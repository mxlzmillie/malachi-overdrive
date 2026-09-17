/**
 * Reproducible release regression sampler. This is not a live provider or endurance test.
 * Run: node scripts/release-benchmark.mjs [--scenario <1-14>]
 * Results are written locally; manual scenarios remain NOT TESTED until separately recorded.
 */
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const vitest = resolve(root, 'node_modules/vitest/vitest.mjs');
const scenarios = [
  { id: 1, name: 'Unfamiliar repository investigation', manual: true },
  { id: 2, name: 'Real bug diagnosis', manual: true },
  { id: 3, name: 'Multi-file implementation', manual: true },
  { id: 4, name: 'Failing test repair', manual: true },
  { id: 5, name: 'Refactor with regression protection', manual: true },
  { id: 6, name: 'UI regression', file: 'test/renderer-control-rail.test.ts', pattern: 'keeps scroll, section state and an outside composer draft stable across targeted updates' },
  { id: 7, name: 'Three-worker coordination', file: 'test/agents.test.ts', pattern: 'atomically admits three workers only after both requested GPT-6 Pro lanes are account-proven' },
  { id: 8, name: 'Worker failure and recovery', file: 'test/agents.test.ts', pattern: 'ends a worker whose chat fails two wakes in a row, and lets that chat bring it back' },
  { id: 9, name: 'Context handoff', file: 'test/session.test.ts', pattern: 'reports a durable handoff after restart even when meta.json missed its debounced projection' },
  { id: 10, name: 'Long-running task recovery', file: 'test/bridge.test.ts', pattern: 'periodically sleeps a silent detached worker and wakes already-queued work without another MCP call' },
  { id: 11, name: 'Provider temporary failure', file: 'test/task-request.test.ts', pattern: 'bounds transient retries and never retries terminal/ambiguous failures' },
  { id: 12, name: 'Provider durable restriction', file: 'test/goal.test.ts', pattern: 'preserves Retry-After as information but never auto-retries a provider rate limit' },
  { id: 13, name: 'Exact-model admission failure', file: 'test/agents.test.ts', pattern: 'opens zero workers when a fresh account refresh still cannot prove GPT-6 Pro' },
  { id: 14, name: 'Lost acknowledgement and duplicate prevention', file: 'test/bridge.test.ts', pattern: 'restores a durable command receipt so a lost ACK response can be replayed after restart' }
];

const selectedId = process.argv[2] === '--scenario' ? Number(process.argv[3]) : null;
if (process.argv.length > (selectedId === null ? 2 : 4) || (selectedId !== null && (!Number.isInteger(selectedId) || selectedId < 1 || selectedId > 14))) {
  console.error('Usage: node scripts/release-benchmark.mjs [--scenario <1-14>]');
  process.exit(2);
}
const selected = selectedId === null ? scenarios : scenarios.filter(scenario => scenario.id === selectedId);
const cap = (value) => value.length > 12_000 ? `${value.slice(0, 12_000)}\n[output truncated]` : value;

async function run(scenario) {
  const startedAt = new Date().toISOString();
  if (scenario.manual) return { id: scenario.id, name: scenario.name, kind: 'live workflow', status: 'NOT TESTED', startedAt: null, elapsedMs: null,
    observedWorkerCount: null, requestedModel: null, admittedModel: null, humanInterventions: null, retries: null, failures: null,
    recoveries: null, testResult: null, buildResult: null, note: 'Use the live workflow protocol in docs/release-benchmark.md.' };
  const began = Date.now();
  const args = [vitest, 'run', scenario.file, '--testNamePattern', scenario.pattern, '--reporter=dot'];
  let output = '';
  const exitCode = await new Promise((finish) => {
    const child = spawn(process.execPath, args, { cwd: root, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', chunk => { if (output.length < 12_000) output += chunk.toString(); });
    child.stderr.on('data', chunk => { if (output.length < 12_000) output += chunk.toString(); });
    child.on('error', error => { output += `\n${error.message}`; finish(-1); });
    child.on('close', code => finish(code ?? -1));
  });
  return { id: scenario.id, name: scenario.name, kind: 'isolated regression', status: exitCode === 0 ? 'PASS' : 'FAIL', startedAt,
    elapsedMs: Date.now() - began, observedWorkerCount: null, requestedModel: null, admittedModel: null, humanInterventions: null,
    retries: null, failures: exitCode === 0 ? 0 : null, recoveries: null, testResult: { file: scenario.file, pattern: scenario.pattern, exitCode, output: cap(output) },
    buildResult: null, note: 'Fixture test only; does not prove live model admission, a three-worker browser run, or multi-hour endurance.' };
}

const results = [];
for (const scenario of selected) {
  const result = await run(scenario);
  results.push(result);
  console.log(`${String(result.id).padStart(2)} ${result.status.padEnd(10)} ${result.name}${result.elapsedMs === null ? '' : ` (${result.elapsedMs} ms)`}`);
}
const dir = resolve(root, 'artifacts');
await mkdir(dir, { recursive: true });
const target = resolve(dir, selectedId === null ? 'release-benchmark.json' : `release-benchmark-${selectedId}.json`);
await writeFile(target, JSON.stringify({ generatedAt: new Date().toISOString(), platform: process.platform, architecture: process.arch, scenarios: results }, null, 2) + '\n');
console.log(`Recorded ${target}`);
if (results.some(result => result.status === 'FAIL')) process.exitCode = 1;
