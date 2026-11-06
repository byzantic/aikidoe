// Manual viewer: index.html?p=page#section renders docs/manual/page.md (spec §16.1).
// Links to other pages (page.md#x) stay in the viewer; links to the app open it.
import { render } from '../../js/markdown.js';
import { PAGES } from './pages.js';

const params = new URLSearchParams(location.search);
const id = PAGES.some(p => p.id === params.get('p')) ? params.get('p') : 'index';
const linkHref = (href) => {
  const m = /^([\w-]+)\.md(#.*)?$/.exec(href);
  return m ? `?p=${m[1]}${m[2] ?? ''}` : href;
};

const toc = document.getElementById('toc');
let part = null;
for (const p of PAGES) {
  if (p.part !== part && p.part) { const h = document.createElement('div'); h.className = 'toc-part'; h.textContent = p.part; toc.append(h); }
  part = p.part;
  const a = document.createElement('a');
  a.href = `?p=${p.id}`; a.textContent = p.id === 'index' ? 'Contents' : p.title;
  if (p.id === id) a.setAttribute('aria-current', 'page');
  toc.append(a);
}

const page = document.getElementById('page');
try {
  const res = await fetch(`${id}.md`);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  page.innerHTML = render(await res.text(), { linkHref });
  document.title = `${PAGES.find(p => p.id === id).title} · aikidoe manual`;
  // previous / next
  const i = PAGES.findIndex(p => p.id === id), nav = document.createElement('nav');
  nav.className = 'page-nav';
  if (i > 0) nav.innerHTML += `<a href="?p=${PAGES[i - 1].id}">← ${PAGES[i - 1].title}</a>`;
  if (i < PAGES.length - 1) nav.innerHTML += `<a class="next" href="?p=${PAGES[i + 1].id}">${PAGES[i + 1].title} →</a>`;
  page.append(nav);
  if (location.hash) document.getElementById(decodeURIComponent(location.hash.slice(1)))?.scrollIntoView();
} catch (e) {
  page.innerHTML = `<div class="msg error">Could not load this page (${e.message}).</div>`;
}
