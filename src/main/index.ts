import { requestSessionFinishGoal, setFinishNotifier } from './session/finish.js';
/**
 * Main process entry: window, tray, and the security posture for the renderer.
 */

import path from 'node:path';
import { app, Notification, BrowserWindow, Menu, Tray, nativeImage, nativeTheme, powerMonitor, screen, session } from 'electron';
import { getConfig, initConfigPath, loadConfig } from './config.js';
import { connect, disconnect, getStatus, onStatusChange, shutdownConnection } from './connection.js';
import { registerIpc } from './ipc.js';
import { getChatModels, restoreChatModels, startChatModelDiscovery } from './chat-models.js';
import { initLogFile, logError, logInfo, logWarn } from './logger.js';
import { unifiedExecManager } from './codex/manager.js';
import { initSecretsPath } from './secrets.js';
import { pluginManager } from './plugins/manager.js';
import { setBrowserWorkArea, shutdownBridge, startBridge } from './bridge.js';
import { flushSessions, initSessionStore, pruneSessions } from './session/store.js';
import {
  flushRecorder,
  liveConversations,
  queueDeterministicAttributionRepair,
  recordAgentMessage,
  setAgentBinder,
  setAgentConversationLookup
} from './session/recorder.js';
import {
  agentConversation,
  bindConversation,
  onRetiredWorkersPersist,
  onRetiredWorkersPersistNow,
  onSwarmPersist,
  onSwarmPersistNow,
  pauseSwarmForDisable,
  pendingAgentFinishRequests,
  repairPrimeConversationAfterRecovery,
  releaseQuiescentRun,
  resolvePendingAgentFinish,
  restoreRetiredWorkers,
  restoreSwarm,
  snapshotRetiredWorkers,
  snapshotSwarm,
  type RetiredWorkersSnapshot,
  type SwarmSnapshot
} from './agents.js';
import { flushDurable, initDurableStore, readDurable, writeDurableNow, writeDurableSoon } from './durable.js';
import { requestCorrelation, restoreRequestCorrelations } from './session/correlation.js';
import { restoreBlockedChats } from './session/blocked-chats.js';
import { stopComputerHelper } from './computer/index.js';
import {
  GOAL_OBJECTIVES_STATE,
  GOAL_REPLIES_STATE,
  GOAL_SWITCHES_STATE,
  restoreGoalObjectives,
  restoreGoalReplies,
  restoreGoalSwitches,
  type GoalObjectivesSnapshot,
  type GoalRepliesSnapshot,
  type GoalSwitchesSnapshot
} from './goal.js';
import {
  CONTINUATIONS_STATE,
  restoreContinuations,
  setContinuationRecoveryHooks,
  type ContinuationSnapshot
} from './session/continuation.js';
import { startSessionRetentionMaintenance } from './session/retention.js';
import { runShutdownSequence } from './shutdown.js';
import {
  applyStagedUpdate,
  automaticInstallSafe,
  markInstallOnQuit,
  onUpdateChange,
  startUpdateChecks,
  updateStatus
} from './update.js';
import { inFlightMcpRequests } from './mcp/call-context.js';
import { UI_BASE_ZOOM, windowLayoutForWorkArea, titleBarOverlayForTheme } from './window-layout.js';
import {
  applyLoginStartup,
  isBackgroundLaunch,
  createWindowActivationGate,
  ownsAppRuntime,
  registerNativeWindowActivation,
  shouldBeginAppBootstrap,
  shouldQuitOnWindowAllClosed
} from './window-lifecycle.js';
import { trayGuidArgsForPlatform, trayImageSpec } from './tray-image.js';
import { browserWindowIconPath } from './window-icon.js';
import { editContextMenuTemplate } from './edit-context-menu.js';
import { stopPreviews } from './preview-server.js';
import { extensionDir } from './extension-path.js';

/** Durable state file holding the multi-agent run. Hashes only, never credentials. */
const SWARM_STATE = 'swarm';
const RETIRED_WORKERS_STATE = 'retired-workers';

let window: BrowserWindow | null = null;
let tray: Tray | null = null;
let quitting = false;
let shutdownStarted = false;
let shutdownComplete = false;
let stopSessionRetention: (() => void) | null = null;
let stopUpdateWatch: (() => void) | null = null;
let automaticUpdateReadySince: number | null = null;
let automaticUpdateTimer: NodeJS.Timeout | null = null;

const AUTO_UPDATE_POLL_MS = 30_000;

// One instance only: two copies would fight over the tunnel and the config file.
const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  // `app.quit()` does not make the rest of this module stop executing. Mark this process as a
  // terminal secondary instance immediately, so neither native activation nor the async bootstrap
  // below can touch shared config/durable state while the primary instance is still running.
  quitting = true;
  app.quit();
}

function createWindow(): void {
  const layout = windowLayoutForWorkArea(screen.getPrimaryDisplay().workArea);
  const icon = browserWindowIconPath(process.platform, app.isPackaged, process.resourcesPath);
  window = new BrowserWindow({
    ...layout,
    ...(icon ? { icon } : {}),
    fullscreenable: true,
    show: false,
    autoHideMenuBar: true,
    ...(process.platform === 'win32' ? {
      titleBarStyle: 'hidden' as const,
      titleBarOverlay: titleBarOverlayForTheme(getConfig().ui.theme)
    } : {}),
    // Painted before the renderer loads, so a dark window never flashes white.
    backgroundColor: getConfig().ui.theme === 'dark' ? '#0e0e11' : '#ffffff',
    title: 'MALACHI OVERDRIVE',
    webPreferences: {
      zoomFactor: UI_BASE_ZOOM,
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: false,
      // The renderer only ever loads our own local files.
      webSecurity: true
    }
  });

  if (process.platform === 'win32') window.removeMenu();

  // First use discovers the account once. A restored catalog is immediately usable;
  // showing the window again cannot refresh it or open another browser attempt.
  window.on('show', () => {
    if (!quitting && getChatModels().state === 'unknown') void startChatModelDiscovery(true)
      .catch(error => logWarn(`model discovery on window open: ${error.message}`));
  });
  window.once('ready-to-show', () => {
    // A renderer can finish loading after Cmd+Q has already entered bounded teardown. Never let
    // that late native event make the app visible again while `will-quit` is draining.
    if (!quitting) showWindow();
  });

  // A renderer that fails to load leaves a blank window with no other clue, so
  // record it where the diagnostics panel can show it.
  window.webContents.on('did-finish-load', () => logInfo('window loaded'));
  window.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown' || input.key !== 'F11' || input.isAutoRepeat) return;
    event.preventDefault();
    window?.setFullScreen(!window.isFullScreen());
  });
  window.webContents.on('context-menu', (_event, params) => {
    const owner = window;
    if (!owner || owner.isDestroyed()) return;
    const template = editContextMenuTemplate(params);
    if (template.length) Menu.buildFromTemplate(template).popup({ window: owner });
  });
  window.webContents.on('did-fail-load', (_event, code, description) =>
    logError(`window failed to load (${code}): ${description}`)
  );
  // Renderer errors are otherwise invisible from here. Only errors, and only the
  // message text — never anything the page was working with.
  window.webContents.on('console-message', (details) => {
    if (details.level === 'error') logError(`renderer: ${details.message}`);
  });

  // Nothing in this app should ever open a second window or navigate away.
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event) => event.preventDefault());
  window.webContents.on('will-redirect', (event) => event.preventDefault());
  window.webContents.on('will-attach-webview', (event) => event.preventDefault());

  window.on('close', (event) => {
    if (!quitting && getConfig().ui.minimizeToTray) {
      event.preventDefault();
      window?.hide();
    }
  });

  // Electron keeps the object after the window is gone, and every member on it throws from
  // then on. Holding that reference made `getWindow()` answer "yes, there is a window" for
  // the rest of the process, so the renderer pushes and the tray's Open both aimed at a
  // corpse. Dropping it is what makes those paths take their existing null branch.
  window.on('closed', () => {
    window = null;
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void window.loadFile(path.join(__dirname, '../renderer/index.html'));
  }
}

function showWindow(): void {
  // Defense in depth for every current or future native activation source. The explicit gate
  // below additionally protects the long pre-window startup interval, while this invariant makes
  // a direct caller harmless once `before-quit` has started.
  if (quitting) return;
  if (!window) {
    createWindow();
    return;
  }
  if (window.isMinimized()) window.restore();
  // Apply maximization before showing the window so startup has the native maximized
  // frame from its first visible paint. Preserve a user's explicit F11 fullscreen choice.
  if (!window.isFullScreen()) window.maximize();
  window.show();
  window.focus();
}

setFinishNotifier((title, body, sessionId, turnId) => {
  if (window?.isFocused() || !Notification.isSupported()) return false;
  const write = (): void => {
    showWindow();
    if (!window) return;
    const target = window.webContents;
    const open = (): void => { if (!target.isDestroyed()) target.send('session:write', sessionId); };
    if (target.isLoadingMainFrame()) target.once('did-finish-load', open); else open();
  };
  const notice = new Notification({ title, body, actions: [
    { type: 'button', text: 'Send Automatic Goal' }, { type: 'button', text: 'Write Directly' }
  ] });
  notice.on('click', write);
  notice.on('action', (details) => {
    if (details.actionIndex === 0) void requestSessionFinishGoal(sessionId, turnId).catch(error => logWarn(`Finish goal: ${error.message}`));
    else if (details.actionIndex === 1) write();
  });
  notice.show();
  return true;
});
setBrowserWorkArea(() => screen.getPrimaryDisplay().workArea);

// Electron promises `second-instance` only after its own `ready`, not after our async startup.
// Until CSP/permission handlers and IPC are installed below, a re-launch is only a focus request
// for the initial window that startup is already going to show, so do not construct one early.
const windowActivation = createWindowActivationGate(showWindow);

/** Stop the update-idle timer without leaving a referenced handle behind. */
function clearAutomaticUpdateTimer(): void {
  if (!automaticUpdateTimer) return;
  clearInterval(automaticUpdateTimer);
  automaticUpdateTimer = null;
}

/**
 * Reconcile the background auto-install loop with the updater's current state.
 *
 * A downloaded update is not permission to interrupt work. We wait through a grace period, then
 * require whole-machine idle plus zero live browser turns, MCP requests and retained terminal
 * processes. The ordinary app shutdown sequence still owns the actual handoff, so all durable
 * writes and connector drains keep their existing guarantees.
 */
function reconcileAutomaticUpdateInstall(): void {
  const current = updateStatus();
  if (current.stage !== 'ready') {
    automaticUpdateReadySince = null;
    clearAutomaticUpdateTimer();
    return;
  }

  automaticUpdateReadySince ??= Date.now();
  if (automaticUpdateTimer) return;

  const tryInstall = (): void => {
    if (quitting || shutdownStarted) return;
    const latest = updateStatus();
    const generating = liveConversations().filter((conversation) =>
      conversation.generating || conversation.activeTurnId !== null
    ).length;
    const safe = automaticInstallSafe({
      stage: latest.stage,
      readySince: automaticUpdateReadySince,
      now: Date.now(),
      systemIdleSeconds: powerMonitor.getSystemIdleTime(),
      inFlightRequests: inFlightMcpRequests(),
      generatingConversations: generating,
      backgroundProcesses: unifiedExecManager.listProcesses().length
    });
    if (!safe) return;
    if (!markInstallOnQuit()) {
      reconcileAutomaticUpdateInstall();
      return;
    }
    logInfo(`update: ${latest.latest ?? 'downloaded release'} is ready and the laptop is idle; restarting automatically`);
    quitting = true;
    app.quit();
  };

  automaticUpdateTimer = setInterval(tryInstall, AUTO_UPDATE_POLL_MS);
  automaticUpdateTimer.unref();
  tryInstall();
}

/** Build the native tray image from encoded PNGs, never platform-dependent bitmap bytes. */
function trayIcon(running: boolean): Electron.NativeImage {
  const spec = trayImageSpec(process.platform, running);
  const [base, ...highDpi] = spec.representations;
  const image = nativeImage.createFromBuffer(base.png, { scaleFactor: base.scaleFactor });
  for (const representation of highDpi) {
    image.addRepresentation({
      scaleFactor: representation.scaleFactor,
      dataURL: `data:image/png;base64,${representation.png.toString('base64')}`
    });
  }
  if (spec.template) image.setTemplateImage(true);
  return image;
}

function refreshTray(): void {
  if (!tray) return;
  const state = getStatus().state;
  const connected = state === 'connected';
  const offline = state === 'offline';
  // Offline keeps the running icon: the bridge is up, the internet is not.
  const running = connected || offline;
  const label = connected ? 'Connected' : offline ? 'No internet' : 'Not connected';
  tray.setImage(trayIcon(running));
  tray.setToolTip(`MALACHI OVERDRIVE — ${label.toLowerCase()}`);
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label, enabled: false },
      { type: 'separator' },
      { label: 'Open', click: windowActivation.request },
      {
        label: running ? 'Disconnect' : 'Connect',
        click: () => void (running ? disconnect() : connect())
      },
      { type: 'separator' },
      {
        label: 'Quit',
        click: () => {
          quitting = true;
          app.quit();
        }
      }
    ])
  );
}

app.on('second-instance', (_event, argv) => {
  if (!isBackgroundLaunch(argv)) windowActivation.request();
});

void app.whenReady().then(async () => {
  // This guard is intentionally before even app.getPath/init* calls. A secondary instance, or a
  // primary that was told to quit before ready, must never touch the primary's shared userData.
  if (!shouldBeginAppBootstrap(hasSingleInstanceLock, quitting)) return;
  const userData = app.getPath('userData');
  initLogFile(path.join(userData, 'app.log'));
  initConfigPath(userData);
  initSecretsPath(userData);
  initSessionStore(userData);
  initDurableStore(userData);
  await restoreChatModels();
  if (windowActivation.isDisabled()) return;
  await loadConfig();
  await pluginManager.initialize(userData);
  if (windowActivation.isDisabled()) return;
  // Refresh the stable unpacked companion before the browser bridge comes up. Packaged updates
  // replace Resources/extension; materializing it here makes the already-loaded stable folder
  // contain the new companion bytes without asking the user to download or load a new folder.
  if (app.isPackaged && !extensionDir()) logWarn('browser companion could not be materialized from the packaged update');
  try { applyLoginStartup(app, getConfig().ui.startAtLogin === true); }
  catch (error) { logWarn(`Windows login startup: ${error instanceof Error ? error.message : String(error)}`); }
  // The renderer has its own explicit light/dark palette, so native chrome must follow the same
  // user choice instead of Electron's default `system` theme. On macOS this controls the window
  // frame, application menus and OS dialogs; on Linux/Windows it covers Electron-native UI.
  nativeTheme.themeSource = getConfig().ui.theme;
  const savedGoalObjectives = await readDurable<GoalObjectivesSnapshot>(GOAL_OBJECTIVES_STATE);
  if (windowActivation.isDisabled()) return;
  restoreGoalObjectives(savedGoalObjectives);
  const savedGoalSwitches = await readDurable<GoalSwitchesSnapshot>(GOAL_SWITCHES_STATE);
  if (windowActivation.isDisabled()) return;
  restoreGoalSwitches(savedGoalSwitches);
  const savedGoalReplies = await readDurable<GoalRepliesSnapshot>(GOAL_REPLIES_STATE);
  if (windowActivation.isDisabled()) return;
  restoreGoalReplies(savedGoalReplies);
  // Request ownership must exist before either side of the bridge can race in. A request id
  // that was proved yesterday remains the same workflow today even if its ChatGPT tab closed.
  await restoreRequestCorrelations();
  if (windowActivation.isDisabled()) return;
  // And the user's blocks, for the same reason: a chat blocked yesterday is still the rogue
  // turn today, and a block that loads after the first call is a tool the turn already got.
  await restoreBlockedChats();
  if (windowActivation.isDisabled()) return;
  setAgentConversationLookup(agentConversation);
  // The prime's chat is the user's own, so no extension report can name it. It is bound
  // when the recorder manages to place the prime's first call. See recordToolCall.
  setAgentBinder(bindConversation);
  // Task placement belongs to the paired companion. A disconnected browser cannot
  // authorize an OS opener that might take over an unrelated foreground window.

  // Persistence is a process-lifetime dependency of the broker, not a feature-toggle
  // dependency. Multi-agent can be enabled from Settings without restarting the process;
  // keeping both sinks wired from startup guarantees the first spawn can cross its durable
  // acceptance barrier even when this launch began with multi-agent disabled.
  onSwarmPersist(() => writeDurableSoon(SWARM_STATE, snapshotSwarm()));
  onSwarmPersistNow((snapshot) => writeDurableNow(SWARM_STATE, snapshot));

  // A multi-agent run outlives this process. Restoring it before the bridge starts
  // means a worker that never joined gets its chat re-requested through the same queue
  // as a fresh one, rather than being stranded with a key nobody has.
  onRetiredWorkersPersist(() => writeDurableSoon(RETIRED_WORKERS_STATE, snapshotRetiredWorkers()));
  onRetiredWorkersPersistNow((snapshot) => writeDurableNow(RETIRED_WORKERS_STATE, snapshot));
  const retiredWorkers = await readDurable<RetiredWorkersSnapshot>(RETIRED_WORKERS_STATE);
  if (windowActivation.isDisabled()) return;
  restoreRetiredWorkers(retiredWorkers);
  const savedSwarm = await readDurable<SwarmSnapshot>(SWARM_STATE);
  if (windowActivation.isDisabled()) return;
  restoreSwarm(savedSwarm);
  // Request correlations are restored before the swarm. A crash can therefore leave an exact
  // worker finish durably pending after its browser request id was already proved. Complete that
  // same two-phase commit before the bridge opens; no new page observation is required.
  for (const pending of pendingAgentFinishRequests()) {
    const correlation = requestCorrelation(pending.requestId);
    if (!correlation) continue;
    try {
      const finished = await resolvePendingAgentFinish(pending.requestId, correlation.conversationId);
      if (finished?.report) await recordAgentMessage(finished.report, 'sent', finished.info.conversationId);
      if (finished?.info.runId) releaseQuiescentRun({}, finished.info.runId);
    } catch (error) {
      logWarn(
        `multi-agent: restored pending finish ${pending.requestId.slice(0, 20)}… could not settle — ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
  if (!getConfig().multiAgent.enabled) {
    // A feature toggle is a pause, not Clear swarm. Canonicalize any active incarnation left by
    // a crash into stopped prime-owned history before the bridge exists, then make that safer
    // projection durable. Re-enabling later in this process or after another restart recovers the
    // same exact worker conversations without letting disabled workers consume execution slots.
    pauseSwarmForDisable('multi-agent mode is disabled');
    await writeDurableNow(SWARM_STATE, snapshotSwarm());
    if (windowActivation.isDisabled()) return;
  }
  // Continuation recovery is after swarm restore because an interrupted durable rebind may
  // have to finish publishing the prime transfer that was frozen in that snapshot.
  setContinuationRecoveryHooks({
    repairPrimeTransfer: repairPrimeConversationAfterRecovery
  });
  const savedContinuations = await readDurable<ContinuationSnapshot>(CONTINUATIONS_STATE);
  if (windowActivation.isDisabled()) return;
  await restoreContinuations(savedContinuations);
  if (windowActivation.isDisabled()) return;

  // Strict CSP for our own page. There is no remote content and no inline script.
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; form-action 'none'; base-uri 'none'; frame-ancestors 'none'"
        ]
      }
    });
  });

  // Deny every permission request; the UI needs none of them.
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));

  // From here on a second launch may safely focus/recreate the window: renderer security policy
  // is installed and the renderer's fixed IPC methods already have handlers before it can load.
  // The same quit the tray's Quit performs. It has to go through `quitting` for the window's
  // close-to-tray handler to let go: without it, quitting to install would hide the window and
  // leave the app running, which is exactly the trap the Install button exists to end.
  registerIpc(
    () => window,
    () => {
      quitting = true;
      app.quit();
    }
  );
  windowActivation.enable();
  if (!isBackgroundLaunch(process.argv)) windowActivation.request();
  // macOS `activate` can fire on first launch, so do not wire it at module load where it could
  // create a BrowserWindow before Electron is ready. Once the initial window path is established,
  // Dock activation/re-launch can safely recreate or focus it.
  registerNativeWindowActivation(app, windowActivation.request);

  tray = new Tray(trayIcon(false), ...trayGuidArgsForPlatform());
  tray.on('click', windowActivation.request);
  refreshTray();
  onStatusChange(refreshTray);

  logInfo('app started');

  // Historical Unattributed repair may legitimately scan and rewrite a large legacy bucket.
  // It is maintenance, not a prerequisite for showing the app or accepting new exact-id
  // traffic, so never make startup/reload wait behind years of old session history.
  queueDeterministicAttributionRepair();

  // The bridge serves recording and multi-agent mode both: recording needs the
  // extension to observe the chat, and multi-agent mode needs it to open worker tabs.
  // Either switch being on starts it. ipc.ts applies the same rule on a settings save.
  if (getConfig().sessions.record || getConfig().multiAgent.enabled) {
    void startBridge();
  }
  // Retention governs recordings already stored on disk, independent of whether recording is
  // currently enabled. The tray app can stay alive for days, so run once now and keep a coarse
  // maintenance timer rather than making expiry depend on the next process restart.
  stopSessionRetention = startSessionRetentionMaintenance({
    retainDays: () => getConfig().sessions.retainDays,
    prune: pruneSessions,
    onRemoved: (removed) => logInfo(`removed ${removed} session(s) past the retention window`),
    onError: (err) => logError(`session pruning failed: ${err.message}`)
  });

  if (getConfig().ui.autoConnect) void connect();

  // Never awaited: an unreachable GitHub, a slow download or a broken release must not delay a
  // window that is already on screen. Everything it learns arrives through the ordinary state
  // push, every failure ends inside it, and its own timer keeps it running for a tray app that
  // is never restarted.
  stopUpdateWatch = onUpdateChange(reconcileAutomaticUpdateInstall);
  startUpdateChecks();
  reconcileAutomaticUpdateInstall();
});

app.on('before-quit', () => {
  if (!ownsAppRuntime(hasSingleInstanceLock)) return;
  quitting = true;
  clearAutomaticUpdateTimer();
  stopUpdateWatch?.();
  stopUpdateWatch = null;
  // From this point `will-quit` owns a bounded teardown. A Dock click/relaunch arriving while
  // that sequence drains must not recreate or reveal a window after the tray has disappeared.
  windowActivation.disable();
});

app.on('window-all-closed', () => {
  if (!ownsAppRuntime(hasSingleInstanceLock)) return;
  // macOS convention: closing the last window is not quitting the application. The Dock/menu
  // bar stay alive and `activate` recreates it. Windows/Linux retain the explicit close-to-tray
  // preference; Cmd+Q / app.quit bypasses this event and still enters the shutdown sequence.
  if (shouldQuitOnWindowAllClosed(process.platform, getConfig().ui.minimizeToTray)) app.quit();
});

app.on('will-quit', (event) => {
  // A secondary instance called app.quit() only to get out of the primary's way. It must be
  // allowed to exit normally: preventing that quit and flushing/stopping the primary's shared
  // stores from a process that never initialized or owns them is both a hang and data race.
  if (!ownsAppRuntime(hasSingleInstanceLock)) return;
  if (shutdownComplete) return;
  event.preventDefault();
  if (shutdownStarted) return;
  shutdownStarted = true;
  stopSessionRetention?.();
  stopSessionRetention = null;
  tray?.destroy();
  tray = null;

  void runShutdownSequence(
    [
      // Phase 1: stop both listeners from admitting work and let accepted requests drain.
      // The budget has to clear the drains it contains, or it would silently defeat them:
      // the bridge force-closes wedged localhost sockets at 15s and the MCP endpoint forces
      // its own drain at 30s. This is the outer bound on both, not a competing one.
      { name: 'admission/drain', budgetMs: 40_000, run: () => [shutdownConnection(), shutdownBridge()] },
      // Phase 2: only after request handlers are done may their owned child processes go.
      {
        name: 'process cleanup',
        budgetMs: 15_000,
        run: () => [unifiedExecManager.terminateAllProcesses(), stopComputerHelper(), stopPreviews(), pluginManager.close()]
      },
      // Phase 3: recorder work can enqueue both session projections and named durable state.
      { name: 'recorder flush', budgetMs: 10_000, run: () => [flushRecorder()] },
      // These are independent writers. One rejection must never skip the other flush.
      { name: 'durable flush', budgetMs: 10_000, run: () => [flushSessions(), flushDurable()] },
      // Last, because it is the one phase whose effect is meant to outlive this process: a
      // staged update is handed to the platform's installer here, so the next start of the app
      // is the new version. Nothing is staged unless it downloaded whole and matched the
      // release's published SHA-256, and applying it cannot fail loudly - see update.ts.
      // AppImage updates are normally one same-filesystem atomic rename. If a user keeps the
      // AppImage on another mounted volume, update.ts falls back to a bounded cross-device copy;
      // give that exceptional path enough room to finish instead of killing the process mid-copy.
      { name: 'update handoff', budgetMs: 60_000, run: () => [applyStagedUpdate()] }
    ],
    {
      info: logInfo,
      warn: logWarn,
      error: logError,
      // Not `app.quit()`. See the note on ShutdownHooks.exit: a quit raised from the
      // continuation that ends this sequence is dropped by Electron, and the app is left
      // running with nothing to click and the single-instance lock still held.
      exit: () => {
        shutdownComplete = true;
        app.exit(0);
      }
    }
  );
});

// Belt and braces: no web contents anywhere in this app may open a window or
// navigate. External links go through the vetted allowlist in ipc.ts instead.
app.on('web-contents-created', (_event, contents) => {
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  contents.on('will-navigate', (event) => event.preventDefault());
  contents.on('will-redirect', (event) => event.preventDefault());
});
