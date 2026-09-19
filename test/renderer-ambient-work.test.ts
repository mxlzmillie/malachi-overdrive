import { JSDOM } from 'jsdom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ambientModelLabel, createAmbientWork } from '../src/renderer/ambient-work.js';
import type { AmbientSnapshot, AmbientTask } from '../src/shared/ambient-work.js';

const t0 = 1700000000000;
function task(id = 's1', extra: Partial<AmbientTask> = {}): AmbientTask {
  return { id, sessionId: id, conversationId: `chat-${id}`, turnId: 'turn-1', title: 'Verify the release', state: 'working', stage: 'Working',
    startedAt: t0, updatedAt: t0 + 1000, live: true, completionId: null, progress: null,
    model: { model: 'gpt-6-pro', reasoningEffort: 'pro', evidence: 'confirmed' }, workers: [], outputs: [], activity: [], warning: null,
    controls: [{ action: 'stop', label: 'Stop safely', enabled: true }, { action: 'pause', label: 'Pause follow-ups', enabled: true }], ...extra };
}
function snapshot(revision: number, tasks = [task()], extra: Partial<AmbientSnapshot> = {}): AmbientSnapshot {
  return { revision, tasks, completions: [], notificationsEnabled: true, ...extra };
}
describe('Ambient Work Mode', () => {
  let dom: JSDOM; let view: ReturnType<typeof createAmbientWork>;
  afterEach(() => { view?.destroy(); dom?.window.close(); vi.useRealTimers(); vi.unstubAllGlobals(); });
  function setup() {
    vi.useFakeTimers(); vi.setSystemTime(t0 + 1000);
    dom = new JSDOM('<div class="app"><main><textarea id="composer">My untouched draft</textarea><button id="pageAction">Page action</button></main></div>', { pretendToBeVisual: true });
    vi.stubGlobal('document', dom.window.document); vi.stubGlobal('window', dom.window);
    const callbacks = { control: vi.fn(async (): Promise<AmbientSnapshot | null> => null), output: vi.fn(async () => true), chat: vi.fn(async () => true), workbench: vi.fn() };
    view = createAmbientWork({ host: document.querySelector('.app')!, ...callbacks });
    return callbacks;
  }
  const node = <T extends HTMLElement = HTMLElement>(selector: string) => document.querySelector<T>(selector)!;
  const button = (text: string) => [...document.querySelectorAll<HTMLButtonElement>('button')].find(item => item.textContent === text)!;

  it('is always available, has no overlay or modal, and never opens the workbench from updates', () => {
    const callbacks = setup();
    expect(node('.ambient-edge')).toBeTruthy(); expect(view.isOpen()).toBe(false);
    view.update(snapshot(1)); node<HTMLButtonElement>('.ambient-edge-main').click();
    expect(view.isOpen()).toBe(true); expect(document.querySelector('[aria-modal],dialog,.control-rail-scrim')).toBeNull();
    node<HTMLButtonElement>('#pageAction').focus(); node<HTMLButtonElement>('#pageAction').click();
    view.update(snapshot(2)); expect(document.activeElement?.id).toBe('pageAction');
    expect(node<HTMLTextAreaElement>('#composer').value).toBe('My untouched draft');
    expect(callbacks.workbench).not.toHaveBeenCalled();
    button('Open workbench').click(); expect(callbacks.workbench).toHaveBeenCalledWith(expect.objectContaining({ id: 's1' })); expect(view.isOpen()).toBe(false);
  });
  it('closing and reopening retains the current task without cancelling any work', () => {
    const callbacks = setup(); view.update(snapshot(1)); view.open(); button('Keep in background').click();
    expect(callbacks.control).not.toHaveBeenCalled();
    view.update(snapshot(2, [task('s1', { stage: 'Verifying' })])); view.open();
    expect(node('.ambient-stage').textContent).toBe('Verifying'); expect(callbacks.control).not.toHaveBeenCalled();
  });
  it('restores capsule focus from the preview on Escape but preserves focus in the composer', () => {
    setup(); view.update(snapshot(1)); view.open();
    document.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(document.activeElement).toBe(node('.ambient-edge-main')); expect(view.isOpen()).toBe(false);
    view.open(); node('#composer').focus();
    document.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(document.activeElement).toBe(node('#composer'));
  });
  it('controls resolve the selected task at activation, preserve turn identity and never replay uncertain requests', async () => {
    const callbacks = setup(); view.update(snapshot(1, [task(), task('s2')])); view.open();
    const select = node<HTMLSelectElement>('select'); select.value = 's2'; select.dispatchEvent(new dom.window.Event('change'));
    view.update(snapshot(2, [task(), task('s2', { turnId: 'turn-2' })]));
    button('Stop safely').click(); await Promise.resolve(); await Promise.resolve();
    expect(callbacks.control).toHaveBeenCalledExactlyOnceWith({ sessionId: 's2', conversationId: 'chat-s2', turnId: 'turn-2', action: 'stop' });
    expect(node('.ambient-control-status').textContent).toContain('could not be confirmed');
    vi.advanceTimersByTime(60000); expect(callbacks.control).toHaveBeenCalledTimes(1);
  });
  it('keeps selected task and focused controls stable on independent activity pushes', () => {
    setup(); view.update(snapshot(1, [task(), task('s2')])); view.open();
    const select = node<HTMLSelectElement>('select'); select.value = 's2'; select.dispatchEvent(new dom.window.Event('change'));
    button('Stop safely').focus(); const focused = document.activeElement;
    view.update(snapshot(2, [task('s2', { updatedAt: t0 + 3000 }), task()]));
    expect(select.value).toBe('s2'); expect(document.activeElement).toBe(focused);
  });
  it.each(['resolved', 'rejected'] as const)('does not display a %s action result on a newly selected task', async outcome => {
    const callbacks = setup(); view.update(snapshot(1, [task(), task('s2')])); view.open();
    let resolve!: (value: AmbientSnapshot | null) => void; let reject!: (error: Error) => void;
    callbacks.control.mockImplementationOnce(() => new Promise((yes, no) => { resolve = yes; reject = no; }));
    button('Stop safely').click();
    const select = node<HTMLSelectElement>('select'); select.value = 's2'; select.dispatchEvent(new dom.window.Event('change'));
    if (outcome === 'resolved') resolve(snapshot(2, [task(), task('s2')])); else reject(new Error('Task one stop failed'));
    await Promise.resolve(); await Promise.resolve();
    expect(select.value).toBe('s2'); expect(node('.ambient-control-status').textContent).toBe('');
    expect(button('Stop safely').disabled).toBe(false);
  });
  it('does not retain an old-turn action message after the selected conversation advances', async () => {
    const callbacks = setup(); view.update(snapshot(1)); view.open();
    let resolve!: (value: AmbientSnapshot | null) => void;
    callbacks.control.mockImplementationOnce(() => new Promise(yes => { resolve = yes; }));
    button('Stop safely').click();
    view.update(snapshot(2, [task('s1', { turnId: 'turn-2' })]));
    resolve(snapshot(1)); await Promise.resolve(); await Promise.resolve();
    expect(node('.ambient-control-status').textContent).toBe('');
    expect(node('.ambient-stage').textContent).toBe('Working');
  });
  it('shows only new completion receipts once and never notifies for restored historical tasks', () => {
    setup(); const completed = { id: 's1:turn-1', taskId: 's1', summary: 'Release checks passed.' };
    view.update(snapshot(1, [task('s1', { state: 'complete', live: false })], { completions: [completed] }));
    expect(node('.ambient-complete').hidden).toBe(true);
    view.update(snapshot(2)); view.update(snapshot(3, [], { completions: [completed, { ...completed, id: 's1:turn-2' }] }));
    expect(node('.ambient-complete').hidden).toBe(false); expect(view.isOpen()).toBe(false);
    button('×').getAttribute('aria-label');
    node<HTMLButtonElement>('[aria-label="Dismiss completion"]').click();
    view.update(snapshot(4, [], { completions: [completed, { ...completed, id: 's1:turn-2' }] }));
    expect(node('.ambient-complete').hidden).toBe(true);
  });
  it('honors notification settings and opens only the recorded output attached to a notice', async () => {
    const callbacks = setup(); view.update(snapshot(1));
    const output = { id: 'o1', sessionId: 's1', eventSeq: 2, outputIndex: 0, name: 'report.pdf', kind: 'file' as const, createdAt: t0 };
    const completion = { id: 'done-1', taskId: 's1', summary: 'Report ready', output };
    view.update(snapshot(2, [], { completions: [completion], notificationsEnabled: false }));
    view.update(snapshot(3, [], { completions: [completion] })); expect(node('.ambient-complete').hidden).toBe(true);
    view.update(snapshot(4, [], { completions: [{ ...completion, id: 'done-2' }] })); button('Open output').click();
    expect(callbacks.output).toHaveBeenCalledExactlyOnceWith(output); expect(callbacks.chat).not.toHaveBeenCalled();
  });
  it('never moves focus when a passive settings push retires a completion notice', () => {
    setup(); view.update(snapshot(1));
    view.update(snapshot(2, [], { completions: [{ id: 'done-passive', taskId: 's1', summary: 'Finished' }] }));
    const close = node<HTMLButtonElement>('[aria-label="Dismiss completion"]'); close.focus();
    view.update(snapshot(3, [], { completions: [{ id: 'done-passive', taskId: 's1', summary: 'Finished' }], notificationsEnabled: false }));
    expect(node('.ambient-complete').hidden).toBe(true); expect(document.activeElement).toBe(close);
    expect(document.activeElement).not.toBe(node('.ambient-edge-main'));
  });
  it('defers notice expiry while its action has keyboard focus and never steals composer focus on expiry', () => {
    setup(); view.update(snapshot(1));
    view.update(snapshot(2, [], { completions: [{ id: 'done-focus', taskId: 's1', summary: 'Finished' }] }));
    const close = node<HTMLButtonElement>('[aria-label="Dismiss completion"]'); close.focus();
    vi.advanceTimersByTime(15000); expect(node('.ambient-complete').hidden).toBe(false); expect(document.activeElement).toBe(close);
    node('#composer').focus(); vi.advanceTimersByTime(1000);
    expect(node('.ambient-complete').hidden).toBe(true); expect(document.activeElement).toBe(node('#composer'));
  });
  it('restores accessible focus when the user explicitly dismisses the focused completion notice', () => {
    setup(); view.update(snapshot(1));
    view.update(snapshot(2, [], { completions: [{ id: 'done-dismiss', taskId: 's1', summary: 'Finished' }] }));
    const close = node<HTMLButtonElement>('[aria-label="Dismiss completion"]'); close.focus(); close.click();
    expect(node('.ambient-complete').hidden).toBe(true); expect(document.activeElement).toBe(node('.ambient-edge-main'));
  });
  it('never substitutes or claims the requested model is confirmed and never invents progress', () => {
    setup(); const requested = { model: 'gpt-6-astra-wm', reasoningEffort: 'ultra' as const, evidence: 'requested' as const };
    view.update(snapshot(1, [task('s1', { model: requested })]));
    expect(ambientModelLabel(requested)).toContain('requested, unconfirmed'); expect(node('.ambient-model').textContent).not.toContain('Sol');
    expect(node<HTMLProgressElement>('progress').hidden).toBe(true);
    vi.advanceTimersByTime(900000); expect(node<HTMLProgressElement>('progress').hidden).toBe(true); expect(node('.ambient-stage').textContent).toBe('Working');
  });
  it('ignores late snapshots and preserves independent model/effort evidence', () => {
    setup(); view.update(snapshot(5, [task('s1', { model: { model: 'gpt-6-pro', reasoningEffort: null, evidence: 'confirmed' } })]));
    view.update(snapshot(4, [task('s2')]));
    expect(node<HTMLSelectElement>('select').value).toBe('s1'); expect(node('.ambient-model').textContent).toContain('reasoning not recorded');
  });
});
