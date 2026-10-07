// web/canvas_snapshots.js
import { app } from "../../scripts/app.js";

// Clean vector SVG icons
const ICONS = {
    camera: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path><circle cx="12" cy="13" r="4"></circle></svg>`,
    trash: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>`,
    edit: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"></path></svg>`,
    restore: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"></polyline><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"></path></svg>`,
    check: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`,
    close: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>`
};

class SnapshotDB {
    constructor(dbName = "ComfyUI_Canvas_Snapshots_DB", storeName = "tab_snapshots") {
        this.storeName = storeName;
        this.dbPromise = new Promise((resolve, reject) => {
            const req = indexedDB.open(dbName, 1);
            req.onupgradeneeded = () => {
                const db = req.result;
                if (!db.objectStoreNames.contains(storeName)) {
                    db.createObjectStore(storeName);
                }
            };
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
    }

    async get(key) {
        const db = await this.dbPromise;
        return new Promise((resolve, reject) => {
            const tx = db.transaction(this.storeName, "readonly");
            const req = tx.objectStore(this.storeName).get(key);
            req.onsuccess = () => resolve(req.result || []);
            req.onerror = () => reject(req.error);
        });
    }

    async set(key, val) {
        const db = await this.dbPromise;
        return new Promise((resolve, reject) => {
            const tx = db.transaction(this.storeName, "readwrite");
            const req = tx.objectStore(this.storeName).put(val, key);
            req.onsuccess = () => resolve();
            req.onerror = () => reject(req.error);
        });
    }

    async delete(key) {
        const db = await this.dbPromise;
        return new Promise((resolve, reject) => {
            const tx = db.transaction(this.storeName, "readwrite");
            const req = tx.objectStore(this.storeName).delete(key);
            req.onsuccess = () => resolve();
            req.onerror = () => reject(req.error);
        });
    }

    async getAll() {
        const db = await this.dbPromise;
        return new Promise((resolve, reject) => {
            const tx = db.transaction(this.storeName, "readonly");
            const store = tx.objectStore(this.storeName);
            const results = new Map();
            const req = store.openCursor();
            req.onsuccess = (e) => {
                const cursor = e.target.result;
                if (cursor) {
                    results.set(cursor.key, cursor.value);
                    cursor.continue();
                } else {
                    resolve(results);
                }
            };
            req.onerror = () => reject(req.error);
        });
    }
}

class SnapshotManager {
    constructor() {
        this.db = new SnapshotDB();
        this.snapshotsByTab = new Map();
        this.containerEl = null;
        this.currentTabId = null;
        this.noticeTimeout = null;
        this.isSystemReady = false;

        this.loadFromDB();
        this.initHooks();

        setTimeout(() => {
            this.isSystemReady = true;
        }, 2200);
    }

    async loadFromDB() {
        try {
            this.snapshotsByTab = await this.db.getAll();
            this.render();
        } catch (e) {
            console.warn("[Snapshots] Failed to load from IndexedDB:", e);
            this.snapshotsByTab = new Map();
        }
    }

    async saveTabToDB(tabId) {
        const list = this.snapshotsByTab.get(tabId) || [];
        await this.db.set(tabId, list);
    }

    async deleteTabFromDB(tabId) {
        this.snapshotsByTab.delete(tabId);
        await this.db.delete(tabId);
    }

    sanitizeName(name) {
        if (!name) return "Untitled";
        return name.replace(/[\*\s]+$/, "").trim() || "Untitled";
    }

    isTabElementActive(el) {
        if (!el) return false;
        return (
            el.getAttribute("aria-pressed") === "true" ||
            el.getAttribute("aria-checked") === "true" ||
            el.getAttribute("data-p-checked") === "true" ||
            el.getAttribute("data-p-active") === "true" ||
            el.classList.contains("p-togglebutton-checked") ||
            el.classList.contains("p-togglebutton-active") ||
            el.classList.contains("p-highlight") ||
            el.classList.contains("active") ||
            el.classList.contains("selected") ||
            !!el.querySelector("[aria-pressed='true'], [data-p-checked='true'], .p-togglebutton-checked, .active")
        );
    }

    getTabSystemInfo() {
        // Priority 1: Pinia Store
        if (window.__PINIA__?._s) {
            for (const store of window.__PINIA__._s.values()) {
                const active = store.activeWorkflow;
                const openList = store.openWorkflows || store.workflows;
                if (active?.id && Array.isArray(openList)) {
                    return {
                        activeId: `wf_${active.id}`,
                        activeName: this.sanitizeName(active.name || active.filename),
                        aliveIds: new Set(openList.map(w => `wf_${w.id}`))
                    };
                }
            }
        }

        // Priority 2: Pinia state
        if (window.__PINIA__?.state?.value) {
            for (const state of Object.values(window.__PINIA__.state.value)) {
                if (state.activeWorkflowId) {
                    const openList = state.openWorkflows || state.workflows || [];
                    const aliveIds = new Set(Array.isArray(openList) ? openList.map(w => `wf_${w.id || w}`) : []);
                    aliveIds.add(`wf_${state.activeWorkflowId}`);
                    return {
                        activeId: `wf_${state.activeWorkflowId}`,
                        activeName: "Workflow",
                        aliveIds: aliveIds
                    };
                }
            }
        }

        // Priority 3: DOM Tab Elements
        const tabEls = Array.from(document.querySelectorAll(
            ".workflow-tabs [data-testid^='workflow-tab-'], " +
            ".workflow-tabs .p-togglebutton, " +
            ".workflow-tab-button, " +
            ".workflow-tab, " +
            "[data-testid^='workflow-tab-']"
        ));

        if (tabEls.length > 0) {
            const aliveIds = new Set();
            let activeId = null;
            let activeName = "Untitled";

            tabEls.forEach((el, index) => {
                const testId = el.getAttribute("data-testid") || el.querySelector("[data-testid^='workflow-tab-']")?.getAttribute("data-testid") || "";
                let tabUid = null;

                if (testId.startsWith("workflow-tab-")) {
                    tabUid = `wf_${testId.replace("workflow-tab-", "")}`;
                } else if (el.dataset.id || el.dataset.workflowId) {
                    tabUid = `wf_${el.dataset.id || el.dataset.workflowId}`;
                } else {
                    tabUid = `tab_pos_${index}`;
                }

                aliveIds.add(tabUid);

                if (this.isTabElementActive(el)) {
                    activeId = tabUid;
                    activeName = this.sanitizeName(el.getAttribute("title") || el.textContent);
                }
            });

            if (activeId) {
                return { activeId, activeName, aliveIds };
            }
        }

        // Priority 4: Fallback single tab
        return {
            activeId: "default_single_workflow",
            activeName: "Default",
            aliveIds: new Set(["default_single_workflow"])
        };
    }

    getActiveTabId() {
        return this.getTabSystemInfo().activeId;
    }

    async cleanupStaleTabs() {
        if (!this.isSystemReady || this.snapshotsByTab.size === 0) return;

        const { aliveIds } = this.getTabSystemInfo();
        if (!aliveIds || aliveIds.size === 0) return;

        for (const tabKey of Array.from(this.snapshotsByTab.keys())) {
            if (!aliveIds.has(tabKey)) {
                await this.deleteTabFromDB(tabKey);
            }
        }
    }

    getCurrentSnapshots() {
        const tabId = this.getActiveTabId();
        if (!this.snapshotsByTab.has(tabId)) {
            this.snapshotsByTab.set(tabId, []);
        }
        return this.snapshotsByTab.get(tabId);
    }

    checkTabSwitch() {
        const activeId = this.getActiveTabId();
        if (activeId && activeId !== this.currentTabId) {
            this.render();
        }
    }

    initHooks() {
        document.addEventListener("click", (e) => {
            const closeBtn = e.target.closest(
                ".close-button, .p-tabview-close, [aria-label='Close'], .workflow-tab-close"
            );

            if (closeBtn) {
                const tabEl = closeBtn.closest(".p-togglebutton, .workflow-tab, [data-testid^='workflow-tab-']");
                let closedId = null;

                if (tabEl) {
                    const testId = tabEl.getAttribute("data-testid") || "";
                    if (testId.startsWith("workflow-tab-")) {
                        closedId = `wf_${testId.replace("workflow-tab-", "")}`;
                    }
                }

                if (closedId && this.snapshotsByTab.has(closedId)) {
                    this.deleteTabFromDB(closedId);
                }

                setTimeout(() => {
                    this.cleanupStaleTabs();
                    this.checkTabSwitch();
                }, 80);
                return;
            }

            setTimeout(() => this.checkTabSwitch(), 50);
            setTimeout(() => this.checkTabSwitch(), 220);
        }, true);

        setInterval(() => {
            if (this.isSystemReady) {
                this.cleanupStaleTabs();
            }

            if (this.containerEl && this.containerEl.offsetParent !== null) {
                const activeId = this.getActiveTabId();
                if (activeId !== this.currentTabId) {
                    this.render();
                } else {
                    this.updateDiffStatuses();
                }
            }
        }, 500);
    }

    computeDiff(currentData, snapData) {
        let diffCount = 0;
        const curNodes = currentData?.nodes || [];
        const snapNodes = snapData?.nodes || [];

        const curMap = new Map(curNodes.map(n => [n.id, n]));
        const snapMap = new Map(snapNodes.map(n => [n.id, n]));

        for (const [id, sNode] of snapMap) {
            const cNode = curMap.get(id);
            if (!cNode || cNode.type !== sNode.type) {
                diffCount++;
                continue;
            }

            const sWidgets = sNode.widgets_values || [];
            const cWidgets = cNode.widgets_values || [];
            const maxLen = Math.max(sWidgets.length, cWidgets.length);
            for (let i = 0; i < maxLen; i++) {
                if (sWidgets[i] !== cWidgets[i]) {
                    diffCount++;
                }
            }
        }

        for (const [id] of curMap) {
            if (!snapMap.has(id)) {
                diffCount++;
            }
        }

        const curLinks = currentData?.links || [];
        const snapLinks = snapData?.links || [];
        if (curLinks.length !== snapLinks.length) {
            diffCount += Math.abs(curLinks.length - snapLinks.length);
        }

        return diffCount;
    }

    showDuplicateNotice(existingSnap) {
        const noticeEl = this.containerEl?.querySelector("#snap-notice");
        if (noticeEl) {
            noticeEl.innerText = `State already exists: "${existingSnap.name}"`;
            noticeEl.style.display = "block";

            if (this.noticeTimeout) clearTimeout(this.noticeTimeout);
            this.noticeTimeout = setTimeout(() => {
                if (noticeEl) noticeEl.style.display = "none";
            }, 3000);
        }

        const card = this.containerEl?.querySelector(`[data-snap-id="${existingSnap.id}"]`);
        if (card) {
            card.scrollIntoView({ behavior: "smooth", block: "nearest" });
            card.style.transition = "border-color 0.2s, box-shadow 0.2s";
            card.style.borderColor = "#facc15";
            card.style.boxShadow = "0 0 10px rgba(250, 204, 21, 0.4)";
            setTimeout(() => {
                card.style.borderColor = "#333";
                card.style.boxShadow = "none";
            }, 2000);
        }
    }

    async takeSnapshot() {
        const graphData = app.graph.serialize();
        const tabId = this.getActiveTabId();
        const snapshots = this.getCurrentSnapshots();

        const duplicate = snapshots.find(s => this.computeDiff(graphData, s.data) === 0);
        if (duplicate) {
            this.showDuplicateNotice(duplicate);
            return;
        }

        const timeStr = new Date().toLocaleString(undefined, {
            year: '2-digit',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        });
        const snapshot = {
            id: Date.now(),
            name: `Snapshot #${snapshots.length + 1}`,
            time: timeStr,
            nodeCount: graphData.nodes ? graphData.nodes.length : 0,
            data: structuredClone(graphData),
            isEditing: false
        };

        snapshots.unshift(snapshot);
        await this.saveTabToDB(tabId);
        this.render();
    }

    restore(id) {
        const snapshots = this.getCurrentSnapshots();
        const snap = snapshots.find(s => s.id === id);
        if (!snap) return;

        const dataToLoad = structuredClone(snap.data);

        try {
            if (typeof app.clean === "function") {
                app.clean();
            } else {
                app.graph.clear();
            }

            app.graph.configure(dataToLoad, true);

            if (app.graph.setDirtyCanvas) {
                app.graph.setDirtyCanvas(true, true);
            }
            if (app.canvas) {
                app.canvas.setDirty(true, true);
                app.canvas.draw(true, true);
            }
        } catch (err) {
            console.error("[Snapshots] Direct in-place restore failed, fallback to loadGraphData:", err);
            app.loadGraphData(dataToLoad, true, false);
        }

        this.render();
    }

    async delete(id) {
        const tabId = this.getActiveTabId();
        const snapshots = this.getCurrentSnapshots().filter(s => s.id !== id);
        this.snapshotsByTab.set(tabId, snapshots);
        await this.saveTabToDB(tabId);
        this.render();
    }

    async rename(id, newName) {
        const tabId = this.getActiveTabId();
        const snapshots = this.getCurrentSnapshots();
        const snap = snapshots.find(s => s.id === id);
        if (snap && newName.trim()) {
            snap.name = newName.trim();
        }
        if (snap) snap.isEditing = false;
        await this.saveTabToDB(tabId);
        this.render();
    }

    updateDiffStatuses() {
        if (!this.containerEl) return;
        const currentData = app.graph.serialize();
        const snapshots = this.getCurrentSnapshots();

        snapshots.forEach(snap => {
            const card = this.containerEl.querySelector(`[data-snap-id="${snap.id}"]`);
            if (!card) return;

            const diff = this.computeDiff(currentData, snap.data);
            const diffLabel = card.querySelector(".diff-label");
            const restoreBtn = card.querySelector(".restore-btn");
            
            if (restoreBtn) {
                restoreBtn.disabled = false;
                restoreBtn.innerHTML = `<span style="display: flex; align-items: center; justify-content: center; gap: 6px;">${ICONS.restore} Restore Canvas</span>`;
                restoreBtn.style.background = "#2563eb";
                restoreBtn.style.color = "#fff";
                restoreBtn.style.borderColor = "#3b82f6";
                restoreBtn.style.cursor = "pointer";
                restoreBtn.style.opacity = "1";
            }

            if (diff === 0) {
                if (diffLabel) {
                    diffLabel.innerText = "Current State";
                    diffLabel.style.color = "#34C759";
                }
                if (restoreBtn) {
                    restoreBtn.disabled = true;
                    restoreBtn.style.background = "#242424";
                    restoreBtn.style.color = "#555";
                    restoreBtn.style.borderColor = "#333";
                    restoreBtn.style.cursor = "not-allowed";
                    restoreBtn.style.opacity = "0.6";
                }
            } else {
                if (diffLabel) {
                    diffLabel.innerText = `${diff} change(s)`;
                    diffLabel.style.color = "#e5c07b";
                }
            }
        });
    }

    render() {
        if (!this.containerEl) return;
        this.currentTabId = this.getActiveTabId();
        const snapshots = this.getCurrentSnapshots();

        this.containerEl.innerHTML = `
            <div style="display: flex; flex-direction: column; height: 100%; box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #ddd; overflow: hidden;">
                <!-- Native ComfyUI Panel Title Header -->
                <div style="
                    padding: 12px 16px;
                    min-height: 64px;
                    border-bottom: 1px solid var(--border-color, #282828);
                    display: flex;
                    align-items: center;
                    background: transparent;
                ">
                    <span style="font-size: 16px; font-weight: 700; color: #eee; letter-spacing: 0.3px;">
                        Snapshots
                    </span>
                </div>

                <!-- Panel Content Container -->
                <div style="flex: 1; display: flex; flex-direction: column; padding: 12px; gap: 12px; overflow: hidden;">
                    <!-- Header Actions -->
                    <div style="display: flex; gap: 8px;">
                        <button id="snap-btn-create" style="
                            flex: 1; padding: 8px 12px; background: #2563eb; color: #fff; border: 1px solid #3b82f6; 
                            border-radius: 6px; cursor: pointer; font-size: 12px; font-weight: 600;
                            display: flex; align-items: center; justify-content: center; gap: 6px;
                        ">
                            ${ICONS.camera} <span>Capture Snapshot</span>
                        </button>
                        <button id="snap-btn-clear-all" style="
                            padding: 8px 12px; background: rgba(220, 38, 38, 0.15); color: #f87171; border: 1px solid rgba(220, 38, 38, 0.4);
                            border-radius: 6px; cursor: pointer; font-size: 12px; font-weight: 600;
                            transition: background 0.2s; display: flex; align-items: center; justify-content: center; gap: 6px;
                        " title="Clear all snapshots for this tab">
                            ${ICONS.trash} <span>Clear All</span>
                        </button>
                    </div>

                    <!-- Duplicate Notice Bar -->
                    <div id="snap-notice" style="
                        display: none; padding: 7px 10px; border-radius: 6px; font-size: 11px;
                        background: rgba(234, 179, 8, 0.15); border: 1px solid rgba(234, 179, 8, 0.4);
                        color: #facc15; font-weight: 500; text-align: center;
                    "></div>

                    <!-- Info Header -->
                    <div style="font-size: 11px; color: #777; display: flex; justify-content: space-between; border-bottom: 1px solid #333; padding-bottom: 6px;">
                        <span>Snapshot List</span>
                        <span>${snapshots.length} snapshot(s)</span>
                    </div>

                    <!-- Snapshots List -->
                    <div id="snap-items-list" style="
                        flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 8px;
                    "></div>
                </div>
            </div>
        `;

        this.containerEl.querySelector("#snap-btn-create").onclick = () => this.takeSnapshot();
        this.containerEl.querySelector("#snap-btn-clear-all").onclick = async () => {
            if (snapshots.length === 0) return;
            if (confirm("Clear all snapshots for this tab?")) {
                await this.deleteTabFromDB(this.currentTabId);
                this.render();
            }
        };

        const listContainer = this.containerEl.querySelector("#snap-items-list");

        if (snapshots.length === 0) {
            listContainer.innerHTML = `
                <div style="text-align: center; color: #666; font-size: 12px; margin-top: 40px; line-height: 1.5;">
                    No snapshots for this workflow tab.<br/><br/>
                    Click “Capture Snapshot” to save current state.<br/>
                    Snapshots will be cleared when the tab is closed.
                </div>
            `;
            return;
        }

        snapshots.forEach(snap => {
            const card = document.createElement("div");
            card.setAttribute("data-snap-id", snap.id);
            card.style.cssText = `
                background: #202020; border: 1px solid #333; border-radius: 6px;
                padding: 10px; display: flex; flex-direction: column; gap: 6px;
            `;

            // Card Header
            const header = document.createElement("div");
            header.style.cssText = "display: flex; justify-content: space-between; align-items: center; gap: 6px;";

            if (snap.isEditing) {
                header.innerHTML = `
                    <div style="display: flex; gap: 4px; width: 100%;">
                        <input type="text" class="rename-input" value="${snap.name}" style="
                            flex: 1; background: #141414; border: 1px solid #2563eb; color: #fff;
                            padding: 3px 6px; border-radius: 4px; font-size: 12px; outline: none;
                        "/>
                        <button class="save-name-btn" style="background: #2563eb; color: #fff; border: none; padding: 3px 8px; border-radius: 4px; cursor: pointer; display: flex; align-items: center;" title="Save">${ICONS.check}</button>
                        <button class="cancel-name-btn" style="background: #333; color: #bbb; border: none; padding: 3px 8px; border-radius: 4px; cursor: pointer; display: flex; align-items: center;" title="Cancel">${ICONS.close}</button>
                    </div>
                `;
                const input = header.querySelector(".rename-input");
                setTimeout(() => input.focus(), 10);

                const save = () => this.rename(snap.id, input.value);
                header.querySelector(".save-name-btn").onclick = save;
                header.querySelector(".cancel-name-btn").onclick = () => { snap.isEditing = false; this.render(); };
                input.onkeydown = (e) => {
                    if (e.key === "Enter") save();
                    if (e.key === "Escape") { snap.isEditing = false; this.render(); }
                };
            } else {
                header.innerHTML = `
                    <div style="display: flex; align-items: center; gap: 6px; overflow: hidden; flex: 1;">
                        <span class="snap-title" style="font-weight: 600; font-size: 12px; color: #eee; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; cursor: pointer;" title="Double click to rename">
                            ${snap.name}
                        </span>
                        <button class="rename-trigger" style="background: none; border: none; color: #666; cursor: pointer; padding: 2px; display: flex; align-items: center;" title="Rename">${ICONS.edit}</button>
                    </div>
                    <button class="del-btn" style="background: none; border: none; color: #ef4444; cursor: pointer; padding: 2px; display: flex; align-items: center;" title="Delete">${ICONS.trash}</button>
                `;

                header.querySelector(".snap-title").ondblclick = () => { snap.isEditing = true; this.render(); };
                header.querySelector(".rename-trigger").onclick = () => { snap.isEditing = true; this.render(); };
                header.querySelector(".del-btn").onclick = () => this.delete(snap.id);
            }

            // Metadata & Diff Label
            const meta = document.createElement("div");
            meta.style.cssText = "font-size: 11px; color: #777; display: flex; justify-content: space-between;";
            meta.innerHTML = `
                <span>${snap.time} (${snap.nodeCount} nodes)</span>
                <span class="diff-label">Calculating...</span>
            `;

            // Action: In-Place Restore Button
            const actions = document.createElement("div");
            actions.innerHTML = `
                <button class="restore-btn" style="
                    width: 100%; padding: 6px 0; border-radius: 4px; font-size: 11px; font-weight: 600;
                    transition: all 0.2s; border: 1px solid transparent;
                ">
                    Restore Canvas
                </button>
            `;
            actions.querySelector(".restore-btn").onclick = () => this.restore(snap.id);

            card.appendChild(header);
            card.appendChild(meta);
            card.appendChild(actions);
            listContainer.appendChild(card);
        });

        this.updateDiffStatuses();
    }
}

// Extension Registration
app.registerExtension({
    name: "ComfyUI.CanvasSnapshots",
    async setup() {
        const manager = new SnapshotManager();

        if (app.extensionManager && app.extensionManager.registerSidebarTab) {
            app.extensionManager.registerSidebarTab({
                id: "canvas-snapshots-tab",
                icon: "pi pi-camera",
                title: "Snapshots",
                tooltip: "Canvas Snapshots",
                type: "custom",
                render: (el) => {
                    manager.containerEl = el;
                    manager.render();
                }
            });
        }
    }
});