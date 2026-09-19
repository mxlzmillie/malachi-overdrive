import { beforeEach, expect, it, vi } from 'vitest';
import type { InputArgs, InputEntry } from '../src/main/session/input.js';
const ports = vi.hoisted(() => ({ connected: true, connect: vi.fn(), status: { state: 'connected', detail: '' },
  wake: vi.fn(), bridge: vi.fn(), guard: vi.fn(), enqueue: vi.fn(), cancel: vi.fn(), note: vi.fn(), rows: [] as InputEntry[], listeners: new Set<() => void>() }));
vi.mock('../src/main/connection.js', () => ({ connect: ports.connect, getStatus: () => ports.status, onStatusChange: (fn: () => void) => { ports.listeners.add(fn); return () => ports.listeners.delete(fn); } }));
vi.mock('../src/main/bridge.js', () => ({ browserWakeConnected: () => ports.connected, startBridge: ports.bridge }));
vi.mock('../src/main/browser-wake.js', () => ({ wakeBrowserWork: ports.wake }));
vi.mock('../src/main/session/input.js', () => ({ assertSessionInputAvailable: ports.guard, enqueueInput: ports.enqueue, cancelInput: ports.cancel, noteInputStartupError: ports.note, listInputs: async () => ports.rows }));
import { sendDesktopInput, cancelDesktopInput, retryQueuedInputBrowser, resetInputStartupForTests } from '../src/main/session/start-input.js';
const request: InputArgs = { id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', sessionId: null, text: 'Please start', mode: 'auto', dueAt: 0, model: null, reasoningEffort: null };
beforeEach(() => {
  vi.resetAllMocks(); resetInputStartupForTests(); ports.connected = true;
  ports.rows = []; ports.listeners.clear(); ports.status = { state: 'connected', detail: '' }; ports.bridge.mockResolvedValue(8765);
  ports.enqueue.mockImplementation(async (input: InputArgs): Promise<InputEntry> => {
    const row: InputEntry = { ...input, state: 'queued', owner: null, createdAt: 1, conversationId: input.sessionId ? 'exact-conversation' : null };
    ports.rows.push(row); return row;
  });
  ports.note.mockImplementation(async (id, error) => { const row = ports.rows.find(entry => entry.id === id); if (row) row.error = error ?? undefined; return row; });
});
it('waits for the existing connector readiness event before publishing input', async () => {
  ports.status = { state: 'connecting-tunnel', detail: 'Starting tunnel' };
  const pending = sendDesktopInput(request);
  await vi.waitFor(() => expect(ports.listeners.size).toBe(1));
  expect(ports.enqueue).not.toHaveBeenCalled(); expect(ports.wake).not.toHaveBeenCalled();
  ports.status = { state: 'connected', detail: '' }; for (const listener of ports.listeners) listener();
  await pending; expect(ports.enqueue).toHaveBeenCalledTimes(1); expect(ports.listeners.size).toBe(0);
});
it('reports a moving chat before waiting for connector or browser startup', async () => {
  ports.guard.mockImplementationOnce(() => { throw new Error('This chat is moving'); });
  await expect(sendDesktopInput({ ...request, sessionId: 'moving-chat' })).rejects.toThrow('This chat is moving');
  expect(ports.connect).not.toHaveBeenCalled(); expect(ports.enqueue).not.toHaveBeenCalled();
});
it('fails closed without a connected isolated companion and never publishes a new task', async () => {
  ports.connected = false;
  await expect(sendDesktopInput(request)).rejects.toThrow('BACKGROUND_UNAVAILABLE');
  expect(ports.enqueue).not.toHaveBeenCalled(); expect(ports.wake).not.toHaveBeenCalled();
});
it('keeps a post-commit socket loss queued and retries only that proven unclaimed input', async () => {
  ports.enqueue.mockImplementationOnce(async (input: InputArgs) => {
    ports.connected = false;
    const row: InputEntry = { ...input, state: 'queued', owner: null, createdAt: 1, conversationId: null };
    ports.rows.push(row); return row;
  });
  await sendDesktopInput(request); expect(ports.rows[0]?.error).toContain('BACKGROUND_UNAVAILABLE');
  ports.connected = true; await retryQueuedInputBrowser(request.id);
  expect(ports.enqueue).toHaveBeenCalledTimes(1); expect(ports.wake).toHaveBeenCalledTimes(1); expect(ports.rows).toHaveLength(1);
  expect(await retryQueuedInputBrowser(request.id)).toBeNull();
  ports.rows[0]!.state = 'browser'; ports.rows[0]!.error = 'Message queued. Browser startup failed: old';
  expect(await retryQueuedInputBrowser(request.id)).toBeNull(); expect(ports.wake).toHaveBeenCalledTimes(1);
});
it('revalidates exact session/conversation after connector readiness before a retry nudge', async () => {
  ports.rows = [{ ...request, sessionId: 'session-one', conversationId: 'chat-one', state: 'queued', owner: null, createdAt: 1, error: 'Message queued. Browser startup failed: old' }];
  ports.status = { state: 'connecting-tunnel', detail: '' };
  const pending = retryQueuedInputBrowser(request.id, { sessionId: 'session-one', conversationId: 'chat-one' });
  await vi.waitFor(() => expect(ports.listeners.size).toBe(1));
  ports.rows[0]!.conversationId = 'replacement-chat'; ports.status = { state: 'connected', detail: '' };
  for (const listener of ports.listeners) listener();
  expect(await pending).toBeNull(); expect(ports.wake).not.toHaveBeenCalled();
});
it('preserves setup failures without queueing', async () => {
  ports.status = { state: 'disconnected', detail: 'Add a folder before connecting.' };
  await expect(sendDesktopInput(request)).rejects.toThrow('Add a folder'); expect(ports.enqueue).not.toHaveBeenCalled();
});
it('hands every new/existing chat to the companion without browser preference or OS launch authority', async () => {
  await sendDesktopInput(request); await sendDesktopInput({ ...request, id: 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff', sessionId: 'session-existing' });
  expect(ports.enqueue).toHaveBeenCalledTimes(2); expect(ports.wake).toHaveBeenCalledTimes(2);
});
it('cancels a first send while waiting for connection without publishing input', async () => {
  ports.status = { state: 'connecting-tunnel', detail: '' };
  const pending = sendDesktopInput(request); const rejected = expect(pending).rejects.toThrow('Input cancelled');
  await vi.waitFor(() => expect(ports.listeners.size).toBe(1)); expect(await cancelDesktopInput(request.id)).toBe(true);
  await rejected; expect(ports.listeners.size).toBe(0); expect(ports.enqueue).not.toHaveBeenCalled(); expect(ports.wake).not.toHaveBeenCalled();
});
it('cancels an enqueue that commits after the user stopped startup', async () => {
  let commit!: () => void;
  ports.enqueue.mockImplementation(() => new Promise(resolve => { commit = () => resolve({ ...request, state: 'queued' }); }));
  const pending = sendDesktopInput(request); const rejected = expect(pending).rejects.toThrow('Input cancelled');
  await vi.waitFor(() => expect(ports.enqueue).toHaveBeenCalled()); expect(await cancelDesktopInput(request.id)).toBe(true);
  commit(); await rejected; expect(ports.cancel).toHaveBeenCalledWith(request.id); expect(ports.wake).not.toHaveBeenCalled();
});
