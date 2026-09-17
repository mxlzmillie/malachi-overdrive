/**
 * Render the production bundle with its real sandboxed preload and isolated fixture IPC.
 * Run after npm run build: node scripts/qa-overdrive.cjs
 * No production main process, user profile, browser transport or external requests are used.
 */
const path = require('node:path');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const artifactName = process.env.COS_QA_ARTIFACTS || 'overdrive-command-center';
if (!/^[a-zA-Z0-9_-]{1,100}$/.test(artifactName)) throw new Error('QA artifact name must be a simple folder name');
const output = path.join(root, 'artifacts', artifactName);

if (!process.versions.electron) {
  const { spawnSync } = require('node:child_process');
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  const result = spawnSync(require('electron'), [__filename], { cwd: root, env, stdio: 'inherit', timeout: 120000 });
  if (result.error) console.error(result.error.message);
  process.exit(result.status ?? 1);
}

const { app, BrowserWindow, ipcMain, session } = require('electron');
fs.mkdirSync(output, { recursive: true });
app.setPath('userData', path.join(output, 'isolated-profile'));
app.commandLine.appendSwitch('disable-background-networking');
const checks = [], errors = [], forbiddenActions = [], externalRequests = [];
const now = Date.now();
const projects = [
  { id: 'qa-overdrive', name: 'Malachi Overdrive', path: '/fixture/overdrive', createdAt: 1, kind: 'work', category: 'Desktop software', summary: 'Custom v2.0.8 · local tools, browser transport and a private command deck.', brief: 'Use the customised v2.0.8 source, not an upstream copy.' },
  { id: 'qa-gapstudy', name: 'GapStudy', path: '/fixture/gapstudy', createdAt: 2, kind: 'work', category: 'Business intelligence', summary: 'Scan conversion gaps and turn evidence into useful proposals.' },
  { id: 'qa-olaren', name: 'Olaren', path: '/fixture/olaren', createdAt: 3, kind: 'work', category: 'Procurement', summary: 'Procurement and operations workflows.' }
];
const recordings = ['Delivery reliability', 'Refine project navigation', 'Review build output'].map((title, i) => ({
  id: `2026-09-09-qa00000${i}`, title, conversationId: `qa-chat-${i}`, chatIds: [`qa-chat-${i}`],
  projectId: projects[i].id, selectedModel: i === 0 ? { conversationId: `qa-chat-${i}`, model: 'gpt-6-astra-wm', reasoningEffort: 'medium', observedAt: now } : null, startedAt: now - 600000, updatedAt: now - i * 60000, endedAt: null,
  events: 0, userMessages: 1, toolCalls: 2, lastToolCallAt: i === 0 ? now : now - 600000,
  activityExpiresAt: i === 0 ? now + 600000 : null, processExitNonzero: i === 2 ? 1 : 0,
  toolRejected: 0, toolInternalErrors: 0, errors: 0, estimatedTokens: 1200, contextTokens: 1200,
  lastHandoffId: null, lastHandoffAt: null, lastTurnOutcome: null, activeTurnId: null, agents: [], origin: null
}));
recordings.push({
  id: '2026-09-09-qa-worker1', title: 'Rail renderer verifier', conversationId: 'qa-worker-chat', chatIds: ['qa-worker-chat'],
  projectId: projects[0].id, selectedModel: null, startedAt: now - 240000, updatedAt: now - 5000, endedAt: null,
  events: 1, userMessages: 0, toolCalls: 0, lastToolCallAt: now - 5000, activityExpiresAt: now + 600000,
  processExitNonzero: 0, toolRejected: 0, toolInternalErrors: 0, errors: 0, estimatedTokens: 2400, contextTokens: 2400,
  lastHandoffId: null, lastHandoffAt: null, lastTurnOutcome: null, activeTurnId: null, agents: [],
  origin: { kind: 'worker', fromSessionId: recordings[0].id, agentId: 'worker-1', task: 'Verify the Control Rail renderer.' }
});
const stored = value => ({ text: value, chars: value.length, truncated: false });
const sessionEvents = {
  [recordings[0].id]: [
    { seq: 1, time: now - 90000, source: 'extension', kind: 'user_message', message: stored('Implement and verify the Control Rail.'), images: 0 },
    { seq: 2, time: now - 70000, source: 'mcp', kind: 'tool_call', agent: 'worker-1', call: {
      callId: 'qa-create', tool: 'apply_patch', attribution: 'request_id', requestId: 'qa-create-req', conversationId: recordings[0].conversationId, attributionMethod: 'request_id',
      args: stored('{"patch":"*** Add File: artifacts/control-rail-report.pdf"}'), result: stored('Done!'), outcome: 'ok', durationMs: 380,
      summary: { kind: 'create', tone: 'good', title: 'Created control-rail-report.pdf', metric: '+120' },
      changes: [{ path: 'artifacts/control-rail-report.pdf', added: 120, removed: 0, approximate: false }]
    } },
    { seq: 3, time: now - 52000, source: 'mcp', kind: 'tool_call', call: {
      callId: 'qa-read', tool: 'read', attribution: 'request_id', requestId: 'qa-read-req', conversationId: recordings[0].conversationId, attributionMethod: 'request_id',
      args: stored('{"paths":["src/renderer/control-rail.ts"]}'), result: stored('source'), outcome: 'ok', durationMs: 95,
      summary: { kind: 'read', tone: 'neutral', title: 'Read control-rail.ts', metric: '669 lines' }
    } },
    { seq: 4, time: now - 26000, source: 'mcp', kind: 'tool_call', call: {
      callId: 'qa-command', tool: 'exec_command', attribution: 'request_id', requestId: 'qa-command-req', conversationId: recordings[0].conversationId, attributionMethod: 'request_id',
      args: stored('{"cmd":"npm run renderer:qa"}'), result: stored('renderer fixture failed'), outcome: 'process_exit_nonzero', durationMs: 2400,
      summary: { kind: 'run', tone: 'warn', title: 'npm run renderer:qa', detail: 'Renderer fixture failed', metric: 'exit 1' }
    } },
    { seq: 5, time: now - 12000, source: 'extension', kind: 'page_tool', tool: 'computer', label: 'Inspected renderer', details: 'Control Rail open at desktop width' },
    { seq: 6, time: now - 8000, source: 'mcp', kind: 'agent_message', messageId: 'qa-agent-message', from: 'worker-1', to: 'prime', delivery: 'offered', message: stored('Wide layout is ready for inspection.') }
  ],
  '2026-09-09-qa-worker1': [
    { seq: 1, time: now - 5000, source: 'extension', kind: 'assistant_message', message: stored('Recorded worker response: rail layout verified.'), final: true }
  ]
};
recordings[0].events = sessionEvents[recordings[0].id].length;
recordings[0].toolCalls = 3;
recordings[0].processExitNonzero = 1;
const config = {
  roots: [{ name: 'fixture', path: '/fixture' }], readOnly: true,
  capabilities: { browse: true, search: true, read: true, metadata: true, create: false, edit: false, move: false, deleteFile: false, saveArtifact: false, command: false, screen: false, control: false, clipboardRead: false, clipboardWrite: false },
  tunnel: { kind: 'openai', tunnelId: '', desktopTunnelId: '', binaryPath: '' },
  ui: { minimizeToTray: false, autoConnect: false, theme: 'dark', privacyScreenshots: false },
  sessions: { record: true, retainDays: 30, advisoryTokens: 300000, limitTokens: 400000 },
  compaction: { auto: true, autoTokens: 300000 },
  multiAgent: { enabled: true, maxWorkers: 3, allowUnattributedCalls: false, recoverAgentTabs: false },
  goal: { enabled: false, model: 'fixture', reasoning: 'default', prompt: '', objectivePrompt: '', loopPrompt: '' },
  artifacts: { enabled: false }, mcp: { instructions: '' }
};
const state = {
  config, hasApiKey: false, hasGoalKey: false, resolvedBinary: null, bundledTunnelVersion: null,
  status: { state: 'disconnected', detail: 'Isolated visual QA', publicUrl: null, localUrl: null, handshakeAt: null, lastRequestAt: null, lastToolCallAt: null, health: null, surfaces: [] },
  bridge: { running: true, port: 0, paired: true, present: true, lastSeenAt: now, extensionVersion: '2.0.8' },
  update: { current: '2.0.8', latest: null, stage: 'idle', error: null, checkedAt: null }
};
const empty = [];
const queuedInputs = [];
const replies = {
  'state:get': () => state, 'window:getZoom': () => 1, 'log:get': () => empty,
  'sessions:list': () => ({ sessions: recordings, activeId: recordings[0].id, blocked: [], pressure: [], total: 19, nextCursor: null }),
  'projects:list': () => projects, 'sessions:outbox': () => queuedInputs, 'sessions:pausedHelpers': () => empty,
  'sessions:events': payload => { const events = sessionEvents[payload.id] ?? []; return { summary: recordings.find(row => row.id === payload.id) ?? null, events, total: events.length, nextFrom: (events.at(-1)?.seq ?? 0) + 1 }; },
  'sessions:controls': payload => ({ sessionId: payload.id, conversationId: 'qa-chat', automation: 'off', activeTurnId: null, finishHeld: false, blocked: '', job: null }),
  'swarm:get': () => ({ enabled: true, running: true, runId: 'qa-run', retainedHistory: false, agents: [
    { id: 'prime', role: 'prime', label: 'Prime', task: 'Coordinate the renderer release', model: null, reasoningEffort: null, state: 'active', createdAt: now - 300000, activatedAt: now - 300000, finishedAt: null, result: null, pending: 0, awaitingAck: 0, delivered: 2, conversationId: recordings[0].conversationId, detachedAt: null, lastSeenAt: now, revivable: false, sleptAt: null, contextTokens: 1200 },
    { id: 'worker-1', role: 'worker', label: 'Astra verifier', task: 'Verify the Control Rail renderer.', model: 'gpt-6-pro', reasoningEffort: 'pro', state: 'active', createdAt: now - 240000, activatedAt: now - 235000, finishedAt: null, result: null, pending: 0, awaitingAck: 0, delivered: 1, conversationId: 'qa-worker-chat', detachedAt: null, lastSeenAt: now - 5000, revivable: false, sleptAt: null, contextTokens: 2400 }
  ], maxWorkers: 3, pendingReports: 0 }),
  'chatModels:get': () => ({ state: 'ready', requestedAt: now, observedAt: now, models: [{ id: 'qa-model', label: 'QA model', efforts: ['high'] }] }),
  'handoff:get': () => null, 'bridge:extensionPath': () => null, 'bridge:pairingCode': () => 'ABCDEF-123456', 'plugins:snapshot': () => null,
  'projects:files': () => ({ files: [{ path: 'README.md', size: 123, modified: now }], limited: false, skipped: 0 }),
  'projects:preview': () => ({ text: '# Fixture project\nVisual QA only.', truncated: false }),
  'sessions:files': () => [{ id: 'qa-file', name: 'requirements.md', size: 123, mimeType: 'text/markdown' }]
};
// Only channels in the real, fixed preload can be invoked. Unknown actions fail closed.
const preloadSource = fs.readFileSync(path.join(root, 'src/preload/index.ts'), 'utf8');
const channels = new Set([...preloadSource.matchAll(/'([A-Za-z]+:[A-Za-z]+)'/g)].map(match => match[1]));
for (const channel of channels) ipcMain.handle(channel, (_event, payload) => {
  if (replies[channel]) return { ok: true, data: replies[channel](payload) };
  forbiddenActions.push(channel); return { ok: false, error: `QA does not permit ${channel}` };
});

let win;
const evaluate = (fn, value) => win.webContents.executeJavaScript(`(${fn.toString()})(${JSON.stringify(value)})`);
const check = (condition, message) => { assert(condition, message); checks.push(message); };
async function waitFor(fn, label) {
  for (let i = 0; i < 80; i++) { if (await evaluate(fn)) return; await new Promise(resolve => setTimeout(resolve, 100)); }
  throw new Error(`Timed out: ${label}`);
}
async function capture(name, width, height, theme = 'dark') {
  win.setContentSize(width, height);
  await evaluate(theme => { document.documentElement.dataset.theme = theme; }, theme);
  await new Promise(resolve => setTimeout(resolve, 200));
  const geometry = await evaluate(() => {
    const dialog = document.querySelector('.overdrive-command-center'), box = dialog.getBoundingClientRect();
    return { width: innerWidth, height: innerHeight, left: box.left, top: box.top, right: box.right, bottom: box.bottom, overflow: dialog.scrollWidth - dialog.clientWidth };
  });
  check(geometry.left >= 0 && geometry.top >= 0 && geometry.right <= geometry.width + 1 && geometry.bottom <= geometry.height + 1 && geometry.overflow <= 1, `${name}: command surface fits viewport`);
  const controls = await evaluate(() => [...document.querySelectorAll('.command-head, .command-context, .command-stats, .command-search, .command-filters, .command-footer')]
    .filter(element => getComputedStyle(element).display !== 'none')
    .map(element => ({ name: element.className, clipped: element.scrollHeight > element.clientHeight + 1 })));
  check(controls.every(control => !control.clipped), `${name}: headings, status and controls are not vertically clipped (${controls.filter(control => control.clipped).map(control => control.name).join(', ') || 'none'})`);
  const image = await win.webContents.capturePage();
  fs.writeFileSync(path.join(output, `${name}.png`), image.resize({ width }).toPNG());
}

async function captureWorkbench(name, width, height, theme = 'dark') {
  win.setContentSize(width, height);
  await evaluate(theme => { document.documentElement.dataset.theme = theme; }, theme);
  await new Promise(resolve => setTimeout(resolve, 200));
  const geometry = await evaluate(() => {
    const board = document.getElementById('workbench'), box = board.getBoundingClientRect();
    const send = document.getElementById('chatSend').getBoundingClientRect();
    return { left: box.left, right: box.right, overflow: board.scrollWidth - board.clientWidth,
      sendVisible: send.right <= innerWidth && send.bottom <= innerHeight && send.left >= 0 && send.top >= 0, width: innerWidth };
  });
  check(geometry.left >= 0 && geometry.right <= geometry.width + 1 && geometry.overflow <= 1, `${name}: workbench fits without horizontal overflow (${JSON.stringify(geometry)})`);
  check(geometry.sendVisible, `${name}: composer send control remains visible`);
  fs.writeFileSync(path.join(output, `${name}.png`), (await win.webContents.capturePage()).resize({ width }).toPNG());
}

async function captureControlRail(name, width, height, theme = 'dark') {
  win.setContentSize(width, height);
  await evaluate(theme => { document.documentElement.dataset.theme = theme; }, theme);
  await evaluate(() => { if (document.getElementById('controlRail').hidden) document.getElementById('controlRailToggle').click(); });
  await waitFor(() => !document.getElementById('controlRail').hidden, 'Control Rail opened');
  await new Promise(resolve => setTimeout(resolve, 180));
  const geometry = await evaluate(() => {
    const rail = document.getElementById('controlRail'), box = rail.getBoundingClientRect();
    const scroller = rail.querySelector('.control-rail-scroll');
    const quick = rail.querySelector('.control-rail-quick').getBoundingClientRect();
    const quickButtons = [...rail.querySelectorAll('.control-rail-quick button')].map(button => button.getBoundingClientRect());
    const composer = document.getElementById('composer').getBoundingClientRect();
    return {
      width: innerWidth, height: innerHeight, left: box.left, top: box.top, right: box.right, bottom: box.bottom,
      railWidth: box.width, railOverflow: rail.scrollWidth - rail.clientWidth,
      bodyOverflow: document.documentElement.scrollWidth - innerWidth,
      independentScroll: getComputedStyle(scroller).overflowY === 'auto',
      quickVisible: quick.height >= 40 && quickButtons.every(button => button.height >= 26 && button.top >= quick.top - 1 && button.bottom <= quick.bottom + 1),
      composerVisible: composer.right <= innerWidth + 1 && composer.left >= -1 && composer.bottom <= innerHeight + 1
    };
  });
  check(geometry.left >= -1 && geometry.top >= -1 && geometry.right <= geometry.width + 1 && geometry.bottom <= geometry.height + 1, `${name}: Control Rail fits viewport`);
  check(geometry.railOverflow <= 1 && geometry.bodyOverflow <= 1, `${name}: Control Rail creates no horizontal overflow`);
  check(geometry.independentScroll, `${name}: Control Rail has independent vertical scrolling`);
  check(geometry.quickVisible, `${name}: quick actions are fully visible`);
  if (width > 1050) check(geometry.railWidth >= 360 && geometry.railWidth <= 460 && geometry.composerVisible, `${name}: desktop rail width is bounded and composer remains visible`);
  else check(Math.abs(geometry.railWidth - width) <= 1, `${name}: narrow rail becomes a full-width drawer`);
  fs.writeFileSync(path.join(output, `${name}.png`), (await win.webContents.capturePage()).resize({ width }).toPNG());
}

const deadline = setTimeout(() => { console.error('QA deadline reached'); app.exit(1); }, 100000);
app.whenReady().then(async () => {
  session.defaultSession.webRequest.onBeforeRequest((details, done) => {
    const external = /^https?:/.test(details.url);
    if (external) externalRequests.push(details.url);
    done({ cancel: external });
  });
  win = new BrowserWindow({ show: false, width: 1440, height: 900, useContentSize: true, webPreferences: { preload: path.join(root, 'out/preload/index.js'), sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
  win.webContents.on('console-message', (...args) => {
    const event = args[0], level = event.level ?? args[1], message = event.message ?? args[2];
    if (level === 'error' || level === 3) errors.push(String(message));
  });
  await win.loadFile(path.join(root, 'out/renderer/index.html'));
  // Geometry captures verify settled layouts, not the sidebar's transition frames.
  await win.webContents.insertCSS('*, *::before, *::after { transition: none !important; animation: none !important; }');
  await waitFor(() => document.querySelector('[data-project-id="qa-overdrive"]'), 'project catalog rendered');
  check(await evaluate(() => document.querySelectorAll('.workbench-project').length === 3), 'workbench shows the three real fixture projects');
  await captureWorkbench('workbench-desktop-dark', 1440, 1000);
  await captureWorkbench('workbench-desktop-light', 1440, 1000, 'light');
  await evaluate(() => document.getElementById('sidebarToggle').click());
  await captureWorkbench('workbench-mobile-390', 390, 844);
  await captureWorkbench('workbench-mobile-320', 320, 700);
  win.setContentSize(1440, 900);
  await evaluate(() => {
    document.getElementById('sidebarToggle').click();
    document.querySelector('[data-workbench-action="project"][data-workbench-id="qa-gapstudy"]').click();
    const input = document.getElementById('chatInput'); input.value = 'Keep this project draft.'; input.dispatchEvent(new Event('input', { bubbles: true }));
    document.getElementById('newChat').click();
  });
  check(await evaluate(() => document.querySelector('[data-workbench-action="project"][data-workbench-id="qa-gapstudy"]').textContent.includes('Resume draft')), 'workbench identifies unsent project drafts');
  await evaluate(() => document.querySelector('[data-workbench-action="project"][data-workbench-id="qa-gapstudy"]').click());
  check(await evaluate(() => document.getElementById('chatInput').value === 'Keep this project draft.'), 'workbench resumes the exact project draft');
  await evaluate(() => document.getElementById('newChat').click());
  await evaluate(() => document.getElementById('overdriveCommand').click());
  await waitFor(() => document.querySelector('.overdrive-command-center[open]'), 'command centre opened');
  check(await evaluate(() => document.querySelectorAll('[role="option"]').length > 10), 'production renderer paints project, chat and action results');
  await capture('desktop-dark', 1440, 900);
  await capture('mobile-390', 390, 844);
  await capture('mobile-320', 320, 700);
  await capture('compact-height', 900, 480);
  await capture('desktop-light', 1440, 900, 'light');
  await evaluate(() => {
    document.querySelector('[data-command="project:qa-overdrive"]').click();
    const input = document.getElementById('chatInput'); input.value = 'Keep these manual requirements.'; input.dispatchEvent(new Event('input', { bubbles: true }));
    document.getElementById('workRecipes').click();
  });
  check(await evaluate(() => document.querySelectorAll('[role="option"]').length === 5), 'project task-brief shortcut shows all five recipes');
  await evaluate(() => document.querySelector('[data-command="recipe:fix"]').click());
  check(await evaluate(() => document.getElementById('chatInput').value.startsWith('Keep these manual requirements.\n\nWorking approach — Diagnose and fix')), 'recipe preserves authored draft');
  check(await evaluate(() => document.getElementById('chatAutomation').value === 'off'), 'recipe leaves automation off');
  check(await evaluate(() => document.getElementById('workContext').getBoundingClientRect().bottom <= document.getElementById('chatInput').getBoundingClientRect().top + 1), 'project context owns a row above the draft, not the model toolbar');
  await evaluate(() => document.getElementById('attachImages').click());
  await waitFor(() => document.getElementById('composerImages').textContent.includes('requirements.md'), 'fixture attachment selected');
  check(await evaluate(() => {
    const context = document.getElementById('workContext').getBoundingClientRect();
    const attachments = document.getElementById('composerImages').getBoundingClientRect();
    const input = document.getElementById('chatInput').getBoundingClientRect();
    return context.bottom <= attachments.top + 1 && attachments.bottom <= input.top + 1;
  }), 'project context, attachments and draft occupy separate ordered rows');
  await evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true, bubbles: true, cancelable: true })));
  check(await evaluate(() => document.activeElement?.getAttribute('role') === 'combobox'), 'command shortcut focuses the native combobox');
  await evaluate(() => document.querySelector('.command-close').click());
  check(await evaluate(() => document.activeElement === document.getElementById('chatInput')), 'closing command centre restores composer focus');
  await evaluate(() => { document.documentElement.dataset.theme = 'dark'; });
  await waitFor(() => !document.querySelector('dialog[open]'), 'command centre closed before the prepared-draft capture');
  // The hidden Chromium compositor can still hold the previous dialog frame after the DOM
  // already reports focus restored. Wait for a painted frame, not merely the IPC evaluation.
  await new Promise(resolve => setTimeout(resolve, 200));
  fs.writeFileSync(path.join(output, 'prepared-brief.png'), (await win.webContents.capturePage()).resize({ width: 1440 }).toPNG());
  queuedInputs.push({ id: 'qa-queued-task', sessionId: recordings[0].id, text: 'Keep the original queued task.',
    mode: 'after-turn', dueAt: now, model: null, reasoningEffort: null, state: 'queued', owner: null,
    createdAt: now, conversationId: recordings[0].conversationId });
  await evaluate(id => document.querySelector(`#sessionList [data-id="${id}"]`).click(), recordings[0].id);
  await waitFor(() => document.querySelector('#finishQueue [aria-label="Edit queued task"]'), 'queued task rendered');
  await evaluate(() => {
    document.querySelector('#finishQueue [aria-label="Edit queued task"]').click();
    const field = document.querySelector('#finishQueue textarea'); field.value = 'x'.repeat(64001);
    field.dispatchEvent(new Event('input')); field.nextElementSibling.click();
  });
  for (const [name, width, height] of [['queue-editor-desktop', 1440, 900], ['queue-editor-mobile', 390, 844]]) {
    if (width === 390) await evaluate(() => document.getElementById('sidebarToggle').click());
    win.setContentSize(width, height); await new Promise(resolve => setTimeout(resolve, 200));
    const geometry = await evaluate(() => {
      const card = document.querySelector('#finishQueue .is-editing'), field = card.querySelector('textarea'), message = card.querySelector('.queue-edit-validation');
      const input = field.getBoundingClientRect(), error = message.getBoundingClientRect();
      return { fieldWidth: input.width, separate: error.top >= input.bottom, overflow: card.scrollWidth - card.clientWidth, textKept: field.value.length === 64001 };
    });
    fs.writeFileSync(path.join(output, `${name}.png`), (await win.webContents.capturePage()).resize({ width }).toPNG());
    check(geometry.fieldWidth >= 180 && geometry.separate && geometry.overflow <= 1 && geometry.textKept, `${name}: oversized draft and validation remain readable in separate rows`);
  }
  await evaluate(() => [...document.querySelectorAll('#finishQueue button')].find(button => button.textContent === 'Cancel edit').click());
  check(await evaluate(() => !document.querySelector('#finishQueue textarea') && document.querySelector('#finishQueue .queue-label').textContent === 'Keep the original queued task.'), 'cancel edit restores the original task without saving or deleting it');
  win.setContentSize(1440, 900);
  await evaluate(() => {
    const input = document.getElementById('chatInput'); input.value = 'Control Rail must preserve this draft.'; input.dispatchEvent(new Event('input', { bubbles: true }));
    const body = document.getElementById('chatBody'); body.scrollTop = Math.min(40, Math.max(0, body.scrollHeight - body.clientHeight));
    window.__qaRailBefore = { draft: input.value, scroll: body.scrollTop };
  });
  await captureControlRail('control-rail-desktop-dark', 1440, 900);
  check(await evaluate(() => {
    const before = window.__qaRailBefore, body = document.getElementById('chatBody');
    return document.getElementById('chatInput').value === before.draft && Math.abs(body.scrollTop - before.scroll) <= 1;
  }), 'opening the Control Rail preserves the composer draft and chat scroll position');
  check(await evaluate(() => document.querySelector('[data-section="outputs"]')?.textContent.includes('control-rail-report.pdf') &&
    document.querySelector('[data-section="agents"]')?.textContent.includes('Astra verifier') &&
    document.querySelector('[data-section="issues"]')?.textContent.includes('npm run renderer:qa')), 'Control Rail renders structured outputs, broker agents and current issues');
  await evaluate(() => [...document.querySelectorAll('.control-rail-agent')].find(button => !button.disabled && button.textContent.includes('Astra verifier')).click());
  await waitFor(() => document.querySelector('.control-rail-inspector-body')?.textContent.includes('Recorded worker response'), 'worker transcript rendered in Control Rail');
  check(await evaluate(() => document.querySelector('.control-rail-inspector-body')?.textContent.includes('Recorded worker response')), 'Control Rail opens the existing read-only worker transcript');
  await evaluate(() => document.querySelector('.control-rail-inspector-head .control-rail-action').click());
  await captureControlRail('control-rail-desktop-light', 1440, 900, 'light');
  await evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })));
  check(await evaluate(() => document.getElementById('controlRail').hidden && document.activeElement === document.getElementById('controlRailToggle')), 'Escape closes the Control Rail and restores toggle focus');
  await captureControlRail('control-rail-mobile-390', 390, 844);
  await evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })));
  check(await evaluate(() => document.getElementById('controlRail').hidden), 'narrow Control Rail drawer closes with Escape');
  win.setContentSize(1440, 900);
  check(await evaluate(() => document.getElementById('composerModelLabel').textContent === 'Current browser model'), 'Work model stays inherited instead of becoming Chat Pro');
  await evaluate(() => { document.getElementById('modelMenu').open = true; });
  for (const [width, height] of [[390, 844], [1440, 900]]) {
    win.setContentSize(width, height);
    await waitFor(() => document.querySelector('[data-model-choice="current-browser"]'), 'inherited model control rendered');
    check(await evaluate(() => {
      const control = document.querySelector('[data-model-choice="current-browser"]');
      const box = control.getBoundingClientRect();
      return control.getAttribute('aria-pressed') === 'true' && box.width > 0 && box.left >= 0 && box.right <= innerWidth &&
        document.getElementById('composerModelStatus').textContent.includes('Last recorded: gpt-6-astra-wm');
    }), `Work model at ${width}px: inherited selection and honest recorded identity remain visible`);
    await new Promise(resolve => setTimeout(resolve, 200));
    fs.writeFileSync(path.join(output, `current-browser-model-${width}.png`), (await win.webContents.capturePage()).toPNG());
  }
  check(forbiddenActions.length === 0, `no sends, permission changes or other forbidden IPC actions (${forbiddenActions.length})`);
  check(externalRequests.length === 0, 'no external renderer requests');
  check(errors.length === 0, `no renderer console errors (${errors.length})`);
}).then(() => {
  const report = { checkedAt: new Date().toISOString(), fixture: true, productionBundle: true, checks, errors, forbiddenActions, externalRequests };
  fs.writeFileSync(path.join(output, 'visual-qa.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}).catch(error => {
  console.error(error.stack, { checks, errors, forbiddenActions, externalRequests }); process.exitCode = 1;
}).finally(() => { clearTimeout(deadline); win?.destroy(); app.exit(process.exitCode ?? 0); });
