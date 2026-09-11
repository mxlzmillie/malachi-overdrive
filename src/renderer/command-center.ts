import { el, icon } from './dom.js';

export type CommandGroup = 'projects' | 'chats' | 'actions';
export type CommandScope = 'all' | CommandGroup | 'active' | 'issues';
export interface WorkCommand {
  id: string;
  label: string;
  detail: string;
  group: CommandGroup;
  icon: string;
  keywords?: string;
  badge?: string;
  active?: boolean;
  issues?: boolean;
  disabled?: string;
  run: () => void | Promise<void>;
}
export interface CommandSnapshot {
  entries: WorkCommand[];
  context: string;
  browser: boolean | null;
  readOnly: boolean | null;
  loadedRecordings: number;
  totalRecordings: number;
  loadingRecordings?: boolean;
  loadMoreRecordings?: () => Promise<void>;
}

const normal = (value: string) => value.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().trim();

/** Bounded, local ranking. Titles beat descriptions; every search term must match. */
export function rankCommands(entries: WorkCommand[], query: string, scope: CommandScope): WorkCommand[] {
  const needle = normal(query.slice(0, 256));
  const terms = needle.split(/\s+/).filter(Boolean).slice(0, 12);
  return entries.flatMap((entry, index) => {
    if (scope === 'active' ? !entry.active : scope === 'issues' ? !entry.issues : scope !== 'all' && entry.group !== scope) return [];
    const label = normal(entry.label), haystack = `${label} ${normal(entry.detail)} ${normal(entry.keywords ?? '')}`;
    if (!terms.every(term => haystack.includes(term))) return [];
    const score = !needle ? 0 : (label === needle ? 1000 : label.startsWith(needle) ? 500 : label.includes(needle) ? 250 : 0) +
      terms.reduce((total, term) => total + (label.includes(term) ? 40 : 0), 0);
    return [{ entry, score, index }];
  }).sort((a, b) => b.score - a.score || a.index - b.index).map(row => row.entry);
}

/** A view over existing renderer state. No filesystem, network, new timers or tool authority. */
export function createCommandCenter(options: {
  trigger: HTMLButtonElement;
  snapshot: () => CommandSnapshot;
  error: (message: string) => void;
}): { open: (scope?: CommandScope, query?: string) => void; refresh: () => void; destroy: () => void } {
  let dialog: HTMLDialogElement | null = null;
  let search: HTMLInputElement;
  let results: HTMLElement;
  let status: HTMLElement;
  let stats: HTMLElement;
  let context: HTMLElement;
  let filters: HTMLElement;
  let history: HTMLButtonElement;
  let scope: CommandScope = 'all';
  let selected: string | null = null;
  let shown: WorkCommand[] = [];
  let previousFocus: HTMLElement | null = null;
  const rows = new Map<string, { node: HTMLElement; title: HTMLElement; detail: HTMLElement; badge: HTMLElement; glyph: SVGElement; icon: string }>();
  let rowSequence = 0;
  const prefix = `overdrive-${crypto.randomUUID()}`;
  const shortcut = /Mac|iPhone|iPad/.test(window.navigator.platform) ? '⌘ K' : 'Ctrl K';
  options.trigger.title = `Open command centre (${shortcut})`;
  options.trigger.setAttribute('aria-haspopup', 'dialog');
  options.trigger.setAttribute('aria-expanded', 'false');
  options.trigger.setAttribute('aria-keyshortcuts', 'Meta+K Control+K');
  options.trigger.querySelector('kbd')?.replaceChildren(document.createTextNode(shortcut));

  function close(restore = true): void {
    if (!dialog) return;
    dialog.close(); dialog.remove(); dialog = null;
    rows.clear();
    options.trigger.setAttribute('aria-expanded', 'false');
    if (restore && previousFocus?.isConnected) previousFocus.focus();
  }

  function select(id: string | null, scroll = false): void {
    selected = id;
    for (const row of results.querySelectorAll<HTMLElement>('[role="option"]')) {
      const active = row.dataset.command === id;
      row.setAttribute('aria-selected', String(active));
      if (active) {
        search.setAttribute('aria-activedescendant', row.id);
        if (scroll) row.scrollIntoView?.({ block: 'nearest' });
      }
    }
    if (!id) search.removeAttribute('aria-activedescendant');
  }

  async function execute(id: string): Promise<void> {
    if (!dialog?.open) return;
    // Resolve against current state again: an open palette cannot resurrect deleted work.
    const entry = options.snapshot().entries.find(row => row.id === id);
    if (!entry || entry.disabled) {
      refresh(); status.textContent = entry?.disabled ?? 'This item is no longer available.';
      return;
    }
    close(false);
    try { await entry.run(); }
    catch (error) { options.error(error instanceof Error ? error.message : String(error)); }
  }

  function setScope(next: CommandScope): void {
    scope = next; selected = null; results.scrollTop = 0; refresh(); search.focus();
  }

  function stat(label: string, value: string, target?: CommandScope): HTMLElement {
    const box = el(target ? 'button' : 'div', 'command-stat');
    box.append(el('strong', '', value), el('span', '', label));
    if (target) {
      box.setAttribute('type', 'button'); box.setAttribute('aria-pressed', String(scope === target));
      box.addEventListener('click', () => setScope(scope === target ? 'all' : target));
    }
    return box;
  }

  function refresh(): void {
    if (!dialog?.open) return;
    const data = options.snapshot();
    context.textContent = data.context;
    // Update values in place: a pushed recording must not detach a focused filter button.
    const values = [String(data.entries.filter(row => row.group === 'chats' && row.active).length),
      String(data.entries.filter(row => row.group === 'chats' && row.issues).length),
      data.browser === null ? 'Unknown' : data.browser ? 'Connected' : 'Offline'];
    for (const [index, value] of values.entries()) stats.children[index]!.querySelector('strong')!.textContent = value;
    stats.children[0]!.setAttribute('aria-pressed', String(scope === 'active'));
    stats.children[1]!.setAttribute('aria-pressed', String(scope === 'issues'));
    for (const button of filters.querySelectorAll<HTMLButtonElement>('button')) button.setAttribute('aria-pressed', String(button.dataset.scope === scope));
    const matches = rankCommands(data.entries, search.value, scope);
    shown = matches.slice(0, 50);
    const scrollTop = results.scrollTop;
    const retained = new Set(shown.map(entry => entry.id));
    for (const [id, row] of rows) if (!retained.has(id)) { row.node.remove(); rows.delete(id); }
    results.querySelector('.command-empty')?.remove();
    // Recording pushes can arrive several times per second. Keep each result's node and
    // ARIA identity, updating text in place; rebuilding the list discards scroll/hover state.
    for (const [index, entry] of shown.entries()) {
      let row = rows.get(entry.id);
      if (!row) {
        const node = el('div', 'command-result'); node.id = `${prefix}-row-${rowSequence++}`;
        node.dataset.command = entry.id; node.setAttribute('role', 'option');
        const copy = el('div', 'command-result-copy');
        const title = el('strong'), detail = el('span'), badge = el('span', 'command-result-badge');
        const glyph = icon(entry.icon); glyph.setAttribute('aria-hidden', 'true');
        copy.append(title, detail); node.append(glyph, copy, badge);
        node.addEventListener('pointermove', () => select(entry.id));
        node.addEventListener('click', () => void execute(entry.id));
        row = { node, title, detail, badge, glyph, icon: entry.icon }; rows.set(entry.id, row);
      }
      for (const [node, value] of [[row.title, entry.label], [row.detail, entry.disabled ?? entry.detail], [row.badge, entry.badge ?? entry.group]] as const) {
        if (node.textContent !== value) node.textContent = value;
      }
      row.node.setAttribute('aria-disabled', String(!!entry.disabled));
      row.node.title = `${entry.label}\n${entry.disabled ?? entry.detail}`;
      if (row.icon !== entry.icon) {
        const glyph = icon(entry.icon); glyph.setAttribute('aria-hidden', 'true');
        row.glyph.replaceWith(glyph); row.glyph = glyph; row.icon = entry.icon;
      }
      if (results.children[index] !== row.node) results.insertBefore(row.node, results.children[index] ?? null);
    }
    if (!shown.length) results.append(el('p', 'command-empty', scope === 'active' ? 'No active chats match this view.' : scope === 'issues' ? 'No chats with recorded issues match this view.' : 'No matches. Try a project name, a chat title or an action.'));
    results.scrollTop = scrollTop;
    select(shown.some(row => row.id === selected) ? selected : shown[0]?.id ?? null);
    history.hidden = !data.loadMoreRecordings;
    history.disabled = data.loadingRecordings === true;
    history.textContent = data.loadingRecordings ? 'Loading older chats…' : 'Load older chats';
    const permission = data.readOnly === null ? 'Permissions not loaded' : data.readOnly ? 'Read-only mode' : 'Existing permissions apply';
    status.textContent = `${matches.length > 50 ? `First 50 of ${matches.length} matches · refine your search. ` : `${matches.length} results · `}${data.loadedRecordings} of ${data.totalRecordings} recordings loaded · ${permission}.`;
    status.title = 'Search covers loaded recordings. Load older chats here or scroll the conversation list for more history.';
  }

  function open(next: CommandScope = 'all', query = ''): void {
    if (dialog) { scope = next; search.value = query; selected = null; refresh(); search.focus(); return; }
    // Do not take focus from a file picker, settings confirmation or another modal.
    if (document.querySelector('dialog[open]')) return;
    previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    scope = next; selected = null;
    dialog = document.createElement('dialog'); dialog.className = 'overdrive-command-center';
    dialog.setAttribute('aria-labelledby', `${prefix}-title`);
    const head = el('div', 'command-head');
    const heading = el('div');
    heading.append(el('span', 'command-eyebrow', 'MALACHI OVERDRIVE'));
    const title = el('h2', '', 'Command centre'); title.id = `${prefix}-title`; heading.append(title);
    const exit = el('button', 'btn command-close', 'Esc') as HTMLButtonElement;
    exit.type = 'button'; exit.setAttribute('aria-label', 'Close command centre'); exit.addEventListener('click', () => close());
    head.append(heading, exit);
    context = el('p', 'command-context');
    stats = el('div', 'command-stats');
    stats.append(stat('Active chats', '0', 'active'), stat('Chats with recorded issues', '0', 'issues'), stat('Browser transport', 'Unknown'));
    stats.children[1]!.setAttribute('title', 'Recorded errors or blocked chats, not a claim that past errors remain unresolved.');
    const field = el('div', 'command-search');
    search = document.createElement('input'); search.type = 'text'; search.value = query; search.maxLength = 256;
    search.placeholder = 'Find a project, chat or action…'; search.autocomplete = 'off'; search.spellcheck = false;
    search.setAttribute('aria-label', 'Search loaded chats, projects and actions');
    search.setAttribute('role', 'combobox'); search.setAttribute('aria-autocomplete', 'list');
    search.setAttribute('aria-expanded', 'true'); search.setAttribute('aria-controls', `${prefix}-results`);
    const searchIcon = icon('i-search'); searchIcon.setAttribute('aria-hidden', 'true'); field.append(searchIcon, search);
    filters = el('div', 'command-filters'); filters.setAttribute('role', 'group'); filters.setAttribute('aria-label', 'Filter commands');
    for (const [id, label] of [['all', 'All'], ['projects', 'Projects'], ['chats', 'Chats'], ['actions', 'Actions'], ['active', 'Active'], ['issues', 'Issues']] as const) {
      const button = el('button', '', label) as HTMLButtonElement; button.type = 'button'; button.dataset.scope = id;
      button.addEventListener('click', () => setScope(id)); filters.append(button);
    }
    results = el('div', 'command-results'); results.id = `${prefix}-results`;
    results.setAttribute('role', 'listbox'); results.setAttribute('aria-label', 'Matching commands');
    status = el('p', 'command-status'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
    history = el('button', 'btn command-history', 'Load older chats') as HTMLButtonElement; history.type = 'button';
    history.addEventListener('click', async () => {
      const current = options.snapshot();
      if (current.loadingRecordings || !current.loadMoreRecordings) return;
      try { await current.loadMoreRecordings(); }
      catch (error) { options.error(error instanceof Error ? error.message : 'Could not load older chats.'); }
      finally { refresh(); }
    });
    const foot = el('div', 'command-footer');
    foot.append(el('span', '', '↑ ↓ Navigate  ·  Enter Open  ·  Esc Close'), el('span', '', 'Local search · briefs never auto-send'));
    dialog.append(head, context, stats, field, filters, results, history, status, foot);
    search.addEventListener('input', () => { selected = null; results.scrollTop = 0; refresh(); });
    search.addEventListener('keydown', event => {
      if (event.isComposing || event.altKey || event.ctrlKey || event.metaKey) return;
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        if (!shown.length) return;
        const index = shown.findIndex(row => row.id === selected);
        select(shown[(index + (event.key === 'ArrowDown' ? 1 : -1) + shown.length) % shown.length]!.id, true);
      } else if ((event.key === 'Home' || event.key === 'End') && !event.shiftKey && !search.value) {
        event.preventDefault(); select((event.key === 'Home' ? shown[0] : shown.at(-1))?.id ?? null, true);
      } else if (event.key === 'Enter' && !event.repeat) {
        event.preventDefault(); if (selected) void execute(selected);
      }
    });
    dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
    dialog.addEventListener('click', event => { if (event.target === dialog) {
      const bounds = dialog!.getBoundingClientRect();
      if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) close();
    } });
    document.body.append(dialog); dialog.showModal();
    options.trigger.setAttribute('aria-expanded', 'true'); refresh(); search.focus();
  }

  const onKey = (event: KeyboardEvent) => {
    if (event.defaultPrevented || event.isComposing || event.repeat || event.altKey || !(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'k') return;
    if (!dialog && document.querySelector('dialog[open]')) return;
    event.preventDefault(); dialog ? close() : open();
  };
  const onClick = () => open();
  document.addEventListener('keydown', onKey); options.trigger.addEventListener('click', onClick);
  return { open, refresh, destroy: () => { close(); document.removeEventListener('keydown', onKey); options.trigger.removeEventListener('click', onClick); } };
}
