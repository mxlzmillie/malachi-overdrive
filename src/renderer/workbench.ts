import { el, icon } from './dom.js';
import { WORK_RECIPES } from './work-recipes.js';

export interface WorkbenchChat { id: string; title: string; project: string; active: boolean; draft: boolean }
export interface WorkbenchProject {
  id: string; name: string; category: string; summary: string; draft: boolean;
  latest: WorkbenchChat | null;
}
export interface WorkbenchSnapshot {
  projectName: string | null;
  projects: WorkbenchProject[];
  recent: WorkbenchChat[];
  existingChat: boolean;
}

/** A bounded start view over existing project/session/draft state. No storage or polling. */
export function createWorkbench(host: HTMLElement, actions: {
  project: (id: string) => void;
  chat: (id: string) => void;
  recipe: (id: string) => void;
  commands: () => void;
}): { update: (snapshot: WorkbenchSnapshot) => void } {
  let signature = '';
  const button = (label: string, className: string, action: string, id: string, run: () => void) => {
    const node = el('button', className, label) as HTMLButtonElement; node.type = 'button';
    node.dataset.workbenchAction = action; node.dataset.workbenchId = id;
    node.addEventListener('click', run); return node;
  };
  return { update(snapshot) {
    const data = { ...snapshot, projects: snapshot.projects.slice(0, 4), recent: snapshot.recent.slice(0, 3) };
    const next = JSON.stringify(data);
    if (next === signature) return;
    signature = next;
    const focused = host.contains(document.activeElement) ? document.activeElement as HTMLElement : null;
    const focusKey = focused ? [focused.dataset.workbenchAction, focused.dataset.workbenchId] : null;
    const header = el('div', 'workbench-head');
    const intro = el('div');
    intro.append(el('span', 'workbench-eyebrow', snapshot.projectName ? 'PROJECT WORKSPACE' : 'YOUR WORKSPACE'));
    intro.append(el('h1', '', snapshot.existingChat ? 'Your conversation is ready.' : snapshot.projectName ? snapshot.projectName : 'Your next move.'));
    intro.append(el('p', '', snapshot.existingChat ? 'No recorded messages in this view yet. Your composer is ready below.'
      : snapshot.projectName ? 'Continue a recent conversation or prepare your next task below.' : 'Pick up your work. Keep the context. Build something great.'));
    header.append(intro, button('All commands ↗', 'btn workbench-all', 'commands', '', actions.commands));
    const parts: HTMLElement[] = [header];
    if (!snapshot.existingChat && !snapshot.projectName && data.projects.length) {
      const grid = el('div', 'workbench-projects'); grid.setAttribute('aria-label', 'Your projects');
      for (const project of data.projects) {
        const card = el('article', 'workbench-project');
        const open = button('', 'workbench-project-open', 'project', project.id, () => actions.project(project.id));
        const top = el('span', 'workbench-project-top');
        top.append(icon('i-folder'), el('span', '', project.category || 'Project'));
        if (project.draft) top.append(el('span', 'workbench-draft', 'Unsent draft'));
        open.append(top, el('strong', '', project.name), el('span', 'workbench-project-summary', project.summary || 'Work with the files and context already in this project.'),
          el('span', 'workbench-project-action', project.draft ? 'Resume draft →' : 'Start a task →'));
        card.append(open);
        if (project.latest) {
          const latest = project.latest;
          const resume = button('', 'workbench-project-recent', 'chat', latest.id, () => actions.chat(latest.id));
          resume.setAttribute('aria-label', `Continue ${latest.title} in ${project.name}`);
          resume.append(icon('i-chat'), el('span', '', latest.title), el('span', 'workbench-recent-state', latest.active ? 'Active' : 'Open'));
          card.append(resume);
        }
        grid.append(card);
      }
      parts.push(grid);
    }
    if (!snapshot.existingChat) {
      const quick = el('section', 'workbench-quick');
      quick.append(el('h2', '', 'Start with a task brief'));
      const choices = el('div', 'workbench-recipes');
      for (const recipe of WORK_RECIPES.filter(row => ['build', 'fix', 'verify'].includes(row.id))) {
        const choice = button('', 'workbench-recipe', 'recipe', recipe.id, () => actions.recipe(recipe.id));
        choice.title = recipe.detail; choice.append(icon(recipe.icon), el('span', '', recipe.label)); choices.append(choice);
      }
      quick.append(choices); parts.push(quick);
      if (data.recent.length) {
        const recent = el('section', 'workbench-recent'); recent.append(el('h2', '', 'Recent conversations'));
        for (const chat of data.recent) {
          const open = button('', 'workbench-chat', 'chat', chat.id, () => actions.chat(chat.id));
          open.append(icon('i-chat'), el('span', 'workbench-chat-title', chat.title), el('span', 'workbench-chat-project', chat.project),
            el('span', 'workbench-recent-state', chat.draft ? 'Draft' : chat.active ? 'Active' : 'Open'));
          recent.append(open);
        }
        parts.push(recent);
      }
      parts.push(el('p', 'workbench-note', 'Drafts stay in this window. Task briefs never send automatically.'));
    }
    host.replaceChildren(...parts);
    if (focusKey) [...host.querySelectorAll<HTMLElement>('[data-workbench-action]')]
      .find(node => node.dataset.workbenchAction === focusKey[0] && node.dataset.workbenchId === focusKey[1])?.focus({ preventScroll: true });
  } };
}
