#!/usr/bin/env node
// An MCP server over the doe command line (spec §16.3, issue #40), for agents without a shell.
//
//   node tools/mcp.mjs [--cwd DIR]
//
// Speaks MCP (JSON-RPC 2.0, one message per line on stdin/stdout). Each doe command is a tool
// taking { args: [strings] } — the command's arguments exactly as on the command line — and
// returning its --json result as text (the object is also in structuredContent). Study files are
// read and written in the working directory (--cwd, default the current one). A thin wrapper: the
// CLI's JSON mode does the work, so the tools behave exactly like the commands.
import { spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const DOE = join(dirname(fileURLToPath(import.meta.url)), 'doe.mjs');
const cwd = resolve(process.argv.includes('--cwd') ? process.argv[process.argv.indexOf('--cwd') + 1] : '.');
const PROTOCOL = '2025-06-18';

// one line per command from `doe help`, as the tool descriptions
const help = spawnSync(process.execPath, [DOE, 'help'], { encoding: 'utf8' }).stdout;
const COMMANDS = ['init', 'recommend', 'design', 'alias', 'power', 'sheet', 'import', 'fit', 'predict', 'augment', 'optimise', 'robust', 'goal',
  'sites', 'summary', 'gauge', 'simulator', 'simulate', 'tolerance', 'spec', 'yield', 'sensitivity', 'comb-over', 'exercise', 'report', 'schema', 'info'];
const describe = (cmd) => {
  const lines = help.split('\n'), i = lines.findIndex(l => new RegExp(`^\\s{2}${cmd.replace('-', '\\-')}\\b`).test(l));
  if (i < 0) return `doe ${cmd}`;
  const out = [lines[i].trim()];
  for (let j = i + 1; j < lines.length && /^\s{4,}\S/.test(lines[j]) && !/^\s{2}\S/.test(lines[j]); j++) out.push(lines[j].trim());
  return `doe ${out.join(' ')}`;
};
const TOOLS = COMMANDS.map(c => ({
  name: `doe_${c.replace('-', '_')}`,
  description: `${describe(c)}\nArguments as on the command line (without "doe ${c}" and without --json); returns the command's JSON result.`,
  inputSchema: { type: 'object', properties: { args: { type: 'array', items: { type: 'string' }, description: `the arguments of doe ${c}` } }, required: ['args'] },
}));

function call(name, args = {}) {
  const cmd = COMMANDS.find(c => `doe_${c.replace('-', '_')}` === name);
  if (!cmd) return { isError: true, content: [{ type: 'text', text: `unknown tool ${name}` }] };
  if (!Array.isArray(args.args) || !args.args.every(a => typeof a === 'string')) return { isError: true, content: [{ type: 'text', text: 'args must be a list of strings' }] };
  const r = spawnSync(process.execPath, [DOE, cmd, ...args.args, '--json'], { cwd, encoding: 'utf8', timeout: 600000 });
  let obj;
  try { obj = JSON.parse(r.stdout); } catch { obj = { ok: false, error: { message: (r.stderr || r.stdout || 'no output').trim() } }; }
  return { isError: obj.ok === false, content: [{ type: 'text', text: JSON.stringify(obj) }], structuredContent: obj };
}

function handle(msg) {
  const { id, method, params } = msg;
  const reply = (result) => (id === undefined ? null : { jsonrpc: '2.0', id, result });
  const error = (code, message) => (id === undefined ? null : { jsonrpc: '2.0', id, error: { code, message } });
  switch (method) {
    case 'initialize': return reply({ protocolVersion: params?.protocolVersion ?? PROTOCOL, capabilities: { tools: {} },
      serverInfo: { name: 'aikidoe', version: '1' },
      instructions: 'Design of experiments with aikidoe. Read skills/aikidoe/SKILL.md in the repository for the workflow and rules (never invent results; keep randomisation; check estimability and power). Study files live in the server\'s working directory.' });
    case 'notifications/initialized': case 'initialized': return null;
    case 'ping': return reply({});
    case 'tools/list': return reply({ tools: TOOLS });
    case 'tools/call': return reply(call(params?.name, params?.arguments));
    default: return error(-32601, `method not found: ${method}`);
  }
}

const rl = createInterface({ input: process.stdin });
rl.on('line', (line) => {
  if (!line.trim()) return;
  let msg;
  try { msg = JSON.parse(line); } catch { process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } }) + '\n'); return; }
  const out = handle(msg);
  if (out) process.stdout.write(JSON.stringify(out) + '\n');
});
