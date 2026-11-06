// A small Markdown renderer for the manual (spec §16.1; no build step, no dependencies).
// Supports: ATX headings (with ids from their text, or {#id}), paragraphs, emphasis (*em*,
// **strong**), `code`, links and images, fenced code blocks (``` lang [name]), bullet and
// numbered lists (nested by indentation), block quotes, GitHub tables, horizontal rules and
// raw HTML blocks (lines starting with "<"). Everything else is escaped.

export const slug = (text) => String(text).toLowerCase().replace(/<[^>]+>/g, '').replace(/[`*_~]/g, '').replace(/[^\p{L}\p{N}\s-]/gu, '').trim().replace(/\s+/g, '-');
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Inline Markdown → HTML. linkHref(href) may rewrite link targets. */
export function inline(text, { linkHref = (x) => x } = {}) {
  const codes = [];
  let s = String(text).replace(/`([^`]+)`/g, (_, c) => { codes.push(c); return `\u0000${codes.length - 1}\u0000`; });
  s = esc(s);
  s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (_, alt, src) => `<img alt="${alt}" src="${src}">`);
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label, href) => `<a href="${esc(linkHref(href.replace(/&amp;/g, '&')))}">${label}</a>`);
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/(^|[^\w*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>');
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${esc(codes[+i])}</code>`);
}

/** Parse Markdown into blocks (also used by the tests to find code blocks and links). */
export function parse(md) {
  const lines = md.replace(/\r\n?/g, '\n').split('\n'), out = [];
  let i = 0;
  const isBlank = (l) => !l.trim();
  while (i < lines.length) {
    const l = lines[i];
    let m;
    if (isBlank(l)) { i++; continue; }
    if ((m = /^(`{3,})\s*(\S*)\s*(.*)$/.exec(l))) {
      const fence = m[1], body = []; i++;
      while (i < lines.length && !lines[i].startsWith(fence)) body.push(lines[i++]);
      i++; out.push({ type: 'code', lang: m[2], info: m[3].trim(), text: body.join('\n'), line: i - body.length - 1 }); continue;
    }
    if ((m = /^(#{1,6})\s+(.*?)\s*(?:\{#([\w-]+)\})?\s*#*\s*$/.exec(l))) { out.push({ type: 'heading', level: m[1].length, text: m[2], id: m[3] ?? slug(m[2]) }); i++; continue; }
    if (/^(\*\s*){3,}$|^(-\s*){3,}$/.test(l.trim())) { out.push({ type: 'hr' }); i++; continue; }
    if (/^\s*</.test(l)) { const body = []; while (i < lines.length && !isBlank(lines[i])) body.push(lines[i++]); out.push({ type: 'html', text: body.join('\n') }); continue; }
    if (/^>\s?/.test(l)) { const body = []; while (i < lines.length && /^>\s?/.test(lines[i])) body.push(lines[i++].replace(/^>\s?/, '')); out.push({ type: 'quote', blocks: parse(body.join('\n')) }); continue; }
    if (/^\|.*\|\s*$/.test(l) && i + 1 < lines.length && /^\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/.test(lines[i + 1])) {
      const cells = (r) => r.trim().replace(/^\||\|$/g, '').split(/(?<!\\)\|/).map(c => c.trim().replace(/\\\|/g, '|'));
      const head = cells(l), align = cells(lines[i + 1]).map(c => (c.startsWith(':') && c.endsWith(':') ? 'center' : c.endsWith(':') ? 'right' : null));
      const rows = []; i += 2;
      while (i < lines.length && /^\|/.test(lines[i])) rows.push(cells(lines[i++]));
      out.push({ type: 'table', head, align, rows }); continue;
    }
    if (/^(\s*)([-*]|\d+[.)])\s+/.test(l)) {
      const kind = (x) => { const k = /^(\s*)([-*]|\d+[.)])\s+/.exec(x); return k && k[1].length === /^\s*/.exec(l)[0].length ? (/\d/.test(k[2]) ? 'ol' : 'ul') : null; };
      const k0 = kind(l), body = [];
      while (i < lines.length && (!isBlank(lines[i]) || (i + 1 < lines.length && /^\s+\S/.test(lines[i + 1])))) { const k = kind(lines[i]); if (body.length && k && k !== k0) break; body.push(lines[i++]); }
      out.push(parseList(body)); continue;
    }
    const body = [];
    while (i < lines.length && !isBlank(lines[i]) && !/^(#{1,6}\s|`{3,}|>|\s*([-*]|\d+[.)])\s+|\|.*\|\s*$)/.test(lines[i])) body.push(lines[i++]);
    if (!body.length) body.push(lines[i++]);
    out.push({ type: 'para', text: body.join(' ') });
  }
  return out;
}

function parseList(lines) {
  const ind = (l) => /^\s*/.exec(l)[0].length;
  const base = ind(lines[0]), ordered = /^\s*\d+[.)]/.test(lines[0]);
  const items = [];
  for (const l of lines) {
    const m = /^(\s*)([-*]|\d+[.)])\s+(.*)$/.exec(l);
    if (m && m[1].length === base) items.push({ text: m[3], sub: [] });
    else if (items.length) items[items.length - 1].sub.push(l);
  }
  return { type: 'list', ordered, start: ordered ? parseInt(/\d+/.exec(lines[0])[0], 10) : 1, items: items.map(it => {
    const sub = it.sub.filter(x => x.trim());
    const nested = sub.length && /^\s*([-*]|\d+[.)])\s+/.test(sub[0]) ? parseList(sub) : null;
    return { text: [it.text, ...(nested ? [] : sub.map(x => x.trim()))].join(' '), list: nested };
  }) };
}

/** Render Markdown to HTML. opts.linkHref rewrites link targets; opts.codeClass(lang, info). */
export function render(md, opts = {}) {
  const r = (blocks) => blocks.map(b => {
    switch (b.type) {
      case 'heading': return `<h${b.level} id="${esc(b.id)}">${inline(b.text, opts)}</h${b.level}>`;
      case 'para': return `<p>${inline(b.text, opts)}</p>`;
      case 'code': return `<pre class="code${b.lang ? ` lang-${esc(b.lang)}` : ''}"${b.info ? ` data-info="${esc(b.info)}"` : ''}>${b.info && b.lang === 'file' ? `<span class="file-name">${esc(b.info)}</span>\n` : ''}<code>${esc(b.text)}</code></pre>`;
      case 'hr': return '<hr>';
      case 'html': return b.text;
      case 'quote': return `<blockquote>${r(b.blocks)}</blockquote>`;
      case 'table': return `<div class="table-wrap"><table class="data"><thead><tr>${b.head.map((c, j) => `<th${b.align[j] ? ` style="text-align:${b.align[j]}"` : ''}>${inline(c, opts)}</th>`).join('')}</tr></thead><tbody>${b.rows.map(row => `<tr>${row.map((c, j) => `<td${b.align[j] ? ` style="text-align:${b.align[j]}"` : ''}>${inline(c, opts)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
      case 'list': { const L = (x) => `<${x.ordered ? `ol${x.start !== 1 ? ` start="${x.start}"` : ''}` : 'ul'}>${x.items.map(it => `<li>${inline(it.text, opts)}${it.list ? L(it.list) : ''}</li>`).join('')}</${x.ordered ? 'ol' : 'ul'}>`; return L(b); }
      default: return '';
    }
  }).join('\n');
  return r(parse(md));
}

/** Every link target and heading id in a Markdown text (for the link checker). */
export function linksAndAnchors(md) {
  const blocks = parse(md), links = [], ids = [];
  const texts = [];
  const walk = (bs) => bs.forEach(b => {
    if (b.type === 'heading') { ids.push(b.id); texts.push(b.text); }
    else if (b.type === 'para') texts.push(b.text);
    else if (b.type === 'table') texts.push(...b.head, ...b.rows.flat());
    else if (b.type === 'list') { const L = (x) => x.items.forEach(it => { texts.push(it.text); if (it.list) L(it.list); }); L(b); }
    else if (b.type === 'quote') walk(b.blocks);
    else if (b.type === 'html') { for (const m of b.text.matchAll(/\bid="([^"]+)"/g)) ids.push(m[1]); for (const m of b.text.matchAll(/\bhref="([^"]+)"/g)) links.push(m[1]); }
  });
  walk(blocks);
  for (const t of texts) for (const m of String(t).replace(/`[^`]*`/g, '').matchAll(/!?\[[^\]]*\]\(([^)\s]+)\)/g)) links.push(m[1]);
  return { links, ids };
}
