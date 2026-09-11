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
const config = {
  roots: [{ name: 'fixture', path: '/fixture' }], readOnly: true,
  capabilities: { browse: true, search: true, read: true, metadata: true, create: false, edit: false, move: false, deleteFile: false, saveArtifact: false, command: false, screen: false, control: false, clipboardRead: false, clipboardWrite: false },
  tunnel: { kind: 'openai', tunnelId: '', desktopTunnelId: '', binaryPath: '' },
  ui: { minimizeToTray: false, autoConnect: false, theme: 'dark', privacyScreenshots: false },
  sessions: { record: true, retainDays: 30, advisoryTokens: 300000, limitTokens: 400000 },
  compaction: { auto: true, autoTokens: 300000 },
  multiAgent: { enabled: false, maxWorkers: 2, allowUnattributedCalls: false, recoverAgentTabs: false },
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
  'sessions:events': payload => ({ summary: recordings.find(row => row.id === payload.id) ?? null, events: [], total: 0, nextFrom: 1 }),
  'sessions:controls': payload => ({ sessionId: payload.id, conversationId: 'qa-chat', automation: 'off', activeTurnId: null, finishHeld: false, blocked: '', job: null }),
  'swarm:get': () => ({ running: false, runId: null, agents: [], maxWorkers: 2, pendingReports: 0 }),
  'chatModels:get': () => ({ state: 'ready', requestedAt: now, observedAt: now, models: [{ id: 'qa-model', label: 'QA model', efforts: ['high'] }] }),
  'handoff:get': () => null, 'bridge:extensionPath': () => null, 'plugins:snapshot': () => null,
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
  check(geometry.left >= 0 && geometry.right <= geometry.width + 1 && geometry.overflow <= 1, `${name}: workbench fits without horizontal overflow`);
  check(geometry.sendVisible, `${name}: composer send control remains visible`);
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
