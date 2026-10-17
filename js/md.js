/* A small, safe Markdown renderer for news posts and FAQ answers.
   Everything is HTML-escaped first, then these are turned on:
   ## heading, ### heading, **bold**, *italics*, [link](https://...),
   ![alt](https://...image), - bullet lists, 1. numbered lists, > quotes,
   and blank lines between paragraphs. */
window.KanamMD = (function(){
  const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const safeUrl = u => /^(https?:\/\/|mailto:|tel:|\/|\.\/|[a-z0-9-]+\.html)/i.test(u) ? u : '#';

  function inline(s){
    return s
      .replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (_, alt, url) => `<img src="${safeUrl(url)}" alt="${alt}" loading="lazy">`)
      .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, text, url) => `<a href="${safeUrl(url)}"${/^https?:/i.test(url) ? ' target="_blank" rel="noopener"' : ''}>${text}</a>`)
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>');
  }

  function render(src){
    const lines = esc(src).replace(/\r/g, '').split('\n');
    const out = [];
    let para = [], list = null;
    const flushPara = () => { if (para.length){ out.push(`<p>${inline(para.join('<br>'))}</p>`); para = []; } };
    const flushList = () => { if (list){ out.push(`<${list.tag}>${list.items.map(i => `<li>${inline(i)}</li>`).join('')}</${list.tag}>`); list = null; } };
    for (const raw of lines){
      const line = raw.trimEnd();
      let m;
      if (!line.trim()){ flushPara(); flushList(); continue; }
      if ((m = line.match(/^(#{2,3})\s+(.*)$/))){ flushPara(); flushList(); out.push(`<h${m[1].length}>${inline(m[2])}</h${m[1].length}>`); continue; }
      if ((m = line.match(/^&gt;\s?(.*)$/))){ flushPara(); flushList(); out.push(`<blockquote>${inline(m[1])}</blockquote>`); continue; }
      if ((m = line.match(/^\s*[-*]\s+(.*)$/))){ flushPara(); if (!list || list.tag !== 'ul'){ flushList(); list = { tag: 'ul', items: [] }; } list.items.push(m[1]); continue; }
      if ((m = line.match(/^\s*\d+[.)]\s+(.*)$/))){ flushPara(); if (!list || list.tag !== 'ol'){ flushList(); list = { tag: 'ol', items: [] }; } list.items.push(m[1]); continue; }
      flushList();
      para.push(line);
    }
    flushPara(); flushList();
    return out.join('\n');
  }

  return { render, esc };
})();
