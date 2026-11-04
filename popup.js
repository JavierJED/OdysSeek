// OdysSeek v3.4.3 — Core HUD Script
(function () {
  "use strict";

  var $ = window.$ || (id => document.getElementById(id));
  var GLOBAL_CITES_KEY = window.GLOBAL_CITES_KEY || "odysseek::cites_global";
  window.GLOBAL_CITES_KEY = GLOBAL_CITES_KEY;
  var on = (el, ev, fn) => el?.addEventListener(ev, fn);

  let currentTab = null, currentUrl = "", currentTitle = "", currentDocUrl = "";
  let _citeFormat = "apa", _alphaSort = false, _latestSemResults = [];

  let _pdfParagraphsCache = null;
  let _pdfFullTextCache = "";

  document.addEventListener("DOMContentLoaded", async () => {
    await loadSettings();
    try {
      [currentTab] = await chrome.tabs.query({ active: true, currentWindow: true });
      currentUrl = currentTab?.url || "";
      currentTitle = currentTab?.title || "";
      // Para PDFs, las notas/recursos deben identificarse por el documento REAL, no por el
      // wrapper del visor (que cambia cada vez que un enlace firmado se regenera).
      currentDocUrl = checkIsPdf(currentUrl) ? getRealPdfUrl(currentUrl) : currentUrl;
    } catch {}

    // ── NORMALIZADORES DE IDENTIDAD PARA ODYSSEEK ──
    function getCleanOdysseekUrl(url) {
      if (!url) return "";
      try {
        let target = url;
        if (url.includes("originalUrl=")) {
          target = decodeURIComponent(url.split("originalUrl=")[1].split("&")[0]);
        } else if (url.includes("file=")) {
          target = decodeURIComponent(url.split("file=")[1].split("&")[0]);
        }
        return target.split("#")[0].split("?")[0];
      } catch { return url; }
    }

    function getOdysseekStorageKey(url) {
      try {
        const cleanUrl = getCleanOdysseekUrl(url);
        const u = new URL(cleanUrl);
        return "odysseek::" + u.hostname + u.pathname;
      } catch {
        return "odysseek::" + url;
      }
    }

    initTabs(); initSearch(); initCites(); initNotes(); initResources(); initHistory(); initTrash(); initSettings();
    await refreshAll();
    await applyPendingTab();
  });

  async function refreshAll() {
    await refreshCites(); await refreshNotes(); await refreshResources(); await refreshHistory(); await refreshTrash();
  }

  async function applyPendingTab() {
    const data = await chrome.storage.local.get("odysseek::pendingTab");
    if (data["odysseek::pendingTab"]) {
      document.querySelector(`.tab[data-tab="${data["odysseek::pendingTab"]}"]`)?.click();
      await chrome.storage.local.remove("odysseek::pendingTab");
    }
  }

  function setStatus(id, msg, type = "") {
    const el = $(id); if (!el) return;
    el.textContent = msg; el.className = "status " + type;
    if (msg) setTimeout(() => { if (el.textContent === msg) el.textContent = ""; }, 3500);
  }

  function fmtDate(iso) {
    if (!iso) return "";
    const d = new Date(iso); return isNaN(d) ? "" : d.toLocaleDateString("es-ES", { day: "2-digit", month: "short", year: "numeric" });
  }

  // Helper universal: reconoce visor PDF.js local y archivos directos
  function checkIsPdf(url) {
    if (!url) return false;
    const clean = url.split('#')[0].split('?')[0].toLowerCase();
    return clean.endsWith(".pdf") || url.startsWith("file:///") || url.includes("pdf-viewer/web/viewer.html");
  }

  // Extrae la URL original de internet desde el parámetro ?file= del visor
  function getRealPdfUrl(url) {
  if (url && url.includes("pdf-viewer/web/viewer.html")) {
    try {
      const urlObj = new URL(url);
      const param = urlObj.searchParams.get("originalUrl") || urlObj.searchParams.get("file");
      if (param) return decodeURIComponent(param);
    } catch {}
  }
  return url;
  }


  function initTabs() {
    document.querySelectorAll(".tab").forEach(btn => {
      on(btn, "click", () => {
        document.querySelectorAll(".tab").forEach(t => t.classList.remove("active"));
        document.querySelectorAll(".panel").forEach(p => p.classList.remove("active"));
        btn.classList.add("active");
        $("tab-" + btn.dataset.tab)?.classList.add("active");
      });
    });
  }

  function initSearch() {
    const inp = $("searchInput");
    on(inp, "keydown", e => { if (e.key === "Enter") doSymbioticSearch(); });
    on($("btnSearch"), "click", () => doSymbioticSearch());
    on($("btnPrev"), "click", () => doNavigate("prev"));
    on($("btnNext"), "click", () => doNavigate("next"));
    on($("btnClear"), "click", () => doClear());

    // Modo de carga directa (bypass): vive únicamente en la pestaña Buscar
    chrome.storage.local.get(["odysseek::bypass_fetch"], data => {
      if ($("toggleBypassFetch")) $("toggleBypassFetch").checked = !!data["odysseek::bypass_fetch"];
    });
    on($("toggleBypassFetch"), "change", async e => {
      await chrome.storage.local.set({ "odysseek::bypass_fetch": e.target.checked });
      if (checkIsPdf(currentUrl) && currentTab) {
        setStatus("searchStatus", "Recargando PDF con el nuevo modo de carga...", "warn");
        chrome.tabs.reload(currentTab.id);
      }
    });

    on($("togglePdfMode"), "change", async e => {
      const isPdfUrl = checkIsPdf(currentUrl);
      if (!isPdfUrl && e.target.checked) {
        e.target.checked = false;
        setStatus("searchStatus", "❌ Error: Este modo es exclusivo para archivos PDF.", "error");
        return;
      }
      if (e.target.checked) {
        setStatus("searchStatus", "⚡ Analizando PDF en segundo plano...", "ok");
        await doSymbioticSearch();
      } else {
        setStatus("searchStatus", "Modo Analizador PDF desactivado.", "warn");
        $("semResults").innerHTML = "";
      }
    });

    document.querySelectorAll(".concept-pill").forEach(btn => {
      on(btn, "click", async () => {
        const wasActive = btn.classList.contains("active");
        document.querySelectorAll(".concept-pill").forEach(b => b.classList.remove("active"));
        if (!wasActive) btn.classList.add("active");

        const activeConcept = document.querySelector(".concept-pill.active")?.dataset.concept || "";
        const isPdfUrl = checkIsPdf(currentUrl);

        if (isPdfUrl) {
          // Le pasamos el concepto activo (resumen, metodologia, resultados, futuro) a tu búsqueda
          await doSymbioticSearch();
        } else {
          inp.value = "";
          runSemanticFilter("", activeConcept, activeConcept ? `📌 Párrafos de: ${btn.textContent}` : "✨ Conceptos clave detectados automáticamente");
        }
      });
    });

    chrome.storage.local.get(["odysseek::scholar_sort", "odysseek::scholar_filter"], data => {
      const s = data["odysseek::scholar_sort"] || "normal";
      const f = data["odysseek::scholar_filter"] || "all";
      if (s === "cites") $("toggleSortCites").checked = true;
      if (s === "date") $("toggleSortDate").checked = true;
      if (f === "oa") $("toggleOpenAccess").checked = true;
      if (f === "web") $("toggleOnlyWeb").checked = true;
      if (f === "books") $("toggleOnlyBooks").checked = true;
    });

    on($("toggleSortCites"), "change", async e => {
      if (e.target.checked) $("toggleSortDate").checked = false;
      await updateScholarState(e.target.checked ? "cites" : "normal", null);
    });
    on($("toggleSortDate"), "change", async e => {
      if (e.target.checked) $("toggleSortCites").checked = false;
      await updateScholarState(e.target.checked ? "date" : "normal", null);
    });
    // Los 3 filtros son mutuamente excluyentes: activar uno apaga los otros dos
    on($("toggleOpenAccess"), "change", async e => {
      if (e.target.checked) { $("toggleOnlyWeb").checked = false; $("toggleOnlyBooks").checked = false; }
      await updateScholarState(null, e.target.checked ? "oa" : "all");
    });
    on($("toggleOnlyWeb"), "change", async e => {
      if (e.target.checked) { $("toggleOpenAccess").checked = false; $("toggleOnlyBooks").checked = false; }
      await updateScholarState(null, e.target.checked ? "web" : "all");
    });
    on($("toggleOnlyBooks"), "change", async e => {
      if (e.target.checked) { $("toggleOpenAccess").checked = false; $("toggleOnlyWeb").checked = false; }
      await updateScholarState(null, e.target.checked ? "books" : "all");
    });

    on($("btnTop3ToNotes"), "click", async () => {
      if (!_latestSemResults.length) { setStatus("searchStatus", "No hay párrafos analizados para guardar.", "warn"); return; }
      const top3 = _latestSemResults.slice(0, 3);
      for (const item of top3) {
        await saveRecordDirect(
          { id: Date.now() + Math.random(), type: "note", text: item.text, excerpt: item.text, date: new Date().toISOString() },
          currentDocUrl, currentTitle
        );
      }
      await refreshNotes();
      setStatus("searchStatus", `¡Top ${top3.length} párrafos guardados en Notas!`, "ok");
    });

    loadDynamicKeywords();
    setTimeout(() => { if (!inp.value.trim()) runSemanticFilter("", "", "✨ Conceptos clave detectados automáticamente"); }, 150);
  }

  function renderKeywordChips(keywords) {
    const box = $("docKeywords"); if (!box) return;
    box.innerHTML = "";
    if (!Array.isArray(keywords) || !keywords.length) return;
    keywords.forEach(kw => {
      const chip = document.createElement("span"); chip.className = "chip"; chip.textContent = `+ ${kw}`;
      on(chip, "click", () => { $("searchInput").value = kw; doSymbioticSearch(); });
      box.appendChild(chip);
    });
  }

  // Parsea el PDF en memoria (vía el visor) UNA sola vez y cachea párrafos/texto completo
  let _pdfLoadFailed = false;
  async function ensurePdfParsed() {
    if (_pdfParagraphsCache) return { ok: true, paragraphs: _pdfParagraphsCache, fullText: _pdfFullTextCache };
    const { "odysseek::bypass_fetch": bypass } = await chrome.storage.local.get("odysseek::bypass_fetch");
    if (bypass) return { ok: false, error: "Modo de carga directa activo: el análisis semántico está desactivado para este documento.", bypass: true };
    if (_pdfLoadFailed) return { ok: false, error: "Este PDF no pudo cargarse en el visor (bloqueado por el servidor)." };
    if (!currentTab) return { ok: false };
    const parsed = await window.odysseekPDFEngine.parseDocument(currentTab.id);
    if (parsed?.ok) {
      _pdfParagraphsCache = parsed.paragraphs;
      _pdfFullTextCache = parsed.fullText;
    } else {
      _pdfLoadFailed = true;
    }
    return parsed;
  }

  async function loadDynamicKeywords() {
    const box = $("docKeywords"); if (!box) return;
    box.innerHTML = "";
    const isPdfUrl = checkIsPdf(currentUrl);

    if (isPdfUrl) {
      const parsed = await ensurePdfParsed();
      if (parsed?.ok) {
        renderKeywordChips(window.odysseekPDFEngine.extractKeywords(_pdfFullTextCache));
      }
    } else {
      try {
        const kws = await sendToContent("getDocKeywords");
        renderKeywordChips(kws);
      } catch {}
    }
  }

  async function updateScholarState(newSort, newFilter) {
    const data = await chrome.storage.local.get(["odysseek::scholar_sort", "odysseek::scholar_filter"]);
    const sortMode = newSort !== null ? newSort : (data["odysseek::scholar_sort"] || "normal");
    const filterMode = newFilter !== null ? newFilter : (data["odysseek::scholar_filter"] || "all");
    
    await chrome.storage.local.set({
      "odysseek::scholar_sort": sortMode,
      "odysseek::scholar_filter": filterMode
    });
    
    if (currentTab) {
      try {
        await chrome.tabs.sendMessage(currentTab.id, { action: "runScholarEngine" });
        setStatus("searchStatus", "Filtro de Scholar actualizado.", "ok");
      } catch { setStatus("searchStatus", "Abre Google Scholar para usar este modo.", "warn"); }
    }
  }

  async function doSymbioticSearch() {
    const activeConcept = document.querySelector(".concept-pill.active")?.dataset.concept || "";
    const keyword = $("searchInput").value.trim();
    const isPdfUrl = checkIsPdf(currentUrl);

    if (!isPdfUrl && !keyword && !activeConcept) { 
      setStatus("searchStatus", "Escribe un término o selecciona una píldora IMRAD.", "warn"); 
      return; 
    }
    if (!currentTab) return;

    if (isPdfUrl) {
      $("counterBar").classList.add("hidden");
      setStatus("searchStatus", "⏳ Extrayendo texto y resaltando en PDF...", "warn");

      // 1. Mensaje directo al visor para resaltar visualmente todo el PDF (motor Mozilla)
      if (keyword) {
        try {
          await chrome.runtime.sendMessage({ action: "pdfFind", query: keyword, highlightAll: true });
          $("counterBar").classList.remove("hidden");
          $("counterLabel").textContent = "Modo PDF Activo";
        } catch (err) {
          console.warn("[OdysSeek] Error resaltando en PDF.js:", err);
        }
      }

      // 2. Procesamiento del motor semántico satélite (parsea una sola vez y cachea)
      const parsed = await ensurePdfParsed();
      if (!parsed?.ok) {
        const hint = parsed?.bypass ? "" : " Prueba activando el ⚡ modo de carga directa arriba (se recargará el PDF).";
        setStatus("searchStatus", "❌ " + (parsed?.error || "Error al leer el PDF.") + hint, "error");
        return;
      }
      renderKeywordChips(window.odysseekPDFEngine.extractKeywords(_pdfFullTextCache));

      const results = window.odysseekPDFEngine.filterSemantic(_pdfParagraphsCache, keyword, activeConcept);
      _latestSemResults = results;

      const semBox = $("semResults");
      semBox.innerHTML = results.length ? "" : '<span style="color:var(--muted);font-size:11px;padding:4px">Sin coincidencias semánticas en este PDF.</span>';
      
      results.forEach(item => {
        const d = document.createElement("div"); d.className = "sem-item";
        d.innerHTML = `<span>${escHtml(item.text)}</span><span class="sc">▲${item.score}</span>`;
        
        // Clic en tarjeta: Salto de página + Resaltado automático del texto clave
        on(d, "click", async () => {
          document.querySelectorAll(".sem-item").forEach(el => {
            el.style.borderColor = "";
            el.style.backgroundColor = "";
          });
          d.style.borderColor = "var(--accent)";
          d.style.backgroundColor = "var(--accent-soft)";

          if (item.page) {
            try {
              // Usamos un fragmento (no el párrafo entero): el resaltado ahora ubica el texto
              // real en la capa de la página y lo pinta directamente, sin pasar por el
              // buscador interno de PDF.js (que no estaba pintando nada de forma confiable).
              const snippet = item.text.slice(0, 90).replace(/\s+\S*$/, "");
              await chrome.runtime.sendMessage({ action: "scrollToPdfPage", page: item.page });
              if (snippet) await chrome.runtime.sendMessage({ action: "pdfHighlightSnippet", page: item.page, snippet });
            } catch (err) {
              console.warn("[OdysSeek] Error al realizar el salto de página:", err);
            }
          }
        });

        semBox.appendChild(d);
      });

      setStatus("searchStatus", `¡PDF resaltado y procesado!`, "ok");
      return;
    }

    document.querySelectorAll(".concept-pill").forEach(b => b.classList.remove("active"));
    await ensureContent();

    try {
      const res = await chrome.tabs.sendMessage(currentTab.id, { action: "highlight", keyword });
      if ((res?.count ?? 0) === 0) {
        $("counterBar").classList.add("hidden");
        setStatus("searchStatus", "Sin coincidencias literales (revisa el análisis semántico).", "warn");
      } else {
        $("counterBar").classList.remove("hidden");
        $("counterLabel").textContent = `1 de ${res.count} exactos`;
        setStatus("searchStatus", `${res.count} exactos resaltados.`, "ok");
      }
    } catch { setStatus("searchStatus", "Recarga la página para vincular el buscador.", "error"); }

    await runSemanticFilter(keyword, activeConcept, keyword ? `💡 Párrafos relevantes para: "${keyword}"` : "✨ Conceptos clave");
  }

  async function runSemanticFilter(query, concept, labelTitle) {
    if (!currentTab) return;
    await ensureContent();
    try {
      const [result] = await chrome.scripting.executeScript({
        target: { tabId: currentTab.id },
        func: (q, c) => window.__odysseekSemanticFilter?.(q, c) || [],
        args: [query, concept]
      });
      const items = result?.result || [], box = $("semResults");
      _latestSemResults = items;
      
      if ($("semHeaderLabel")) $("semHeaderLabel").textContent = labelTitle;
      box.innerHTML = items.length ? "" : '<span style="color:var(--muted);font-size:11px;padding:4px">Sin párrafos de alta densidad semántica.</span>';
      
      items.forEach(item => {
        const d = document.createElement("div"); d.className = "sem-item";
        d.innerHTML = `<span>${escHtml(item.text)}</span><span class="sc">▲${item.score}</span>`;
        on(d, "click", async () => {
          document.querySelectorAll(".sem-item").forEach(el => el.style.borderColor = "");
          d.style.borderColor = "var(--accent)";
          await chrome.tabs.sendMessage(currentTab.id, { action: "scrollToSemId", id: item.id });
        });
        box.appendChild(d);
      });
    } catch {}
  }

  async function doNavigate(dir) {
    if (!currentTab) return;
    if (checkIsPdf(currentUrl)) {
      try {
        await chrome.runtime.sendMessage({ action: "pdfFindAgain", findPrevious: dir === "prev" });
      } catch {}
      return;
    }
    const res = await chrome.tabs.sendMessage(currentTab.id, { action: "navigate", direction: dir });
    if (res?.total > 0) $("counterLabel").textContent = `${res.index + 1} de ${res.total} exactos`;
  }

  async function doClear() {
    if (!currentTab) return;
    if (checkIsPdf(currentUrl)) {
      try {
        await chrome.runtime.sendMessage({ action: "pdfFind", query: "", highlightAll: false });
      } catch {}
      $("counterBar").classList.add("hidden"); $("searchInput").value = "";
      return;
    }
    try { await chrome.tabs.sendMessage(currentTab.id, { action: "clearHighlights" }); } catch {}
    $("counterBar").classList.add("hidden"); $("searchInput").value = "";
    document.querySelectorAll(".concept-pill").forEach(b => b.classList.remove("active"));
    runSemanticFilter("", "", "✨ Conceptos clave detectados automáticamente");
  }

  function initCites() {
    document.querySelectorAll("#tab-cites .format-pill").forEach(btn => {
      on(btn, "click", () => {
        document.querySelectorAll("#tab-cites .format-pill").forEach(b => b.classList.remove("active"));
        btn.classList.add("active"); _citeFormat = btn.dataset.fmt; refreshCites();
      });
    });
    on($("toggleAlphaSort"), "change", e => {
      _alphaSort = e.target.checked;
      $("alphaLabel").textContent = _alphaSort ? "Sí" : "No";
      refreshCites();
    });
    on($("btnExportCites"), "click", () => exportCitesDoc());
    on($("btnExportSources"), "click", () => exportSourcesXML());
    on($("citeFilter"), "input", e => filterCards("citeList", e.target.value));
  }

  async function refreshCites() {
    const data = await chrome.storage.local.get(GLOBAL_CITES_KEY);
    let items = (data[GLOBAL_CITES_KEY]?.items || []).filter(i => !i.deleted);
    if (_alphaSort) {
      items.sort((a, b) => {
        const authA = a.meta?.author || a.text || "", authB = b.meta?.author || b.text || "";
        return authA.localeCompare(authB, 'es');
      });
    } else {
      items.slice().reverse();
    }
    $("citesSubtitle").textContent = `${items.length} cita(s)`;
    renderCards("citeList", items, "citeStatus", { citeFormat: _citeFormat, noReverse: _alphaSort });
  }

  function formatCitation(meta, style) {
    const author = fmtAuthor(meta?.author || "", style), year = (meta?.rawDate || "").match(/\d{4}/)?.[0] || "s.f.";
    const site = meta?.siteName || (meta?.url ? new URL(meta.url).hostname.replace("www.", "") : "s.n."), url = meta?.url || "";
    if (style === "mla") return `${author}. "${meta?.title}." ${site}, ${year}, ${url}.`;
    if (style === "chicago") return `${author}. ${year}. "${meta?.title}." ${site}. ${url}.`;
    if (style === "vancouver") return `${author}. ${meta?.title} [Internet]. ${site}; ${year}. Disponible en: ${url}`;
    return `${author} (${year}). ${meta?.title}. ${site}. ${url}`;
  }

  function fmtAuthor(raw, style) {
    if (!raw) return "Autor desconocido";
    const parts = raw.trim().split(/\s+/), last = parts[parts.length - 1];
    if (parts.length === 1) return last;
    if (style === "vancouver") return `${last} ${parts.slice(0, -1).map(p => p[0].toUpperCase()).join("")}`;
    return `${last}, ${parts.slice(0, -1).map(p => p[0].toUpperCase() + ".").join(" ")}`;
  }

  async function exportCitesDoc() {
    const name = $("citeExportName").value.trim(); if (!name) { setStatus("citeStatus", "Escribe un nombre para exportar.", "warn"); return; }
    const data = await chrome.storage.local.get(GLOBAL_CITES_KEY);
    let items = (data[GLOBAL_CITES_KEY]?.items || []).filter(i => !i.deleted);
    if (_alphaSort) items.sort((a, b) => (a.meta?.author || "").localeCompare(b.meta?.author || "", 'es'));
    if (!items.length) { setStatus("citeStatus", "Sin citas para exportar.", "warn"); return; }
    downloadDocx(name, items.map((it, i) => `[${i+1}] ${it.meta ? (it.aiCite?.[_citeFormat] || formatCitation(it.meta, _citeFormat)) : it.text}`));
    setStatus("citeStatus", "Descargando documento Word…", "ok");
  }

  function initNotes() {
    on($("btnSaveNote"), "click", async () => {
      const text = $("noteInput").value.trim(); if (!text) return;
      await saveRecordDirect({ id: Date.now(), type: "note", text, excerpt: text, date: new Date().toISOString() }, currentDocUrl, currentTitle);
      $("noteInput").value = ""; await refreshNotes(); setStatus("noteStatus", "Anotación guardada.", "ok");
    });
    on($("btnClearNote"), "click", () => $("noteInput").value = "");
    on($("btnExportNotes"), "click", () => exportRecordsDoc("note", "noteStatus"));
    on($("noteFilter"), "input", e => filterCards("noteList", e.target.value));
  }
  async function refreshNotes() {
    if (!currentDocUrl) return; const data = await getRecordsDirect(currentDocUrl);
    renderCards("noteList", (data?.items || []).filter(i => i.type === "note" && !i.deleted), "noteStatus");
  }

  function initResources() {
    on($("btnAddRes"), "click", async () => {
      const title = $("resTitle").value.trim(); if (!title) return;
      const text = [title, $("resUrl").value.trim() && `URL: ${$("resUrl").value.trim()}`, $("resDesc").value.trim()].filter(Boolean).join("\n");
      await saveRecordDirect({ id: Date.now(), type: "resource", text, excerpt: title, date: new Date().toISOString() }, currentDocUrl, currentTitle);
      $("resTitle").value = $("resUrl").value = $("resDesc").value = ""; await refreshResources(); setStatus("resStatus", "Recurso vinculado.", "ok");
    });
    on($("btnExportRes"), "click", () => exportRecordsDoc("resource", "resStatus"));
    on($("btnAiRes"), "click", async () => {
      const title = $("resTitle").value.trim();
      if (!title) { setStatus("resStatus", "Escribe primero un título de recurso.", "warn"); return; }
      const settings = await getSettings();
      if (!settings.aiEnabled || !settings.aiApiKey) { setStatus("resStatus", "Activa la IA y configura una clave del proveedor elegido en Ajustes ⚙.", "warn"); return; }
      setStatus("resStatus", "✨ Redactando con IA...", "warn");
      try {
        const note = await generateResourceNoteWithAI(title, $("resUrl").value.trim(), $("resDesc").value.trim(), settings);
        if (note) { $("resDesc").value = note; setStatus("resStatus", "¡Listo! Revisa y edita antes de guardar.", "ok"); }
        else setStatus("resStatus", "La IA no devolvió texto. Intenta de nuevo.", "warn");
      } catch (e) {
        setStatus("resStatus", "Error de IA: " + e.message, "error");
      }
    });
  }
  async function refreshResources() {
    if (!currentDocUrl) return; const data = await getRecordsDirect(currentDocUrl);
    renderCards("resList", (data?.items || []).filter(i => i.type === "resource" && !i.deleted), "resStatus");
  }

  async function exportRecordsDoc(type, statusId) {
    if (!currentDocUrl) return; const data = await getRecordsDirect(currentDocUrl);
    const items = (data?.items || []).filter(i => i.type === type && !i.deleted);
    if (!items.length) { setStatus(statusId, `Sin elementos de tipo ${type} para exportar.`, "warn"); return; }
    downloadDocx(`OdysSeek_${type.toUpperCase()}_${Date.now()}`, items.map((it, i) => `[${i+1}] ${fmtDate(it.date)}\n${it.text}`));
    setStatus(statusId, "Descargando…", "ok");
  }

  let _histCache = [], _histType = "all";
  function initHistory() {
    document.querySelectorAll("#tab-history .format-pill").forEach(btn => {
      on(btn, "click", () => {
        document.querySelectorAll("#tab-history .format-pill").forEach(b => b.classList.remove("active"));
        btn.classList.add("active"); _histType = btn.dataset.hist; renderHistList();
      });
    });
    on($("histFilter"), "input", () => renderHistList());
  }

  async function refreshHistory() {
    const cites = ((await chrome.storage.local.get(GLOBAL_CITES_KEY))[GLOBAL_CITES_KEY]?.items || []).filter(i => !i.deleted).map(i => ({ id: String(i.id), type: "cite", title: i.meta?.title || "Cita APA", url: i.meta?.url || "", date: i.date }));
    const all = await chrome.storage.local.get(null), notes = [];
    for (const [k, v] of Object.entries(all)) {
      if (k.startsWith("odysseek::") && !["odysseek::settings", GLOBAL_CITES_KEY, "odysseek::scholar_sort", "odysseek::scholar_filter"].includes(k)) {
        (v.items || []).filter(i => !i.deleted && i.type === "note").forEach(i => notes.push({ id: String(i.id), type: "note", title: i.text?.slice(0, 50) || "Nota", url: v.url || "", date: i.date }));
      }
    }
    _histCache = [...cites, ...notes].sort((a, b) => new Date(b.date) - new Date(a.date));
    renderHistList();
  }

  function renderHistList() {
    const box = $("histList"), q = $("histFilter").value.toLowerCase(); box.innerHTML = "";
    const filtered = _histCache.filter(i => (_histType === "all" || i.type === _histType) && (!q || i.title.toLowerCase().includes(q) || i.url.toLowerCase().includes(q)));
    if (!filtered.length) { box.innerHTML = '<span style="color:var(--muted);font-size:11px;">Historial limpio.</span>'; return; }
    filtered.forEach(item => {
      const d = document.createElement("div"); d.className = "card"; styleCard(d);
      d.innerHTML = `<div class="card-head"><span class="badge ${item.type === 'cite' ? 'badge-cite' : 'badge-note'}">${item.type.toUpperCase()}</span><span class="card-date">${fmtDate(item.date)}</span></div><div class="cite-title">${escHtml(item.title)}</div><div class="card-text" style="color:var(--muted);">${escHtml(item.url)}</div>`;
      on(d, "click", () => { if (item.url && currentTab?.id) chrome.tabs.update(currentTab.id, { url: item.url }); });
      box.appendChild(d);
    });
  }

  function initTrash() {
    on($("btnEmptyTrash"), "click", async () => { if (confirm("¿Destruir elementos permanentemente?")) { await emptyTrashDirect(currentDocUrl); await emptyGlobalCiteTrashDirect(); await refreshAll(); } });
  }

  async function refreshTrash() {
    const perUrl = ((await getRecordsDirect(currentDocUrl))?.items || []).filter(i => i.deleted);
    const global = ((await chrome.storage.local.get(GLOBAL_CITES_KEY))[GLOBAL_CITES_KEY]?.items || []).filter(i => i.deleted);
    const items = [...perUrl, ...global]; const box = $("trashList"); box.innerHTML = "";
    if (!items.length) { box.innerHTML = '<span style="color:var(--muted);font-size:11px;">Papelera vacía.</span>'; return; }
    items.forEach(item => {
      const d = document.createElement("div"); d.className = "card"; styleCard(d);
      d.innerHTML = `<div class="card-head"><span class="badge badge-note">${item.type.toUpperCase()}</span><span class="card-date">Eliminado: ${fmtDate(item.deletedAt)}</span></div><div class="card-text">${escHtml(item.text || item.meta?.title || "")}</div><div class="row mt8"><button class="btn-sm flex1" data-act="res">↺ Restaurar</button><button class="btn-ghost-red flex1" data-act="del">🗑 Destruir</button></div>`;
      on(d.querySelector('[data-act="res"]'), "click", async () => {
        if (item.type === "cite") await restoreGlobalCiteDirect(item.id);
        else await restoreRecordDirect(item.id, currentDocUrl);
        await refreshAll();
      });
      on(d.querySelector('[data-act="del"]'), "click", async () => {
        if (item.type === "cite") await deleteGlobalCiteDirect(item.id);
        else await deleteRecordDirect(item.id, currentDocUrl);
        await refreshTrash();
      });
      box.appendChild(d);
    });
  }

  const _selection = {};
  function getSelection(listId) { if (!_selection[listId]) _selection[listId] = new Set(); return _selection[listId]; }

  function ensureSelectionBar(listId) {
    let bar = document.getElementById(listId + "-selbar");
    if (!bar) {
      bar = document.createElement("div"); bar.id = listId + "-selbar"; bar.className = "selection-bar hidden mt8";
      const list = $(listId); list.parentNode.insertBefore(bar, list);
    }
    return bar;
  }

  function updateSelectionBar(listId, statusId) {
    const sel = getSelection(listId), bar = ensureSelectionBar(listId);
    if (sel.size === 0) { bar.classList.add("hidden"); bar.innerHTML = ""; return; }
    bar.classList.remove("hidden");
    bar.innerHTML = `<span>${sel.size} sel.</span><button class="btn-sm" data-act="word" style="padding:4px 8px; background:#FFF;">📄 Word (${sel.size})</button><button class="btn-ghost-red" data-act="trash" style="padding:4px 8px;">🗑 Papelera</button><button class="btn-ghost" data-act="cancel" style="padding:4px 8px;">✕</button>`;
    
    on(bar.querySelector('[data-act="word"]'), "click", async () => {
      let toExport = [];
      if (listId === "citeList") {
        const g = await chrome.storage.local.get(GLOBAL_CITES_KEY);
        toExport = (g[GLOBAL_CITES_KEY]?.items || []).filter(i => sel.has(i.id)).map(i => i.meta ? formatCitation(i.meta, _citeFormat) : i.text);
      } else {
        const r = await getRecordsDirect(currentDocUrl);
        toExport = (r?.items || []).filter(i => sel.has(i.id)).map(i => i.text);
      }
      downloadDocx(`OdysSeek_Grupo_${Date.now()}`, toExport);
      sel.clear(); updateSelectionBar(listId, statusId); refreshAll();
    });

    on(bar.querySelector('[data-act="trash"]'), "click", async () => {
      if (listId === "citeList") { for (const id of sel) await trashGlobalCiteDirect(id); }
      else { for (const id of sel) await trashRecordDirect(id, currentDocUrl); }
      sel.clear(); updateSelectionBar(listId, statusId); refreshAll(); setStatus(statusId, "Grupo movido a Papelera.", "ok");
    });

    on(bar.querySelector('[data-act="cancel"]'), "click", () => { sel.clear(); updateSelectionBar(listId, statusId); refreshAll(); });
  }

  function renderCards(listId, items, statusId, opts = {}) {
    const box = $(listId); box.innerHTML = "";
    const sel = getSelection(listId);
    const validIds = new Set(items.map(i => i.id));
    [...sel].forEach(id => { if (!validIds.has(id)) sel.delete(id); });

    if (!items.length) { box.innerHTML = '<span style="color:var(--muted);font-size:11px;">Sin registros activos.</span>'; updateSelectionBar(listId, statusId); return; }
    
    const displayItems = opts.noReverse ? items : items.slice().reverse();
    displayItems.forEach(item => {
      const card = document.createElement("div"); card.className = "card" + (sel.has(item.id) ? " selected" : ""); styleCard(card);
      const badge = item.type === "cite" ? "badge-cite" : item.type === "note" ? "badge-note" : "badge-resource";
      const style = opts.citeFormat || "apa";
      const body = item.type === "cite" ? (item.aiCite?.[style] || formatCitation(item.meta, style)) : item.text;
      card.innerHTML = `
        <div class="card-head">
          <input type="checkbox" class="card-check" ${sel.has(item.id) ? "checked" : ""} title="Seleccionar círculo Cupertino">
          <span class="badge ${badge}">${item.type.toUpperCase()}</span><span class="card-date">${fmtDate(item.date)}</span>
          <div class="card-menu-wrap"><button class="card-menu-btn">⋯</button>
            <div class="card-menu hidden"><button data-act="copy">📋 Copiar</button><button data-act="word">📄 Exportar .doc</button>${item.type === "cite" ? '<button data-act="ai">✨ Redactar con IA</button>' : ""}<button data-act="trash">🗑 Papelera</button></div>
          </div>
        </div>
        ${item.meta?.title ? `<div class="cite-title">${escHtml(item.meta.title)}</div>` : ""}
        <div class="card-text">${escHtml(body)}</div>`;
      
      on(card.querySelector(".card-check"), "change", e => { if (e.target.checked) sel.add(item.id); else sel.delete(item.id); card.classList.toggle("selected", e.target.checked); updateSelectionBar(listId, statusId); });
      on(card.querySelector(".card-menu-btn"), "click", e => { e.stopPropagation(); document.querySelectorAll(".card-menu").forEach(m => m.classList.add("hidden")); card.querySelector(".card-menu").classList.remove("hidden"); });
      on(card.querySelector('[data-act="copy"]'), "click", () => { navigator.clipboard.writeText(body); setStatus(statusId, "Copiado al portapapeles.", "ok"); });
      on(card.querySelector('[data-act="word"]'), "click", () => downloadDocx(`OdysSeek_${item.type}_${Date.now()}`, [body]));
      const aiBtn = card.querySelector('[data-act="ai"]');
      if (aiBtn) on(aiBtn, "click", async () => {
        const settings = await getSettings();
        if (!settings.aiEnabled || !settings.aiApiKey) { setStatus(statusId, "Activa la IA y configura una clave del proveedor elegido en Ajustes ⚙.", "warn"); return; }
        setStatus(statusId, "✨ Redactando cita con IA...", "warn");
        try {
          const improved = await generateCiteWithAI(item.meta, style, settings);
          if (!improved) { setStatus(statusId, "La IA no devolvió texto. Intenta de nuevo.", "warn"); return; }
          const data = await chrome.storage.local.get(GLOBAL_CITES_KEY);
          const stored = data[GLOBAL_CITES_KEY];
          const idx = stored?.items?.findIndex(i => i.id === item.id) ?? -1;
          if (idx >= 0) {
            stored.items[idx].aiCite = stored.items[idx].aiCite || {};
            stored.items[idx].aiCite[style] = improved;
            await chrome.storage.local.set({ [GLOBAL_CITES_KEY]: stored });
          }
          await refreshCites();
          setStatus(statusId, "¡Cita redactada con IA!", "ok");
        } catch (e) {
          setStatus(statusId, "Error de IA: " + e.message, "error");
        }
      });
      on(card.querySelector('[data-act="trash"]'), "click", async () => {
        if (item.type === "cite") await trashGlobalCiteDirect(item.id);
        else await trashRecordDirect(item.id, currentDocUrl);
        sel.delete(item.id); await refreshAll(); setStatus(statusId, "Movido a Papelera.", "ok");
      });
      box.appendChild(card);
    });
    updateSelectionBar(listId, statusId);
  }

  // Misma normalización que content.js::_urlKey y background.js — para que las 3 rutas de escritura coincidan
  function _docUrlKey(u) {
    try {
      const url = new URL(u);
      if (url.pathname.toLowerCase().endsWith(".pdf")) {
        return "odysseek::" + url.hostname + url.pathname;
      }
      ["utm_source", "utm_medium", "utm_campaign", "gclid", "fbclid"].forEach(p => url.searchParams.delete(p));
      return "odysseek::" + url.hostname + url.pathname + url.search;
    } catch { return "odysseek::" + u; }
  }
  async function getRecordsDirect(u) {
    const k = _docUrlKey(u);
    return (await chrome.storage.local.get(k))[k] || { url: u, pageTitle: "", items: [] };
  }
  async function saveRecordDirect(rec, u, title) {
    const k = _docUrlKey(u), s = await getRecordsDirect(u);
    s.url = u; s.pageTitle = title || s.pageTitle;
    const idx = s.items.findIndex(i => i.id === rec.id);
    if (idx >= 0) s.items[idx] = rec; else s.items.push(rec);
    await chrome.storage.local.set({ [k]: s });
    return { ok: true };
  }
  async function trashRecordDirect(id, u) {
    const k = _docUrlKey(u), s = await getRecordsDirect(u), idx = s.items.findIndex(i => i.id === id);
    if (idx >= 0) { s.items[idx].deleted = true; s.items[idx].deletedAt = new Date().toISOString(); await chrome.storage.local.set({ [k]: s }); }
    return { ok: true };
  }
  async function restoreRecordDirect(id, u) {
    const k = _docUrlKey(u), s = await getRecordsDirect(u), idx = s.items.findIndex(i => i.id === id);
    if (idx >= 0) { delete s.items[idx].deleted; delete s.items[idx].deletedAt; await chrome.storage.local.set({ [k]: s }); }
    return { ok: true };
  }
  async function deleteRecordDirect(id, u) {
    const k = _docUrlKey(u), s = await getRecordsDirect(u);
    s.items = s.items.filter(i => i.id !== id);
    if (!s.items.length) await chrome.storage.local.remove(k); else await chrome.storage.local.set({ [k]: s });
    return { ok: true };
  }
  async function emptyTrashDirect(u) {
    const k = _docUrlKey(u), s = await getRecordsDirect(u);
    s.items = s.items.filter(i => !i.deleted);
    if (!s.items.length) await chrome.storage.local.remove(k); else await chrome.storage.local.set({ [k]: s });
    return { ok: true };
  }

  async function trashGlobalCiteDirect(id) {
    const stored = await chrome.storage.local.get(GLOBAL_CITES_KEY);
    const it = (stored[GLOBAL_CITES_KEY]?.items || []).find(i => i.id === id);
    if (it) { it.deleted = true; it.deletedAt = new Date().toISOString(); }
    await chrome.storage.local.set({ [GLOBAL_CITES_KEY]: stored[GLOBAL_CITES_KEY] });
  }
  async function restoreGlobalCiteDirect(id) {
    const stored = await chrome.storage.local.get(GLOBAL_CITES_KEY);
    const it = (stored[GLOBAL_CITES_KEY]?.items || []).find(i => i.id === id);
    if (it) { delete it.deleted; delete it.deletedAt; }
    await chrome.storage.local.set({ [GLOBAL_CITES_KEY]: stored[GLOBAL_CITES_KEY] });
  }
  async function deleteGlobalCiteDirect(id) {
    const stored = await chrome.storage.local.get(GLOBAL_CITES_KEY);
    if (stored[GLOBAL_CITES_KEY]) {
      stored[GLOBAL_CITES_KEY].items = stored[GLOBAL_CITES_KEY].items.filter(i => i.id !== id);
      await chrome.storage.local.set({ [GLOBAL_CITES_KEY]: stored[GLOBAL_CITES_KEY] });
    }
  }
  async function emptyGlobalCiteTrashDirect() {
    const stored = await chrome.storage.local.get(GLOBAL_CITES_KEY);
    if (stored[GLOBAL_CITES_KEY]) {
      stored[GLOBAL_CITES_KEY].items = stored[GLOBAL_CITES_KEY].items.filter(i => !i.deleted);
      await chrome.storage.local.set({ [GLOBAL_CITES_KEY]: stored[GLOBAL_CITES_KEY] });
    }
  }

  function styleCard(c) { c.addEventListener("mouseenter", () => c.style.borderColor = "var(--accent)"); c.addEventListener("mouseleave", () => c.style.borderColor = "var(--border)"); }
  function filterCards(listId, q) { document.querySelectorAll(`#${listId} .card`).forEach(c => c.style.display = c.textContent.toLowerCase().includes(q.toLowerCase()) ? "" : "none"); }
  function escHtml(s) { return (s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }

  function downloadDocx(name, lines) {
    // Los nombres pueden ser escritos por el usuario y no deben interpretarse como HTML.
    const safeName = String(name || "OdysSeek").replace(/[\\/:*?"<>|\x00-\x1f]/g, "_").slice(0, 100) || "OdysSeek";
    const html = `<html xmlns:w='urn:schemas-microsoft-com:office:word'><head><meta charset='utf-8'><style>body{font-family:'Times New Roman';font-size:12pt;margin:2cm;}p{margin:0 0 6pt;line-height:1.5;}</style></head><body><h1>${escHtml(name)}</h1>${lines.map(l => `<p>${escHtml(l)}</p>`).join("")}</body></html>`;
    const blobUrl = URL.createObjectURL(new Blob([html], { type: "application/msword" }));
    const a = document.createElement("a"); a.href = blobUrl; a.download = `${safeName}.doc`; a.click();
    setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
  }

  async function exportSourcesXML() {
    const items = ((await chrome.storage.local.get(GLOBAL_CITES_KEY))[GLOBAL_CITES_KEY]?.items || []).filter(i => !i.deleted);
    if (!items.length) return;
    const xml = `<?xml version="1.0" encoding="UTF-8"?><b:Sources xmlns:b="http://schemas.openxmlformats.org/officeDocument/2006/bibliography">${items.map((it, i) => `
      <b:Source><b:Tag>OdysSeek${i+1}</b:Tag><b:SourceType>InternetSite</b:SourceType><b:Title>${escHtml(it.meta?.title || "")}</b:Title><b:URL>${escHtml(it.meta?.url || "")}</b:URL></b:Source>`).join("")}</b:Sources>`;
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([xml], { type: "application/xml" })); a.download = "Sources.xml"; a.click();
    setStatus("citeStatus", "Archivo XML exportado para Word.", "ok");
  }

  function initSettings() {
    on($("btnSettings"), "click", () => $("settingsOverlay").classList.remove("hidden"));
    on($("btnCloseSettings"), "click", () => $("settingsOverlay").classList.add("hidden"));
    on($("cfgAiProvider"), "change", updateAiHint);
    on($("btnSaveSettings"), "click", async () => {
      const s = { theme: $("cfgTheme").value, hlColor: $("cfgHlColor").value, activeColor: $("cfgActiveColor").value, fontSize: $("cfgFontSize").value, aiEnabled: $("cfgAiEnabled").checked, aiProvider: $("cfgAiProvider").value, aiApiKey: $("cfgAiKey").value.trim() };
      await chrome.storage.local.set({ "odysseek::settings": s }); applySettingsUI(s); setStatus("settingsStatus", "Cambios aplicados.", "ok");
    });
  }
  async function loadSettings() { const s = (await chrome.storage.local.get("odysseek::settings"))["odysseek::settings"] || {}; applySettingsUI(s); }
  function applySettingsUI(s) {
    if (s.theme) { document.body.className = s.theme === "light" ? "theme-light" : ""; if ($("cfgTheme")) $("cfgTheme").value = s.theme; }
    if (s.hlColor && $("cfgHlColor")) $("cfgHlColor").value = s.hlColor;
    if (s.activeColor && $("cfgActiveColor")) $("cfgActiveColor").value = s.activeColor;
    if (s.fontSize) { document.body.style.fontSize = `${s.fontSize}px`; if ($("cfgFontSize")) $("cfgFontSize").value = s.fontSize; }
    if ($("cfgAiEnabled")) $("cfgAiEnabled").checked = !!s.aiEnabled;
    if ($("cfgAiProvider")) $("cfgAiProvider").value = s.aiProvider || "gemini";
    if ($("cfgAiKey")) $("cfgAiKey").value = s.aiApiKey || "";
    updateAiHint();
    // Solo los colores llegan a content scripts y al visor: jamás enviar la clave de IA por mensajes.
    const displaySettings = { hlColor: s.hlColor, activeColor: s.activeColor };
    if (currentTab) chrome.tabs.sendMessage(currentTab.id, { action: "applySettings", settings: displaySettings }).catch(()=>{});
    chrome.runtime.sendMessage({ action: "applySettings", settings: displaySettings }).catch(()=>{});
  }
  function updateAiHint() {
    const hint = $("cfgAiHint"); if (!hint) return;
    if (($("cfgAiProvider")?.value || "gemini") === "gemini") {
      hint.innerHTML = 'Se ve como <code>AIzaSy...</code>. Consíguela gratis (sin tarjeta) en <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noopener">aistudio.google.com/app/apikey</a>.';
    } else {
      hint.innerHTML = 'Se ve como <code>sk-xxxxxxxxxxxxxxxxxxxx</code>. Consíguela en <a href="https://platform.deepseek.com/api_keys" target="_blank" rel="noopener">platform.deepseek.com/api_keys</a> (requiere cargar saldo; cobra por uso).';
    }
  }
  async function getSettings() { return (await chrome.storage.local.get("odysseek::settings"))["odysseek::settings"] || {}; }

  // ── Asistencia con IA (Gemini gratis, o DeepSeek de pago) ──
  async function callGemini(apiKey, systemPrompt, userPrompt) {
    const model = "gemini-3.8-flash";
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents: [{ parts: [{ text: userPrompt }] }],
        generationConfig: { temperature: 0.3, maxOutputTokens: 300 }
      })
    });
    if (!res.ok) {
      let detail = "";
      try { detail = (await res.json())?.error?.message || ""; } catch {}
      throw new Error(`Gemini (${res.status})${detail ? ": " + detail : ""}`);
    }
    const data = await res.json();
    return (data?.candidates?.[0]?.content?.parts?.map(p => p.text).join("") || "").trim();
  }

  async function callDeepSeek(apiKey, systemPrompt, userPrompt) {
    const res = await fetch("https://api.deepseek.com/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: "deepseek-chat",
        messages: [{ role: "system", content: systemPrompt }, { role: "user", content: userPrompt }],
        temperature: 0.3,
        max_tokens: 300
      })
    });
    if (!res.ok) {
      let detail = "";
      try { detail = (await res.json())?.error?.message || ""; } catch {}
      throw new Error(`DeepSeek (${res.status})${detail ? ": " + detail : ""}`);
    }
    const data = await res.json();
    return (data?.choices?.[0]?.message?.content || "").trim();
  }

  async function callAI(settings, systemPrompt, userPrompt) {
    return settings.aiProvider === "deepseek"
      ? callDeepSeek(settings.aiApiKey, systemPrompt, userPrompt)
      : callGemini(settings.aiApiKey, systemPrompt, userPrompt);
  }

  async function generateCiteWithAI(meta, style, settings) {
    const styleNames = { apa: "APA 7", mla: "MLA 9", chicago: "Chicago", vancouver: "Vancouver" };
    const sys = "Eres un asistente experto en normas de citación bibliográfica académica. Respondes ÚNICAMENTE con la cita ya formateada en una sola línea, sin explicaciones, sin comillas envolventes y sin inventar datos que no se te dieron (si falta un dato, indícalo de forma estándar para el estilo, por ejemplo 's.f.' para fecha desconocida).";
    const usr = `Formatea esta referencia en estilo ${styleNames[style] || style} a partir de estos datos (pueden venir incompletos o desordenados):\nTítulo: ${meta?.title || "(desconocido)"}\nAutor: ${meta?.author || "(desconocido)"}\nFecha: ${meta?.rawDate || "(desconocida)"}\nSitio/Editorial: ${meta?.siteName || "(desconocido)"}\nURL: ${meta?.url || "(sin URL)"}`;
    return await callAI(settings, sys, usr);
  }

  async function generateResourceNoteWithAI(title, url, draftText, settings) {
    const sys = "Eres un asistente de investigación académica. Escribes en español, en tono neutral y académico, una nota breve (2 a 3 frases) que explica la posible relevancia de un recurso para una investigación. Respondes solo con la nota, sin encabezados ni listas.";
    const usr = `Recurso a anotar: "${title}"\n${url ? `URL: ${url}\n` : ""}${draftText ? `Borrador/ideas del usuario: ${draftText}\n` : ""}Documento en el que se está trabajando actualmente: "${currentTitle || "(sin título)"}"`;
    return await callAI(settings, sys, usr);
  }
  async function sendToContent(act, pay = {}) {
    if (!currentTab) return null;
    try { return await chrome.tabs.sendMessage(currentTab.id, { action: act, ...pay }); }
    catch { await ensureContent(); try { return await chrome.tabs.sendMessage(currentTab.id, { action: act, ...pay }); } catch { return null; } }
  }
  async function ensureContent() {
    if (!currentTab) return;
    try { await chrome.tabs.sendMessage(currentTab.id, { action: "ping" }); }
    catch { try { await chrome.scripting.executeScript({ target: { tabId: currentTab.id }, files: ["content.js"] }); await chrome.scripting.insertCSS({ target: { tabId: currentTab.id }, files: ["content-styles.css"] }); } catch {} }
  }
})();