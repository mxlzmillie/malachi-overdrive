import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { expect, it, vi } from 'vitest';

const source = readFileSync('extension/background.js', 'utf8');
const code = source.slice(source.indexOf('let backgroundWindowFlight = null;'), source.indexOf('\nasync function deliverDesktopInputs'));
type Tab = { id: number; windowId: number; url: string; active?: boolean; index?: number };
function harness(initial: Tab[], cached?: number) {
  const tabs = new Map(initial.map(tab => [tab.id, { ...tab }]));
  const windows = new Map([...new Set(initial.map(tab => tab.windowId))].map(id => [id, { id, state: 'minimized', focused: false }]));
  const stored: Record<string, unknown> = cached === undefined ? {} : { chatBackgroundWindow: cached, chatBackgroundTabs: initial.filter(tab => tab.windowId === cached).map(tab => tab.id) };
  let next = 100;
  const create = vi.fn(async (options: { url: string; windowId: number }) => {
    const tab = { id: next++, windowId: options.windowId, url: options.url };
    tabs.set(tab.id, tab); return tab;
  });
  const move = vi.fn(async (id: number, options: { windowId: number }) => {
    if (!windows.has(options.windowId)) throw new Error('Window closed');
    const tab = tabs.get(id)!; tab.windowId = options.windowId; return { ...tab };
  });
  const get = vi.fn(async (id: number) => ({ ...tabs.get(id)! }));
  const update = vi.fn(async (id: number, patch: Partial<Tab>) => {
    const tab = tabs.get(id)!; Object.assign(tab, patch); return { ...tab };
  });
  const windowCreate = vi.fn(async (options: { url?: string; tabId?: number; focused?: boolean; state?: string }) => {
    const id = next++;
    const revealed = Number.isInteger(options.tabId);
    const oldWindow = revealed ? tabs.get(options.tabId!)?.windowId : null;
    const window = { id, state: options.state ?? (revealed ? 'normal' : 'minimized'), focused: options.focused ?? revealed };
    windows.set(id, window);
    const tab = revealed ? tabs.get(options.tabId!)! : await create({ url: options.url!, windowId: id });
    if (revealed) tab.windowId = id;
    if (oldWindow != null && ![...tabs.values()].some(row => row.windowId === oldWindow)) windows.delete(oldWindow);
    return { ...window, tabs: [{ ...tab }] };
  });
  const windowUpdate = vi.fn(async (id: number, patch: { state?: string; focused?: boolean }) => {
    const window = windows.get(id)!; Object.assign(window, patch); return { ...window };
  });
  const call = vi.fn(async () => ({ ok: true, data: { ok: true } }));
  const sendMessage = vi.fn(async () => ({ safe: true }));
  const api = vm.runInNewContext(`${code}\n({ createChatTab, reconcileBackgroundWindow, revealWorkerChat, recoverSelectedChatTab })`, {
    URL, URLSearchParams, Promise, setTimeout, clearTimeout, maintain: async () => undefined,
    commandMarkerId: (value: unknown) => typeof value === 'string' ? value : null,
    isChatGptUrl: (url: string) => url.startsWith('https://chatgpt.com/'), cleanConversationId: (value: unknown) => typeof value === 'string' ? value : null,
    conversationForTab: (tab: Tab) => new URL(tab.url).pathname.match(/^\/c\/(.+)$/)?.[1] ?? null,
    CHATGPT_TAB_URLS: ['https://chatgpt.com/*'], call,
    chrome: {
      runtime: { getURL: (path: string) => `chrome-extension://test/${path}` },
      storage: { session: {
        get: async () => ({ ...stored }),
        set: async (values: object) => { Object.assign(stored, values); },
        remove: async (key: string) => { delete stored[key]; }
      } },
      tabs: { query: async (filter?: { windowId?: number; active?: boolean }) => [...tabs.values()]
        .filter(tab => (filter?.windowId === undefined || tab.windowId === filter.windowId) &&
          (filter?.active !== true || tab.active === true))
        .map(tab => ({ ...tab })), create, move, get, update, sendMessage },
      windows: { create: windowCreate, update: windowUpdate, get: async (id: number) => {
        if (!windows.has(id)) throw new Error('Window closed'); return windows.get(id);
      } }
    }
  }) as { createChatTab(url: string, background: boolean, active?: boolean): Promise<Tab>; reconcileBackgroundWindow(policy: object): Promise<boolean>; revealWorkerChat(request: object): Promise<void>; recoverSelectedChatTab(request: object, sender: object): Promise<{ ok: boolean; error?: string }> };
  return { ...api, tabs, windows, stored, create, move, get, update, windowCreate, windowUpdate, call, sendMessage };
}
const policy = { background: true, managedConversations: ['main', 'worker'] };

it('keeps a recovery tab inactive inside the owned window', async () => {
  const app = harness([{ id: 1, windowId: 9, url: 'https://chatgpt.com/c/main' }], 9);
  await app.createChatTab('https://chatgpt.com/c/recovered', true, true);
  expect(app.create).toHaveBeenCalledWith({ url: 'https://chatgpt.com/c/recovered', windowId: 9, active: false });
  expect(app.windowCreate).not.toHaveBeenCalled();
  expect(app.windowUpdate).not.toHaveBeenCalled();
});

it('does not adopt a minimized personal duplicate merely because its conversation is managed', async () => {
  const app = harness([{ id: 1, windowId: 9, url: 'https://chatgpt.com/c/main' }]);
  expect(await app.reconcileBackgroundWindow({ ...policy, isolatedConversations: ['main'] })).toBe(false);
  const created = await app.createChatTab('https://chatgpt.com/?cos-input=new-input', true);
  expect(app.windowCreate).toHaveBeenCalledTimes(1);
  expect(created.windowId).not.toBe(9);
  expect(app.tabs.get(1)?.windowId).toBe(9);
  expect(app.move).not.toHaveBeenCalled();
  expect(app.windowUpdate).not.toHaveBeenCalled();
});

it('never moves a task tab out of a different user window during reconciliation', async () => {
  const app = harness([{ id: 1, windowId: 9, url: 'https://chatgpt.com/c/main' },
    { id: 2, windowId: 10, url: 'https://chatgpt.com/c/worker' }], 10);
  await app.reconcileBackgroundWindow(policy);
  expect(app.move).not.toHaveBeenCalled();
  expect(app.windowCreate).not.toHaveBeenCalled();
});

it('serializes concurrent first tabs into one minimized unfocused window', async () => {
  const app = harness([]);
  const tabs = await Promise.all([app.createChatTab('https://chatgpt.com/?a', true), app.createChatTab('https://chatgpt.com/?b', true)]);
  expect(app.windowCreate).toHaveBeenCalledTimes(1);
  expect(app.windowCreate).toHaveBeenCalledWith(expect.objectContaining({ state: 'minimized', focused: false }));
  expect(app.windowUpdate).not.toHaveBeenCalled();
  expect(tabs[0]?.windowId).toBe(tabs[1]?.windowId);
});

it('does not evict a live owned task after hundreds of closed helper tabs', async () => {
  const app = harness([{ id: 1, windowId: 9, url: 'https://chatgpt.com/c/active' }], 9);
  for (let index = 0; index < 210; index++) {
    const helper = await app.createChatTab(`https://chatgpt.com/?cos-input=helper-${index}`, true);
    app.tabs.delete(helper.id);
  }
  const next = await app.createChatTab('https://chatgpt.com/?cos-input=next', true);
  expect(next.windowId).toBe(9);
  expect(app.windowCreate).not.toHaveBeenCalled();
  expect(app.stored.chatBackgroundTabs).toEqual([1, next.id]);
});

it('does not recover a closed cached owner from conversation identity alone', async () => {
  const app = harness([{ id: 1, windowId: 9, url: 'https://chatgpt.com/c/main' }], 99);
  expect(await app.reconcileBackgroundWindow(policy)).toBe(false);
  await app.createChatTab('https://chatgpt.com/?worker', true);
  expect(app.stored.chatBackgroundWindow).not.toBe(9);
  expect(app.windowCreate).toHaveBeenCalledTimes(1);
});

it('does not adopt or move personal tabs in a mixed window', async () => {
  const app = harness([{ id: 1, windowId: 9, url: 'https://chatgpt.com/c/main' },
    { id: 2, windowId: 9, url: 'https://example.com/private' }]);
  expect(await app.reconcileBackgroundWindow(policy)).toBe(false);
  const worker = await app.createChatTab('https://chatgpt.com/?worker', true);
  await app.reconcileBackgroundWindow(policy);
  expect(app.tabs.get(1)?.windowId).toBe(9);
  expect(worker.windowId).not.toBe(9);
  expect(app.tabs.get(2)?.windowId).toBe(9);
  expect(app.move).not.toHaveBeenCalled();
});

it('adopts an exact pending planner startup tab before it has a conversation', async () => {
  const app = harness([{ id: 1, windowId: 9, url: 'https://chatgpt.com/?temporary-chat=true&cos-input=planner' }]);
  await app.reconcileBackgroundWindow({ background: true, inputs: [{ id: 'planner' }] });
  await app.createChatTab('https://chatgpt.com/?main', true);
  expect(app.windowCreate).not.toHaveBeenCalled();
  expect(app.stored.chatBackgroundWindow).toBe(9);
});

it('does not move a tab that navigated away after the policy snapshot', async () => {
  const app = harness([{ id: 1, windowId: 9, url: 'https://chatgpt.com/c/main' },
    { id: 2, windowId: 10, url: 'https://chatgpt.com/c/worker' }], 10);
  app.get.mockResolvedValueOnce({ id: 1, windowId: 9, url: 'https://example.com/new-page' });
  await app.reconcileBackgroundWindow(policy);
  expect(app.move).not.toHaveBeenCalled();
});

it('restores only an exact still-pending catalog marker after browser restart', async () => {
  const nonce = '11111111-1111-1111-1111-111111111111';
  const app = harness([{ id: 1, windowId: 9, url: `https://chatgpt.com/?cos-model-catalog=${nonce}` }]);
  expect(await app.reconcileBackgroundWindow({ modelCatalogRequest: { nonce: 'other', expiresAt: Date.now() + 60000 } })).toBe(false);
  expect(await app.reconcileBackgroundWindow({ modelCatalogRequest: { nonce, expiresAt: Date.now() - 1 } })).toBe(false);
  expect(await app.reconcileBackgroundWindow({ modelCatalogRequest: { nonce, expiresAt: Date.now() + 60000 } })).toBe(true);
  await app.createChatTab('https://chatgpt.com/?cos-input=main', true);
  expect(app.windowCreate).not.toHaveBeenCalled();
});

it('does not adopt a conversation or personal page carrying a catalog-looking query', async () => {
  const app = harness([{ id: 1, windowId: 9, url: 'https://chatgpt.com/c/personal?cos-model-catalog=11111111-1111-1111-1111-111111111111' }]);
  expect(await app.reconcileBackgroundWindow({ background: true })).toBe(false);
});


it('never adopts an ordinary foreground ChatGPT window after restart', async () => {
  const app = harness([{ id: 1, windowId: 9, url: 'https://chatgpt.com/c/worker' }]);
  Object.assign(app.windows.get(9)!, { state: 'normal', focused: true });
  expect(await app.reconcileBackgroundWindow({ background: false, isolatedConversations: ['worker'] })).toBe(false);
  const created = await app.createChatTab('https://chatgpt.com/?clf=new-worker', true);
  expect(created.windowId).not.toBe(9);
  expect(app.move).not.toHaveBeenCalled();
  expect(app.windowUpdate).not.toHaveBeenCalled();
});

it('retains current browser-session worker ownership across MV3 restart independent of background preference', async () => {
  const app = harness([{ id: 1, windowId: 9, url: 'https://chatgpt.com/c/worker' }], 9);
  await app.reconcileBackgroundWindow({ background: false, isolatedConversations: ['worker'] });
  await app.createChatTab('https://chatgpt.com/?clf=second-worker', true);
  expect(app.windowCreate).not.toHaveBeenCalled();
  expect(app.create).toHaveBeenCalledWith(expect.objectContaining({ windowId: 9, active: false }));
});

it('never reuses a formerly owned task window after it is revealed into the foreground', async () => {
  const app = harness([{ id: 1, windowId: 9, url: 'https://chatgpt.com/c/worker' }], 9);
  Object.assign(app.windows.get(9)!, { state: 'normal', focused: true });
  const created = await app.createChatTab('https://chatgpt.com/?clf=next-worker', true);
  expect(created.windowId).not.toBe(9);
  expect(app.windowCreate).toHaveBeenCalledTimes(1);
  expect(app.create).not.toHaveBeenCalledWith(expect.objectContaining({ windowId: 9 }));
  expect(app.windowUpdate).not.toHaveBeenCalled();
});

it('reveals one chat without de-isolating sibling tasks', async () => {
  const app = harness([{ id: 1, windowId: 9, url: 'https://chatgpt.com/c/worker' },
    { id: 2, windowId: 9, url: 'https://chatgpt.com/c/prime' }], 9);
  await app.revealWorkerChat({ id: 'show-worker', conversationId: 'worker' });
  expect(app.windowCreate).toHaveBeenCalledWith(expect.objectContaining({ tabId: 1, focused: true }));
  expect(app.tabs.get(1)?.windowId).not.toBe(9);
  expect(app.tabs.get(2)?.windowId).toBe(9);
  expect(app.windows.get(9)).toMatchObject({ state: 'minimized', focused: false });
  expect(app.stored.chatBackgroundTabs).toEqual([2]);
  const next = await app.createChatTab('https://chatgpt.com/?clf=next-worker', true);
  expect(next.windowId).toBe(9);
  expect(app.windowCreate).toHaveBeenCalledTimes(1);
  expect(app.call).toHaveBeenCalledWith('/browser/worker-reveal', expect.objectContaining({ body: expect.stringContaining('"ok":true') }));
});

it('serializes explicit reveal against a concurrent background create', async () => {
  const app = harness([{ id: 1, windowId: 9, url: 'https://chatgpt.com/c/worker' }], 9);
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  const createWindow = app.windowCreate.getMockImplementation()!;
  app.windowCreate.mockImplementationOnce(async (options) => {
    await held;
    return createWindow(options);
  });
  const reveal = app.revealWorkerChat({ id: 'show-worker', conversationId: 'worker' });
  await vi.waitFor(() => expect(app.windowCreate).toHaveBeenCalledWith(expect.objectContaining({ tabId: 1, focused: true })));
  const creating = app.createChatTab('https://chatgpt.com/?clf=next-worker', true);
  await Promise.resolve();
  expect(app.create).not.toHaveBeenCalled();
  expect(app.windowCreate).toHaveBeenCalledTimes(1);
  release();
  await reveal;
  const created = await creating;
  expect(created.windowId).not.toBe(9);
  expect(created.windowId).not.toBe(app.tabs.get(1)?.windowId);
  expect(app.windowCreate).toHaveBeenCalledTimes(2);
  expect(app.create).not.toHaveBeenCalledWith(expect.objectContaining({ windowId: 9 }));
});

it('refuses a cached app window contaminated by a personal tab', async () => {
  const app = harness([{ id: 1, windowId: 9, url: 'https://chatgpt.com/c/worker' }], 9);
  app.tabs.set(2, { id: 2, windowId: 9, url: 'https://example.com/private' });
  const created = await app.createChatTab('https://chatgpt.com/?clf=new-worker', true);
  expect(created.windowId).not.toBe(9);
  expect(app.move).not.toHaveBeenCalled();
});

it('does not fall back to a personal tab if isolated creation is unavailable', async () => {
  const app = harness([{ id: 1, windowId: 9, url: 'https://example.com/private' }]);
  app.windowCreate.mockRejectedValueOnce(new Error('background unavailable'));
  await expect(app.createChatTab('https://chatgpt.com/?clf=new-worker', true)).rejects.toThrow('background unavailable');
  expect(app.create).not.toHaveBeenCalled();
});

it('restores a pre-redeem isolated command after browser restart only with current app authority', async () => {
  const live = harness([{ id: 1, windowId: 9, url: 'https://chatgpt.com/?clf=worker-command#clf=worker-command' }]);
  expect(await live.reconcileBackgroundWindow({ background: false, isolatedCommands: ['worker-command'] })).toBe(true);
  await live.createChatTab('https://chatgpt.com/?clf=next', true);
  expect(live.windowCreate).not.toHaveBeenCalled();
  const stale = harness([{ id: 1, windowId: 9, url: 'https://chatgpt.com/?clf=retired-command' }]);
  expect(await stale.reconcileBackgroundWindow({ background: false, isolatedCommands: ['other-command'] })).toBe(false);
});


it('does not adopt an unmarked existing-chat outbox target after full browser restart', async () => {
  const app = harness([{ id: 1, windowId: 9, url: 'https://chatgpt.com/c/pending-target' }]);
  expect(await app.reconcileBackgroundWindow({ background: false, inputs: [{ id: 'pending-input', conversationId: 'pending-target' }] })).toBe(false);
  await app.createChatTab('https://chatgpt.com/?next', true);
  expect(app.windowCreate).toHaveBeenCalledTimes(1);
  expect(app.move).not.toHaveBeenCalled();
});

it('rejects an unknown physical tab even when it duplicates a managed chat inside the cached app window', async () => {
  const app = harness([{ id: 1, windowId: 9, url: 'https://chatgpt.com/c/worker' }], 9);
  app.tabs.set(2, { id: 2, windowId: 9, url: 'https://chatgpt.com/c/worker' });
  expect(await app.reconcileBackgroundWindow({ isolatedConversations: ['worker'] })).toBe(false);
  const created = await app.createChatTab('https://chatgpt.com/?new', true);
  expect(created.windowId).not.toBe(9);
  expect(app.move).not.toHaveBeenCalled();
});

const popupSender = { url: 'chrome-extension://test/popup.html' };
const recoveryRequest = (tab: Tab) => ({ tab: tab.id, windowId: tab.windowId,
  conversationId: new URL(tab.url).pathname.split('/')[2], url: tab.url });

it('reconnects only the selected idle task tab without opening a duplicate chat', async () => {
  const selected = { id: 2, windowId: 10, url: 'https://chatgpt.com/c/task', active: true };
  const app = harness([{ id: 1, windowId: 9, url: 'https://chatgpt.com/c/other' }, selected], 9);
  Object.assign(app.windows.get(10)!, { state: 'normal', focused: true });
  expect((await app.recoverSelectedChatTab(recoveryRequest(selected), popupSender)).ok).toBe(true);
  expect(app.move).toHaveBeenCalledWith(2, { windowId: 9, index: -1 });
  expect(app.tabs.get(2)?.windowId).toBe(9);
  expect(app.stored.chatBackgroundTabs).toEqual([1, 2]);
  expect(app.windowCreate).not.toHaveBeenCalled();
  expect(app.create).not.toHaveBeenCalled();
  expect(app.call).toHaveBeenCalledWith('/browser/recovery-ownership', expect.anything());
});

it('moves the selected chat itself into one minimized window when no owner survives restart', async () => {
  const selected = { id: 2, windowId: 10, url: 'https://chatgpt.com/c/task', active: true };
  const app = harness([selected]);
  Object.assign(app.windows.get(10)!, { state: 'normal', focused: true });
  expect((await app.recoverSelectedChatTab(recoveryRequest(selected), popupSender)).ok).toBe(true);
  expect(app.windowCreate).toHaveBeenCalledWith({ tabId: 2, type: 'normal', state: 'minimized', focused: false });
  expect(app.create).not.toHaveBeenCalled();
  expect(app.stored.chatBackgroundTabs).toEqual([2]);
  expect(app.tabs.size).toBe(1);
});

it('refuses recovery from a content script, a changed tab, a busy page, or an unowned chat', async () => {
  const selected = { id: 2, windowId: 10, url: 'https://chatgpt.com/c/task', active: true };
  const app = harness([selected]);
  expect((await app.recoverSelectedChatTab(recoveryRequest(selected), { url: 'https://chatgpt.com/c/task', tab: selected })).ok).toBe(false);
  expect((await app.recoverSelectedChatTab({ ...recoveryRequest(selected), tab: 3 }, popupSender)).ok).toBe(false);
  app.sendMessage.mockResolvedValueOnce({ safe: false });
  expect((await app.recoverSelectedChatTab(recoveryRequest(selected), popupSender)).ok).toBe(false);
  app.call.mockResolvedValueOnce({ ok: false, data: { ok: false } });
  expect((await app.recoverSelectedChatTab(recoveryRequest(selected), popupSender)).ok).toBe(false);
  expect(app.windowCreate).not.toHaveBeenCalled();
  expect(app.move).not.toHaveBeenCalled();
  expect(app.tabs.size).toBe(1);
});

it('removes a pre-registered tab if its transfer into the existing owner fails', async () => {
  const selected = { id: 2, windowId: 10, url: 'https://chatgpt.com/c/task', active: true };
  const app = harness([{ id: 1, windowId: 9, url: 'https://chatgpt.com/c/other' }, selected], 9);
  app.move.mockRejectedValueOnce(new Error('move denied'));
  expect((await app.recoverSelectedChatTab(recoveryRequest(selected), popupSender)).ok).toBe(false);
  expect(app.stored.chatBackgroundTabs).toEqual([1]);
  expect(app.tabs.get(2)?.windowId).toBe(10);
  expect(app.windowCreate).not.toHaveBeenCalled();
});

it('keeps the selected tab visible and unclaimed if post-move idle proof fails', async () => {
  const selected = { id: 2, windowId: 10, url: 'https://chatgpt.com/c/task', active: true };
  const app = harness([selected]);
  app.sendMessage.mockResolvedValueOnce({ safe: true })
    .mockResolvedValueOnce({ safe: true }).mockResolvedValueOnce({ safe: false });
  expect((await app.recoverSelectedChatTab(recoveryRequest(selected), popupSender)).ok).toBe(false);
  expect(app.windowCreate).toHaveBeenCalledWith({ tabId: 2, type: 'normal', state: 'minimized', focused: false });
  expect(app.windowCreate).toHaveBeenCalledWith({ tabId: 2, type: 'normal', focused: true });
  expect(app.tabs.size).toBe(1);
  expect(app.stored.chatBackgroundWindow).toBeUndefined();
  expect(app.windows.get(app.tabs.get(2)!.windowId)).toMatchObject({ state: 'normal', focused: true });
});
