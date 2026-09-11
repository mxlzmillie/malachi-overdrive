import { JSDOM } from 'jsdom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createWorkbench, type WorkbenchSnapshot } from '../src/renderer/workbench.js';

let dom: JSDOM;
beforeEach(() => {
  dom = new JSDOM('<main id="host"></main>'); vi.stubGlobal('document', dom.window.document);
});
afterEach(() => { dom.window.close(); vi.unstubAllGlobals(); });
const data = (): WorkbenchSnapshot => ({ projectName: null, existingChat: false,
  projects: [{ id: 'overdrive', name: 'Overdrive', category: 'Desktop', summary: 'Custom source.', draft: true,
    latest: { id: 'chat-1', title: 'Fix delivery', project: 'Overdrive', active: true, draft: false } }],
  recent: [{ id: 'chat-1', title: 'Fix delivery', project: 'Overdrive', active: true, draft: false }] });
const boot = () => {
  const host = dom.window.document.getElementById('host')!;
  const actions = { project: vi.fn(), chat: vi.fn(), recipe: vi.fn(), commands: vi.fn() };
  return { host, actions, board: createWorkbench(host, actions) };
};

it('projects actual projects, drafts and recent chats without doing work on render', () => {
  const { host, actions, board } = boot(); board.update(data());
  expect(host.textContent).toContain('Resume draft'); expect(host.textContent).toContain('Fix delivery');
  for (const action of Object.values(actions)) expect(action).not.toHaveBeenCalled();
  (host.querySelector('[data-workbench-action="project"]') as HTMLButtonElement).click();
  expect(actions.project).toHaveBeenCalledWith('overdrive');
  (host.querySelector('[data-workbench-action="chat"]') as HTMLButtonElement).click();
  expect(actions.chat).toHaveBeenCalledWith('chat-1');
});

it('keeps unchanged controls and keyboard focus intact during recording notifications', () => {
  const { host, board } = boot(); const snapshot = data(); board.update(snapshot);
  const button = host.querySelector('button')!; button.focus(); board.update(structuredClone(snapshot));
  expect(host.querySelector('button')).toBe(button); expect(dom.window.document.activeElement).toBe(button);
  snapshot.projects[0]!.draft = false; board.update(snapshot);
  expect(dom.window.document.activeElement?.getAttribute('data-workbench-action')).toBe('commands');
});

it('bounds the start screen, renders hostile labels as text, and prepares only the clicked recipe', () => {
  const { host, board, actions } = boot(); const snapshot = data();
  snapshot.projects = Array.from({ length: 20 }, (_, i) => ({ ...snapshot.projects[0]!, id: String(i), name: '<img src=x onerror=alert(1)>' }));
  snapshot.recent = Array.from({ length: 20 }, (_, i) => ({ ...snapshot.recent[0]!, id: String(i) })); board.update(snapshot);
  expect(host.querySelectorAll('.workbench-project')).toHaveLength(4);
  expect(host.querySelectorAll('.workbench-chat')).toHaveLength(3); expect(host.querySelector('img')).toBeNull();
  (host.querySelector('[data-workbench-action="recipe"][data-workbench-id="fix"]') as HTMLButtonElement).click();
  expect(actions.recipe).toHaveBeenCalledOnce(); expect(actions.recipe).toHaveBeenCalledWith('fix');
});

it('keeps an existing empty conversation distinct from the new-project start screen', () => {
  const { host, board } = boot(); board.update({ ...data(), existingChat: true });
  expect(host.textContent).toContain('Your conversation is ready.');
  expect(host.querySelector('.workbench-projects')).toBeNull(); expect(host.querySelector('.workbench-recipes')).toBeNull();
});

it('shows selected project context without offering other projects as the current workspace', () => {
  const { host, board } = boot(); board.update({ ...data(), projectName: 'Overdrive' });
  expect(host.querySelector('h1')!.textContent).toBe('Overdrive');
  expect(host.querySelector('.workbench-projects')).toBeNull();
});
