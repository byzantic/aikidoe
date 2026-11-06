// Guidance for AI agents (issue #40): the skill's front matter and links, its generated references
// up to date, every recipe run with its output as shown, llms.txt, the MCP server over the JSON CLI,
// and the agent-evaluation harness.
import { readFileSync, readdirSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { section, check, done } from './lib/check.mjs';
import { linksAndAnchors } from '../js/markdown.js';
import { validate } from '../js/jsonschema.js';
import { SKILL, SKILL_REFS, SKILL_LINKS, referenceCli, referenceStudyFormat, runPage, outputMatches, blocksOf } from '../tools/gen-manual.mjs';

const ROOT = new URL('../', import.meta.url).pathname;
const read = (p) => readFileSync(p, 'utf8');

section('SKILL.md');
const skill = read(join(SKILL, 'SKILL.md'));
{
  const m = /^---\n([\s\S]*?)\n---\n/.exec(skill);
  const fm = m ? Object.fromEntries(m[1].split('\n').map(l => { const i = l.indexOf(':'); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })) : {};
  check('front matter with name and description (Agent Skills format)', !!m && fm.name === 'aikidoe' && fm.name === SKILL.split('/').pop());
  check(`description: one paragraph, ≤ 1024 characters, no angle brackets (${fm.description?.length})`, fm.description?.length > 50 && fm.description.length <= 1024 && !/[<>]/.test(fm.description));
  for (const part of ['## When to use it', '## Workflow', '## Rules', '## References', 'Never invent', 'Keep the randomisation', 'Check before recommending', 'Say what is aliased', 'Prefer sequential', 'intervals', 'cost or safety'])
    check(`covers: ${part}`, skill.includes(part));
}

section('links in the skill resolve');
for (const [file, md] of [['SKILL.md', skill], ...readdirSync(SKILL_REFS).filter(f => f.endsWith('.md')).map(f => [`references/${f}`, read(join(SKILL_REFS, f))])]) {
  const base = dirname(join(SKILL, file));
  const bad = linksAndAnchors(md).links.filter(h => !/^https?:/.test(h) && !h.startsWith('#') && !existsSync(resolve(base, h.split('#')[0])));
  check(`${file}`, !bad.length, bad.join(', '));
}

section('generated references are up to date (node tools/gen-manual.mjs)');
check('references/cli.md', read(join(SKILL_REFS, 'cli.md')) === referenceCli(SKILL_LINKS));
check('references/study-format.md', read(join(SKILL_REFS, 'study-format.md')) === referenceStudyFormat(SKILL_LINKS));

section('recipes: every command run, output as shown');
for (const f of readdirSync(SKILL_REFS).filter(f => f.endsWith('.md'))) {
  const md = read(join(SKILL_REFS, f));
  if (!blocksOf(md).some(b => b.lang === 'console')) continue;
  let n = 0; const bad = [];
  for (const { commands } of runPage(md)) for (const c of commands) { n++; if (!outputMatches(c.expected, c.actual)) bad.push(`$ ${c.cmd}\n--- shown ---\n${c.expected}\n--- doe prints ---\n${c.actual}`); }
  check(`${f}: ${n} commands`, (f !== 'recipes.md' || n >= 10) && !bad.length, bad[0] ?? '');
}

section('llms.txt');
{
  const t = read(join(ROOT, 'llms.txt'));
  check('an H1, a summary quote, sections of links', /^# aikidoe\n\n> /.test(t) && (t.match(/^## /gm) ?? []).length >= 3);
  const links = [...t.matchAll(/\]\(([^)]+)\)/g)].map(m => m[1]).filter(h => !/^https?:/.test(h));
  const bad = links.filter(h => !existsSync(join(ROOT, h)));
  check(`its ${links.length} links resolve`, links.length >= 10 && !bad.length, bad.join(', '));
  check('links the skill', t.includes('skills/aikidoe/SKILL.md'));
}

section('MCP server over the JSON CLI');
{
  const dir = mkdtempSync(join(tmpdir(), 'aikidoe-mcp-'));
  try {
    const msgs = [
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } } },
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      { jsonrpc: '2.0', id: 2, method: 'tools/list' },
      { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'doe_init', arguments: { args: ['m.aikidoe.json', '--factor', 'A:0:1', '--factor', 'B:0:1', '--factor', 'C:0:1', '--response', 'y', '--seed', '3'] } } },
      { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'doe_recommend', arguments: { args: ['m.aikidoe.json', '--goal', 'model', '--budget', '16', '--no-optimal'] } } },
      { jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'doe_fit', arguments: { args: ['nope.json', 'y ~ A'] } } },
      { jsonrpc: '2.0', id: 6, method: 'nonsense' },
      'not json',
    ];
    const r = spawnSync(process.execPath, [join(ROOT, 'tools', 'mcp.mjs'), '--cwd', dir], { input: msgs.map(m => (typeof m === 'string' ? m : JSON.stringify(m))).join('\n') + '\n', encoding: 'utf8' });
    const out = r.stdout.trim().split('\n').map(l => JSON.parse(l));
    const by = Object.fromEntries(out.map(o => [o.id ?? 'null', o]));
    check('initialize: protocol version, tools capability, instructions', by[1].result.protocolVersion === '2025-06-18' && by[1].result.capabilities.tools && /SKILL\.md/.test(by[1].result.instructions));
    check('notifications get no reply; seven replies in all', out.length === 7);
    const tools = by[2].result.tools;
    const doeHelp = spawnSync(process.execPath, [join(ROOT, 'tools', 'doe.mjs'), 'help'], { encoding: 'utf8' }).stdout;
    check(`tools/list: ${tools.length} tools, one per command, each with an args schema and the command's help`, tools.length >= 25 && tools.every(t => t.inputSchema.required.includes('args') && t.description.startsWith('doe ')) && tools.every(t => doeHelp.includes(t.name.replace(/^doe_/, '').replace('_', '-'))));
    const cli = JSON.parse(read(join(ROOT, 'schema', 'cli.schema.json')));
    check('tools/call init: the --json result, valid against the CLI schema, and the file written', !by[3].result.isError && !validate(cli, by[3].result.structuredContent).length && existsSync(join(dir, 'm.aikidoe.json')));
    check('tools/call recommend: ranked options', by[4].result.structuredContent.options[0].rank === 1);
    check('a failing command: isError with its message', by[5].result.isError && /nope\.json/.test(by[5].result.structuredContent.error.message));
    check('unknown method and unparseable line: JSON-RPC errors', by[6].error.code === -32601 && by.null.error.code === -32700);
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

section('agent-evaluation harness');
{
  const dir = mkdtempSync(join(tmpdir(), 'aikidoe-eval-'));
  try {
    const run = (...a) => spawnSync(process.execPath, [join(ROOT, 'tools', 'agent-eval.mjs'), ...a], { encoding: 'utf8' });
    let r = run('prepare', '--out', dir, '--topics', 'factorial,blocking', '--seeds', '1');
    check('prepare: keys, work studies without the truth, briefs', r.status === 0 && ['keys/factorial-medium-1.key.json', 'work/blocking-medium-1.aikidoe.json', 'briefs/blocking-medium-1.md'].every(f => existsSync(join(dir, f)))
      && !/"truth"|"sealed"/.test(read(join(dir, 'work', 'factorial-medium-1.aikidoe.json'))), r.stderr);
    check('the brief has what the user knows, not the truth', /8 runs a day/.test(read(join(dir, 'briefs', 'blocking-medium-1.md'))) && !/coef|terms/.test(read(join(dir, 'briefs', 'blocking-medium-1.md'))));
    r = run('score', dir);
    check('score: a table, unattempted exercises scored 0', r.status === 0 && /\| factorial-medium-1 \| — \| 0 \| not attempted/.test(r.stdout) && /mean score 0\.0 over 2/.test(r.stdout), r.stdout + r.stderr);
  } finally { rmSync(dir, { recursive: true, force: true }); }
  check('docs/agent-eval.md describes the protocol', /## Protocol/.test(read(join(ROOT, 'docs', 'agent-eval.md'))));
}

done();
