import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { expect, it, vi } from 'vitest';

const source = readFileSync('extension/background.js', 'utf8');
const code = source.slice(source.indexOf('function rootHelperMarker('), source.indexOf('/** Retire idle app-owned documents'));
const inputA = '11111111-1111-1111-1111-111111111111';
const inputB = '22222222-2222-2222-2222-222222222222';
const inputC = '33333333-3333-3333-3333-333333333333';
const catalogA = '44444444-4444-4444-4444-444444444444';
const catalogB = '55555555-5555-5555-5555-555555555555';
type Tab = { id: number; windowId: number; url: string; pendingUrl?: string };

function harness(initial: Tab[], options: { owned?: number[]; safe?: number[]; catalogOwner?: number } = {}) {
  const tabs = new Map(initial.map(tab => [tab.id, { ...tab }]));
  const owned = new Set(options.owned ?? initial.map(tab => tab.id));
  const safe = new Set(options.safe ?? initial.map(tab => tab.id));
  const documents = Object.fromEntries(initial.map(tab => [String(tab.id), `doc-${tab.id}`]));
  const epochs = Object.fromEntries(initial.map(tab => [String(tab.id), 1]));
  const removed: number[] = [];
  const stored: Record<string, unknown> = { chatBackgroundTabs: [...owned], rootHelperOrphans: {},
    modelCatalogOwner: options.catalogOwner ? { tab: options.catalogOwner } : null };
  const sendMessage = vi.fn(async (id: number, _message?: { type: string }) =>
    ({ safe: safe.has(id), conversationId: null, navigationEpoch: 1 }));
  const api = vm.runInNewContext(`${code}\n({ pruneAbandonedRootTabs })`, {
    URL, URLSearchParams, Promise, setTimeout, clearTimeout,
    conversationForTab: (tab: Tab) => new URL(tab.url).pathname.startsWith('/c/') ? new URL(tab.url).pathname.slice(3) : null,
    commandMarkerId: (id: string) => id && id.length <= 128 ? id : null,
    catalogTabNonce: (tab: Tab) => new URL(tab.url).searchParams.get('cos-model-catalog'),
    pluginRefreshMarker: (tab: Tab) => {
      const url = new URL(tab.url);
      return url.hash.startsWith('#settings/Plugins') ? url.searchParams.get('cos-plugin-refresh') : null;
    },
    inputOpenings: {}, tabDocuments: documents, tabEpochs: epochs,
    storedBackgroundWindow: async () => ({ id: 9 }),
    ownsDocument: (source: { tab: number; documentId: string; navigationEpoch: number }) =>
      documents[String(source.tab)] === source.documentId && source.navigationEpoch === 1,
    isolatedWorkerTab: async (tab: Tab) => owned.has(tab.id) && tabs.get(tab.id)?.windowId === tab.windowId,
    retireTabOnce: async (id: number, work: (remove: () => Promise<void>) => Promise<void>) => work(async () => {
      if (owned.has(id)) { tabs.delete(id); removed.push(id); }
    }),
    chrome: {
      storage: { session: { get: async () => ({ ...stored }), set: async (patch: object) => { Object.assign(stored, patch); } } },
      tabs: { get: async (id: number) => tabs.get(id) ? { ...tabs.get(id)! } : null, sendMessage }
    }
  }) as { pruneAbandonedRootTabs(tabs: Tab[], policy: object): Promise<void> };
  const age = () => { for (const key of Object.keys(stored.rootHelperOrphans as object))
    (stored.rootHelperOrphans as Record<string, number>)[key] = Date.now() - 61_000; };
  return { ...api, tabs, owned, documents, removed, sendMessage, stored, age };
}

const policy = (overrides: object = {}) => ({
  inputOpeningIds: [], inputReceipts: [], inputs: [], isolatedCommands: [],
  pluginRefreshRequests: [], modelCatalogRequest: null, ...overrides
});

it('retires only app-owned terminal root inputs after exact idle proof', async () => {
  const app = harness([
    { id: 1, windowId: 9, url: `https://chatgpt.com/?cos-input=${inputA}#cos-input=${inputA}` },
    { id: 2, windowId: 9, url: `https://chatgpt.com/?cos-input=${inputB}` },
    { id: 3, windowId: 10, url: `https://chatgpt.com/?cos-input=${inputC}` },
    { id: 4, windowId: 9, url: 'https://chatgpt.com/' },
    { id: 5, windowId: 9, url: 'https://chatgpt.com/c/real-chat' }
  ], { owned: [1, 2, 4, 5], safe: [1, 3] });
  await app.pruneAbandonedRootTabs([...app.tabs.values()], policy({ inputOpeningIds: [inputB] }));
  expect(app.removed).toEqual([]); // terminal observation starts the grace period
  app.age();
  await app.pruneAbandonedRootTabs([...app.tabs.values()], policy({ inputOpeningIds: [inputB] }));
  expect(app.removed).toEqual([1]);
  expect(app.tabs.has(2)).toBe(true); // app still owns the input
  expect(app.tabs.has(3)).toBe(true); // personal window is never cleanup authority
  expect(app.tabs.has(4)).toBe(true); // unmarked New Chat is never cleanup authority
  expect(app.tabs.has(5)).toBe(true); // conversation retention has a separate policy
});

it('keeps ambiguous send receipts and pages with a draft, generation or changed document', async () => {
  const app = harness([
    { id: 1, windowId: 9, url: `https://chatgpt.com/?cos-input=${inputA}` },
    { id: 2, windowId: 9, url: `https://chatgpt.com/?cos-input=${inputB}` },
    { id: 3, windowId: 9, url: `https://chatgpt.com/?clf=finished-command#clf=finished-command` }
  ], { safe: [1, 3] });
  app.sendMessage.mockImplementation(async id => {
    if (id === 3) app.documents['3'] = 'replaced-document';
    return { safe: id === 3, conversationId: null, navigationEpoch: 1 };
  });
  await app.pruneAbandonedRootTabs([...app.tabs.values()], policy({ inputReceipts: [{ id: inputA }] }));
  app.age();
  await app.pruneAbandonedRootTabs([...app.tabs.values()], policy({ inputReceipts: [{ id: inputA }] }));
  expect(app.removed).toEqual([]);
  expect(app.sendMessage).toHaveBeenCalledTimes(2); // only terminal candidates were probed
});

it('never assigns cleanup ownership to conflicting or repeated root markers', async () => {
  const app = harness([
    { id: 1, windowId: 9, url: `https://chatgpt.com/?cos-input=${inputA}#cos-input=${inputB}` },
    { id: 2, windowId: 9, url: `https://chatgpt.com/?cos-input=${inputA}&cos-input=${inputB}` },
    { id: 3, windowId: 9, url: `https://chatgpt.com/?clf=first#clf=second` },
    { id: 4, windowId: 9, url: `https://chatgpt.com/?cos-model-catalog=${catalogA}&cos-model-catalog=${catalogB}` }
  ]);
  await app.pruneAbandonedRootTabs([...app.tabs.values()], policy());
  app.age();
  await app.pruneAbandonedRootTabs([...app.tabs.values()], policy());
  expect(app.removed).toEqual([]);
  expect(app.sendMessage).not.toHaveBeenCalled();
});

it('bounds stale model catalog helpers while retaining the elected warm helper', async () => {
  const app = harness([
    { id: 1, windowId: 9, url: `https://chatgpt.com/?cos-model-catalog=${catalogA}` },
    { id: 2, windowId: 9, url: `https://chatgpt.com/?cos-model-catalog=${catalogB}` },
    { id: 3, windowId: 9, url: 'https://chatgpt.com/?cos-plugin-refresh=stale#settings/Plugins' }
  ], { catalogOwner: 1 });
  await app.pruneAbandonedRootTabs([...app.tabs.values()], policy());
  app.age();
  await app.pruneAbandonedRootTabs([...app.tabs.values()], policy());
  expect(app.removed.sort()).toEqual([2, 3]);
  expect(app.tabs.has(1)).toBe(true);
});

it('uses the settings-page idle proof for stale plugin helpers without a composer', async () => {
  const app = harness([{ id: 3, windowId: 9,
    url: 'https://chatgpt.com/?cos-plugin-refresh=stale#settings/Plugins' }]);
  app.sendMessage.mockImplementation(async (_id, message?: { type: string }) =>
    ({ safe: message?.type === 'clf-plugin-refresh-state', conversationId: null, navigationEpoch: 1 }));
  await app.pruneAbandonedRootTabs([...app.tabs.values()], policy());
  app.age();
  await app.pruneAbandonedRootTabs([...app.tabs.values()], policy());
  expect(app.sendMessage).toHaveBeenCalledWith(3,
    { type: 'clf-plugin-refresh-state', id: 'stale' }, { documentId: 'doc-3' });
  expect(app.removed).toEqual([3]);
});

it('drops the grace clock when an input becomes active or its document changes', async () => {
  const app = harness([{ id: 1, windowId: 9, url: `https://chatgpt.com/?cos-input=${inputA}` }]);
  await app.pruneAbandonedRootTabs([...app.tabs.values()], policy());
  expect(Object.keys(app.stored.rootHelperOrphans as object)).toHaveLength(1);
  app.age();
  await app.pruneAbandonedRootTabs([...app.tabs.values()], policy({ inputOpeningIds: [inputA] }));
  expect(app.stored.rootHelperOrphans).toEqual({});
  await app.pruneAbandonedRootTabs([...app.tabs.values()], policy());
  expect(app.removed).toEqual([]); // old sighting cannot skip a new terminal interval
  app.documents['1'] = 'replacement-doc';
  await app.pruneAbandonedRootTabs([...app.tabs.values()], policy());
  expect(Object.keys(app.stored.rootHelperOrphans as object)).toHaveLength(1);
});
