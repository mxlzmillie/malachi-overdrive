import { JSDOM } from 'jsdom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createCommandCenter, rankCommands, type CommandSnapshot, type WorkCommand } from '../src/renderer/command-center.js';

const command = (id: string, label: string, group: WorkCommand['group'] = 'projects'): WorkCommand => ({
  id, label, group, detail: 'A local command', icon: 'i-folder', run: vi.fn()
});

it('ranks exact and prefix titles above description matches, with accent-insensitive AND search', () => {
  const entries = [
    { ...command('mention', 'Client work'), detail: 'Overdrive café project' },
    command('prefix', 'Overdrive café'), command('exact', 'Overdrive')
  ];
  expect(rankCommands(entries, 'OVERDRIVE', 'all').map(row => row.id)).toEqual(['exact', 'prefix', 'mention']);
  expect(rankCommands(entries, 'cafe overdrive', 'all').map(row => row.id)).toEqual(['prefix', 'mention']);
  expect(rankCommands(entries, 'missing overdrive', 'all')).toHaveLength(0);
  expect(entries[0]!.id).toBe('mention');
});

it('filters on explicit project, active and issue fields, preserving source order for empty search', () => {
  const entries = [command('p', 'Project'), { ...command('c', 'Chat', 'chats'), active: true }, { ...command('i', 'Old chat', 'chats'), issues: true }];
  expect(rankCommands(entries, '', 'projects').map(row => row.id)).toEqual(['p']);
  expect(rankCommands(entries, '', 'active').map(row => row.id)).toEqual(['c']);
  expect(rankCommands(entries, '', 'issues').map(row => row.id)).toEqual(['i']);
  expect(rankCommands(entries, '', 'all')).toEqual(entries);
});

let dom: JSDOM;
let center: ReturnType<typeof createCommandCenter>;
let snapshot: CommandSnapshot;
let error = vi.fn((_message: string) => {});
beforeEach(() => {
  dom = new JSDOM('<button id="trigger"><kbd></kbd></button><textarea id="draft">Keep my draft</textarea>', { url: 'https://local.test/', pretendToBeVisual: true });
  vi.stubGlobal('window', dom.window); vi.stubGlobal('document', dom.window.document); vi.stubGlobal('HTMLElement', dom.window.HTMLElement);
  dom.window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  dom.window.HTMLDialogElement.prototype.close = function () { this.open = false; };
  snapshot = { entries: [command('one', 'Overdrive'), command('two', 'GapStudy')], context: 'Working in Overdrive', browser: false, readOnly: true, loadedRecordings: 2, totalRecordings: 80 };
  error = vi.fn((_message: string) => {});
  center = createCommandCenter({ trigger: dom.window.document.querySelector('button')!, snapshot: () => snapshot, error });
});
afterEach(() => { center?.destroy(); dom?.window.close(); vi.unstubAllGlobals(); });
const search = () => dom.window.document.querySelector<HTMLInputElement>('[role="combobox"]')!;
const key = (key: string, fields: KeyboardEventInit = {}) => new dom.window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...fields });

it('opens from a shortcut while preserving the draft and restores focus on cancellation', () => {
  const draft = dom.window.document.querySelector('textarea')!; draft.focus();
  draft.dispatchEvent(key('k', { metaKey: true }));
  expect(dom.window.document.querySelectorAll('dialog[open]')).toHaveLength(1);
  expect(dom.window.document.activeElement).toBe(search());
  expect(search().getAttribute('aria-activedescendant')).toBe(dom.window.document.querySelector('[role="option"]')!.id);
  dom.window.document.querySelector('dialog')!.dispatchEvent(new dom.window.Event('cancel', { cancelable: true }));
  expect(dom.window.document.activeElement).toBe(draft);
  expect(draft.value).toBe('Keep my draft');
  expect(snapshot.entries[0]!.run).not.toHaveBeenCalled();
});

it('wraps arrow navigation and executes only the chosen item once', async () => {
  center.open(); search().dispatchEvent(key('ArrowUp')); search().dispatchEvent(key('Enter'));
  await Promise.resolve();
  expect(snapshot.entries[0]!.run).not.toHaveBeenCalled();
  expect(snapshot.entries[1]!.run).toHaveBeenCalledTimes(1);
  expect(dom.window.document.querySelector('dialog')).toBeNull();
});

it('does not execute an IME confirmation or repeated Enter', () => {
  center.open(); search().dispatchEvent(key('Enter', { isComposing: true })); search().dispatchEvent(key('Enter', { repeat: true }));
  expect(snapshot.entries[0]!.run).not.toHaveBeenCalled();
});

it('shows explicit loaded-history coverage and read-only/browser state', () => {
  center.open();
  expect(dom.window.document.querySelector('.command-status')!.textContent).toContain('2 of 80 recordings loaded');
  expect(dom.window.document.querySelector('.command-status')!.textContent).toContain('Read-only mode');
  expect(dom.window.document.querySelector('.command-stats')!.textContent).toContain('Offline');
  snapshot.browser = null; snapshot.readOnly = null; center.refresh();
  expect(dom.window.document.querySelector('.command-stats')!.textContent).toContain('Unknown');
  expect(dom.window.document.querySelector('.command-status')!.textContent).toContain('Permissions not loaded');
});

it('keeps search, focus and the selected identity across live snapshot refreshes', () => {
  center.open(); search().value = 'drive'; search().dispatchEvent(new dom.window.Event('input'));
  snapshot.entries.unshift(command('new', 'Drive control')); center.refresh();
  expect(search().value).toBe('drive'); expect(dom.window.document.activeElement).toBe(search());
  expect(dom.window.document.querySelector('[aria-selected="true"]')!.getAttribute('data-command')).toBe('one');
});

it('revalidates an item removed after rendering instead of calling its stale callback', async () => {
  const old = snapshot.entries[0]!;
  center.open(); snapshot.entries = [];
  search().dispatchEvent(key('Enter')); await Promise.resolve();
  expect(old.run).not.toHaveBeenCalled();
  expect(dom.window.document.querySelector('.command-status')!.textContent).toContain('no longer available');
  expect(search().hasAttribute('aria-activedescendant')).toBe(false);
});

it('keeps a focused status filter mounted when live state changes', () => {
  center.open();
  const filter = dom.window.document.querySelector('.command-stat') as HTMLButtonElement;
  filter.focus(); snapshot.entries.push({ ...command('c', 'New active chat', 'chats'), active: true }); center.refresh();
  expect(dom.window.document.activeElement).toBe(filter);
  expect(filter.querySelector('strong')!.textContent).toBe('1');
});

it('keeps result nodes, active-descendant identity and scroll position during streaming refreshes', () => {
  snapshot.entries = Array.from({ length: 40 }, (_, i) => command(String(i), `Project ${i}`));
  center.open();
  const results = dom.window.document.querySelector('.command-results') as HTMLElement;
  const first = results.firstElementChild;
  const identity = search().getAttribute('aria-activedescendant');
  results.scrollTop = 480;
  snapshot.entries[0]!.detail = 'Updated information';
  center.refresh(); center.refresh();
  expect(results.firstElementChild).toBe(first);
  expect(first!.textContent).toContain('Updated information');
  expect(search().getAttribute('aria-activedescendant')).toBe(identity);
  expect(results.scrollTop).toBe(480);
});

it('supports Home and End for large command lists and keeps issue filters available at short heights', () => {
  center.open(); search().dispatchEvent(key('End'));
  expect(dom.window.document.querySelector('[aria-selected="true"]')!.getAttribute('data-command')).toBe('two');
  search().dispatchEvent(key('Home'));
  expect(dom.window.document.querySelector('[aria-selected="true"]')!.getAttribute('data-command')).toBe('one');
  expect(dom.window.document.querySelector('[data-scope="issues"]')).not.toBeNull();
  expect(dom.window.document.querySelector('[data-scope="active"]')).not.toBeNull();
});

it('does not execute disabled commands and shows the actionable reason', () => {
  snapshot.entries[0]!.disabled = 'Select a project first.';
  center.open(); search().dispatchEvent(key('Enter'));
  expect(snapshot.entries[0]!.run).not.toHaveBeenCalled();
  expect(dom.window.document.querySelector('.command-status')!.textContent).toBe('Select a project first.');
});

it('renders untrusted titles as text and limits the painted result count', () => {
  snapshot.entries = Array.from({ length: 90 }, (_, index) => command(String(index), index === 0 ? '<img src=x onerror=alert(1)>' : `Project ${index}`));
  center.open();
  expect(dom.window.document.querySelectorAll('[role="option"]')).toHaveLength(50);
  expect(dom.window.document.querySelector('img')).toBeNull();
  expect(dom.window.document.querySelector('.command-result-copy strong')!.textContent).toBe('<img src=x onerror=alert(1)>');
  expect(dom.window.document.querySelector('.command-status')!.textContent).toContain('First 50 of 90 matches');
});

it('does not steal another modal and releases listeners on destroy', () => {
  const other = dom.window.document.createElement('dialog'); other.open = true; dom.window.document.body.append(other);
  center.open(); expect(dom.window.document.querySelectorAll('dialog')).toHaveLength(1);
  other.remove(); center.destroy();
  dom.window.document.dispatchEvent(key('k', { ctrlKey: true }));
  expect(dom.window.document.querySelector('dialog')).toBeNull();
});

it('supports clickable scope and issue filters without altering the source data', () => {
  snapshot.entries.push({ ...command('c', 'A chat', 'chats'), issues: true });
  center.open(); (dom.window.document.querySelector('[data-scope="chats"]') as HTMLButtonElement).click();
  expect(dom.window.document.querySelectorAll('[role="option"]')).toHaveLength(1);
  (dom.window.document.querySelectorAll('.command-stat')[1] as HTMLButtonElement).click();
  expect(dom.window.document.querySelector('[role="option"]')!.getAttribute('data-command')).toBe('c');
  expect(snapshot.entries).toHaveLength(3);
});

it('reports a rejected action without leaving a stale modal or an unhandled rejection', async () => {
  snapshot.entries[0]!.run = async () => { throw new Error('Unavailable project'); };
  center.open(); search().dispatchEvent(key('Enter')); await Promise.resolve(); await Promise.resolve();
  expect(error).toHaveBeenCalledWith('Unavailable project');
  expect(dom.window.document.querySelector('dialog')).toBeNull();
});

it('loads one older-history page only on request, retaining the query and preventing a duplicate read', async () => {
  let finish!: () => void;
  const load = vi.fn(async () => {
    snapshot.loadingRecordings = true; center.refresh();
    await new Promise<void>(resolve => { finish = resolve; });
    snapshot.entries.push(command('old', 'Older project chat', 'chats'));
    snapshot.loadedRecordings++; snapshot.loadingRecordings = false;
  });
  snapshot.loadMoreRecordings = load;
  center.open('chats', 'Older');
  expect(load).not.toHaveBeenCalled();
  const more = dom.window.document.querySelector('.command-history') as HTMLButtonElement;
  more.click(); more.click();
  expect(load).toHaveBeenCalledTimes(1); expect(more.disabled).toBe(true);
  finish(); await Promise.resolve(); await Promise.resolve();
  expect(search().value).toBe('Older');
  expect(dom.window.document.querySelector('[role="option"]')!.getAttribute('data-command')).toBe('old');
  expect(more.disabled).toBe(false);
});

it('keeps history-load failure visible without closing the palette or losing its search', async () => {
  snapshot.loadMoreRecordings = async () => { throw new Error('History unavailable'); };
  center.open('chats', 'Review');
  (dom.window.document.querySelector('.command-history') as HTMLButtonElement).click();
  await Promise.resolve(); await Promise.resolve();
  expect(error).toHaveBeenCalledWith('History unavailable');
  expect(search().value).toBe('Review'); expect(dom.window.document.querySelector('dialog[open]')).not.toBeNull();
});
