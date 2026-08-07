(() => {
const DB_NAME = "html-lab-workspace";
const DB_VERSION = 1;
const STORE_NAME = "entries";
const LOCAL_STORAGE_KEY = `${DB_NAME}:${STORE_NAME}`;

const welcomeHtml = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Hello World</title>
</head>
<body>
    Hello World
</body>
</html>`;

let databasePromise;
let storageModePromise;
const memoryEntries = new Map();

function requestToPromise(request) {
    return new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

function transactionDone(transaction) {
    return new Promise((resolve, reject) => {
        transaction.oncomplete = resolve;
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error);
    });
}

function openDatabase() {
    if (!databasePromise) {
        databasePromise = new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, DB_VERSION);
            request.onupgradeneeded = () => {
                const db = request.result;
                if (!db.objectStoreNames.contains(STORE_NAME)) {
                    db.createObjectStore(STORE_NAME, { keyPath: "path" });
                }
            };
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }
    return databasePromise;
}

function canUseLocalStorage() {
    try {
        const key = `${LOCAL_STORAGE_KEY}:probe`;
        window.localStorage.setItem(key, "1");
        window.localStorage.removeItem(key);
        return true;
    } catch {
        return false;
    }
}

async function selectStorageMode() {
    if (window.location.protocol === "file:") {
        return canUseLocalStorage() ? "localStorage" : "memory";
    }

    try {
        await openDatabase();
        return "indexedDB";
    } catch {
        return canUseLocalStorage() ? "localStorage" : "memory";
    }
}

function getStorageMode() {
    if (!storageModePromise) storageModePromise = selectStorageMode();
    return storageModePromise;
}

function bytesToBase64(bytes) {
    let binary = "";
    const chunkSize = 0x8000;
    for (let index = 0; index < bytes.length; index += chunkSize) {
        binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
    }
    return window.btoa(binary);
}

function base64ToBlob(value, mime) {
    const binary = window.atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index);
    }
    return new Blob([bytes], { type: mime });
}

async function serializeEntry(entry) {
    if (!(entry.content instanceof Blob)) return entry;
    const bytes = new Uint8Array(await entry.content.arrayBuffer());
    return {
        ...entry,
        content: {
            blob: true,
            mime: entry.content.type || entry.mime || "application/octet-stream",
            base64: bytesToBase64(bytes)
        }
    };
}

function deserializeEntry(entry) {
    if (!entry?.content?.blob || typeof entry.content.base64 !== "string") return entry;
    return {
        ...entry,
        content: base64ToBlob(entry.content.base64, entry.content.mime || entry.mime)
    };
}

function readLocalEntries() {
    const raw = window.localStorage.getItem(LOCAL_STORAGE_KEY);
    if (!raw) return [];
    try {
        const entries = JSON.parse(raw);
        return Array.isArray(entries) ? entries : [];
    } catch {
        return [];
    }
}

function writeLocalEntries(entries) {
    window.localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(entries));
}

function sortEntries(entries) {
    return entries.sort((a, b) => {
        if (a.type !== b.type) return a.type === "folder" ? -1 : 1;
        return a.path.localeCompare(b.path, "en");
    });
}

async function listFallbackEntries(mode) {
    const entries = mode === "memory"
        ? [...memoryEntries.values()]
        : readLocalEntries().map(deserializeEntry);
    return sortEntries(entries);
}

async function putFallbackEntry(mode, entry) {
    const normalizedEntry = { ...entry, path: normalizePath(entry.path) };
    if (mode === "memory") {
        memoryEntries.set(normalizedEntry.path, normalizedEntry);
        return;
    }

    const entries = readLocalEntries();
    const storedEntry = await serializeEntry(normalizedEntry);
    const index = entries.findIndex(item => item.path === normalizedEntry.path);
    if (index === -1) entries.push(storedEntry);
    else entries[index] = storedEntry;
    writeLocalEntries(entries);
}

function normalizePath(path) {
    const parts = String(path || "").replace(/\\/g, "/").split("/");
    const normalized = [];
    for (const part of parts) {
        if (!part || part === ".") continue;
        if (part === "..") normalized.pop();
        else normalized.push(part);
    }
    return `/${normalized.join("/")}`;
}

function dirname(path) {
    const normalized = normalizePath(path);
    const index = normalized.lastIndexOf("/");
    return index <= 0 ? "/" : normalized.slice(0, index);
}

function basename(path) {
    return normalizePath(path).split("/").pop() || "";
}

function joinPath(base, child) {
    return normalizePath(`${base}/${child}`);
}

async function initializeWorkspace() {
    const entries = await listEntries();
    if (entries.length) return;
    await putEntry({
        path: "/welcome.html",
        type: "file",
        mime: "text/html",
        encoding: "text",
        content: welcomeHtml,
        updatedAt: Date.now()
    });
}

async function listEntries() {
    const mode = await getStorageMode();
    if (mode !== "indexedDB") return listFallbackEntries(mode);

    const db = await openDatabase();
    const transaction = db.transaction(STORE_NAME, "readonly");
    const request = transaction.objectStore(STORE_NAME).getAll();
    const entries = await requestToPromise(request);
    return sortEntries(entries);
}

async function getEntry(path) {
    const normalizedPath = normalizePath(path);
    const mode = await getStorageMode();
    if (mode === "memory") return memoryEntries.get(normalizedPath);
    if (mode === "localStorage") {
        const entry = readLocalEntries().find(item => item.path === normalizedPath);
        return entry ? deserializeEntry(entry) : undefined;
    }

    const db = await openDatabase();
    const transaction = db.transaction(STORE_NAME, "readonly");
    return requestToPromise(transaction.objectStore(STORE_NAME).get(normalizedPath));
}

async function putEntry(entry) {
    const mode = await getStorageMode();
    if (mode !== "indexedDB") return putFallbackEntry(mode, entry);

    const db = await openDatabase();
    const transaction = db.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).put({ ...entry, path: normalizePath(entry.path) });
    await transactionDone(transaction);
}

async function createFolder(path) {
    await putEntry({ path, type: "folder", updatedAt: Date.now() });
}

async function deleteEntries(paths) {
    const normalizedPaths = paths.map(normalizePath);
    const entries = await listEntries();
    const targets = entries.filter(entry => normalizedPaths.some(path => entry.path === path || entry.path.startsWith(`${path}/`)));
    const mode = await getStorageMode();

    if (mode === "memory") {
        targets.forEach(entry => memoryEntries.delete(entry.path));
        return targets;
    }

    if (mode === "localStorage") {
        const targetPaths = new Set(targets.map(entry => entry.path));
        writeLocalEntries(readLocalEntries().filter(entry => !targetPaths.has(entry.path)));
        return targets;
    }

    const db = await openDatabase();
    const transaction = db.transaction(STORE_NAME, "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    targets.forEach(entry => store.delete(entry.path));
    await transactionDone(transaction);
    return targets;
}

async function importFiles(files, folder = "/") {
    const imported = [];
    for (const file of files) {
        const relative = file.webkitRelativePath || file.name;
        const targetPath = joinPath(folder, relative);
        const mime = file.type || guessMime(file.name);
        const isText = mime.startsWith("text/") || /\.(html?|css|js|mjs|json|svg|xml|txt)$/i.test(file.name);
        const content = isText ? await file.text() : file.slice(0, file.size, mime);
        await putEntry({
            path: targetPath,
            type: "file",
            mime,
            encoding: isText ? "text" : "blob",
            content,
            updatedAt: Date.now()
        });
        imported.push(targetPath);
    }
    return imported;
}

function guessMime(name) {
    const extension = String(name).split(".").pop().toLowerCase();
    const types = {
        html: "text/html", htm: "text/html", css: "text/css", js: "text/javascript",
        mjs: "text/javascript", json: "application/json", svg: "image/svg+xml",
        png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif",
        webp: "image/webp", ico: "image/x-icon", txt: "text/plain",
        mp3: "audio/mpeg", wav: "audio/wav", mp4: "video/mp4", webm: "video/webm"
    };
    return types[extension] || "application/octet-stream";
}

window.HtmlLabStorage = {
    basename,
    createFolder,
    deleteEntries,
    dirname,
    getEntry,
    getStorageMode,
    guessMime,
    importFiles,
    initializeWorkspace,
    joinPath,
    listEntries,
    normalizePath,
    putEntry
};
})();
