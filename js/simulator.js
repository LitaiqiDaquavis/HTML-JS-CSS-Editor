(() => {
const { dirname, normalizePath } = window.HtmlLabStorage;

const RESOURCE_ATTRIBUTES = [
    ["img", "src"], ["script", "src"], ["link", "href"], ["source", "src"],
    ["video", "src"], ["video", "poster"], ["audio", "src"], ["iframe", "src"],
    ["object", "data"], ["a", "href"]
];

function isExternal(value) {
    return /^(?:[a-z][a-z\d+.-]*:|#|\/\/)/i.test(value || "");
}

function resolveVirtualPath(basePath, value) {
    const pathOnly = value.split(/[?#]/, 1)[0];
    let decodedPath = pathOnly;
    try {
        decodedPath = decodeURIComponent(pathOnly);
    } catch {
        // Keep the original path when it contains an invalid escape sequence.
    }
    if (decodedPath.startsWith("/")) return normalizePath(decodedPath);
    return normalizePath(`${dirname(basePath)}/${decodedPath}`);
}

function toDataUrl(content, mime) {
    const blob = content instanceof Blob
        ? content
        : new Blob([content], { type: `${mime};charset=utf-8` });
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(blob);
    });
}

function replaceCssUrls(css, cssPath, buildUrl) {
    const matches = [...css.matchAll(/url\(\s*(["']?)(.*?)\1\s*\)/gi)];
    return Promise.all(matches.map(async match => {
        const raw = match[2].trim();
        if (!raw || isExternal(raw) || raw.startsWith("data:")) return [match[0], match[0]];
        const virtualPath = resolveVirtualPath(cssPath, raw);
        const url = await buildUrl(virtualPath);
        return [match[0], url ? `url("${url}")` : match[0]];
    })).then(replacements => {
        let output = css;
        replacements.forEach(([source, replacement]) => { output = output.replace(source, replacement); });
        return output;
    });
}

async function renderDocument({ html, currentPath, entries, iframe }) {
    const entryMap = new Map(entries.map(entry => [entry.path, entry]));
    const urlCache = new Map();

    async function buildUrl(path, stack = new Set()) {
        const normalized = normalizePath(path);
        if (urlCache.has(normalized)) return urlCache.get(normalized);
        const entry = entryMap.get(normalized);
        if (!entry || entry.type !== "file" || stack.has(normalized)) return null;

        const nextStack = new Set(stack);
        nextStack.add(normalized);
        let content = entry.content;
        let mime = entry.mime || "application/octet-stream";

        if (mime === "text/css" && typeof content === "string") {
            content = await replaceCssUrls(content, normalized, child => buildUrl(child, nextStack));
        } else if (mime === "text/html" && typeof content === "string") {
            content = await transformHtml(content, normalized, buildUrl, nextStack);
        }

        const url = await toDataUrl(content, mime);
        urlCache.set(normalized, url);
        return url;
    }

    async function transformHtml(source, sourcePath, resolver = buildUrl, stack = new Set()) {
        const parser = new DOMParser();
        const documentNode = parser.parseFromString(source, "text/html");
        const jobs = [];

        for (const [selector, attribute] of RESOURCE_ATTRIBUTES) {
            documentNode.querySelectorAll(`${selector}[${attribute}]`).forEach(element => {
                const value = element.getAttribute(attribute);
                if (!value || isExternal(value) || value.startsWith("data:") || value.startsWith("blob:")) return;
                jobs.push((async () => {
                    const virtualPath = resolveVirtualPath(sourcePath, value);
                    const url = await resolver(virtualPath, stack);
                    if (url) element.setAttribute(attribute, url);
                })());
            });
        }

        documentNode.querySelectorAll("[srcset]").forEach(element => {
            const value = element.getAttribute("srcset");
            jobs.push((async () => {
                const parts = await Promise.all(value.split(",").map(async candidate => {
                    const [source, descriptor] = candidate.trim().split(/\s+/, 2);
                    if (isExternal(source) || source.startsWith("data:")) return candidate.trim();
                    const url = await resolver(resolveVirtualPath(sourcePath, source), stack);
                    return `${url || source}${descriptor ? ` ${descriptor}` : ""}`;
                }));
                element.setAttribute("srcset", parts.join(", "));
            })());
        });

        await Promise.all(jobs);
        return `<!DOCTYPE html>\n${documentNode.documentElement.outerHTML}`;
    }

    const renderedHtml = await transformHtml(html, currentPath);
    iframe.srcdoc = renderedHtml;
    return () => {};
}

window.HtmlLabSimulator = { renderDocument };
})();
