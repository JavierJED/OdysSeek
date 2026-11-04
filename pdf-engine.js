// OdysSeek v3.4.2 — Standalone In-Memory PDF Parsing & Semantic Engine (pdf-engine.js)
"use strict";

window.odysseekPDFEngine = {
  parseDocument: async function (_tabInput, maxPages = 35) {
    try {
      const response = await chrome.runtime.sendMessage({
        action: "parsePdfInMemory",
        maxPages: maxPages
      });

      return response || { ok: false, error: "No se obtuvo respuesta del visor PDF." };
    } catch (e) {
      console.warn("[OdysSeek PDF Engine] Error en comunicación con visor:", e);
      return { ok: false, error: e.message };
    }
  },

  filterSemantic: function (paragraphs, query = "", concept = "") {
    paragraphs = paragraphs || [];
    let scored = [];
    if (concept) {
      const reg = {
        resumen: /resumen|abstract|introducci[oó]n|objetivos|prop[oó]sito/i,
        metodologia: /metodolog[ií]a|methods|materiales|m[eé]todos|proceso|fase|actividades|desarrollo|ciclo de vida/i,
        resultados: /resultados|results|datos|m[eé]tricas|hallazgos|verificaci[oó]n|validaci[oó]n|pruebas|evaluaci[oó]n|calidad/i,
        futuro: /trabajo futuro|future work|limitations|limitaciones|conclusiones|discusi/i
      }[concept];
      
      if (reg) {
        let cap = 0;
        paragraphs.forEach(p => {
          if (reg.test(p.text) && p.text.length < 180) {
            cap = 2;
            scored.push({ text: `[Pág. ${p.page}] ` + p.text, score: 10, page: p.page });
          } else if (cap > 0) {
            scored.push({ text: `[Pág. ${p.page}] ` + p.text, score: cap * 3, page: p.page });
            cap--;
          } else if (reg.test(p.text)) {
            scored.push({ text: `[Pág. ${p.page}] ` + p.text, score: 5, page: p.page });
          }
        });
      }
    } else {
      const stop = new Set(["de","la","el","los","las","un","una","y","o","en","con","por","para","que","es","son","del","al","se","su","no","a","lo","como","más","sus","este","esta","entre","sobre","para","todo","ser","dos","sin","muy","años","hasta","desde","estos"]);
      const tokens = query.trim().toLowerCase().split(/\W+/).filter(t => t.length > 3 && !stop.has(t)).slice(0, 5);
      
      if (!tokens.length) {
        return paragraphs.slice(0, 5).map((p, i) => ({
          id: `pdf_sem_${i}`,
          text: `[Pág. ${p.page}] ` + p.text,
          score: 5,
          page: p.page
        }));
      }
      
      scored = paragraphs.map(p => {
        let score = 0;
        const lower = p.text.toLowerCase();
        tokens.forEach(t => {
          const m = lower.match(new RegExp(t, "g"));
          if (m) score += m.length * 2;
        });
        return { text: `[Pág. ${p.page}] ` + p.text, score, page: p.page };
      }).filter(r => r.score > 0);
    }
    
    if (scored.length === 0 && !concept && query) {
      scored = paragraphs.slice(0, 5).map((p, i) => ({
        text: `[Pág. ${p.page}] ` + p.text,
        score: 3,        page: p.page
      }));
    }
    
    return scored.sort((a, b) => b.score - a.score).slice(0, 5).map((it, i) => ({
      id: `pdf_sem_${i}`,
      text: it.text,
      score: it.score,
      page: it.page
    }));
  },

  extractKeywords: function (fullText) {
    const stop = new Set(["de","la","el","los","las","un","una","y","o","en","con","por","para","que","es","son","del","al","se","su","no","a","lo","como","más","sus","este","esta","entre","sobre","para","todo","ser","dos","sin","muy","años","hasta","desde","estos","presente","documento","trabajo","capítulo"]);
    const words = fullText.toLowerCase().split(/\W+/).filter(w => w.length > 4 && !stop.has(w) && !/\d/.test(w));
    const freq = {};
    words.forEach(w => freq[w] = (freq[w] || 0) + 1);
    return Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, 4).map(e => e[0]);
  }
};