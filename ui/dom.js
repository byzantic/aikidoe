// Tiny DOM helpers for the UI.

/**
 * h('div', { class: 'x', onclick: f, title: 't' }, child, 'text', [more], null) → element.
 * Attributes starting with "on" become event listeners; `value`, `checked`, `disabled` and
 * `selected` are set as properties; null/false children and attributes are skipped.
 */
export function h(tag, attrs = {}, ...children) {
  const el = tag.startsWith('svg:') ? document.createElementNS('http://www.w3.org/2000/svg', tag.slice(4)) : document.createElement(tag);
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (['value', 'checked', 'disabled', 'selected'].includes(k)) el[k] = v;
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const clear = (el) => { while (el.firstChild) el.removeChild(el.firstChild); return el; };

/** <select> from [{ value, label }] or strings. */
export function select(options, value, onchange, attrs = {}) {
  return h('select', { ...attrs, onchange: (e) => onchange(e.target.value) },
    options.map(o => { const v = typeof o === 'object' ? o.value : o; const l = typeof o === 'object' ? o.label : o; return h('option', { value: v, selected: String(v) === String(value) }, l); }));
}

/** Messages box: [{ severity, message }] or strings. */
export function messages(list, severity = 'error') {
  if (!list.length) return null;
  return h('div', { class: `msg ${severity}` }, list.length === 1 ? (list[0].message ?? list[0]) : h('ul', {}, list.map(m => h('li', {}, m.message ?? m))));
}

/** Simple table from columns [{ key, label, cls, fmt }] and row objects. */
export function dataTable(columns, rows, { rowAttrs } = {}) {
  return h('div', { class: 'table-wrap' }, h('table', { class: 'data' },
    h('thead', {}, h('tr', {}, columns.map(c => h('th', { class: c.cls ?? '' }, c.label)))),
    h('tbody', {}, rows.map(r => h('tr', rowAttrs ? rowAttrs(r) : {}, columns.map(c => h('td', { class: c.cls ?? '' }, c.fmt ? c.fmt(r[c.key], r) : r[c.key])))))));
}

let toastTimer;
export function toast(text) {
  const t = $('#toast'); if (!t) return;
  t.textContent = text; t.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2500);
}

/** Offer a text file for download. */
export function download(name, text, type = 'text/plain') {
  const a = h('a', { href: URL.createObjectURL(new Blob([text], { type })), download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}

/** A "?" link to a manual section (docs/manual/PAGE.md#ANCHOR), opened in a new tab. */
export const help = (page, anchor) => h('a', { class: 'help', href: `docs/manual/index.html?p=${page}${anchor ? `#${anchor}` : ''}`, target: '_blank', rel: 'noopener',
  title: 'Open the manual', 'aria-label': `manual: ${page}${anchor ? ` ${anchor}` : ''}`, 'data-help': `${page}${anchor ? `#${anchor}` : ''}` }, '?');
