import path from 'node:path';
import { getConfig } from './config.js';
import { getSession, findSessionByConversation, listSessionPage, readRecentEvents, readEvents } from './session/store.js';
import { liveConversations } from './session/recorder.js';
import { listInputs, type InputEntry } from './session/input.js';
import { retryQueuedInputBrowser } from './session/start-input.js';
import { sessionControlsFor, sessionHasInputActivity, setSessionAutomation, stopSessionTurn, type SessionControlsView } from './bridge.js';
import { swarmState } from './agents.js';
import { goalSwitchFor } from './goal.js';
import { isChatBlocked } from './session/blocked-chats.js';
import { resolvePath } from './sandbox.js';
import { readDurable, writeDurableNow } from './durable.js';
import { redact } from './logger.js';
import { foregroundTurnGranted, grantForegroundTurn, revokeForegroundTurn } from './desktop-custody.js';
import { normalizedToolOutcome, type AgentInfo, type SessionEvent, type SessionSummary } from '../shared/session.js';
import { AMBIENT_STAGE_LABELS, type AmbientActivity, type AmbientCompletion, type AmbientControlRequest, type AmbientModel, type AmbientOutput, type AmbientSnapshot, type AmbientStage, type AmbientTask, type AmbientWorker } from '../shared/ambient-work.js';

const ACTIVE = new Set(['invited', 'active', 'detached', 'waking']);
const PENDING = new Set(['queued', 'browser', 'tool', 'decision']);
const RECEIPTS = 'ambient-completion-receipts';
const unknownModel = (): AmbientModel => ({ model: null, reasoningEffort: null, evidence: 'unknown' });
/** Ambient summaries never publish tool arguments/results, private reasoning or absolute paths. */
export function ambientText(text: string, limit = 160): string {
  return redact(text).replace(/https?:\/\/\S+/gi, '[link]')
    .replace(/(?:[A-Za-z]:[\\/]|\\\\|(?:^|[\s('"=:\[{])\/)[^\n\r,;]+/g, ' [local path]')
    .replace(/\b(?:bearer\s+|(?:token|password|secret|api[_-]?key)\s*[=:]\s*)(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s,;]+)/gi, '[redacted]')
    .replace(/\s+/g, ' ').trim().slice(0, limit);
}
function selectedModel(session?: SessionSummary): AmbientModel {
  const choice = session?.selectedModel;
  return choice && choice.conversationId === session?.conversationId
    ? { model: choice.model, reasoningEffort: choice.reasoningEffort ?? null, evidence: 'confirmed' } : unknownModel();
}
function modelForEvent(event: SessionEvent): AmbientModel {
  const call = event.kind === 'tool_call' ? event.call : event;
  return call.model ? { model: call.model, reasoningEffort: call.reasoningEffort ?? null, evidence: 'confirmed' } : unknownModel();
}
function outputRows(sessionId: string, events: SessionEvent[]): AmbientOutput[] {
  return events.flatMap(event => event.kind !== 'tool_call' || normalizedToolOutcome(event.call) !== 'ok' ||
    !['create', 'edit'].includes(event.call.summary.kind) ? [] :
    (event.call.changes ?? []).map((change, outputIndex): AmbientOutput => ({
      id: `${sessionId}:${event.seq}:${outputIndex}`, sessionId, eventSeq: event.seq, outputIndex,
      name: ambientText(path.basename(change.path.replaceAll('\\', '/')), 100), kind: 'file', createdAt: event.time
    }))).reverse().slice(0, 20);
}
function activityRows(sessionId: string, workerId: string | null, events: SessionEvent[]): AmbientActivity[] {
  const result: AmbientActivity[] = [];
  for (const event of events) {
    let description: string | undefined;
    let stage: AmbientStage = 'working';
    let error: AmbientActivity['error'];
    if (event.kind === 'tool_call') {
      description = ambientText(event.call.summary.title);
      const outcome = normalizedToolOutcome(event.call);
      if (outcome && outcome !== 'ok') {
        const permission = /FOREGROUND_CONTROL_REQUIRED|TOOL_DISABLED|PERMISSION_DENIED/.test(event.call.result.text);
        stage = permission ? 'waiting-permission' : 'failed';
        error = { code: permission ? 'PERMISSION_REQUIRED' : outcome, recoverable: false, userActionRequired: permission };
      }
    } else if (event.kind === 'page_tool') description = ambientText(event.label);
    else if (event.kind === 'turn_start') description = 'Provider started the turn';
    else if (event.kind === 'turn_end') {
      stage = event.outcome === 'completed' ? 'complete' : event.outcome === 'interrupted' ? 'cancelled' : 'blocked';
      description = event.outcome === 'completed' ? 'Provider completed the turn' : `Turn ended: ${event.outcome}`;
    } else if (event.kind === 'chat_error') {
      stage = 'failed'; description = 'Provider reported an error';
      error = { code: 'PROVIDER_ERROR', recoverable: false, userActionRequired: true };
    } else if (event.kind === 'progress' && event.source === 'app' && event.progressId?.startsWith('browser-repair:')) {
      stage = 'preparing'; description = 'Browser connection recovery';
    }
    if (!description) continue;
    const prior = result.at(-1);
    if (prior && prior.description === description && prior.stage === stage && prior.workerId === workerId) {
      prior.count++; prior.timestamp = event.time; continue;
    }
    result.push({ id: `${sessionId}:${event.seq}`, taskId: sessionId, workerId, timestamp: event.time,
      stage, description, model: modelForEvent(event), count: 1, ...(error ? { error } : {}) });
  }
  return result.reverse().slice(0, 60);
}

export interface AmbientProjectionInput {
  session: SessionSummary;
  events: SessionEvent[];
  agents: AgentInfo[];
  sessions: SessionSummary[];
  inputs: InputEntry[];
  controls: SessionControlsView | null;
  live: boolean;
  blocked: boolean;
  resumeMode?: 'goal' | 'loop';
}

/** One session owns one controlled conversation. Worker display joins exact conversations, never worker-N alone. */
export function projectAmbientTask(input: AmbientProjectionInput): AmbientTask {
  const { session, events, controls } = input;
  const conversationId = session.conversationId!;
  const owned = input.agents.filter(agent => agent.conversationId === conversationId || agent.primeConversationId === conversationId);
  const workers: AmbientWorker[] = owned.filter(agent => agent.role === 'worker').map(agent => {
    const workerSession = input.sessions.find(candidate => candidate.conversationId === agent.conversationId &&
      candidate.origin?.kind === 'worker' && candidate.origin.agentId === agent.id &&
      (session.origin?.kind === 'worker' ? candidate.id === session.id : candidate.origin.fromSessionId === session.id));
    const observed = selectedModel(workerSession);
    return { id: agent.id, runId: agent.runId ?? null, sessionId: workerSession?.id ?? null,
      conversationId: agent.conversationId, name: ambientText(agent.label || agent.id, 80), task: ambientText(agent.task),
      state: agent.state, active: ACTIVE.has(agent.state),
      model: observed.evidence === 'confirmed' ? observed : agent.model || agent.reasoningEffort
        ? { model: agent.model, reasoningEffort: agent.reasoningEffort, evidence: 'requested' } : unknownModel() };
  });
  const self = owned.find(agent => agent.conversationId === conversationId);
  const pending = input.inputs.filter(row => (row.sessionId === session.id || row.deliveredSessionId === session.id) && PENDING.has(row.state));
  const latestBoundary = [...events].reverse().find(event => event.kind === 'turn_start' || event.kind === 'turn_end');
  const latestFinish = [...events].reverse().find(event => event.kind === 'tool_call' && event.call.endsActivity && normalizedToolOutcome(event.call) === 'ok');
  const terminal = latestBoundary?.kind === 'turn_end' && latestBoundary.turnId ? latestBoundary : null;
  const finished = latestFinish && latestFinish.time >= (latestBoundary?.time ?? 0) ? latestFinish : null;
  const activeChildren = workers.some(worker => worker.active && worker.conversationId !== conversationId);
  const currentStart = [...events].reverse().find(event => event.kind === 'turn_start');
  const failedChild = owned.some(agent => agent.role === 'worker' && agent.state === 'failed' &&
    agent.finishedAt !== null && agent.finishedAt >= (currentStart?.time ?? session.updatedAt));
  const automation = controls?.automation ?? 'off';
  const busyDraft = controls?.goalDraft && !['failed', 'ready'].includes(controls.goalDraft.stage);
  const activity = activityRows(session.id, self?.role === 'worker' ? self.id : null, events);
  let state: AmbientStage = 'idle';
  if (input.blocked) state = 'blocked';
  else if (self?.state === 'failed' || failedChild) state = 'failed';
  else if (self?.state === 'invited') state = 'opening-workspace';
  else if (self?.state === 'waking' || busyDraft || controls?.job) state = 'preparing';
  else if (input.live || activeChildren) state = 'working';
  else if (pending.length) state = pending.some(row => row.state === 'browser') ? 'waiting-provider' : 'queued';
  else if (terminal?.outcome === 'completed' || finished) state = automation === 'off' ? 'complete' : 'waiting-provider';
  else if (terminal?.outcome === 'interrupted') state = 'cancelled';
  else if (terminal && terminal.outcome !== 'unknown') state = 'failed';
  else if (session.activeTurnId || self?.state === 'detached') state = 'blocked';
  if (activity[0]?.stage === 'waiting-permission' && !input.live) state = 'waiting-permission';
  const turnId = controls?.activeTurnId ?? session.activeTurnId ?? terminal?.turnId ?? finished?.turnId ?? null;
  const start = [...events].reverse().find(event => event.kind === 'turn_start' && event.turnId === turnId);
  const completionId = state === 'complete' ? finished?.kind === 'tool_call'
    ? `${session.id}:finish:${finished.call.callId}` : terminal ? `${session.id}:${terminal.turnId}:${terminal.seq}` : null : null;
  const retry = pending.find(row => row.state === 'queued' && row.error?.startsWith('Message queued. Browser startup failed:'));
  // Never offer an earlier turn's artifact as the result of this completion. A missing
  // turn association stays unknown even when timestamps happen to be close.
  const outputs = outputRows(session.id, turnId ? events.filter(event => event.turnId === turnId) : []);
  const foreground = !!controls?.activeTurnId && foregroundTurnGranted(session.id, conversationId, controls.activeTurnId);
  const warning = foreground ? 'Foreground control is allowed for this turn. It may move focus and use your desktop until the turn ends.'
    : input.blocked ? 'This chat is blocked. Release it in the linked chat controls.'
    : state === 'waiting-permission' ? 'Foreground device control requires an explicit user action. Background workers cannot control your desktop.'
    : state === 'blocked' && session.activeTurnId ? 'Waiting for fresh provider evidence; previous work is not marked complete.'
    : self?.state === 'detached' ? 'Worker browser disconnected; server-side work may still be running.' : null;
  return {
    id: session.id, sessionId: session.id, conversationId, turnId, title: ambientText(session.title || 'Untitled task', 120),
    state, stage: AMBIENT_STAGE_LABELS[state], startedAt: start?.time ?? (input.live ? session.finishTurn?.startedAt ?? null : null),
    updatedAt: session.updatedAt, live: input.live || activeChildren, completionId, progress: null, model: selectedModel(session),
    workers, activity, outputs, warning,
    controls: [
      { action: 'pause', label: 'Pause follow-ups', enabled: automation !== 'off', reason: 'Pauses future Goal/Loop steps; an in-flight provider turn continues.' },
      { action: 'resume', label: 'Resume follow-ups', enabled: automation === 'off' && !!input.resumeMode && !input.blocked && !self?.role?.includes('worker'), reason: 'Resumes the saved Goal/Loop mode for this conversation.' },
      { action: 'stop', label: 'Stop safely', enabled: !!controls?.activeTurnId && !controls.stopPending, reason: 'Stops this exact turn. Other worker chats continue independently.' },
      { action: 'retry', label: 'Retry connection', enabled: !!retry, ...(retry ? { inputId: retry.id } : {}), reason: 'Only a queued input proven not sent can be retried; uncertain sends are never repeated.' },
      { action: 'foreground', label: 'Allow foreground control', enabled: !!controls?.activeTurnId &&
        !foregroundTurnGranted(session.id, conversationId, controls.activeTurnId),
        reason: 'Explicit handoff: this turn may focus windows and use your screen, keyboard, mouse and clipboard. It stops being background-only.' }
    ]
  };
}

/** New-chat delivery exists durably before it has a provider conversation. Do not invent one. */
export function projectAmbientInput(entry: InputEntry): AmbientTask {
  const state: AmbientStage = entry.state === 'failed' ? 'failed' : entry.state === 'browser' ? 'preparing' : 'queued';
  const id = `input:${entry.id}`;
  const model: AmbientModel = entry.model || entry.reasoningEffort
    ? { model: entry.model, reasoningEffort: entry.reasoningEffort, evidence: 'requested' } : unknownModel();
  return { id, inputId: entry.id, sessionId: '', conversationId: '', turnId: null,
    title: ambientText(entry.text, 100) || 'New task', state, stage: AMBIENT_STAGE_LABELS[state], startedAt: entry.createdAt,
    updatedAt: entry.createdAt, live: PENDING.has(entry.state), completionId: null, progress: null, model,
    workers: [], outputs: [], controls: [], warning: entry.error ? ambientText(entry.error) : null,
    activity: [{ id, taskId: id, workerId: null, timestamp: entry.createdAt, stage: state,
      description: entry.state === 'browser' ? 'Browser preparation accepted' : entry.state === 'failed' ? 'Task delivery failed' : 'Task queued for browser delivery',
      model, count: 1 }]
  };
}

/** Notification eligibility is observed transition evidence, not elapsed time or historic completion. */
export class AmbientCompletionTracker {
  private observed = new Map<string, { turnId: string | null; live: boolean }>();
  private delivered = new Set<string>();
  private pending = new Map<string, AmbientCompletion>();
  seed(receipts: string[]): void { this.delivered = new Set(receipts); }
  receipts(completions: AmbientCompletion[] = []): string[] {
    return [...new Set([...this.delivered, ...completions.map(row => row.id)])].slice(-1000);
  }
  /** Commit only after the receipt write succeeds; failed writes retain observed evidence. */
  commit(completions: AmbientCompletion[]): void {
    for (const row of completions) {
      this.delivered.add(row.id); this.pending.delete(row.id);
    }
  }
  update(tasks: AmbientTask[]): AmbientCompletion[] {
    const current = new Set(tasks.map(task => task.completionId));
    for (const id of this.pending.keys()) if (!current.has(id)) this.pending.delete(id);
    for (const task of tasks) {
      const previous = this.observed.get(task.id);
      if (task.completionId && previous?.live && previous.turnId === task.turnId && !this.delivered.has(task.completionId)) {
        this.pending.set(task.completionId, { id: task.completionId, taskId: task.id, summary: `${task.title} completed.`, ...(task.outputs[0] ? { output: task.outputs[0] } : {}) });
      }
      // Temporary loss of page evidence never erases the live turn identity being watched.
      if (task.live || task.completionId || !previous || (task.turnId !== previous.turnId))
        this.observed.set(task.id, { turnId: task.turnId, live: task.live });
    }
    for (const key of this.observed.keys()) if (!tasks.some(task => task.id === key)) this.observed.delete(key);
    return [...this.pending.values()];
  }
}
let snapshot: AmbientSnapshot = { revision: 0, tasks: [], completions: [], notificationsEnabled: true };
const tracker = new AmbientCompletionTracker();
let loaded = false;
let flight: Promise<AmbientSnapshot> | null = null;
let invalidated = false;
// Rebuildable evidence only: unchanged histories are not rescanned on browser heartbeats.
const evidenceCache = new Map<string, { revision: string; events: SessionEvent[] }>();
const listeners = new Set<(value: AmbientSnapshot) => void>();
export function onAmbientWorkChange(listener: (value: AmbientSnapshot) => void): () => void {
  listeners.add(listener); return () => { listeners.delete(listener); };
}
export function invalidateAmbientWork(): void {
  invalidated = true;
  void getAmbientWork().catch(() => {
    snapshot = { ...snapshot, revision: snapshot.revision + 1, completions: [], error: 'Background activity could not be refreshed. Recorded work remains unchanged.' };
    for (const listener of listeners) listener(snapshot);
  });
}
async function readSnapshot(): Promise<AmbientSnapshot> {
  if (!loaded) {
    const stored = await readDurable<unknown>(RECEIPTS);
    if (stored !== null && (!Array.isArray(stored) || stored.some(id => typeof id !== 'string'))) throw new Error('Invalid notification receipts');
    tracker.seed((stored ?? []) as string[]); loaded = true;
  }
  const agents = swarmState().agents;
  const inputs = await listInputs();
  const candidates = new Map((await listSessionPage({ limit: 40 })).sessions.filter(row => row.conversationId).map(row => [row.id, row]));
  // Durable outbox work must remain visible even when its session has fallen outside the
  // recency page. The outbox owns this membership; Ambient only projects the exact session
  // ids already attached to pending delivery rows.
  const pendingSessionIds = new Set(inputs.flatMap(row => PENDING.has(row.state)
    ? [row.sessionId, row.deliveredSessionId].filter((id): id is string => !!id) : []));
  await Promise.all([...pendingSessionIds].filter(id => !candidates.has(id)).map(async id => {
    const session = await getSession(id);
    if (session?.conversationId) candidates.set(session.id, session);
  }));
  for (const id of new Set([...liveConversations().map(row => row.conversationId), ...agents.filter(row => ACTIVE.has(row.state)).map(row => row.conversationId).filter((id): id is string => !!id)])) {
    const session = await findSessionByConversation(id); if (session) candidates.set(session.id, session);
  }
  const sessions = [...candidates.values()];
  const tasks: AmbientTask[] = [];
  for (const session of sessions) {
    if (!session.conversationId || session.origin?.kind === 'helper') continue;
    const revision = `${session.conversationId}:${session.events}:${session.updatedAt}`;
    let evidence = evidenceCache.get(session.id);
    if (evidence?.revision !== revision) {
      const [recent, boundaries] = await Promise.all([
        readRecentEvents(session.id, 80, { kinds: ['tool_call', 'page_tool', 'chat_error', 'progress'], maxBytes: 180_000 }),
        readRecentEvents(session.id, 8, { kinds: ['turn_start', 'turn_end'], maxBytes: 12_000 })
      ]);
      evidence = { revision, events: [...recent, ...boundaries].sort((a, b) => a.seq - b.seq) };
      evidenceCache.set(session.id, evidence);
    }
    const events = evidence.events;
    const policy = goalSwitchFor(session.conversationId);
    const live = sessionHasInputActivity(session);
    let controls: SessionControlsView | null = null;
    if (live || session.activeTurnId || policy.enabled || policy.own) {
      try { controls = await sessionControlsFor(session.id); } catch { /* Old/superseded history is still readable, never controllable. */ }
    }
    if (controls && controls.conversationId !== session.conversationId) { invalidated = true; continue; }
    tasks.push(projectAmbientTask({ session, events, agents, sessions, inputs, controls, live,
      blocked: isChatBlocked(session.conversationId), ...(!policy.enabled && policy.own ? { resumeMode: policy.mode } : {}) }));
  }
  for (const key of evidenceCache.keys()) if (!candidates.has(key)) evidenceCache.delete(key);
  for (const entry of inputs) if (!entry.sessionId && !entry.deliveredSessionId && entry.purpose !== 'decision' &&
    (PENDING.has(entry.state) || entry.state === 'failed')) tasks.push(projectAmbientInput(entry));
  tasks.sort((a, b) => Number(b.live) - Number(a.live) || b.updatedAt - a.updatedAt);
  const completions = tracker.update(tasks);
  // Persist notification receipts before publishing. A restart never replays a past completion.
  if (completions.length) {
    await writeDurableNow(RECEIPTS, tracker.receipts(completions));
    tracker.commit(completions);
  }
  return { revision: snapshot.revision + 1, tasks, completions, notificationsEnabled: getConfig().ui.ambientNotifications !== false };
}
export function getAmbientWork(): Promise<AmbientSnapshot> {
  if (flight) return flight;
  flight = (async () => {
    let next: AmbientSnapshot;
    do {
      invalidated = false;
      next = await readSnapshot();
    } while (invalidated);
    // Never publish the partial projection that detected an identity change while it was
    // loading. Rebuild first, then advance the public revision once with a stable snapshot.
    snapshot = next;
    for (const listener of listeners) listener(snapshot);
    return snapshot;
  })().finally(() => { flight = null; });
  return flight;
}

export async function controlAmbientWork(request: AmbientControlRequest): Promise<AmbientSnapshot> {
  const session = await getSession(request.sessionId);
  if (!session || session.conversationId !== request.conversationId) throw new Error('Task conversation changed. Refresh the preview.');
  const controls = await sessionControlsFor(session.id);
  if (controls.conversationId !== request.conversationId) throw new Error('Task conversation changed. Refresh the preview.');
  if (controls.activeTurnId && controls.activeTurnId !== request.turnId) throw new Error('Task turn changed. Refresh the preview.');
  if (request.action === 'stop') {
    if (!request.turnId || controls.activeTurnId !== request.turnId) throw new Error('Task turn changed. Refresh the preview.');
    revokeForegroundTurn(request.conversationId);
    await stopSessionTurn(session.id, request.turnId, request.conversationId);
  } else if (request.action === 'pause') {
    await setSessionAutomation(session.id, 'off', request.conversationId);
  } else if (request.action === 'resume') {
    const policy = goalSwitchFor(request.conversationId);
    if (policy.enabled || !policy.own) throw new Error('No paused follow-ups belong to this conversation.');
    await setSessionAutomation(session.id, policy.mode, request.conversationId);
  } else if (request.action === 'foreground') {
    if (!request.turnId || controls.activeTurnId !== request.turnId) throw new Error('Task turn changed. Refresh the preview.');
    const starts = await readRecentEvents(session.id, 8, { kinds: ['turn_start'], maxBytes: 12000 });
    const start = [...starts].reverse().find(row => row.turnId === request.turnId);
    if (!start) throw new Error('This turn has no recorded start to authorize safely.');
    const latest = await getSession(session.id);
    if (latest?.conversationId !== request.conversationId || latest.activeTurnId !== request.turnId) throw new Error('Task turn changed. Refresh the preview.');
    grantForegroundTurn(session.id, request.conversationId, request.turnId, start.time);
  } else {
    const entry = (await listInputs()).find(row => row.id === request.inputId);
    if (!entry || entry.sessionId !== session.id || (entry.conversationId && entry.conversationId !== request.conversationId)) throw new Error('Queued input does not belong to this task.');
    if (!await retryQueuedInputBrowser(entry.id, { sessionId: session.id, conversationId: request.conversationId })) throw new Error('This send is not proven safe to retry. Check the linked conversation first.');
  }
  invalidated = true;
  return getAmbientWork();
}

/** Renderer supplies an evidence address, never a path. Current approved roots remain the authority. */
export async function resolveAmbientOutput(input: { sessionId: string; eventSeq: number; outputIndex: number }): Promise<string> {
  const [event] = await readEvents(input.sessionId, { from: input.eventSeq, limit: 1 });
  if (event?.seq !== input.eventSeq || event.kind !== 'tool_call' || normalizedToolOutcome(event.call) !== 'ok' ||
      !['create', 'edit'].includes(event.call.summary.kind)) throw new Error('Output evidence no longer exists.');
  const change = event.call.changes?.[input.outputIndex];
  if (!change) throw new Error('This output is unavailable.');
  const resolved = await resolvePath(getConfig().roots, change.path);
  return resolved.real;
}
