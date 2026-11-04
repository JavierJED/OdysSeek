// OdysSeek v3.4.2 — Injected DOM, Scholar Lock-Memory & Semantic Engine
"use strict";

(function () {
  // --- GUARDIA ABSOLUTO PARA PDF NATIVO ---
  if (document.contentType === "application/pdf" || window.location.pathname.toLowerCase().endsWith(".pdf")) {
    chrome.runtime.onMessage.addListener((req, _sender, sendResponse) => {
      if (req.action === "highlight" || req.action === "getPageMeta") {
        sendResponse({ isPdf: true, count: 0 });
      } else if (req.action === "ping") {
        sendResponse({ ok: true }); // Salva al popup de colapsar devolviendo un "estoy vivo"
      } else {
        sendResponse({ ok: false, isPdf: true }); // Respuesta neutra
      }
      return true;
    });
    return;
  }

  let _marks = [], _matchIdx = -1, _matchTotal = 0;
  const MAX_HIGHLIGHTS = 500;

  chrome.runtime.onMessage.addListener((req, _sender, sendResponse) => {
    if (req.action === "getDocKeywords") { sendResponse(_extractKeywords()); return true; }
    if (req.action === "runScholarEngine") { runScholarEngine(); sendResponse({ ok: true }); return true; }
    if (req.action === "ping") { sendResponse({ ok: true }); return; }
         
    // --- COMPORTAMIENTO WEB ESTÁNDAR ---
    if (req.action === "highlight") { 
      _removeHighlights(); 
      _matchTotal = _highlight(req.keyword); 
      _matchIdx = _matchTotal > 0 ? 0 : -1; 
      _scrollToActive(_matchIdx); 
      sendResponse({ count: _matchTotal }); 
      return true; 
    }
    if (req.action === "clearHighlights") { _removeHighlights(); sendResponse({ ok: true }); return; }
    if (req.action === "navigate") { _doNavigate(req.direction); sendResponse({ index: _matchIdx, total: _matchTotal }); return; }
    if (req.action === "getPageMeta") { sendResponse(_extractMeta()); return; }
    
    if (req.action === "scrollToSemId") {
      const el = document.querySelector(`[data-odysseek-sem-id="${req.id}"]`);
      if (el) { 
        el.scrollIntoView({ behavior: "smooth", block: "center" }); 
        el.classList.remove("odysseek-pulse"); 
        void el.offsetWidth; 
        el.classList.add("odysseek-pulse"); 
      }
      sendResponse({ ok: !!el }); 
      return true;
    }
    
    if (req.action === "getRecords") { _getRecords(req.url).then(sendResponse); return true; }
    if (req.action === "saveRecord") { _saveRecord(req.record, req.url, req.pageTitle).then(sendResponse); return true; }
    if (req.action === "trashRecord") { _trashRecord(req.id, req.url).then(sendResponse); return true; }
    if (req.action === "restoreRecord") { _restoreRecord(req.id, req.url).then(sendResponse); return true; }
    if (req.action === "deleteRecord") { _deleteRecord(req.id, req.url).then(sendResponse); return true; }
    if (req.action === "emptyTrash") { _emptyTrash(req.url).then(sendResponse); return true; }
    if (req.action === "clearAllHistory") { _clearAllHistory().then(sendResponse); return true; }
    if (req.action === "clearHistoryByType") { _clearHistoryByType(req.type).then(sendResponse); return true; }
    
    if (req.action === "applySettings") { 
      if (req.settings?.hlColor) document.documentElement.style.setProperty("--os-hl-color", req.settings.hlColor); 
      if (req.settings?.activeColor) document.documentElement.style.setProperty("--os-active-color", req.settings.activeColor); 
      sendResponse({ ok: true }); 
      return; 
    }
  });

  // --- MOTOR SCHOLAR DESACOPLADO CON CANDADO ANTI-BUCLES ---
  let _scholarObserver = null;
  let _isUpdatingScholar = false;
  
  function runScholarEngine() {
    if (!location.hostname.includes("scholar.google") || _isUpdatingScholar) return;
    const container = document.querySelector("#gs_res_ccl_mid");
    if (!container) return;
    const articles = Array.from(container.querySelectorAll(".gs_r")).filter(el => el.querySelector(".gs_rt"));
    if (!articles.length) return;
    
    _isUpdatingScholar = true;
    if (_scholarObserver) _scholarObserver.disconnect();
    
    articles.forEach((el, idx) => {
      if (!el.hasAttribute("data-original-idx")) el.setAttribute("data-original-idx", idx);
    });
    
    chrome.storage.local.get(["odysseek::scholar_sort", "odysseek::scholar_filter"], data => {
      const sortMode = data["odysseek::scholar_sort"] || "normal";
      const filterMode = data["odysseek::scholar_filter"] || "all";
      
      articles.forEach(el => {
        const titleText = el.querySelector(".gs_rt")?.textContent || "";
        const isBookOrCit = /\[(?:LIBRO|BOOK|CITACIÓN|CITATION)\]/i.test(titleText);
        const isBook = /\[(?:LIBRO|BOOK)\]/i.test(titleText);
        const allLinks = Array.from(el.querySelectorAll("a"));
        
        const hasOpenAccess = allLinks.some(a => {
          const text = (a.textContent || "").toLowerCase();
          const href = (a.href || "").toLowerCase();
          return text.includes("[pdf]") || text.includes("[html]") || href.endsWith(".pdf") || href.includes("pdf=");
        });
        
        const isBookLink = allLinks.some(a => {
          const href = (a.href || "").toLowerCase();
          return href.includes("books.google") || href.includes("isbn") || href.includes("/book");
        });
        
        if (filterMode === "oa") {
          el.style.display = (hasOpenAccess && !isBookOrCit) ? "" : "none";
        } else if (filterMode === "web") {
          el.style.display = (!hasOpenAccess && !isBookOrCit) ? "" : "none";
        } else if (filterMode === "books") {
          el.style.display = (isBook || isBookLink) ? "" : "none";
        } else {
          el.style.display = "";
        }
      });
           
      let toSort = Array.from(articles);
      if (sortMode === "cites") {
        toSort.sort((a, b) => {
          const getC = el => {
            const anc = Array.from(el.querySelectorAll("a")).find(a => /citado por|cited by/i.test(a.textContent));
            const m = anc?.textContent.match(/\d+/);
            return m ? parseInt(m[0], 10) : 0;
          };
          return getC(b) - getC(a);
        });
      } else if (sortMode === "date") {
        toSort.sort((a, b) => {
          const getY = el => {
            const m = (el.textContent || "").match(/\b(19|20)\d{2}\b/g);
            return m ? parseInt(m[m.length - 1], 10) : 0;
          };
          return getY(b) - getY(a);
        });
      } else {
        toSort.sort((a, b) => parseInt(a.getAttribute("data-original-idx")) - parseInt(b.getAttribute("data-original-idx")));
      }
      
      toSort.forEach(el => container.appendChild(el));
      
      setTimeout(() => {
        _isUpdatingScholar = false;
        if (_scholarObserver && container) _scholarObserver.observe(container, { childList: true });
      }, 350);
    });
  }

  if (location.hostname.includes("scholar.google")) {
    setTimeout(() => {
      runScholarEngine();
      const container = document.querySelector("#gs_res_ccl_mid");
      if (container) {
        _scholarObserver = new MutationObserver(() => runScholarEngine());
        _scholarObserver.observe(container, { childList: true });
      }
    }, 300);
  }

  function _extractKeywords() {
    const stop = new Set(["de","la","el","los","las","un","una","y","o","en","con","por","para","que","es","son","del","al","se","su","no","a","lo","como","más","sus","este","esta","entre","sobre","para","todo","ser","dos","sin","muy","años","hasta","desde","estos"]);
    const text = (document.title + " " + Array.from(document.querySelectorAll("h1, h2, h3, strong")).map(h => h.textContent).join(" ")).toLowerCase();
    const words = text.split(/\W+/).filter(w => w.length > 4 && !stop.has(w) && !/\d/.test(w));
    const freq = {}; words.forEach(w => freq[w] = (freq[w] || 0) + 1);
    return Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, 4).map(e => e[0]);
  }

  function _highlight(kw) {
    if (!kw) return 0; 
    const esc = kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); 
    let n = 0;
    
    function walk(node) {
      if (n >= MAX_HIGHLIGHTS) return;
      if (node.nodeType === 3) {
        if (!new RegExp(esc, "i").test(node.nodeValue)) return;
        const re = new RegExp(esc, "gi"), frag = document.createDocumentFragment(); 
        let last = 0, m;
        
        while (n < MAX_HIGHLIGHTS && (m = re.exec(node.nodeValue)) !== null) {
          if (m.index > last) frag.appendChild(document.createTextNode(node.nodeValue.slice(last, m.index)));
          const mark = document.createElement("mark"); 
          mark.className = "odysseek-highlight"; 
          mark.textContent = m[0];
          frag.appendChild(mark); 
          _marks.push(mark); 
          last = re.lastIndex; 
          n++;
        }
        
        if (last < node.nodeValue.length) frag.appendChild(document.createTextNode(node.nodeValue.slice(last)));
        node.parentNode?.replaceChild(frag, node);
      } else if (node.nodeType === 1 && !["SCRIPT","STYLE","INPUT","TEXTAREA","SELECT"].includes(node.tagName) && !node.classList?.contains("odysseek-highlight")) {
        Array.from(node.childNodes).forEach(walk);
      }
    }
    walk(document.body); return n;
  }

  function _scrollToActive(idx) {
    document.querySelectorAll(".odysseek-highlight").forEach((el, i) => el.classList.toggle("odysseek-active", i === idx));
    document.querySelector(".odysseek-active")?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  function _removeHighlights() {
    let marks = document.querySelectorAll(".odysseek-highlight");
    while (marks.length > 0) {
      marks.forEach(m => {
        const parent = m.parentNode;
        if (parent) {
          parent.replaceChild(document.createTextNode(m.textContent), m);
        }
      });
      document.body.normalize();
      marks = document.querySelectorAll(".odysseek-highlight");
    }
    _marks = []; _matchTotal = 0; _matchIdx = -1;
  }

  function _doNavigate(dir) { 
    if (_matchTotal === 0) return; 
    _matchIdx = dir === "next" ? (_matchIdx + 1) % _matchTotal : (_matchIdx - 1 + _matchTotal) % _matchTotal; 
    _scrollToActive(_matchIdx); 
  }

  function _extractMeta() {
    const q = s => document.querySelector(s)?.content?.trim() || "";
    return {
      url: location.href, 
      title: document.title || "Sin título",
      author: q('meta[name="author"]') || q('meta[property="article:author"]') || document.querySelector('[rel="author"]')?.textContent?.trim() || "",
      rawDate: q('meta[property="article:published_time"]') || q('meta[name="date"]') || document.querySelector("time")?.getAttribute("datetime") || "",
      siteName: q('meta[property="og:site_name"]') || location.hostname.replace(/^www\./, ""), 
      accessed: new Date().toISOString()
    };
  }

  /* --- FILTRO SEMÁNTICO SIMBIÓTICO --- */
  window.__odysseekSemanticFilter = function(query = "", concept = "") {
    document.querySelectorAll("[data-odysseek-sem-id]").forEach(el => el.removeAttribute("data-odysseek-sem-id"));
    const paras = []; 
    document.querySelectorAll("p, li, h1, h2, h3, blockquote").forEach(el => { 
      if (el.textContent.trim().length > 35) paras.push({ el, txt: el.textContent.trim() }); 
    });
    
    let scored = [];
    if (concept) {
      const reg = { 
        resumen: /resumen|abstract|introducci[oó]n/i, 
        metodologia: /metodolog[ií]a|methods|materiales/i, 
        resultados: /resultados|results|datos|m[eé]tricas/i, 
        futuro: /trabajo futuro|future work|limitations|limitaciones/i 
      }[concept];
      
      if (reg) {
        let cap = 0; 
        paras.forEach(({ el, txt }) => {
          if (reg.test(txt) && el.tagName.startsWith("H")) { cap = 2; scored.push({ el, text: txt.slice(0, 200), score: 10 }); }
          else if (cap > 0) { scored.push({ el, text: txt.slice(0, 200), score: cap * 3 }); cap--; }
          else if (reg.test(txt)) scored.push({ el, text: txt.slice(0, 200), score: 5 });
        });
      }
    } else {
      const stop = new Set(["de","la","el","los","las","un","una","y","o","en","con","por","para","que","es","son","del","al","se","su","no","a","lo","como","más","sus","este","entre"]);
      const tokens = (query.trim() || document.title).toLowerCase().split(/\W+/).filter(t => t.length > 3 && !stop.has(t)).slice(0, 5);
      if (!tokens.length) return [];
      
      scored = paras.map(({ el, txt }) => {
        let score = 0; const lower = txt.toLowerCase();
        tokens.forEach(t => { const m = lower.match(new RegExp(t, "g")); if (m) score += m.length * (el.tagName.startsWith("H") ? 3 : 1); });
        return { el, text: txt.slice(0, 200), score };
      }).filter(r => r.score > 0);
    }
    
    return scored.sort((a, b) => b.score - a.score).slice(0, 5).map((it, i) => {
      const id = `os_sem_${i}_${Date.now()}`; 
      it.el.setAttribute("data-odysseek-sem-id", id);
      return { id, text: it.text, score: it.score };
    });
  };

  /* --- ALMACENAMIENTO POR URL --- */
  function _urlKey(u) {
    try {
      const url = new URL(u);
      if (url.pathname.toLowerCase().endsWith(".pdf")) {
        return "odysseek::" + url.hostname + url.pathname;
      }
      ["utm_source","utm_medium","utm_campaign","gclid","fbclid"].forEach(p => url.searchParams.delete(p));
      return "odysseek::" + url.hostname + url.pathname + url.search;
    } catch { return "odysseek::" + u; }
  }

  async function _getRecords(u) { const k = _urlKey(u); return (await chrome.storage.local.get(k))[k] || { url: u, pageTitle: "", items: [] }; }
  
  async function _saveRecord(rec, u, title) { 
    const k = _urlKey(u), s = await _getRecords(u); 
    s.url = u; 
    s.pageTitle = title || s.pageTitle; 
    const idx = s.items.findIndex(i => i.id === rec.id); 
    if (idx >= 0) s.items[idx] = rec; else s.items.push(rec); 
    await chrome.storage.local.set({ [k]: s }); 
    return { ok: true }; 
  }
  
  async function _trashRecord(id, u) { 
    const k = _urlKey(u), s = await _getRecords(u), idx = s.items.findIndex(i => i.id === id); 
    if (idx >= 0) { 
      s.items[idx].deleted = true; 
      s.items[idx].deletedAt = new Date().toISOString(); 
      await chrome.storage.local.set({ [k]: s }); 
    } 
    return { ok: true }; 
  }
  
  async function _restoreRecord(id, u) { 
    const k = _urlKey(u), s = await _getRecords(u), idx = s.items.findIndex(i => i.id === id); 
    if (idx >= 0) { 
      delete s.items[idx].deleted; 
      await chrome.storage.local.set({ [k]: s }); 
    } 
    return { ok: true }; 
  }
  
  async function _deleteRecord(id, u) { 
    const k = _urlKey(u), s = await _getRecords(u); 
    s.items = s.items.filter(i => i.id !== id); 
    if (!s.items.length) await chrome.storage.local.remove(k); 
    else await chrome.storage.local.set({ [k]: s }); 
    return { ok: true }; 
  }
  
  async function _emptyTrash(u) { 
    const k = _urlKey(u), s = await _getRecords(u); 
    s.items = s.items.filter(i => !i.deleted); 
    if (!s.items.length) await chrome.storage.local.remove(k); 
    else await chrome.storage.local.set({ [k]: s }); 
    return { ok: true }; 
  }
  
  async function _clearAllHistory() { 
    const all = await chrome.storage.local.get(null), 
          keys = Object.keys(all).filter(k => k.startsWith("odysseek::") && !["odysseek::settings", "odysseek::cites_global", "odysseek::scholar_sort", "odysseek::scholar_filter"].includes(k)); 
    if (keys.length) await chrome.storage.local.remove(keys); 
    return { ok: true }; 
  }
  
  async function _clearHistoryByType(type) {
    if (type === "cite") await chrome.storage.local.set({ "odysseek::cites_global": { items: [] } });
    else {
      const all = await chrome.storage.local.get(null);
      for (const [k, v] of Object.entries(all)) {
        if (k.startsWith("odysseek::") && !["odysseek::settings", "odysseek::cites_global", "odysseek::scholar_sort", "odysseek::scholar_filter"].includes(k)) {
          v.items = (v.items || []).filter(i => i.type !== type);
          if (!v.items.length) await chrome.storage.local.remove(k);
          else await chrome.storage.local.set({ [k]: v });
        }
      }
    }
    return { ok: true };
  }
})();