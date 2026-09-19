import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentInfo, SessionEvent, SessionSummary } from '../src/shared/session.js';
import type { AmbientSnapshot, AmbientTask } from '../src/shared/ambient-work.js';
import type { SessionControlsView } from '../src/main/bridge.js';
import type { InputEntry } from '../src/main/session/input.js';

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(), controls: vi.fn(), setAutomation: vi.fn(), stop: vi.fn(), inputs: vi.fn(), retry: vi.fn(),
  switch: vi.fn(), readEvents: vi.fn(), resolve: vi.fn(), read: vi.fn(), write: vi.fn(),
  page: vi.fn(), recent: vi.fn(), live: vi.fn()
}));
vi.mock('../src/main/config.js', () => ({ getConfig: () => ({ roots: [{ name: 'project', path: '/approved' }], ui: {} }) }));
vi.mock('../src/main/session/store.js', () => ({ getSession: mocks.getSession, findSessionByConversation: vi.fn(), listSessionPage: mocks.page, readRecentEvents: mocks.recent, readEvents: mocks.readEvents }));
vi.mock('../src/main/session/recorder.js', () => ({ liveConversations: () => [] }));
vi.mock('../src/main/session/input.js', () => ({ listInputs: mocks.inputs }));
vi.mock('../src/main/session/start-input.js', () => ({ retryQueuedInputBrowser: mocks.retry }));
vi.mock('../src/main/bridge.js', () => ({ sessionControlsFor: mocks.controls, sessionHasInputActivity: mocks.live, setSessionAutomation: mocks.setAutomation, stopSessionTurn: mocks.stop }));
vi.mock('../src/main/agents.js', () => ({ swarmState: () => ({ agents: [] }) }));
vi.mock('../src/main/goal.js', () => ({ goalSwitchFor: mocks.switch }));
vi.mock('../src/main/session/blocked-chats.js', () => ({ isChatBlocked: () => false }));
vi.mock('../src/main/sandbox.js', () => ({ resolvePath: mocks.resolve }));
vi.mock('../src/main/durable.js', () => ({ readDurable: mocks.read, writeDurableNow: mocks.write }));
import { AmbientCompletionTracker, ambientText, controlAmbientWork, getAmbientWork, onAmbientWorkChange, projectAmbientInput, projectAmbientTask, resolveAmbientOutput } from '../src/main/ambient-work.js';

function session(overrides: Partial<SessionSummary> = {}): SessionSummary {
  return { id: 'session-prime', conversationId: 'chat-prime', title: 'Build the app', chatIds: ['chat-prime'],
    startedAt: 100, updatedAt: 400, endedAt: null, events: 4, userMessages: 1, toolCalls: 1,
    lastToolCallAt: 250, processExitNonzero: 0, toolRejected: 0, toolInternalErrors: 0, errors: 0,
    estimatedTokens: 1000, contextTokens: 1000, lastHandoffId: null, lastHandoffAt: null,
    lastTurnOutcome: null, activeTurnId: 'turn-one', agents: [], origin: null, ...overrides };
}
function controls(overrides: Partial<SessionControlsView> = {}): SessionControlsView {
  return { sessionId: 'session-prime', conversationId: 'chat-prime', automation: 'off', objective: '',
    activeTurnId: null, finishHeld: false, blocked: '', job: null, ...overrides };
}
const start: SessionEvent = { seq: 1, time: 100, source: 'extension', kind: 'turn_start', turnId: 'turn-one' };
const end: SessionEvent = { seq: 4, time: 400, source: 'extension', kind: 'turn_end', turnId: 'turn-one', outcome: 'completed' };
function task(overrides: Partial<Parameters<typeof projectAmbientTask>[0]> = {}): AmbientTask {
  return projectAmbientTask({ session: session(), events: [start], agents: [], sessions: [], inputs: [],
    controls: controls(), live: false, blocked: false, ...overrides });
}
function worker(overrides: Partial<AgentInfo> = {}): AgentInfo {
  return { runId: 'run-prime', primeConversationId: 'chat-prime', id: 'worker-1', role: 'worker', label: 'Verifier', task: 'Run tests',
    conversationId: 'chat-worker', model: 'gpt-6-pro', reasoningEffort: 'high', state: 'active', createdAt: 100,
    activatedAt: 120, finishedAt: null, result: null, pending: 0, awaitingAck: 0, delivered: 0, detachedAt: null,
    lastSeenAt: 300, revivable: true, sleptAt: null, contextTokens: 100, ...overrides };
}

beforeEach(() => {
  vi.clearAllMocks(); mocks.getSession.mockResolvedValue(session()); mocks.controls.mockResolvedValue(controls());
  mocks.inputs.mockResolvedValue([]); mocks.switch.mockReturnValue({ enabled: false, mode: 'loop', own: true });
  mocks.page.mockResolvedValue({ sessions: [] }); mocks.recent.mockResolvedValue([]); mocks.live.mockReturnValue(false); mocks.read.mockResolvedValue([]);
});

describe('Ambient activity projection', () => {
  it('shows durable new-chat preparation without fabricating a session or confirmed model', () => {
    const view = projectAmbientInput({ id: 'queued-task', text: 'Build a report', state: 'browser', createdAt: 100,
      sessionId: null, conversationId: null, model: 'gpt-6-pro', reasoningEffort: 'high' } as InputEntry);
    expect(view.id).toBe('input:queued-task'); expect(view.sessionId).toBe(''); expect(view.state).toBe('preparing');
    expect(view.model.evidence).toBe('requested'); expect(view.controls).toEqual([]); expect(view.completionId).toBeNull();
  });
  it('never turns an archived session, missing process or old persisted start into completion', () => {
    expect(task({ session: session({ endedAt: 500 }) }).state).toBe('blocked');
    expect(task({ session: session({ endedAt: 500, activeTurnId: null }), events: [] }).completionId).toBeNull();
    expect(task({ live: false }).warning).toContain('fresh provider evidence');
  });
  it('uses exact durable completed turn receipts and actual elapsed start evidence', () => {
    const view = task({ events: [start, end], session: session({ activeTurnId: null }) });
    expect(view.state).toBe('complete'); expect(view.completionId).toBe('session-prime:turn-one:4');
    expect(view.startedAt).toBe(100); expect(view.progress).toBeNull();
    expect(task({ events: [start, { ...end, outcome: 'unknown' } as SessionEvent] }).completionId).toBeNull();
  });
  it('does not complete a parent while an exactly owned worker is active or follow-ups remain enabled', () => {
    expect(task({ events: [start, end], agents: [worker()] }).state).toBe('working');
    expect(task({ events: [start, end], controls: controls({ automation: 'goal' }) }).state).toBe('waiting-provider');
    expect(task({ events: [start, end], agents: [worker({ state: 'failed', finishedAt: 300 })] }).state).toBe('failed');
  });
  it('exposes only successful create/edit output attached to the exact current turn', () => {
    const output = (seq: number, turnId: string, kind = 'create') => ({ seq, time: seq * 100, source: 'mcp', kind: 'tool_call', turnId,
      call: { outcome: 'ok', summary: { kind, title: 'Created file', tone: 'good' }, changes: [{ path: `/project/result-${seq}.txt` }] } }) as unknown as SessionEvent;
    const view = task({ events: [start, output(2, 'old-turn'), output(3, 'turn-one'), output(5, 'turn-one', 'delete'), end], session: session({ activeTurnId: null }) });
    expect(view.outputs.map(row => row.name)).toEqual(['result-3.txt']);
  });
  it('distinguishes requested Astra from confirmed identity and refuses same-named cross-run joins', () => {
    const wrong = session({ id: 'other-worker', conversationId: 'other-chat', selectedModel: { conversationId: 'other-chat', model: 'gpt-5.6-sol', observedAt: 200 },
      origin: { kind: 'worker', agentId: 'worker-1', fromSessionId: 'other-prime', task: '' } });
    const requested = task({ agents: [worker()], sessions: [wrong] }).workers[0]!;
    expect(requested.sessionId).toBeNull(); expect(requested.model).toMatchObject({ model: 'gpt-6-pro', evidence: 'requested' });
    const own = session({ id: 'own-worker', conversationId: 'chat-worker', selectedModel: { conversationId: 'chat-worker', model: 'gpt-6-pro', reasoningEffort: 'high', observedAt: 300 },
      origin: { kind: 'worker', agentId: 'worker-1', fromSessionId: 'session-prime', task: '' } });
    expect(task({ agents: [worker()], sessions: [wrong, own] }).workers[0]!.model.evidence).toBe('confirmed');
    expect(task({ agents: [worker({ primeConversationId: 'other-prime' })], sessions: [own] }).workers).toEqual([]);
  });
  it('keeps private reasoning, raw tool results and secret paths out of the preview', () => {
    expect(task({ events: [{ seq: 2, time: 200, source: 'extension', kind: 'progress', message: { text: 'private thought', chars: 15, truncated: false } }] }).activity).toEqual([]);
    const hidden = ambientText('Read /Users/example/private.txt; token=secret-value');
    expect(hidden).not.toContain('example'); expect(hidden).not.toContain('secret-value');
    for (const value of ['/etc/private.conf', '/root/private', '/opt/private', 'C:/Users/person/file', '\\\\server\\share\\private'])
      expect(ambientText(`Read ${value}`)).not.toContain(value);
    expect(ambientText("Read('/etc/private.conf')")).not.toContain('/etc/private.conf');
    expect(ambientText('file=/root/private')).not.toContain('/root/private');
    expect(ambientText('password = "open sesame"; next step')).toBe('[redacted]; next step');
    expect(ambientText("token='alpha beta'; continue")).toBe('[redacted]; continue');
  });
  it('retains only exact safe retry controls and describes cooperative pause honestly', () => {
    const view = task({ controls: controls({ automation: 'loop' }) });
    expect(view.controls.find(control => control.action === 'pause')).toMatchObject({ enabled: true, label: 'Pause follow-ups' });
    expect(view.controls.find(control => control.action === 'retry')!.enabled).toBe(false);
  });
});

describe('Ambient completion receipts', () => {
  it('notifies once only for a genuinely observed running turn and survives switching scopes', () => {
    const tracker = new AmbientCompletionTracker();
    const done = task({ events: [start, end], session: session({ activeTurnId: null }) });
    expect(tracker.update([done])).toEqual([]);
    const running = task({ live: true });
    tracker.update([running]);
    const completed = tracker.update([done]);
    expect(completed).toHaveLength(1); tracker.commit(completed);
    expect(tracker.update([done])).toEqual([]);
    tracker.update([running]); expect(tracker.update([done])).toEqual([]);
    const restart = new AmbientCompletionTracker(); restart.seed(tracker.receipts());
    restart.update([running]); expect(restart.update([done])).toEqual([]);
  });
  it('does not notify a different task, an old completed turn or a failed turn', () => {
    const tracker = new AmbientCompletionTracker(); tracker.update([task({ live: true })]);
    const historical = task({ session: session({ id: 'other-session', activeTurnId: null }), events: [start, end] });
    expect(tracker.update([historical])).toEqual([]);
    tracker.update([task({ live: true })]);
    expect(tracker.update([task({ events: [start, { ...end, outcome: 'failed' } as SessionEvent] })])).toEqual([]);
  });
});

describe('Ambient exact controls and outputs', () => {
  it('pauses and resumes the existing durable conversation policy, including its saved Loop mode after restart', async () => {
    const target = { sessionId: 'session-prime', conversationId: 'chat-prime', turnId: null };
    await controlAmbientWork({ ...target, action: 'pause' });
    expect(mocks.setAutomation).toHaveBeenCalledWith('session-prime', 'off', 'chat-prime');
    mocks.setAutomation.mockClear();
    await controlAmbientWork({ ...target, action: 'resume' });
    expect(mocks.setAutomation).toHaveBeenCalledWith('session-prime', 'loop', 'chat-prime');
  });
  it('refuses a compaction rebind that happens while controls are loading', async () => {
    mocks.controls.mockResolvedValue(controls({ conversationId: 'replacement-chat' }));
    await expect(controlAmbientWork({ sessionId: 'session-prime', conversationId: 'chat-prime', turnId: null, action: 'pause' })).rejects.toThrow('conversation changed');
    expect(mocks.setAutomation).not.toHaveBeenCalled();
  });
  it('rejects stale conversation and turn identity without stopping other work', async () => {
    const target = { sessionId: 'session-prime', conversationId: 'wrong-chat', turnId: 'turn-one', action: 'stop' as const };
    await expect(controlAmbientWork(target)).rejects.toThrow('conversation changed');
    await expect(controlAmbientWork({ ...target, conversationId: 'chat-prime' })).rejects.toThrow('turn changed');
    expect(mocks.stop).not.toHaveBeenCalled(); expect(mocks.setAutomation).not.toHaveBeenCalled();
  });
  it('never retries another task input or an uncertain already-claimed send', async () => {
    const request = { sessionId: 'session-prime', conversationId: 'chat-prime', turnId: null, action: 'retry' as const, inputId: 'input-one' };
    mocks.inputs.mockResolvedValue([{ id: 'input-one', sessionId: 'other-task' }]);
    await expect(controlAmbientWork(request)).rejects.toThrow('does not belong'); expect(mocks.retry).not.toHaveBeenCalled();
    mocks.inputs.mockResolvedValue([{ id: 'input-one', sessionId: 'session-prime', conversationId: 'chat-prime', state: 'browser' }]);
    mocks.retry.mockResolvedValue(null); await expect(controlAmbientWork(request)).rejects.toThrow('not proven safe');
  });
  it('re-reads exact output evidence and current approved-root containment', async () => {
    mocks.readEvents.mockResolvedValue([{ seq: 8, kind: 'tool_call', call: { outcome: 'ok', summary: { kind: 'create' }, changes: [{ path: '/project/result.txt' }] } }]);
    mocks.resolve.mockResolvedValue({ real: '/approved/result.txt' });
    await expect(resolveAmbientOutput({ sessionId: 'session-prime', eventSeq: 8, outputIndex: 0 })).resolves.toBe('/approved/result.txt');
    expect(mocks.resolve).toHaveBeenCalledWith([{ name: 'project', path: '/approved' }], '/project/result.txt');
    await expect(resolveAmbientOutput({ sessionId: 'session-prime', eventSeq: 9, outputIndex: 0 })).rejects.toThrow('evidence');
  });
});

describe('Ambient global snapshot', () => {
  it('keeps pending durable work visible after its session falls outside the recent-session page', async () => {
    const current = session({ id: 'queued-hidden-session', conversationId: 'queued-hidden-chat', activeTurnId: null });
    mocks.page.mockResolvedValue({ sessions: [] });
    mocks.switch.mockReturnValue({ enabled: false, mode: 'loop', own: false });
    mocks.inputs.mockResolvedValue([{ id: '11111111-2222-4333-8444-555555555555', sessionId: current.id,
      deliveredSessionId: null, conversationId: current.conversationId, state: 'queued', purpose: 'user',
      createdAt: 350, dueAt: 350, text: 'continue hidden work', owner: null }] as unknown as InputEntry[]);
    mocks.getSession.mockImplementation(async (id: string) => id === current.id ? current : null);
    const view = await getAmbientWork();
    expect(view.tasks.find(row => row.id === current.id)).toMatchObject({ state: 'queued', conversationId: current.conversationId });
  });
  it('publishes only the stable rebuild when a control read detects a concurrent conversation rebind', async () => {
    const current = session();
    mocks.page.mockResolvedValue({ sessions: [current] });
    mocks.recent.mockResolvedValue([start]);
    mocks.controls.mockResolvedValueOnce(controls({ conversationId: 'replacement-chat' })).mockResolvedValue(controls());
    const published: AmbientSnapshot[] = [];
    const unsubscribe = onAmbientWorkChange(value => published.push(value));
    try {
      const view = await getAmbientWork();
      expect(view.tasks.some(row => row.id === current.id)).toBe(true);
      expect(published).toHaveLength(1);
      expect(published[0]!.tasks.some(row => row.id === current.id)).toBe(true);
    } finally { unsubscribe(); }
  });
  it('retains a real observed completion across a receipt write failure and publishes once after recovery', async () => {
    const current = session({ id: 'receipt-failure-session' });
    mocks.page.mockResolvedValue({ sessions: [current] });
    mocks.controls.mockResolvedValue(controls({ sessionId: current.id, activeTurnId: 'turn-one' }));
    mocks.live.mockReturnValue(true);
    mocks.recent.mockImplementation(async (_id: string, limit: number) => limit === 8 ? [start] : []);
    expect((await getAmbientWork()).completions).toEqual([]);
    mocks.page.mockResolvedValue({ sessions: [{ ...current, activeTurnId: null, events: 5, updatedAt: 401 }] });
    mocks.controls.mockResolvedValue(controls({ sessionId: current.id }));
    mocks.live.mockReturnValue(false);
    mocks.recent.mockImplementation(async (_id: string, limit: number) => limit === 8 ? [start, end] : []);
    mocks.write.mockRejectedValueOnce(new Error('disk unavailable')).mockResolvedValue(undefined);
    await expect(getAmbientWork()).rejects.toThrow('disk unavailable');
    const restored = await getAmbientWork();
    expect(restored.completions).toHaveLength(1);
    expect(restored.completions[0]!.id).toBe('receipt-failure-session:turn-one:4');
    expect(mocks.write).toHaveBeenCalledTimes(2);
    expect((await getAmbientWork()).completions).toEqual([]);
  });
  it('restores existing evidence without notification and caches unchanged histories independently of the selected chat', async () => {
    const current = session({ id: 'snapshot-session', activeTurnId: null });
    mocks.page.mockResolvedValue({ sessions: [current] });
    mocks.controls.mockResolvedValue(controls({ sessionId: current.id }));
    mocks.recent.mockImplementation(async (_id: string, limit: number) => limit === 8 ? [start, end] : []);
    const first = await getAmbientWork();
    expect(first.tasks[0]!.id).toBe(current.id); expect(first.tasks[0]!.state).toBe('complete'); expect(first.completions).toEqual([]);
    const calls = mocks.recent.mock.calls.length;
    const again = await getAmbientWork(); expect(again.tasks[0]!.completionId).toBe(first.tasks[0]!.completionId);
    expect(mocks.recent).toHaveBeenCalledTimes(calls);
  });
});
