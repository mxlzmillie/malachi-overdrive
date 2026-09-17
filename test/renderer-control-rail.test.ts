import { JSDOM } from 'jsdom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createControlRail, projectControlRail, type ControlRailSnapshot } from '../src/renderer/control-rail.js';
import type { InputEntry } from '../src/main/session/input.js';
import type { AppState } from '../src/shared/types.js';
import type { SessionEvent, SessionSummary, SwarmState } from '../src/shared/session.js';

const T0 = Date.UTC(2026, 8, 16, 17, 0, 0);
const text = (value: string) => ({ text: value, truncated: false, chars: value.length });

function session(overrides: Partial<SessionSummary> = {}): SessionSummary {
  return {
    id: '2026-09-16-prime0001', title: 'Release control rail', conversationId: 'chat-prime', chatIds: ['chat-prime'],
    selectedModel: { conversationId: 'chat-prime', model: 'gpt-5.6-sol', reasoningEffort: 'high', observedAt: T0 - 1000 },
    startedAt: T0 - 120_000, updatedAt: T0, endedAt: null, events: 7, userMessages: 1, toolCalls: 4,
    lastToolCallAt: T0 - 1000, processExitNonzero: 0, toolRejected: 0, toolInternalErrors: 0, errors: 0,
    estimatedTokens: 20_000, contextTokens: 8_000, lastHandoffId: null, lastHandoffAt: null,
    lastTurnOutcome: null, activeTurnId: 'turn-1', agents: ['worker-1'], origin: null, ...overrides
  };
}

function tool(
  seq: number,
  toolName: string,
  summary: Extract<SessionEvent, { kind: 'tool_call' }>['call']['summary'],
  options: { outcome?: Extract<SessionEvent, { kind: 'tool_call' }>['call']['outcome']; changes?: Array<{ path: string; added: number; removed: number; approximate: boolean }>; args?: string; agent?: string } = {}
): SessionEvent {
  return {
    seq, time: T0 + seq * 100, source: 'mcp', kind: 'tool_call', ...(options.agent ? { agent: options.agent } : {}),
    call: {
      callId: `call-${seq}`, tool: toolName, attribution: 'request_id', requestId: `req-${seq}`, conversationId: 'chat-prime', attributionMethod: 'request_id',
      args: text(options.args ?? '{}'), result: text('ok'), outcome: options.outcome ?? 'ok', durationMs: 120 + seq,
      summary, ...(options.changes ? { changes: options.changes } : {})
    }
  };
}

function state(present = true): AppState {
  return {
    config: {
      sessions: { record: true }, multiAgent: { enabled: true }, roots: [{ name: 'overdrive', path: '/private/hidden' }], ui: { browserOnly: false }
    },
    status: { state: 'connected', surfaces: [] },
    bridge: { present, paired: true, running: present, lastSeenAt: T0, extensionVersion: '2.0.17' }
  } as unknown as AppState;
}

function swarm(): SwarmState {
  return {
    enabled: true, running: true,
    agents: [
      {
        id: 'prime', role: 'prime', label: 'Prime', task: 'Coordinate the release', model: null, reasoningEffort: null, state: 'active',
        createdAt: T0 - 120_000, activatedAt: T0 - 120_000, finishedAt: null, result: null, pending: 0, awaitingAck: 0, delivered: 2,
        conversationId: 'chat-prime', detachedAt: null, lastSeenAt: T0, revivable: false, sleptAt: null, contextTokens: 8_000
      },
      {
        id: 'worker-1', role: 'worker', label: 'Astra verifier', task: 'Run the renderer checks', model: 'gpt-6-pro', reasoningEffort: 'pro', state: 'active',
        createdAt: T0 - 60_000, activatedAt: T0 - 55_000, finishedAt: null, result: null, pending: 0, awaitingAck: 0, delivered: 1,
        conversationId: 'chat-worker', detachedAt: null, lastSeenAt: T0, revivable: false, sleptAt: null, contextTokens: 4_000
      }
    ]
  };
}

describe('Control Rail projection', () => {
  it('keeps the rail available while the app state has no bridge or status yet', () => {
    const snapshot = projectControlRail({
      state: { config: { sessions: { record: true }, ui: { browserOnly: false } } } as AppState,
      session: null, workerSessions: [], events: [], swarm: null, queue: [], project: null,
      pressure: null, working: false, blocked: false, currentModel: null,
      modelCatalog: { state: 'unknown', observedAt: null, count: 0 }, now: T0
    });
    expect(snapshot.transport).toBe('unknown');
    expect(snapshot.facts.find(row => row.id === 'browser')?.value).toBe('Unknown');
    expect(snapshot.browser.facts).toEqual([]);
    expect(snapshot.issues).toEqual([]);
  });

  it('projects only structured operational truth and keeps admitted worker model identity intact', () => {
    const worker = session({
      id: '2026-09-16-worker0001', title: 'Astra verifier', conversationId: 'chat-worker', chatIds: ['chat-worker'], selectedModel: undefined,
      origin: { kind: 'worker', fromSessionId: '2026-09-16-prime0001', agentId: 'worker-1', task: 'Run the renderer checks' }
    });
    const events: SessionEvent[] = [
      { seq: 1, time: T0 + 100, source: 'extension', kind: 'assistant_message', message: text('I created imaginary-release.zip'), final: true },
      tool(2, 'apply_patch', { kind: 'create', title: 'Created report.pdf', tone: 'good' }, { changes: [{ path: 'artifacts/report.pdf', added: 10, removed: 0, approximate: false }], agent: 'worker-1' }),
      tool(3, 'read', { kind: 'read', title: 'Read src/renderer/chat.ts', tone: 'neutral' }, { args: JSON.stringify({ paths: ['src/renderer/chat.ts'] }) }),
      tool(4, 'exec_command', { kind: 'run', title: 'npm test', tone: 'warn', metric: '✕ 1' }, { outcome: 'process_exit_nonzero' }),
      tool(5, 'exec_command', { kind: 'run', title: 'npm test', tone: 'good', metric: '✓ 0' }),
      { seq: 6, time: T0 + 600, source: 'extension', kind: 'page_tool', messageId: 'browser-1', label: 'Inspected renderer' }
    ];
    const queue = [{
      id: '00000000-0000-4000-8000-000000000001', sessionId: '2026-09-16-prime0001', text: 'Run final renderer QA', mode: 'after-turn', dueAt: T0,
      model: 'gpt-5.6-sol', reasoningEffort: 'high', state: 'queued', owner: null, createdAt: T0, conversationId: 'chat-prime'
    } as InputEntry];
    const snapshot = projectControlRail({
      state: state(), session: session(), workerSessions: [worker], events, swarm: swarm(), queue,
      project: { id: 'project-1', name: 'MALACHI OVERDRIVE', kind: 'work', createdAt: T0 } as never,
      pressure: { estimated: 8_000, advisory: 80_000, limit: 110_000, level: 'ok' }, working: true, blocked: false,
      currentModel: { model: 'gpt-5.6-sol', reasoningEffort: 'high' }, modelCatalog: { state: 'ready', observedAt: T0, count: 3 }, now: T0 + 1000
    });

    expect(snapshot.runState).toBe('RUNNING');
    expect(snapshot.scopeId).toBe('2026-09-16-prime0001');
    expect(snapshot.outputs.map(row => row.path)).toEqual(['artifacts/report.pdf']);
    expect(snapshot.outputs.some(row => row.title.includes('imaginary-release'))).toBe(false);
    expect(snapshot.files).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'artifacts/report.pdf', indicator: 'created' }),
      expect.objectContaining({ path: 'src/renderer/chat.ts', indicator: 'read' })
    ]));
    expect(snapshot.agents.find(row => row.id === 'worker-1')).toEqual(expect.objectContaining({ model: 'gpt-6-pro', reasoningEffort: 'pro', sessionId: worker.id }));
    expect(snapshot.queue).toHaveLength(1);
    expect(snapshot.browser.facts.find(row => row.id === 'catalog')?.value).toContain('3 choices');
    expect(snapshot.issues.some(row => row.title === 'npm test')).toBe(false);
    expect(snapshot.sources.find(row => row.id === 'roots')?.detail).toBe('/overdrive');
    expect(JSON.stringify(snapshot)).not.toContain('/private/hidden');
  });

  it('shows a current browser disconnect as an issue without inventing an output or model', () => {
    const snapshot = projectControlRail({
      state: state(false), session: session({ selectedModel: undefined }), workerSessions: [], events: [], swarm: null, queue: [], project: null,
      pressure: null, working: false, blocked: false, currentModel: null,
      modelCatalog: { state: 'unavailable', observedAt: null, count: 0, error: 'Browser model catalog unavailable.' }, now: T0
    });
    expect(snapshot.outputs).toEqual([]);
    expect(snapshot.agents[0]?.model).toBeNull();
    expect(snapshot.facts.find(row => row.id === 'model')?.value).toBe('Unknown');
    expect(snapshot.issues).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'browser-offline', title: 'Browser disconnected' })]));
  });
});

describe('Control Rail interactions', () => {
  let dom: JSDOM;
  afterEach(() => dom?.window.close());

  function snapshot(updatedAt = T0): ControlRailSnapshot {
    return {
      scopeId: 'prime-session', runState: 'RUNNING', transport: 'connected', conversation: 'Rail interaction test',
      facts: [{ id: 'workers', label: 'Active workers', value: '1' }], outputs: [], activity: [], files: [],
      browser: { facts: [], actions: [] }, queue: [], sources: [], issues: [],
      agents: [{
        id: 'worker-1', label: 'Worker 1', role: 'worker', model: 'gpt-6-pro', reasoningEffort: 'pro', state: 'active', task: 'Test the rail',
        createdAt: T0 - 10_000, activatedAt: T0 - 9_000, finishedAt: null, contextTokens: 1000, sessionId: 'worker-session', updatedAt
      }]
    };
  }

  it('keeps scroll, section state and an outside composer draft stable across targeted updates', () => {
    dom = new JSDOM('<div class="app"><input id="draft" value="do not lose me"><button id="toggle"></button></div>', { pretendToBeVisual: true });
    Object.assign(globalThis, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, Element: dom.window.Element, Node: dom.window.Node });
    const host = document.querySelector<HTMLElement>('.app')!, toggle = document.querySelector<HTMLButtonElement>('#toggle')!;
    const rail = createControlRail({ host, toggle, loadWorker: async () => ({ events: [] }), renderWorker: () => [], openMain: vi.fn(), copyPath: async () => true,
      actions: { newTask: vi.fn(), commands: vi.fn(), projectFiles: vi.fn(), activity: vi.fn(), openChat: vi.fn(), refreshModels: vi.fn(), setup: vi.fn() } });
    rail.update(snapshot()); rail.open();
    const scroller = host.querySelector<HTMLElement>('.control-rail-scroll')!; scroller.scrollTop = 87;
    const outputs = host.querySelector<HTMLDetailsElement>('[data-section="outputs"]')!; outputs.open = false;
    rail.update({ ...snapshot(T0 + 1000), activity: [{ id: 'a', title: 'Edited file', kind: 'edit', tone: 'neutral', time: T0 }] });
    expect(scroller.scrollTop).toBe(87);
    expect(outputs.open).toBe(false);
    expect((document.querySelector('#draft') as HTMLInputElement).value).toBe('do not lose me');
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
  });

  it('opens the existing worker transcript inside the rail and Escape returns focus to the rail toggle', async () => {
    dom = new JSDOM('<div class="app"><button id="toggle"></button></div>', { pretendToBeVisual: true });
    Object.assign(globalThis, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, Element: dom.window.Element, Node: dom.window.Node });
    const host = document.querySelector<HTMLElement>('.app')!, toggle = document.querySelector<HTMLButtonElement>('#toggle')!;
    const renderWorker = vi.fn(() => { const p = document.createElement('p'); p.textContent = 'Recorded worker response'; return [p]; });
    const rail = createControlRail({ host, toggle, loadWorker: async () => ({ events: [] }), renderWorker, openMain: vi.fn(), copyPath: async () => true,
      actions: { newTask: vi.fn(), commands: vi.fn(), projectFiles: vi.fn(), activity: vi.fn(), openChat: vi.fn(), refreshModels: vi.fn(), setup: vi.fn() } });
    rail.update(snapshot()); rail.open(); await rail.openWorker('worker-session');
    expect(host.textContent).toContain('Recorded worker response');
    expect(renderWorker).toHaveBeenCalledOnce();
    host.querySelector<HTMLElement>('#controlRail')!.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(host.querySelector<HTMLElement>('.control-rail-inspector')!.hidden).toBe(true);
    host.querySelector<HTMLElement>('#controlRail')!.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(host.querySelector<HTMLElement>('#controlRail')!.hidden).toBe(true);
    expect(document.activeElement).toBe(toggle);
  });
});
