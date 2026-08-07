const {
    basename, createFolder, deleteEntries, dirname, getEntry, guessMime,
    importFiles, initializeWorkspace, joinPath, listEntries, normalizePath, putEntry
} = window.HtmlLabStorage;
const { renderDocument } = window.HtmlLabSimulator;

const elements = {
    menuButton: document.querySelector("#menuButton"),
    drawer: document.querySelector("#drawer"),
    fileTree: document.querySelector("#fileTree"),
    editor: document.querySelector("#editor"),
    lineNumber: document.querySelector("#lineNumber"),
    cursorStatus: document.querySelector("#cursorStatus"),
    editorTitle: document.querySelector("#editorTitle"),
    fileType: document.querySelector("#fileType"),
    activePath: document.querySelector("#activePath"),
    previewAddress: document.querySelector("#previewAddress"),
    documentState: document.querySelector("#documentState"),
    preview: document.querySelector("#preview"),
    previewEmpty: document.querySelector("#previewEmpty"),
    linkedPages: document.querySelector("#linkedPages"),
    refreshButton: document.querySelector("#refreshButton"),
    uploadButton: document.querySelector("#uploadButton"),
    uploadInput: document.querySelector("#uploadInput"),
    newFileButton: document.querySelector("#newFileButton"),
    saveButton: document.querySelector("#saveButton"),
    downloadButton: document.querySelector("#downloadButton"),
    deleteButton: document.querySelector("#deleteButton"),
    inputDialog: document.querySelector("#inputDialog"),
    inputForm: document.querySelector("#inputForm"),
    inputDialogTitle: document.querySelector("#inputDialogTitle"),
    closeInputButton: document.querySelector("#closeInputButton"),
    createTypeStep: document.querySelector("#createTypeStep"),
    createNameStep: document.querySelector("#createNameStep"),
    createPathStep: document.querySelector("#createPathStep"),
    createTypeButtons: document.querySelectorAll("[data-create-type]"),
    itemNameLabel: document.querySelector("#itemNameLabel"),
    itemName: document.querySelector("#itemName"),
    inputDialogHint: document.querySelector("#inputDialogHint"),
    inputError: document.querySelector("#inputError"),
    destinationFolder: document.querySelector("#destinationFolder"),
    createSummary: document.querySelector("#createSummary"),
    pathError: document.querySelector("#pathError"),
    backToTypeButton: document.querySelector("#backToTypeButton"),
    backToNameButton: document.querySelector("#backToNameButton"),
    confirmDialog: document.querySelector("#confirmDialog"),
    confirmMessage: document.querySelector("#confirmMessage"),
    confirmDeleteButton: document.querySelector("#confirmDeleteButton"),
    toast: document.querySelector("#toast")
};

const state = {
    entries: [],
    currentPath: "/welcome.html",
    currentFolder: "/",
    currentMime: "text/html",
    currentType: "html",
    cssPreviewPath: null,
    dirty: false,
    expandedFolders: new Set(["/"]),
    selecting: false,
    selectedPaths: new Set(),
    dialogMode: null,
    dialogStep: "type",
    pendingName: "",
    renderTimer: null,
    toastTimer: null,
    cleanupPreview: null
};

function escapeHtml(value) {
    return String(value).replace(/[&<>'"]/g, character => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"
    })[character]);
}

function showToast(message) {
    clearTimeout(state.toastTimer);
    elements.toast.textContent = message;
    elements.toast.hidden = false;
    state.toastTimer = setTimeout(() => { elements.toast.hidden = true; }, 2600);
}

function setDirty(dirty) {
    state.dirty = dirty;
    elements.documentState.textContent = dirty ? "Unsaved" : "Saved";
    elements.documentState.classList.toggle("unsaved", dirty);
}

function getEditableType(path) {
    if (/\.html?$/i.test(path)) return "html";
    if (/\.css$/i.test(path)) return "css";
    if (/\.js$/i.test(path)) return "js";
    return null;
}

function mimeForType(type) {
    if (type === "css") return "text/css";
    if (type === "js") return "text/javascript";
    return "text/html";
}

function initialContentForType(type) {
    if (type === "css") {
        return ":root {\n    color-scheme: light;\n}\n\nbody {\n    margin: 0;\n}\n";
    }
    if (type === "js") return 'console.log("Hello World");\n';
    return "<!DOCTYPE html>\n<html lang=\"en\">\n<head>\n    <meta charset=\"UTF-8\">\n    <meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\">\n    <title>New Page</title>\n</head>\n<body>\n    \n</body>\n</html>";
}

function resolveVirtualReference(sourcePath, reference) {
    if (!reference || /^(?:[a-z][a-z\d+.-]*:|#|\/\/)/i.test(reference)) return null;
    const pathOnly = reference.split(/[?#]/, 1)[0];
    let decodedPath = pathOnly;
    try {
        decodedPath = decodeURIComponent(pathOnly);
    } catch {
        // Keep malformed escapes unchanged so they simply fail to match.
    }
    if (decodedPath.startsWith("/")) return normalizePath(decodedPath);
    return normalizePath(`${dirname(sourcePath)}/${decodedPath}`);
}

function findLinkedHtmlEntries(cssPath) {
    const parser = new DOMParser();
    return state.entries.filter(entry => {
        if (entry.type !== "file" || !/\.html?$/i.test(entry.path) || typeof entry.content !== "string") return false;
        const documentNode = parser.parseFromString(entry.content, "text/html");
        return [...documentNode.querySelectorAll('link[href]')].some(link => {
            const relations = (link.getAttribute("rel") || "").toLowerCase().split(/\s+/);
            if (!relations.includes("stylesheet")) return false;
            return resolveVirtualReference(entry.path, link.getAttribute("href")) === cssPath;
        });
    });
}

function openDrawer() {
    elements.drawer.setAttribute("aria-hidden", "false");
    document.body.classList.add("drawer-open");
    requestAnimationFrame(() => elements.drawer.classList.add("open"));
}

function toggleDrawer() {
    if (document.body.classList.contains("drawer-open")) closeDrawer();
    else openDrawer();
}

function closeDrawer() {
    elements.drawer.classList.remove("open");
    elements.drawer.setAttribute("aria-hidden", "true");
    document.body.classList.remove("drawer-open");
}

function childEntries(folderPath) {
    return state.entries.filter(entry => dirname(entry.path) === folderPath);
}

function renderTree() {
    if (!state.entries.length) {
        elements.fileTree.innerHTML = '<p class="tree-empty">No files yet. Create one to get started.</p>';
        return;
    }

    const rows = [];
    function addChildren(folderPath, depth) {
        childEntries(folderPath).forEach(entry => {
            const isFolder = entry.type === "folder";
            const isExpanded = state.expandedFolders.has(entry.path);
            const isActive = entry.path === state.currentPath;
            const isSelected = state.selectedPaths.has(entry.path);
            const extension = isFolder ? "" : (basename(entry.path).split(".").pop() || "").toUpperCase();
            rows.push(`
                <div class="tree-row${isActive ? " active" : ""}${isSelected ? " selected" : ""}"
                    data-path="${escapeHtml(entry.path)}" data-type="${entry.type}" style="padding-left:${8 + depth * 17}px">
                    ${state.selecting ? `<input class="tree-check" type="checkbox" aria-label="Select ${escapeHtml(basename(entry.path))}" ${isSelected ? "checked" : ""}>` : '<span class="tree-toggle">' + (isFolder ? (isExpanded ? "&#9662;" : "&#9656;") : "") + '</span>'}
                    <span class="tree-icon">${isFolder ? "&#9632;" : "&#9707;"}</span>
                    <span class="tree-name">${escapeHtml(basename(entry.path))}</span>
                    <span class="tree-meta">${extension}</span>
                </div>`);
            if (isFolder && isExpanded) addChildren(entry.path, depth + 1);
        });
    }
    addChildren("/", 0);
    elements.fileTree.innerHTML = rows.join("") || '<p class="tree-empty">This folder is empty.</p>';
}

async function refreshEntries() {
    state.entries = await listEntries();
    renderTree();
}

async function openEditableFile(path) {
    const entry = await getEntry(path);
    if (!entry || entry.type !== "file") return;
    const editableType = getEditableType(entry.path);
    if (!editableType) {
        showToast("Only HTML, CSS, and JavaScript files can be edited");
        return;
    }
    state.currentPath = entry.path;
    state.currentFolder = dirname(entry.path);
    state.currentType = editableType;
    state.currentMime = entry.mime || mimeForType(editableType);
    state.cssPreviewPath = null;
    elements.editor.value = typeof entry.content === "string" ? entry.content : await entry.content.text();
    elements.editorTitle.textContent = basename(entry.path);
    elements.fileType.textContent = editableType === "js" ? "JS" : editableType.toUpperCase();
    elements.activePath.textContent = entry.path;
    elements.previewAddress.textContent = `site://${entry.path}`;
    setDirty(false);
    updateEditorChrome();
    renderTree();
    await updatePreview();
    closeDrawer();
}

function updateEditorChrome() {
    const lines = elements.editor.value.split("\n").length;
    elements.lineNumber.textContent = Array.from({ length: lines }, (_, index) => index + 1).join("\n");
    const cursor = elements.editor.selectionStart;
    const beforeCursor = elements.editor.value.slice(0, cursor).split("\n");
    elements.cursorStatus.textContent = `Line ${beforeCursor.length}, Column ${beforeCursor.at(-1).length + 1}`;
    elements.lineNumber.scrollTop = elements.editor.scrollTop;
}

async function updatePreview() {
    clearTimeout(state.renderTimer);
    if (state.cleanupPreview) state.cleanupPreview();
    state.cleanupPreview = null;

    if (state.currentType === "js") {
        elements.linkedPages.hidden = true;
        elements.linkedPages.innerHTML = "";
        elements.preview.hidden = true;
        elements.previewEmpty.hidden = false;
        elements.previewEmpty.textContent = "JavaScript files do not have a standalone preview";
        elements.refreshButton.disabled = true;
        return;
    }

    let html = elements.editor.value;
    let previewPath = state.currentPath;
    let previewEntries = state.entries;

    if (state.currentType === "css") {
        const linkedEntries = findLinkedHtmlEntries(state.currentPath);
        if (!linkedEntries.some(entry => entry.path === state.cssPreviewPath)) {
            state.cssPreviewPath = linkedEntries[0]?.path || null;
        }
        elements.linkedPages.innerHTML = linkedEntries.map(entry => `
            <button type="button" class="${entry.path === state.cssPreviewPath ? "active" : ""}"
                data-preview-path="${escapeHtml(entry.path)}" title="${escapeHtml(entry.path)}">
                ${escapeHtml(basename(entry.path))}
            </button>`).join("");
        elements.linkedPages.hidden = linkedEntries.length === 0;

        const targetEntry = linkedEntries.find(entry => entry.path === state.cssPreviewPath);
        if (!targetEntry) {
            elements.preview.hidden = true;
            elements.previewEmpty.hidden = false;
            elements.previewEmpty.textContent = "No HTML file links to this CSS file";
            elements.previewAddress.textContent = `site://${state.currentPath}`;
            elements.refreshButton.disabled = true;
            return;
        }

        html = targetEntry.content;
        previewPath = targetEntry.path;
        previewEntries = state.entries.map(entry => entry.path === state.currentPath
            ? { ...entry, content: elements.editor.value, mime: "text/css", encoding: "text" }
            : entry);
    } else {
        elements.linkedPages.hidden = true;
        elements.linkedPages.innerHTML = "";
    }

    elements.previewAddress.textContent = `site://${previewPath}`;
    elements.preview.hidden = false;
    elements.previewEmpty.hidden = true;
    elements.refreshButton.disabled = false;
    state.cleanupPreview = await renderDocument({
        html,
        currentPath: previewPath,
        entries: previewEntries,
        iframe: elements.preview
    });
}

function schedulePreview() {
    clearTimeout(state.renderTimer);
    state.renderTimer = setTimeout(updatePreview, 180);
}

async function saveCurrent() {
    await putEntry({
        path: state.currentPath,
        type: "file",
        mime: state.currentMime,
        encoding: "text",
        content: elements.editor.value,
        updatedAt: Date.now()
    });
    await refreshEntries();
    setDirty(false);
    showToast("File saved");
}

function showCreateStep(step) {
    state.dialogStep = step;
    elements.createTypeStep.hidden = step !== "type";
    elements.createNameStep.hidden = step !== "name";
    elements.createPathStep.hidden = step !== "path";
}

function openInputDialog() {
    state.dialogMode = null;
    state.pendingName = "";
    elements.inputDialogTitle.textContent = "New File / Folder";
    elements.itemName.value = "";
    elements.inputError.textContent = "";
    elements.pathError.textContent = "";
    showCreateStep("type");
    elements.inputDialog.showModal();
}

function chooseCreateType(mode) {
    state.dialogMode = mode;
    const isFolder = mode === "folder";
    elements.inputDialogTitle.textContent = isFolder ? "New Folder" : "New File";
    elements.itemNameLabel.textContent = isFolder ? "Folder name" : "File name";
    elements.itemName.placeholder = isFolder ? "For example: assets" : "For example: index.html, style.css, or app.js";
    elements.inputDialogHint.textContent = isFolder
        ? "Enter a folder name, then choose its destination."
        : "Supports HTML, CSS, and JavaScript. Choose the destination next.";
    elements.inputError.textContent = "";
    showCreateStep("name");
    setTimeout(() => elements.itemName.focus(), 0);
}

function populateDestinationFolders() {
    const folders = state.entries
        .filter(entry => entry.type === "folder")
        .map(entry => entry.path)
        .sort((a, b) => a.localeCompare(b, "zh-CN"));
    const paths = ["/", ...folders];
    elements.destinationFolder.innerHTML = paths
        .map(path => `<option value="${escapeHtml(path)}">${escapeHtml(path)}</option>`)
        .join("");
    elements.destinationFolder.value = paths.includes(state.currentFolder) ? state.currentFolder : "/";
}

async function createItem(event) {
    event.preventDefault();

    if (state.dialogStep === "name") {
        let name = elements.itemName.value.trim().replace(/[\\/]+/g, "");
        if (!name) {
            elements.inputError.textContent = "Enter a name.";
            return;
        }
        if (state.dialogMode === "file") {
            if (!/\.[^.]+$/.test(name)) name += ".html";
            if (!getEditableType(name)) {
                elements.inputError.textContent = "The file extension must be .html, .htm, .css, or .js.";
                return;
            }
        }
        state.pendingName = name;
        populateDestinationFolders();
        elements.createSummary.textContent = `Ready to create: ${name}`;
        elements.pathError.textContent = "";
        showCreateStep("path");
        return;
    }

    if (state.dialogStep !== "path") return;
    const destination = elements.destinationFolder.value || "/";
    const path = joinPath(destination, state.pendingName);
    if (state.entries.some(entry => entry.path.toLowerCase() === path.toLowerCase())) {
        elements.pathError.textContent = "An item with this name already exists in that folder.";
        return;
    }

    if (state.dialogMode === "folder") {
        await createFolder(path);
        showToast("Folder created");
    } else {
        const newType = getEditableType(path);
        await putEntry({
            path, type: "file", mime: mimeForType(newType), encoding: "text",
            content: initialContentForType(newType),
            updatedAt: Date.now()
        });
    }
    state.expandedFolders.add(destination);
    elements.inputDialog.close();
    await refreshEntries();
    if (state.dialogMode === "file") await openEditableFile(path);
}

function toggleSelectionMode(enabled) {
    state.selecting = enabled;
    if (!enabled) state.selectedPaths.clear();
    elements.deleteButton.textContent = enabled ? "Cancel" : "Manage";
    elements.deleteButton.disabled = false;
    updateSelectionCount();
    renderTree();
}

function updateSelectionCount() {
    if (state.selecting) {
        elements.deleteButton.textContent = state.selectedPaths.size > 0 ? "Delete Selected" : "Cancel";
    }
    elements.deleteButton.disabled = false;
}

function requestDelete() {
    if (!state.selecting) {
        toggleSelectionMode(true);
        return;
    }
    const count = state.selectedPaths.size;
    if (!count) {
        toggleSelectionMode(false);
        return;
    }
    elements.confirmMessage.textContent = count === 1
        ? "Are you sure you want to delete this item?"
        : "Are you sure you want to delete these items?";
    elements.confirmDialog.showModal();
}

async function confirmDelete() {
    const paths = [...state.selectedPaths];
    const removed = await deleteEntries(paths);
    const currentRemoved = removed.some(entry => entry.path === state.currentPath);
    toggleSelectionMode(false);
    await refreshEntries();
    if (currentRemoved) {
        const nextEditable = state.entries.find(entry => entry.type === "file" && getEditableType(entry.path));
        if (nextEditable) await openEditableFile(nextEditable.path);
        else {
            elements.editor.value = "";
            elements.editorTitle.textContent = "No editable files";
            elements.fileType.textContent = "";
            elements.activePath.textContent = "/";
            elements.preview.hidden = true;
            elements.previewEmpty.hidden = false;
            elements.previewEmpty.textContent = "No preview available";
        }
    }
    showToast(`Deleted ${removed.length} item${removed.length === 1 ? "" : "s"}`);
}

function downloadCurrent() {
    const blob = new Blob([elements.editor.value], { type: `${state.currentMime};charset=utf-8` });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = basename(state.currentPath);
    anchor.click();
    URL.revokeObjectURL(url);
}

async function handleUploads(files) {
    if (!files.length) return;
    const imported = await importFiles(files, state.currentFolder);
    await refreshEntries();
    showToast(`Uploaded ${imported.length} file${imported.length === 1 ? "" : "s"}`);
}

elements.menuButton.addEventListener("click", toggleDrawer);
elements.refreshButton.addEventListener("click", updatePreview);
elements.newFileButton.addEventListener("click", openInputDialog);
elements.closeInputButton.addEventListener("click", () => elements.inputDialog.close());
elements.createTypeButtons.forEach(button => {
    button.addEventListener("click", () => chooseCreateType(button.dataset.createType));
});
elements.backToTypeButton.addEventListener("click", () => {
    state.dialogMode = null;
    elements.inputDialogTitle.textContent = "New File / Folder";
    showCreateStep("type");
});
elements.backToNameButton.addEventListener("click", () => {
    elements.pathError.textContent = "";
    showCreateStep("name");
    setTimeout(() => elements.itemName.focus(), 0);
});
elements.inputForm.addEventListener("submit", createItem);
elements.saveButton.addEventListener("click", saveCurrent);
elements.downloadButton.addEventListener("click", downloadCurrent);
elements.deleteButton.addEventListener("click", requestDelete);
elements.confirmDeleteButton.addEventListener("click", confirmDelete);
elements.linkedPages.addEventListener("click", event => {
    const button = event.target.closest("[data-preview-path]");
    if (!button || state.currentType !== "css") return;
    state.cssPreviewPath = button.dataset.previewPath;
    updatePreview();
});
elements.uploadButton.addEventListener("click", () => elements.uploadInput.click());
elements.uploadInput.addEventListener("change", async () => {
    await handleUploads([...elements.uploadInput.files]);
    elements.uploadInput.value = "";
});

elements.fileTree.addEventListener("click", async event => {
    const row = event.target.closest(".tree-row");
    if (!row) return;
    const path = row.dataset.path;
    if (state.selecting) {
        if (state.selectedPaths.has(path)) state.selectedPaths.delete(path);
        else state.selectedPaths.add(path);
        updateSelectionCount();
        renderTree();
        return;
    }
    if (row.dataset.type === "folder") {
        state.currentFolder = path;
        if (state.expandedFolders.has(path)) state.expandedFolders.delete(path);
        else state.expandedFolders.add(path);
        renderTree();
    } else {
        await openEditableFile(path);
    }
});

elements.editor.addEventListener("input", () => {
    setDirty(true);
    updateEditorChrome();
    schedulePreview();
});
elements.editor.addEventListener("scroll", updateEditorChrome);
elements.editor.addEventListener("click", updateEditorChrome);
elements.editor.addEventListener("keyup", updateEditorChrome);
elements.editor.addEventListener("keydown", event => {
    if (event.key === "Tab") {
        event.preventDefault();
        const start = elements.editor.selectionStart;
        const end = elements.editor.selectionEnd;
        elements.editor.setRangeText("    ", start, end, "end");
        elements.editor.dispatchEvent(new Event("input"));
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        saveCurrent();
    }
});

window.addEventListener("beforeunload", event => {
    if (!state.dirty) return;
    event.preventDefault();
    event.returnValue = "";
});

async function start() {
    await initializeWorkspace();
    await refreshEntries();
    const preferred = await getEntry(state.currentPath);
    const firstEditable = preferred && getEditableType(preferred.path)
        ? preferred
        : state.entries.find(entry => entry.type === "file" && getEditableType(entry.path));
    if (firstEditable) await openEditableFile(firstEditable.path);
}

start().catch(error => {
    console.error(error);
    showToast("Workspace initialization failed. Refresh the page and try again.");
});
