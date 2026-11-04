// OdysSeek v3.4.2 — Background Worker & Interceptor Blindado
const GLOBAL_CITES_KEY = "odysseek::cites_global";

// 1. INTERCEPTOR DE PDFS BLINDADO
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  const url = changeInfo.url || tab?.url || tab?.pendingUrl;
  
  if (!url || url.startsWith("chrome-extension://") || url.includes("pdf-viewer/web/viewer.html") || url.startsWith("file://")) return;
  
  const cleanPath = url.split("?")[0].split("#")[0].toLowerCase();
  if (cleanPath.endsWith(".pdf")) {
    const viewerUrl = chrome.runtime.getURL("pdf-viewer/web/viewer.html") + "?originalUrl=" + encodeURIComponent(url);
    if (tab.url !== viewerUrl && tab.pendingUrl !== viewerUrl) {
      chrome.tabs.update(tabId, { url: viewerUrl });
    }
  }
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: "os-root", title: "OdysSeek", contexts: ["selection", "page"] });
    chrome.contextMenus.create({ id: "os-highlight", parentId: "os-root", title: "✏️ Resaltar selección", contexts: ["selection"] });
    chrome.contextMenus.create({ id: "os-cite", parentId: "os-root", title: "📚 Generar cita bibliográfica", contexts: ["selection", "page"] });
    chrome.contextMenus.create({ id: "os-note", parentId: "os-root", title: "📝 Guardar como anotación", contexts: ["selection"] });
    chrome.contextMenus.create({ id: "os-clear", parentId: "os-root", title: "🧹 Limpiar resaltados", contexts: ["page"] });
  });
});

// Extractor universal de URL limpia
function getCleanTargetUrl(url) {
  try {
    if (url.includes("originalUrl=")) return decodeURIComponent(url.split("originalUrl=")[1].split("&")[0]);
    if (url.includes("file=")) return decodeURIComponent(url.split("file=")[1].split("&")[0]);
    return url.split("#")[0].split("?")[0];
  } catch { return url; }
}

function getPdfTitle(url) {
  try {
    const cleanUrl = getCleanTargetUrl(url);
    const pathname = new URL(cleanUrl).pathname;
    const filename = decodeURIComponent(pathname.substring(pathname.lastIndexOf('/') + 1));
    return filename.replace(/\.pdf$/i, '').replace(/[-_]/g, ' ') || "Documento PDF";
  } catch { return "Archivo PDF"; }
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!tab?.id || !tab?.url) return;
  const sel = (info.selectionText || "").trim();
  const isCustomViewer = tab.url.includes("pdf-viewer/web/viewer.html");
  const targetUrl = getCleanTargetUrl(tab.url);
  const isPdf = targetUrl.toLowerCase().split("?")[0].split("#")[0].endsWith(".pdf") || isCustomViewer;
  
  if (info.menuItemId === "os-highlight" && sel) {
    chrome.tabs.sendMessage(tab.id, { action: "highlight", keyword: sel }).catch(()=>{});
  } 
  else if (info.menuItemId === "os-cite") {
    let meta = { url: targetUrl, title: tab.title || "Sin título", author: "", rawDate: "", siteName: "Documento PDF", accessed: new Date().toISOString() };
    if (isCustomViewer || isPdf) {
      meta.title = getPdfTitle(targetUrl);
      meta.author = "Autor de documento";
    } else {
      try { meta = await chrome.tabs.sendMessage(tab.id, { action: "getPageMeta" }); } catch {}
    }
    const data = await chrome.storage.local.get(GLOBAL_CITES_KEY);
    const stored = data[GLOBAL_CITES_KEY] || { items: [] };
    const citeText = isPdf 
      ? `${meta.title} [Archivo PDF]. (${new Date().getFullYear()}). Recuperado de ${meta.url}`
      : `${meta.author || 'Autor desconocido'} (${meta.rawDate ? meta.rawDate.slice(0,4) : 's.f.'}). ${meta.title}. ${meta.siteName}. ${meta.url}`;
    stored.items.push({ id: Date.now(), type: "cite", text: citeText, excerpt: sel, date: new Date().toISOString(), meta });
    await chrome.storage.local.set({ [GLOBAL_CITES_KEY]: stored, "odysseek::pendingTab": "cites" });
    try { await chrome.action.openPopup(); } catch {}
  } 
  else if (info.menuItemId === "os-note" && sel) {
    const noteKey = "odysseek::" + (() => {
      try {
        const u = new URL(targetUrl);
        if (u.pathname.toLowerCase().endsWith(".pdf")) return u.hostname + u.pathname;
        ["utm_source","utm_medium","utm_campaign","gclid","fbclid"].forEach(p => u.searchParams.delete(p));
        return u.hostname + u.pathname + u.search;
      } catch { return targetUrl; }
    })();
    const noteData = await chrome.storage.local.get(noteKey);
    const noteTitle = isPdf ? getPdfTitle(targetUrl) : (tab.title || "Documento");
    const noteStored = noteData[noteKey] || { url: targetUrl, pageTitle: noteTitle, items: [] };
    noteStored.items.push({ id: Date.now(), type: "note", text: sel, excerpt: sel, date: new Date().toISOString() });
    const globalData = await chrome.storage.local.get(GLOBAL_CITES_KEY);
    const storedGlobal = globalData[GLOBAL_CITES_KEY] || { items: [] };
    await chrome.storage.local.set({ [noteKey]: noteStored, [GLOBAL_CITES_KEY]: storedGlobal, "odysseek::pendingTab": "notes" });
    try { await chrome.action.openPopup(); } catch {}
  } 
  else if (info.menuItemId === "os-clear") {
    chrome.tabs.sendMessage(tab.id, { action: "clearHighlights" }).catch(()=>{});
  }
});

// 2. DESCARGAS PDF: aisladas por documento, con límites y validación de origen.
// El service worker de MV3 puede reiniciarse; el visor reintenta de forma nativa
// si se pierde el caché. No se conservan PDFs ni cookies en storage.local.
const _pdfBufferCache = new Map();
const _activePdfFetches = new Map();
const PDF_CHUNK_SIZE = 512 * 1024;       // 512 KiB por mensaje, evitando listas gigantes de números.
const PDF_MAX_BYTES = 100 * 1024 * 1024; // 100 MiB por documento en memoria.
const PDF_CACHE_TTL_MS = 5 * 60 * 1000;

function _cleanupPdfCache() {
  const now = Date.now();
  for (const [id, entry] of _pdfBufferCache) {
    if (now - entry.ts > PDF_CACHE_TTL_MS) _pdfBufferCache.delete(id);
  }
}

function _viewerOwner(sender) {
  // Solo nuestro visor PDF puede pedir un fetch con credenciales.
  // Impide que otras páginas de la extensión o scripts ajenos usen este endpoint.
  if (sender?.id !== chrome.runtime.id || typeof sender.url !== "string") return null;
  try {
    const url = new URL(sender.url);
    const viewer = new URL(chrome.runtime.getURL("pdf-viewer/web/viewer.html"));
    if (url.origin !== viewer.origin || url.pathname !== viewer.pathname) return null;
    return `${sender.tab?.id ?? "no-tab"}:${sender.documentId || sender.url}`;
  } catch { return null; }
}

function _validatedPdfUrl(value) {
  if (typeof value !== "string" || value.length > 8192) return null;
  try {
    const url = new URL(value);
    if (!["https:", "http:"].includes(url.protocol) || !url.hostname || url.username || url.password) return null;
    return url.href;
  } catch { return null; }
}

function _encodeBase64(bytes) {
  // Bloques pequeños para no superar el límite de argumentos de String.fromCharCode.
  let binary = "";
  for (let i = 0; i < bytes.length; i += 8192) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  }
  return btoa(binary);
}

async function _readLimitedPdf(res, signal) {
  const declared = Number(res.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > PDF_MAX_BYTES) {
    throw new Error("El PDF excede el máximo de 100 MiB para el visor en memoria.");
  }
  if (!res.body) throw new Error("La respuesta del PDF no contiene datos.");
  const reader = res.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (signal.aborted) throw new DOMException("Descarga cancelada", "AbortError");
      total += value.byteLength;
      if (total > PDF_MAX_BYTES) {
        throw new Error("El PDF excede el máximo de 100 MiB para el visor en memoria.");
      }
      chunks.push(value);
    }
  } catch (err) {
    // Un límite de tamaño o una interrupción debe cerrar también el stream HTTP.
    await reader.cancel().catch(() => {});
    throw err;
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

chrome.runtime.onMessage.addListener((req, sender, sendResponse) => {
  if (!["fetchPdfBuffer", "abortPdfFetch", "fetchPdfChunk"].includes(req?.action)) return;

  const owner = _viewerOwner(sender);
  if (!owner) {
    sendResponse({ ok: false, error: "Solicitud PDF no autorizada." });
    return false;
  }

  if (req.action === "fetchPdfBuffer") {
    const url = _validatedPdfUrl(req.url);
    if (!url) {
      sendResponse({ ok: false, error: "URL del PDF no permitida: solo HTTP y HTTPS." });
      return false;
    }

    _cleanupPdfCache();
    // Cancelar solo la petición previa de ESTE visor, nunca la de otra pestaña.
    _activePdfFetches.get(owner)?.abort();
    for (const [id, entry] of _pdfBufferCache) {
      if (entry.owner === owner) _pdfBufferCache.delete(id);
    }
    const controller = new AbortController();
    _activePdfFetches.set(owner, controller);

    (async () => {
      try {
        // Mantener cookies de la sesión para repositorios universitarios autenticados.
        const res = await fetch(url, {
          signal: controller.signal,
          credentials: "include",
          headers: { "Accept": "application/pdf,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8" }
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        if (!_validatedPdfUrl(res.url)) throw new Error("Redirección a un protocolo no permitido.");
        const bytes = await _readLimitedPdf(res, controller.signal);
        if (controller.signal.aborted) throw new DOMException("Descarga cancelada", "AbortError");
        if (bytes.length < 5 || bytes[0] !== 0x25 || bytes[1] !== 0x50 ||
            bytes[2] !== 0x44 || bytes[3] !== 0x46 || bytes[4] !== 0x2D) {
          throw new Error("La respuesta no contiene un PDF válido (cabecera %PDF- ausente).");
        }
        const requestId = crypto.randomUUID();
        _pdfBufferCache.set(requestId, { bytes, ts: Date.now(), owner });
        sendResponse({ ok: true, requestId, totalSize: bytes.length, chunkSize: PDF_CHUNK_SIZE });
      } catch (err) {
        // Siempre contestamos, también ante cancelaciones, para no dejar promesas pendientes.
        sendResponse({ ok: false, error: err.name === "AbortError" ? "Descarga cancelada." : (err.message || "Error al descargar PDF.") });
      } finally {
        if (_activePdfFetches.get(owner) === controller) _activePdfFetches.delete(owner);
      }
    })();
    return true;
  }

  if (req.action === "abortPdfFetch") {
    _activePdfFetches.get(owner)?.abort();
    for (const [id, entry] of _pdfBufferCache) {
      if (entry.owner === owner) _pdfBufferCache.delete(id);
    }
    sendResponse({ ok: true });
    return false;
  }

  if (req.action === "fetchPdfChunk") {
    _cleanupPdfCache();
    const entry = _pdfBufferCache.get(req.requestId);
    if (!entry || entry.owner !== owner) {
      sendResponse({ ok: false, error: "El PDF ya no está disponible en memoria." });
      return false;
    }
    const totalChunks = Math.ceil(entry.bytes.length / PDF_CHUNK_SIZE);
    if (!Number.isSafeInteger(req.index) || req.index < 0 || req.index >= totalChunks) {
      sendResponse({ ok: false, error: "Índice de fragmento PDF inválido." });
      return false;
    }
    const start = req.index * PDF_CHUNK_SIZE;
    const end = Math.min(start + PDF_CHUNK_SIZE, entry.bytes.length);
    const data = _encodeBase64(entry.bytes.subarray(start, end));
    const done = req.index === totalChunks - 1;
    entry.ts = Date.now();
    sendResponse({ ok: true, data, done });
    if (done) _pdfBufferCache.delete(req.requestId);
    return false;
  }
});
