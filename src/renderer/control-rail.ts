import type { InputEntry } from '../main/session/input.js';
import type { LocalProject } from '../shared/projects.js';
import type {
  AgentInfo,
  SessionEvent,
  SessionSummary,
  SwarmState,
  TokenPressure,
  ToolOutcome
} from '../shared/session.js';
import { normalizedToolOutcome } from '../shared/session.js';
import { browserExtensionRequired, type AppState } from '../shared/types.js';

export type ControlRailRunState = 'RUNNING' | 'IDLE' | 'BLOCKED' | 'WAITING' | 'COMPLETE';

export interface ControlRailOutput {
  id: string;
  title: string;
  path?: string;
  type: string;
  time: number;
  worker?: string;
  status: 'created' | 'modified' | 'generated' | 'failed';
}

export interface ControlRailAgent {
  id: string;
  label: string;
  role: 'prime' | 'worker';
  model: string | null;
  reasoningEffort: string | null;
  state: AgentInfo['state'] | 'idle';
  task: string;
  lastAction?: string;
  createdAt: number;
  activatedAt: number | null;
  finishedAt: number | null;
  contextTokens: number;
  sessionId?: string;
  updatedAt: number;
}

export interface ControlRailActivity {
  id: string;
  title: string;
  detail?: string;
  metric?: string;
  kind: string;
  tone: 'neutral' | 'good' | 'bad' | 'warn';
  time: number;
  worker?: string;
  durationMs?: number;
  outcome?: ToolOutcome | null;
  count?: number;
}

export interface ControlRailFile {
  id: string;
  name: string;
  path: string;
  indicator: 'created' | 'changed' | 'read';
  worker?: string;
  time: number;
}

export interface ControlRailIssue {
  id: string;
  title: string;
  explanation: string;
  affected?: string;
  time: number;
  action?: 'setup' | 'activity';
}

export interface ControlRailQueueItem {
  id: string;
  order: number;
  type: string;
  preview: string;
  target: string;
  status: string;
  time: number;
}

export interface ControlRailFact {
  id: string;
  label: string;
  value: string;
}

export interface ControlRailSource {
  id: string;
  label: string;
  detail: string;
}

export interface ControlRailBrowser {
  facts: ControlRailFact[];
  actions: Array<'open-chat' | 'refresh-models' | 'setup' | 'activity'>;
}

export interface ControlRailSnapshot {
  scopeId: string;
  runState: ControlRailRunState;
  transport: string;
  conversation: string;
  facts: ControlRailFact[];
  outputs: ControlRailOutput[];
  agents: ControlRailAgent[];
  activity: ControlRailActivity[];
  files: ControlRailFile[];
  browser: ControlRailBrowser;
  queue: ControlRailQueueItem[];
  sources: ControlRailSource[];
  issues: ControlRailIssue[];
}

export interface ControlRailProjectionInput {
  state: AppState | null;
  session: SessionSummary | null;
  workerSessions: SessionSummary[];
  events: SessionEvent[];
  swarm: SwarmState | null;
  queue: InputEntry[];
  project: LocalProject | null;
  pressure: TokenPressure | null;
  working: boolean;
  blocked: boolean;
  currentModel: { model: string | null; reasoningEffort: string | null } | null;
  modelCatalog: { state: 'unknown' | 'pending' | 'ready' | 'unavailable'; observedAt: number | null; count: number; error?: string };
  now?: number;
}

const ACTIVE_AGENT_STATES = new Set<AgentInfo['state']>(['invited', 'active', 'detached', 'waking']);
const TERMINAL_INPUT_STATES = new Set<InputEntry['state']>(['sent', 'cancelled', 'failed']);

function clip(text: string, max = 110): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
}

function basename(path: string): string {
  const parts = path.replaceAll('\\', '/').split('/').filter(Boolean);
  return parts.at(-1) ?? path;
}

function outputType(path: string): string {
  const name = path.toLowerCase();
  if (/\.(png|jpe?g|webp|gif|svg)$/.test(name)) return 'Image';
  if (name.endsWith('.pdf')) return 'PDF';
  if (name.endsWith('.zip')) return 'ZIP';
  if (/\.(html?|css|js|mjs|cjs|ts|tsx|jsx)$/.test(name)) return 'Code';
  return 'File';
}

function workerName(id: string | undefined, agents: ControlRailAgent[]): string | undefined {
  if (!id) return undefined;
  return agents.find(agent => agent.id === id)?.label ?? id;
}

function exactSessionModel(session: SessionSummary | null): { model: string; reasoningEffort: string | null } | null {
  const selected = session?.selectedModel;
  if (!selected || selected.conversationId !== session?.conversationId) return null;
  return { model: selected.model, reasoningEffort: selected.reasoningEffort ?? null };
}

function latestAgentAction(agent: AgentInfo, session: SessionSummary | undefined, now: number): string | undefined {
  if (agent.result && (agent.state === 'sleeping' || agent.state === 'finished')) return 'Finish report recorded';
  if (session?.lastToolCallAt) return `Tool activity ${relativeTime(session.lastToolCallAt, now)}`;
  if (agent.state === 'waking') return 'Wake accepted';
  if (agent.state === 'detached') return 'Browser view detached';
  if (agent.state === 'sleeping') return 'Waiting for more work';
  if (agent.state === 'failed') return 'Worker failed';
  return undefined;
}

function projectAgents(input: ControlRailProjectionInput, now: number): ControlRailAgent[] {
  const selectedIsWorker = input.session?.origin?.kind === 'worker';
  const exactPrimeModel = selectedIsWorker ? null : exactSessionModel(input.session);
  const brokerAgents = input.swarm?.agents ?? [];
  const projected = brokerAgents.map((agent): ControlRailAgent => {
    const workerSession = agent.role === 'worker'
      ? input.workerSessions.find(session => session.origin?.kind === 'worker' && session.origin.agentId === agent.id)
      : input.session ?? undefined;
    const model = agent.role === 'prime' ? exactPrimeModel?.model ?? null : agent.model;
    const effort = agent.role === 'prime' ? exactPrimeModel?.reasoningEffort ?? null : agent.reasoningEffort;
    return {
      id: agent.id,
      label: agent.label || agent.id,
      role: agent.role,
      model,
      reasoningEffort: effort,
      state: agent.state,
      task: agent.task,
      lastAction: latestAgentAction(agent, workerSession, now),
      createdAt: agent.createdAt,
      activatedAt: agent.activatedAt,
      finishedAt: agent.finishedAt,
      contextTokens: agent.contextTokens,
      sessionId: workerSession?.id ?? (agent.role === 'prime' && !selectedIsWorker ? input.session?.id : undefined),
      updatedAt: Math.max(workerSession?.updatedAt ?? 0, agent.lastSeenAt ?? 0, agent.finishedAt ?? 0, agent.sleptAt ?? 0, agent.createdAt)
    };
  });
  if (projected.length === 0 && input.session) {
    const role = input.session.origin?.kind === 'worker' ? 'worker' : 'prime';
    const id = role === 'worker' ? input.session.origin?.agentId ?? 'worker' : 'prime';
    const observed = exactSessionModel(input.session);
    projected.push({
      id, label: role === 'worker' ? id : 'Prime', role, model: observed?.model ?? null,
      reasoningEffort: observed?.reasoningEffort ?? null,
      state: input.working ? 'active' : 'idle', task: input.working ? 'Working in this conversation' : 'Current conversation',
      lastAction: input.session.lastToolCallAt ? `Tool activity ${relativeTime(input.session.lastToolCallAt, now)}` : undefined,
      createdAt: input.session.startedAt, activatedAt: input.session.startedAt, finishedAt: input.session.endedAt,
      contextTokens: input.session.contextTokens, sessionId: input.session.id, updatedAt: input.session.updatedAt
    });
  }
  return projected;
}

function projectOutputs(events: SessionEvent[], agents: ControlRailAgent[]): ControlRailOutput[] {
  const latest = new Map<string, ControlRailOutput>();
  for (const event of events) {
    if (event.kind !== 'tool_call') continue;
    const outcome = normalizedToolOutcome(event.call);
    const status = event.call.summary.kind === 'create' ? 'created' : 'modified';
    if (event.call.summary.kind === 'create' || event.call.summary.kind === 'edit') {
      for (const change of event.call.changes ?? []) {
        latest.set(`file:${change.path}`, {
          id: `file:${change.path}`,
          title: basename(change.path), path: change.path, type: outputType(change.path), time: event.time,
          worker: workerName(event.agent, agents), status: outcome && outcome !== 'ok' ? 'failed' : status
        });
      }
    }
    if (event.call.summary.kind === 'screen') {
      for (const asset of event.call.assets ?? []) {
        if (!asset.mimeType.startsWith('image/')) continue;
        latest.set(`asset:${asset.id}`, {
          id: `asset:${asset.id}`, title: `Screenshot ${asset.id.slice(0, 8)}`, type: asset.mimeType,
          time: event.time, worker: workerName(event.agent, agents), status: outcome && outcome !== 'ok' ? 'failed' : 'generated'
        });
      }
    }
  }
  return [...latest.values()].sort((a, b) => b.time - a.time).slice(0, 40);
}

function projectFiles(events: SessionEvent[], outputs: ControlRailOutput[], agents: ControlRailAgent[]): ControlRailFile[] {
  const files = new Map<string, ControlRailFile>();
  for (const output of outputs.filter((item): item is ControlRailOutput & { path: string } => !!item.path && item.status !== 'failed')) {
    files.set(output.path, {
      id: output.path, name: output.title, path: output.path,
      indicator: output.status === 'created' ? 'created' : 'changed', worker: output.worker, time: output.time
    });
  }
  for (const event of events) {
    if (event.kind !== 'tool_call' || event.call.tool !== 'read' || normalizedToolOutcome(event.call) !== 'ok') continue;
    try {
      const args = JSON.parse(event.call.args.text) as { paths?: unknown };
      if (!Array.isArray(args.paths)) continue;
      for (const candidate of args.paths) {
        if (typeof candidate !== 'string' || !candidate.trim()) continue;
        const existing = files.get(candidate);
        if (existing && existing.time >= event.time) continue;
        files.set(candidate, { id: candidate, name: basename(candidate), path: candidate, indicator: existing?.indicator ?? 'read', worker: workerName(event.agent, agents), time: event.time });
      }
    } catch { /* Recorded redacted args may be truncated; omit instead of guessing. */ }
  }
  return [...files.values()].sort((a, b) => b.time - a.time).slice(0, 50);
}

function projectActivity(events: SessionEvent[], agents: ControlRailAgent[]): ControlRailActivity[] {
  const rows: ControlRailActivity[] = [];
  for (const event of events) {
    if (event.kind === 'tool_call') {
      const outcome = normalizedToolOutcome(event.call);
      rows.push({
        id: `tool:${event.seq}`, title: event.call.summary.title, detail: event.call.summary.detail,
        metric: event.call.summary.metric, kind: event.call.summary.kind,
        tone: outcome && outcome !== 'ok' ? 'bad' : event.call.summary.tone,
        time: event.time, worker: workerName(event.agent, agents), durationMs: event.call.durationMs, outcome
      });
    } else if (event.kind === 'page_tool') {
      rows.push({ id: `page:${event.seq}`, title: event.label, kind: 'browse', tone: 'neutral', time: event.time, worker: workerName(event.agent, agents) });
    } else if (event.kind === 'agent_message') {
      rows.push({ id: `agent:${event.messageId}:${event.delivery}`, title: `${event.from} → ${event.to}`, detail: clip(event.message.text), kind: 'agent', tone: 'neutral', time: event.time, worker: workerName(event.agent, agents) });
    } else if (event.kind === 'chat_error') {
      rows.push({ id: `error:${event.seq}`, title: 'Chat error', detail: clip(event.message.text), kind: 'error', tone: 'bad', time: event.time, worker: workerName(event.agent, agents) });
    } else if (event.kind === 'progress' && event.source === 'app' && event.progressId?.startsWith('browser-repair:')) {
      rows.push({ id: `recovery:${event.progressId}`, title: 'Browser recovery', detail: clip(event.message.text), kind: 'browse', tone: 'warn', time: event.time, worker: workerName(event.agent, agents) });
    }
  }
  const newest = rows.sort((a, b) => b.time - a.time).slice(0, 60);
  const compressed: ControlRailActivity[] = [];
  for (const row of newest) {
    const previous = compressed.at(-1);
    if (previous && previous.title === row.title && previous.kind === row.kind && previous.worker === row.worker && Math.abs(previous.time - row.time) <= 5000) {
      previous.count = (previous.count ?? 1) + 1;
      continue;
    }
    compressed.push({ ...row });
  }
  return compressed.slice(0, 36);
}

function projectQueue(input: ControlRailProjectionInput): ControlRailQueueItem[] {
  const selectedId = input.session?.id ?? null;
  return input.queue
    .filter(entry => !TERMINAL_INPUT_STATES.has(entry.state) && (selectedId ? (entry.sessionId ?? entry.deliveredSessionId) === selectedId : !entry.sessionId && !entry.deliveredSessionId))
    .sort((a, b) => (a.queueOrder ?? a.dueAt) - (b.queueOrder ?? b.dueAt) || a.createdAt - b.createdAt)
    .map((entry, index) => ({
      id: entry.id, order: index + 1,
      type: entry.mode === 'finish' ? 'Finish checkpoint' : entry.mode === 'after-turn' ? 'After turn' : 'Inject / send',
      preview: clip(entry.text, 100), target: entry.sessionId ? 'Current chat' : input.project?.name ?? 'New chat',
      status: entry.state, time: entry.createdAt
    }));
}

function projectSources(input: ControlRailProjectionInput): ControlRailSource[] {
  const rows: ControlRailSource[] = [];
  if (input.project) {
    rows.push({ id: 'project', label: 'Current project', detail: input.project.name });
    rows.push({ id: 'project-files', label: 'Project files', detail: 'Available through the existing project file browser' });
  }
  if (input.state?.config?.roots?.length) rows.push({ id: 'roots', label: 'Approved workspace', detail: input.state.config.roots.map(root => `/${root.name}`).join(', ') });
  if (input.session) rows.push({ id: 'history', label: 'Session history', detail: `${input.session.events} recorded events` });
  if (input.state?.config?.sessions?.record) rows.push({
    id: 'recording', label: 'Browser recording',
    detail: !input.state.bridge ? 'Recording enabled · browser status unknown'
      : input.state.bridge.present ? 'Live browser observations available' : 'Recording enabled · browser not live'
  });
  const attachments = new Set<string>();
  for (const event of input.events) if (event.kind === 'user_message') for (const file of event.attachments ?? []) attachments.add(file.name);
  if (attachments.size) rows.push({ id: 'attachments', label: 'Attached files', detail: `${attachments.size} in the loaded session window` });
  const selected = exactSessionModel(input.session);
  if (selected) rows.push({ id: 'model', label: 'Recorded model evidence', detail: `${selected.model}${selected.reasoningEffort ? ` · ${selected.reasoningEffort}` : ''}` });
  rows.push({ id: 'catalog', label: 'Account model catalog', detail: input.modelCatalog.state === 'ready' ? `${input.modelCatalog.count} account-observed choices` : input.modelCatalog.state });
  return rows;
}

function projectBrowser(input: ControlRailProjectionInput, now: number): ControlRailBrowser {
  const state = input.state;
  if (!state?.bridge) return { facts: [], actions: [] };
  const selected = exactSessionModel(input.session);
  const recovery = [...input.events].reverse().find(event => event.kind === 'progress' && event.source === 'app' && event.progressId?.startsWith('browser-repair:'));
  const lastBrowser = [...input.events].reverse().find(event => event.kind === 'page_tool' || (event.kind === 'tool_call' && ['browse', 'screen'].includes(event.call.summary.kind)));
  const facts: ControlRailFact[] = [
    { id: 'presence', label: 'ChatGPT browser', value: state.bridge.present ? 'Connected' : state.bridge.paired ? 'Authorized · offline' : 'Not connected' },
    { id: 'extension', label: 'Extension', value: state.bridge.extensionVersion ? `v${state.bridge.extensionVersion}` : state.bridge.paired ? 'Authorized' : 'Not paired' },
    { id: 'mode', label: 'Browser-only mode', value: state.config?.ui?.browserOnly === true ? 'On' : 'Off' }
  ];
  if (input.session?.conversationId) facts.push({ id: 'chat', label: 'Linked conversation', value: input.session.conversationId });
  if (selected) facts.push({ id: 'model', label: 'Recorded picker model', value: `${selected.model}${selected.reasoningEffort ? ` · ${selected.reasoningEffort}` : ''}` });
  const catalog = input.modelCatalog;
  facts.push({
    id: 'catalog',
    label: 'Model catalog',
    value: catalog.state === 'ready'
      ? `${catalog.count} choices · ${catalog.observedAt ? relativeTime(catalog.observedAt, now) : 'observed'}`
      : catalog.state === 'pending' ? 'Refreshing…' : catalog.error ? clip(catalog.error, 70) : catalog.state
  });
  if (recovery && now - recovery.time <= 120000 && recovery.kind === 'progress') facts.push({ id: 'recovery', label: 'Recovery', value: clip(recovery.message.text, 80) });
  if (lastBrowser) {
    const title = lastBrowser.kind === 'page_tool'
      ? lastBrowser.label
      : lastBrowser.kind === 'tool_call'
        ? lastBrowser.call.summary.title
        : 'Browser activity';
    facts.push({ id: 'last-action', label: 'Recent browser action', value: `${clip(title, 70)} · ${relativeTime(lastBrowser.time, now)}` });
  }
  const actions: ControlRailBrowser['actions'] = ['refresh-models', 'setup', 'activity'];
  if (input.session?.conversationId) actions.unshift('open-chat');
  return { facts, actions };
}

function projectIssues(input: ControlRailProjectionInput, agents: ControlRailAgent[], now: number): ControlRailIssue[] {
  const issues: ControlRailIssue[] = [];
  if (input.blocked) issues.push({ id: 'blocked', title: 'Chat blocked', explanation: 'This conversation is currently blocked from app-authored delivery.', affected: input.session?.title ?? 'Current chat', time: now, action: 'activity' });
  const state = input.state;
  if (state?.bridge && state.config?.sessions && state.config?.multiAgent && browserExtensionRequired(state.config) && !state.bridge.present) {
    issues.push({ id: 'browser-offline', title: 'Browser disconnected', explanation: state.bridge.paired ? 'The authorized browser extension is not currently present.' : 'Browser-backed features need an authorized extension connection.', affected: 'Browser bridge', time: state.bridge.lastSeenAt ?? now, action: 'setup' });
  }
  for (const agent of agents.filter(agent => agent.state === 'failed')) {
    issues.push({ id: `agent:${agent.id}`, title: `${agent.label} failed`, explanation: agent.lastAction ?? 'The broker records this worker as failed.', affected: agent.label, time: agent.finishedAt ?? agent.updatedAt, action: 'activity' });
  }
  for (const entry of input.queue.filter(entry => entry.state === 'failed' && (!input.session || (entry.sessionId ?? entry.deliveredSessionId) === input.session.id)).slice(-3)) {
    issues.push({ id: `queue:${entry.id}`, title: 'Queued input failed', explanation: entry.error ?? 'The durable input queue records this delivery as failed.', affected: input.session?.title ?? 'Current chat', time: entry.createdAt, action: 'activity' });
  }
  const latestByTool = new Map<string, SessionEvent & { kind: 'tool_call' }>();
  for (const event of input.events) {
    if (event.kind !== 'tool_call') continue;
    latestByTool.set(`${event.call.tool}\u0000${event.call.summary.title}`, event);
  }
  for (const event of [...latestByTool.values()].sort((a, b) => b.time - a.time)) {
    const outcome = normalizedToolOutcome(event.call);
    if (!outcome || outcome === 'ok') continue;
    issues.push({
      id: `tool:${event.call.tool}:${event.call.summary.title}`,
      title: event.call.summary.title,
      explanation: event.call.summary.detail
        ? `${event.call.summary.detail} · ${outcome.replaceAll('_', ' ')}`
        : `Latest matching recorded ${event.call.tool} call ended as ${outcome.replaceAll('_', ' ')}.`,
      affected: workerName(event.agent, agents) ?? input.session?.title ?? 'Current chat',
      time: event.time,
      action: 'activity'
    });
  }
  return issues.sort((a, b) => b.time - a.time).slice(0, 8);
}

export function relativeTime(time: number | null | undefined, now = Date.now()): string {
  if (!time) return 'unknown';
  const seconds = Math.max(0, Math.round((now - time) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function projectControlRail(input: ControlRailProjectionInput): ControlRailSnapshot {
  const now = input.now ?? Date.now();
  const agents = projectAgents(input, now);
  const outputs = projectOutputs(input.events, agents);
  const queue = projectQueue(input);
  const activeWorkers = agents.filter(agent => agent.role === 'worker' && ACTIVE_AGENT_STATES.has(agent.state as AgentInfo['state'])).length;
  const exactModel = exactSessionModel(input.session);
  const composerModel = input.currentModel?.model ? `${input.currentModel.model}${input.currentModel.reasoningEffort ? ` · ${input.currentModel.reasoningEffort}` : ''}` : null;
  const currentModel = exactModel ? `${exactModel.model}${exactModel.reasoningEffort ? ` · ${exactModel.reasoningEffort}` : ''}` : composerModel ?? (input.currentModel ? 'Current browser model' : 'Unknown');
  const failedAgent = agents.some(agent => agent.state === 'failed');
  const runState: ControlRailRunState = input.blocked || failedAgent ? 'BLOCKED'
    : input.working || activeWorkers > 0 ? 'RUNNING'
      : queue.length > 0 ? 'WAITING'
        : input.session?.endedAt ? 'COMPLETE' : 'IDLE';
  const facts: ControlRailFact[] = [
    { id: 'workers', label: 'Active workers', value: String(activeWorkers) },
    { id: 'queue', label: 'Queued inputs', value: String(queue.length) },
    { id: 'model', label: 'Current model', value: currentModel },
    { id: 'browser', label: 'Browser', value: !input.state?.bridge ? 'Unknown' : input.state.bridge.present ? 'Connected' : 'Offline' }
  ];
  if (input.pressure) facts.push({ id: 'context', label: 'Context pressure', value: `${input.pressure.level} · ~${Math.round(input.pressure.estimated / 1000)}k local tokens` });
  else if (input.session) facts.push({ id: 'context', label: 'Context', value: `~${Math.round(input.session.contextTokens / 1000)}k local tokens` });
  if (input.project) facts.push({ id: 'project', label: 'Project', value: input.project.name });
  const snapshot: ControlRailSnapshot = {
    scopeId: input.session?.id ?? (input.project ? `project:${input.project.id}` : 'new'),
    runState,
    transport: input.state?.status?.state ?? 'unknown',
    conversation: input.session?.title || (input.project ? `New chat · ${input.project.name}` : 'New chat'),
    facts,
    outputs,
    agents,
    activity: projectActivity(input.events, agents),
    files: projectFiles(input.events, outputs, agents),
    browser: projectBrowser(input, now),
    queue,
    sources: projectSources(input),
    issues: []
  };
  snapshot.issues = projectIssues(input, agents, now);
  return snapshot;
}

type SectionId = 'outputs' | 'agents' | 'activity' | 'files' | 'browser' | 'queue' | 'sources' | 'issues';

export interface ControlRailOptions {
  host: HTMLElement;
  toggle: HTMLButtonElement;
  loadWorker: (id: string) => Promise<{ events: SessionEvent[] } | null>;
  renderWorker: (events: SessionEvent[], id: string, current: () => boolean) => HTMLElement[];
  openMain: (id: string) => void;
  copyPath: (path: string) => Promise<boolean | null>;
  actions: {
    newTask: () => void;
    commands: () => void;
    projectFiles: () => void;
    activity: () => void;
    openChat: () => void;
    refreshModels: () => void;
    setup: () => void;
  };
}

function makeIcon(id: string): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('class', 'ico'); svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use'); use.setAttribute('href', `#${id}`); svg.append(use); return svg;
}

function button(label: string, iconId?: string): HTMLButtonElement {
  const node = document.createElement('button'); node.type = 'button'; node.className = 'control-rail-action';
  if (iconId) node.append(makeIcon(iconId)); node.append(document.createTextNode(label)); return node;
}

function metadata(parts: Array<string | undefined | null>): string {
  return parts.filter(Boolean).join(' · ');
}

function stateTone(state: string): string {
  if (['failed', 'BLOCKED'].includes(state)) return 'bad';
  if (['active', 'waking', 'invited', 'RUNNING'].includes(state)) return 'live';
  if (['sleeping', 'WAITING', 'detached'].includes(state)) return 'wait';
  return 'quiet';
}

function section(rail: HTMLElement, id: SectionId, title: string, open: boolean): { details: HTMLDetailsElement; body: HTMLElement; count: HTMLElement } {
  const details = document.createElement('details'); details.className = 'control-rail-section'; details.dataset.section = id; details.open = open;
  const summary = document.createElement('summary');
  summary.append(makeIcon('i-chev'), document.createTextNode(title));
  const count = document.createElement('span'); count.className = 'control-rail-count'; summary.append(count);
  const body = document.createElement('div'); body.className = 'control-rail-section-body';
  details.append(summary, body); rail.append(details); return { details, body, count };
}

function setEmpty(body: HTMLElement, text: string): void {
  let empty = body.querySelector<HTMLElement>(':scope > .control-rail-empty');
  if (!empty) { empty = document.createElement('p'); empty.className = 'control-rail-empty'; body.append(empty); }
  empty.textContent = text;
}

function reconcile<T extends { id: string }>(body: HTMLElement, items: T[], create: (item: T) => HTMLElement, update: (row: HTMLElement, item: T) => void): void {
  const existing = new Map([...body.querySelectorAll<HTMLElement>(':scope > [data-rail-key]')].map(node => [node.dataset.railKey!, node]));
  const nodes = items.map(item => {
    let row = existing.get(item.id);
    if (!row) { row = create(item); row.dataset.railKey = item.id; }
    update(row, item); existing.delete(item.id); return row;
  });
  for (const row of existing.values()) row.remove();
  const empty = body.querySelector(':scope > .control-rail-empty');
  if (empty) empty.remove();
  for (let index = 0; index < nodes.length; index += 1) {
    const wanted = nodes[index]!; const current = body.children[index];
    if (current !== wanted) body.insertBefore(wanted, current ?? null);
  }
}

function rowShell(className = ''): HTMLElement {
  const row = document.createElement('div'); row.className = `control-rail-row ${className}`.trim();
  row.append(document.createElement('div')); return row;
}

function updateStandardRow(row: HTMLElement, title: string, meta: string, detail = '', iconId = 'i-pulse', tone = 'quiet'): void {
  const signature = JSON.stringify([title, meta, detail, iconId, tone]);
  if (row.dataset.signature === signature) return;
  row.dataset.signature = signature;
  row.dataset.tone = tone;
  const glyph = document.createElement('span'); glyph.className = 'control-rail-glyph'; glyph.append(makeIcon(iconId));
  const body = document.createElement('div'); body.className = 'control-rail-row-copy';
  const strong = document.createElement('strong'); strong.textContent = title; body.append(strong);
  if (meta) { const small = document.createElement('small'); small.textContent = meta; body.append(small); }
  if (detail) { const p = document.createElement('p'); p.textContent = detail; body.append(p); }
  row.replaceChildren(glyph, body);
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(ms < 10000 ? 1 : 0)}s`;
  return `${Math.floor(ms / 60000)}m`;
}

export function createControlRail(options: ControlRailOptions) {
  const rail = document.createElement('aside'); rail.id = 'controlRail'; rail.className = 'control-rail'; rail.hidden = true; rail.setAttribute('aria-label', 'OVERDRIVE Control Rail');
  const resize = document.createElement('div'); resize.className = 'control-rail-resize'; resize.setAttribute('role', 'separator'); resize.setAttribute('aria-orientation', 'vertical'); resize.setAttribute('aria-label', 'Control Rail width'); resize.tabIndex = 0;
  const header = document.createElement('header'); header.className = 'control-rail-header';
  const brand = document.createElement('div'); brand.className = 'control-rail-brand'; brand.append(document.createElement('strong'), document.createElement('span'));
  brand.querySelector('strong')!.textContent = 'MALACHI OVERDRIVE'; brand.querySelector('span')!.textContent = 'CONTROL RAIL';
  const close = button('', 'i-x'); close.className = 'control-rail-close'; close.setAttribute('aria-label', 'Close Control Rail'); close.title = 'Close'; header.append(brand, close);
  const live = document.createElement('div'); live.className = 'control-rail-live';
  const run = document.createElement('strong'); run.className = 'control-rail-run';
  const transport = document.createElement('span'); transport.className = 'control-rail-transport';
  const conversation = document.createElement('span'); conversation.className = 'control-rail-conversation'; live.append(run, transport, conversation);
  const facts = document.createElement('div'); facts.className = 'control-rail-facts';
  const quick = document.createElement('div'); quick.className = 'control-rail-quick'; quick.setAttribute('aria-label', 'Control Rail quick actions');
  const quickButtons = [
    ['New task', 'i-plus', options.actions.newTask], ['Commands', 'i-terminal', options.actions.commands],
    ['Sub-agents', 'i-bolt', () => focusSection('agents')], ['Project files', 'i-folder', options.actions.projectFiles], ['Activity', 'i-pulse', options.actions.activity]
  ] as const;
  for (const [label, iconId, action] of quickButtons) { const node = button(label, iconId); node.addEventListener('click', action); quick.append(node); }
  const scroller = document.createElement('div'); scroller.className = 'control-rail-scroll';
  const sections = {
    outputs: section(scroller, 'outputs', 'OUTPUTS', true), agents: section(scroller, 'agents', 'AGENTS', true),
    activity: section(scroller, 'activity', 'ACTIVITY', true), files: section(scroller, 'files', 'FILES', false),
    browser: section(scroller, 'browser', 'BROWSER', false), queue: section(scroller, 'queue', 'QUEUE', false),
    sources: section(scroller, 'sources', 'SOURCES / CONTEXT', false), issues: section(scroller, 'issues', 'ISSUES', true)
  };
  const inspector = document.createElement('div'); inspector.className = 'control-rail-inspector'; inspector.hidden = true;
  const inspectorHead = document.createElement('div'); inspectorHead.className = 'control-rail-inspector-head';
  const back = button('Back', 'i-chev'); const inspectorTitle = document.createElement('strong'); const openFull = button('Open full chat', 'i-out');
  inspectorHead.append(back, inspectorTitle, openFull); const inspectorBody = document.createElement('div'); inspectorBody.className = 'control-rail-inspector-body'; inspector.append(inspectorHead, inspectorBody);
  const scrim = document.createElement('div'); scrim.className = 'control-rail-scrim'; scrim.hidden = true;
  const ambient = document.createElement('aside'); ambient.className = 'ambient-edge'; ambient.setAttribute('aria-label', 'Background work');
  const ambientMain = document.createElement('button'); ambientMain.type = 'button'; ambientMain.className = 'ambient-edge-main'; ambientMain.setAttribute('aria-expanded', 'false');
  const ambientRing = document.createElement('span'); ambientRing.className = 'ambient-edge-ring'; ambientRing.append(makeIcon('i-bolt'));
  const ambientState = document.createElement('span'); ambientState.className = 'ambient-edge-state';
  const ambientTime = document.createElement('span'); ambientTime.className = 'ambient-edge-time';
  ambientMain.append(ambientRing, ambientState, ambientTime);
  const ambientNew = button('', 'i-plus'); ambientNew.className = 'ambient-edge-new'; ambientNew.setAttribute('aria-label', 'Start a new task'); ambientNew.title = 'New task'; ambientNew.addEventListener('click', options.actions.newTask);
  ambient.append(ambientMain, ambientNew);

  const peek = document.createElement('section'); peek.id = 'ambientEdgePeek'; peek.className = 'ambient-peek'; peek.hidden = true; peek.setAttribute('aria-label', 'Background work preview');
  const peekHead = document.createElement('header'); peekHead.className = 'ambient-peek-head';
  const peekHeading = document.createElement('div'); peekHeading.append(document.createElement('strong'), document.createElement('span'));
  peekHeading.querySelector('strong')!.textContent = 'WORKING IN BACKGROUND'; peekHeading.querySelector('span')!.textContent = 'The page stays yours while MALACHI works.';
  const peekClose = button('', 'i-x'); peekClose.className = 'ambient-peek-close'; peekClose.setAttribute('aria-label', 'Close background preview'); peekHead.append(peekHeading, peekClose);
  const peekPreview = document.createElement('div'); peekPreview.className = 'ambient-peek-preview';
  const peekGlyph = document.createElement('span'); peekGlyph.className = 'ambient-peek-glyph'; peekGlyph.append(makeIcon('i-pulse'));
  const peekCopy = document.createElement('div'); const peekTitle = document.createElement('strong'); const peekAction = document.createElement('span'); peekCopy.append(peekTitle, peekAction); peekPreview.append(peekGlyph, peekCopy);
  const peekFacts = document.createElement('div'); peekFacts.className = 'ambient-peek-facts';
  const peekWorkers = document.createElement('span'); const peekOutputs = document.createElement('span'); peekFacts.append(peekWorkers, peekOutputs);
  const peekActions = document.createElement('div'); peekActions.className = 'ambient-peek-actions';
  const keepBackground = button('Keep in background', 'i-eye'); keepBackground.classList.add('ambient-peek-quiet');
  const openWorkbench = button('Open workbench', 'i-out'); openWorkbench.classList.add('ambient-peek-primary'); peekActions.append(keepBackground, openWorkbench);
  peek.append(peekHead, peekPreview, peekFacts, peekActions);

  const completion = document.createElement('aside'); completion.className = 'ambient-complete'; completion.hidden = true; completion.setAttribute('role', 'status'); completion.setAttribute('aria-live', 'polite');
  const completionIcon = document.createElement('span'); completionIcon.className = 'ambient-complete-icon'; completionIcon.append(makeIcon('i-bolt'));
  const completionCopy = document.createElement('div'); const completionTitle = document.createElement('strong'); completionTitle.textContent = 'Work complete'; const completionDetail = document.createElement('span'); completionCopy.append(completionTitle, completionDetail);
  const completionClose = button('', 'i-x'); completionClose.className = 'ambient-complete-close'; completionClose.setAttribute('aria-label', 'Dismiss completion'); completion.append(completionIcon, completionCopy, completionClose);

  rail.append(resize, header, live, facts, quick, scroller, inspector); options.host.append(scrim, rail, peek, ambient, completion);
  ambientMain.setAttribute('aria-controls', peek.id);

  let snapshot: ControlRailSnapshot | null = null;
  let selectedWorker: string | null = null;
  let parentKey = '';
  let loadGeneration = 0;
  let previousRunState: ControlRailRunState | null = null;
  let completionTimer: ReturnType<typeof setTimeout> | null = null;
  const seenWorkers = new Map<string, number>();
  const workerUpdates = new Map<string, number>();

  function open(): void {
    if (!rail.hidden) return;
    rail.hidden = false; scrim.hidden = false; options.host.classList.add('has-control-rail'); options.toggle.setAttribute('aria-expanded', 'true');
  }
  function hide(restoreFocus = false): void {
    if (rail.hidden) return;
    rail.hidden = true; scrim.hidden = true; options.host.classList.remove('has-control-rail'); options.toggle.setAttribute('aria-expanded', 'false');
    if (restoreFocus) options.toggle.focus();
  }
  function openPeek(): void {
    if (!peek.hidden) return;
    peek.hidden = false; ambientMain.setAttribute('aria-expanded', 'true'); options.host.classList.add('has-ambient-peek');
  }
  function hidePeek(restoreFocus = false): void {
    if (peek.hidden) return;
    peek.hidden = true; ambientMain.setAttribute('aria-expanded', 'false'); options.host.classList.remove('has-ambient-peek');
    if (restoreFocus) ambientMain.focus();
  }
  function showCompletion(detail: string): void {
    completionDetail.textContent = detail; completion.hidden = false;
    if (completionTimer) clearTimeout(completionTimer);
    completionTimer = setTimeout(() => { completion.hidden = true; completionTimer = null; }, 7000);
  }
  function focusSection(id: SectionId): void {
    open(); const target = sections[id].details; target.open = true; target.scrollIntoView({ block: 'nearest' });
  }
  function showDeck(): void { selectedWorker = null; loadGeneration++; inspector.hidden = true; scroller.hidden = false; facts.hidden = false; quick.hidden = false; live.hidden = false; }

  async function openWorker(id: string): Promise<void> {
    const agent = snapshot?.agents.find(row => row.sessionId === id || row.id === id);
    const sessionId = agent?.sessionId ?? id;
    if (!sessionId) return;
    open(); selectedWorker = sessionId; const generation = ++loadGeneration;
    scroller.hidden = true; facts.hidden = true; quick.hidden = true; live.hidden = true; inspector.hidden = false;
    inspectorTitle.textContent = agent?.label ?? 'Worker'; inspectorBody.replaceChildren(); inspectorBody.append(document.createTextNode('Loading recorded worker conversation…'));
    if (agent) seenWorkers.set(agent.id, agent.updatedAt);
    const detail = await options.loadWorker(sessionId);
    if (!detail || generation !== loadGeneration || selectedWorker !== sessionId) return;
    const top = inspectorBody.scrollTop;
    inspectorBody.replaceChildren(...options.renderWorker(detail.events, sessionId, () => generation === loadGeneration && selectedWorker === sessionId)); inspectorBody.scrollTop = top;
  }

  function paintFacts(items: ControlRailFact[]): void {
    reconcile(facts, items, () => { const node = document.createElement('div'); node.className = 'control-rail-fact'; return node; }, (node, item) => {
      const signature = `${item.label}\u0000${item.value}`; if (node.dataset.signature === signature) return; node.dataset.signature = signature;
      const label = document.createElement('span'); label.textContent = item.label; const value = document.createElement('strong'); value.textContent = item.value; node.replaceChildren(label, value);
    });
  }

  function paint(snapshotNow: ControlRailSnapshot): void {
    snapshot = snapshotNow;
    run.textContent = snapshot.runState; run.dataset.tone = stateTone(snapshot.runState);
    transport.textContent = snapshot.transport; conversation.textContent = snapshot.conversation;
    paintFacts(snapshot.facts);

    const active = snapshot.agents.find(agent => ['active', 'waking', 'invited'].includes(agent.state)) ?? snapshot.agents[0];
    const latest = snapshot.activity[0];
    const runtimeFrom = active?.activatedAt ?? active?.createdAt;
    ambient.dataset.tone = stateTone(snapshot.runState);
    ambientMain.setAttribute('aria-label', `${snapshot.runState.toLowerCase()}: ${active?.task || snapshot.conversation}`);
    ambientState.textContent = snapshot.runState === 'RUNNING' ? 'LIVE' : snapshot.runState;
    ambientTime.textContent = runtimeFrom && snapshot.runState === 'RUNNING' ? formatDuration(Math.max(0, Date.now() - runtimeFrom)) : '';
    peekTitle.textContent = active?.task ? clip(active.task, 72) : snapshot.conversation;
    peekAction.textContent = latest ? metadata([latest.title, latest.detail && clip(latest.detail, 84)]) : active?.lastAction ?? (snapshot.runState === 'RUNNING' ? 'Starting the next step…' : 'No active work');
    peekWorkers.textContent = `${snapshot.agents.filter(agent => ['active', 'waking', 'invited'].includes(agent.state)).length} active`;
    peekOutputs.textContent = `${snapshot.outputs.length} output${snapshot.outputs.length === 1 ? '' : 's'}`;
    if (previousRunState && previousRunState !== 'COMPLETE' && snapshot.runState === 'COMPLETE') {
      showCompletion(snapshot.outputs[0]?.title ? `${snapshot.outputs[0].title} is ready.` : `${snapshot.conversation} is ready.`);
    }
    previousRunState = snapshot.runState;

    sections.outputs.count.textContent = String(snapshot.outputs.length);
    reconcile(sections.outputs.body, snapshot.outputs, () => rowShell(), (row, item) => {
      updateStandardRow(row, item.title, metadata([item.status, item.type, item.worker, relativeTime(item.time)]), item.path ?? '', item.type.startsWith('image/') ? 'i-image' : 'i-folder', item.status === 'failed' ? 'bad' : 'quiet');
    });
    if (!snapshot.outputs.length) setEmpty(sections.outputs.body, 'No structured outputs recorded in the loaded session window.');

    sections.agents.count.textContent = String(snapshot.agents.length);
    reconcile(sections.agents.body, snapshot.agents, () => { const row = document.createElement('button'); row.type = 'button'; row.className = 'control-rail-row control-rail-agent'; return row; }, (row, item) => {
      const prior = workerUpdates.get(item.id); if (prior === undefined) { workerUpdates.set(item.id, item.updatedAt); seenWorkers.set(item.id, item.updatedAt); }
      else if (item.updatedAt > prior) workerUpdates.set(item.id, item.updatedAt);
      const unread = item.updatedAt > (seenWorkers.get(item.id) ?? item.updatedAt);
      row.classList.toggle('has-new', unread); row.toggleAttribute('disabled', !item.sessionId || item.role === 'prime');
      const runtimeFrom = item.activatedAt ?? item.createdAt; const end = item.finishedAt ?? Date.now();
      const model = item.model ?? (item.role === 'prime' ? 'Model not recorded' : 'Account default');
      const meta = metadata([model, item.reasoningEffort ?? undefined, item.state, runtimeFrom ? formatDuration(Math.max(0, end - runtimeFrom)) : undefined, item.contextTokens ? `~${Math.round(item.contextTokens / 1000)}k ctx` : undefined]);
      updateStandardRow(row, item.label, meta, metadata([item.task && clip(item.task, 94), item.lastAction, unread ? 'New activity' : undefined]), 'i-bolt', stateTone(item.state));
      row.setAttribute('aria-label', item.sessionId && item.role === 'worker' ? `Inspect ${item.label}` : item.label);
      row.onclick = item.sessionId && item.role === 'worker' ? () => void openWorker(item.sessionId!) : null;
    });
    if (!snapshot.agents.length) setEmpty(sections.agents.body, 'No agent state is attached to this conversation.');

    sections.activity.count.textContent = String(snapshot.activity.length);
    reconcile(sections.activity.body, snapshot.activity, () => rowShell(), (row, item) => {
      const extra = metadata([item.worker, relativeTime(item.time), item.durationMs !== undefined ? formatDuration(item.durationMs) : undefined, item.count && item.count > 1 ? `×${item.count}` : undefined]);
      updateStandardRow(row, item.title, metadata([extra, item.metric]), item.detail ?? '', item.kind === 'run' || item.kind === 'process' ? 'i-terminal' : item.kind === 'agent' ? 'i-bolt' : item.kind === 'browse' ? 'i-globe' : item.kind === 'edit' ? 'i-pencil' : item.kind === 'create' ? 'i-plus' : 'i-pulse', item.tone === 'bad' ? 'bad' : item.tone === 'warn' ? 'wait' : 'quiet');
    });
    if (!snapshot.activity.length) setEmpty(sections.activity.body, 'No structured activity is recorded in the loaded session window.');

    sections.files.count.textContent = String(snapshot.files.length);
    reconcile(sections.files.body, snapshot.files, () => rowShell('control-rail-file'), (row, item) => {
      updateStandardRow(row, item.name, metadata([item.indicator, item.worker, relativeTime(item.time)]), item.path, 'i-folder');
      let copy = row.querySelector<HTMLButtonElement>('.control-rail-copy');
      if (!copy) { copy = button('', 'i-copy'); copy.className = 'control-rail-copy'; copy.setAttribute('aria-label', 'Copy path'); copy.title = 'Copy path'; row.append(copy); }
      copy.onclick = async event => { event.stopPropagation(); if (await options.copyPath(item.path)) copy!.title = 'Copied'; };
    });
    if (!snapshot.files.length) setEmpty(sections.files.body, 'No structured file changes are recorded in the loaded session window.');

    sections.browser.count.textContent = snapshot.browser.facts.length ? '' : '0';
    reconcile(sections.browser.body, snapshot.browser.facts, () => rowShell(), (row, item) => updateStandardRow(row, item.label, item.value, '', 'i-globe'));
    let browserActions = sections.browser.body.querySelector<HTMLElement>('.control-rail-inline-actions');
    if (!browserActions) { browserActions = document.createElement('div'); browserActions.className = 'control-rail-inline-actions'; sections.browser.body.append(browserActions); }
    browserActions.replaceChildren(...snapshot.browser.actions.map(action => {
      const map = { 'open-chat': ['Open linked chat', options.actions.openChat], 'refresh-models': ['Refresh models', options.actions.refreshModels], setup: ['Extension / setup', options.actions.setup], activity: ['Diagnostics', options.actions.activity] } as const;
      const [label, fn] = map[action]; const node = button(label); node.addEventListener('click', fn); return node;
    }));

    sections.queue.count.textContent = String(snapshot.queue.length);
    reconcile(sections.queue.body, snapshot.queue, () => rowShell(), (row, item) => updateStandardRow(row, `${item.order}. ${item.type}`, metadata([item.target, item.status, relativeTime(item.time)]), item.preview, 'i-clock', item.status === 'failed' ? 'bad' : 'quiet'));
    if (!snapshot.queue.length) setEmpty(sections.queue.body, 'Nothing is waiting in the current durable input queue.');

    sections.sources.count.textContent = String(snapshot.sources.length);
    reconcile(sections.sources.body, snapshot.sources, () => rowShell(), (row, item) => updateStandardRow(row, item.label, item.detail, '', 'i-eye'));
    if (!snapshot.sources.length) setEmpty(sections.sources.body, 'No additional context sources are exposed for this view.');

    sections.issues.details.hidden = snapshot.issues.length === 0; sections.issues.count.textContent = String(snapshot.issues.length);
    reconcile(sections.issues.body, snapshot.issues, () => rowShell(), (row, item) => {
      updateStandardRow(row, item.title, metadata([item.affected, relativeTime(item.time)]), item.explanation, 'i-ban', 'bad');
      if (item.action) {
        let action = row.querySelector<HTMLButtonElement>('.control-rail-issue-action');
        if (!action) { action = button(item.action === 'setup' ? 'Open setup' : 'Inspect activity'); action.className = 'control-rail-issue-action'; row.append(action); }
        action.onclick = item.action === 'setup' ? options.actions.setup : options.actions.activity;
      }
    });

    const nextParent = snapshot.scopeId;
    if (parentKey && parentKey !== nextParent && selectedWorker) showDeck();
    parentKey = nextParent;
    if (selectedWorker) {
      const worker = snapshot.agents.find(agent => agent.sessionId === selectedWorker);
      if (!worker) showDeck();
      else if (worker.updatedAt > (seenWorkers.get(worker.id) ?? 0)) void openWorker(selectedWorker);
    }
  }

  options.toggle.setAttribute('aria-controls', rail.id); options.toggle.setAttribute('aria-expanded', 'false');
  options.toggle.addEventListener('click', () => rail.hidden ? open() : hide(true)); close.addEventListener('click', () => hide(true)); scrim.addEventListener('click', () => hide(true));
  ambientMain.addEventListener('click', () => peek.hidden ? openPeek() : hidePeek(true)); peekClose.addEventListener('click', () => hidePeek(true)); keepBackground.addEventListener('click', () => hidePeek(true));
  openWorkbench.addEventListener('click', () => { hidePeek(); open(); }); completionClose.addEventListener('click', () => { completion.hidden = true; if (completionTimer) clearTimeout(completionTimer); completionTimer = null; });
  back.addEventListener('click', showDeck); openFull.addEventListener('click', () => { if (!selectedWorker) return; const id = selectedWorker; showDeck(); hide(); options.openMain(id); });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !peek.hidden && rail.hidden && !document.querySelector('dialog[open]')) {
      event.preventDefault(); hidePeek(true); return;
    }
    if (event.key === 'Escape' && !rail.hidden && !document.querySelector('dialog[open]')) {
      event.preventDefault();
      if (selectedWorker) showDeck(); else hide(true);
      return;
    }
    if (event.key.toLowerCase() !== 'o' || !event.shiftKey || !(event.metaKey || event.ctrlKey) || event.altKey) return;
    event.preventDefault(); rail.hidden ? open() : hide(true);
  });
  resize.addEventListener('dblclick', () => options.host.style.removeProperty('--control-rail-width'));
  resize.addEventListener('pointerdown', event => {
    if (matchMedia('(max-width: 1050px)').matches) return;
    event.preventDefault(); const startX = event.clientX; const start = rail.getBoundingClientRect().width;
    const move = (next: PointerEvent) => { options.host.style.setProperty('--control-rail-width', `${Math.max(360, Math.min(460, start + startX - next.clientX))}px`); };
    const stop = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', stop); options.host.classList.remove('is-resizing-control-rail'); };
    options.host.classList.add('is-resizing-control-rail'); window.addEventListener('pointermove', move); window.addEventListener('pointerup', stop, { once: true });
  });

  return { update: paint, open, hide, openPeek, hidePeek, openWorker, focusSection, isOpen: () => !rail.hidden, isPeekOpen: () => !peek.hidden };
}
