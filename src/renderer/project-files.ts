import type { LocalProject } from '../shared/projects.js';
import type { ProjectFile } from '../main/project-files.js';
import { el, run } from './dom.js';

let current: HTMLDialogElement | null = null;
/** Each dialog owns its loads; stale results never replace a newer selection. */
export function showProjectFiles(project: LocalProject, startChat: () => void): void {
  current?.close(); current?.remove();
  const dialog = document.createElement('dialog'); current = dialog;
  dialog.className = 'project-files-workspace';
  dialog.setAttribute('aria-label', `${project.name} files`);
  const header = el('header', 'project-files-header');
  const title = el('h2', '', project.name);
  const chat = el('button', 'btn', 'Work on this project');
  const close = el('button', 'btn', 'Back to chat');
  header.append(title, chat, close);
  const search = document.createElement('input'); search.type = 'search'; search.placeholder = 'Search every file — name, project or folder'; search.setAttribute('aria-label', 'Search project files');
  const status = el('p', 'muted', 'Loading your files…'); status.setAttribute('role', 'status');
  const body = el('div', 'project-files-body');
  const list = el('div', 'project-files-list'); list.setAttribute('aria-label', 'Project files');
  const preview = el('section', 'project-file-preview');
  preview.append(el('p', 'muted', 'Select a file to preview it here.'));
  body.append(list, preview); dialog.append(header, search, status, body);
  let files: ProjectFile[] = [], shown = 100, epoch = 0, note = '';
  const alive = () => current === dialog && dialog.isConnected;
  const dismiss = () => { epoch++; dialog.close(); dialog.remove(); if (current === dialog) current = null; };
  close.addEventListener('click', dismiss);
  chat.addEventListener('click', () => { dismiss(); startChat(); });
  dialog.addEventListener('cancel', event => { event.preventDefault(); dismiss(); });
  function paint(): void {
    const query = search.value.trim().toLowerCase();
    const matches = files.filter(file => file.path.toLowerCase().includes(query));
    status.textContent = `${matches.length.toLocaleString()} files${query ? ' matching your search' : ' · newest first'}${note}`;
    list.replaceChildren();
    for (const file of matches.slice(0, shown)) {
      const button = el('button', 'project-file-row'); button.setAttribute('type', 'button');
      const parts = file.path.split('/');
      button.append(el('strong', '', parts.pop()!), el('span', 'muted', parts.join(' / ') || project.name));
      button.addEventListener('click', async () => {
        const generation = ++epoch;
        list.querySelectorAll('[aria-pressed]').forEach(row => row.removeAttribute('aria-pressed'));
        button.setAttribute('aria-pressed', 'true');
        preview.replaceChildren(el('h3', '', file.path), el('p', 'muted', 'Loading preview…'));
        try {
          const result = await run(window.api.previewProjectFile(project.id, file.path));
          if (!alive() || generation !== epoch) return;
          if (!result) throw new Error('File preview could not be loaded.');
          preview.replaceChildren(el('h3', '', file.path), el('pre', '', result.text));
          if (result.truncated) preview.append(el('p', 'muted', 'Preview shows the first 128 KB. Your full file is unchanged.'));
        } catch (error) { if (alive() && generation === epoch) preview.replaceChildren(el('p', '', String(error))); }
      });
      list.append(button);
    }
    if (!matches.length) list.append(el('p', 'muted', query ? 'No matching files. Try another name.' : 'No available files in this project.'));
    if (matches.length > shown) {
      const more = el('button', 'btn', 'Show more files'); more.addEventListener('click', () => { shown += 100; paint(); }); list.append(more);
    }
  }
  search.addEventListener('input', () => { shown = 100; paint(); });
  document.body.append(dialog); dialog.showModal(); search.focus();
  void run(window.api.listProjectFiles(project.id)).then(result => {
    if (!alive()) return;
    if (!result) { status.textContent = 'Files could not be loaded. Reopen the project to try again.'; return; }
    files = result.files; note = `${result.limited ? ' · scan limit reached' : ''}${result.skipped ? ` · ${result.skipped} unavailable items skipped` : ''}`; paint();
  }).catch(error => { if (alive()) status.textContent = `Could not load files: ${String(error)}`; });
}

/** Curated work is selected by purpose, not by asking the user to choose source files. */
export function showWorkLibrary(projects: LocalProject[], openWork: (project: LocalProject) => void): void {
  current?.close(); current?.remove();
  const dialog = document.createElement('dialog'); current = dialog;
  dialog.className = 'project-files-workspace work-library'; dialog.setAttribute('aria-label', 'My work');
  const header = el('header', 'project-files-header');
  const close = el('button', 'btn', 'Back to chat');
  header.append(el('h2', '', 'Your work, organised'), close);
  const intro = el('p', 'muted', 'Choose what you want to work on. The right code, pictures and notes are already grouped together.');
  const search = document.createElement('input'); search.type = 'search'; search.placeholder = 'Find a website, app or design'; search.setAttribute('aria-label', 'Find your work');
  const grid = el('div', 'work-library-grid');
  const dismiss = () => { dialog.close(); dialog.remove(); if (current === dialog) current = null; };
  close.addEventListener('click', dismiss); dialog.addEventListener('cancel', event => { event.preventDefault(); dismiss(); });
  function paint(): void {
    grid.replaceChildren();
    const works = projects.filter(p => p.kind === 'work' && `${p.name} ${p.summary} ${p.category}`.toLowerCase().includes(search.value.toLowerCase()));
    for (const project of works) {
      const card = el('button', 'work-card'); card.setAttribute('type', 'button');
      card.append(el('span', 'work-card-category', project.category ?? 'Project'), el('h3', '', project.name), el('p', '', project.summary ?? ''), el('span', 'work-card-action', 'Continue this work →'));
      card.addEventListener('click', () => { dismiss(); openWork(project); }); grid.append(card);
    }
    if (!works.length) grid.append(el('p', 'muted', 'No matching work. Try another name.'));
  }
  search.addEventListener('input', paint); dialog.append(header, intro, search, grid);
  document.body.append(dialog); paint(); dialog.showModal();
}
