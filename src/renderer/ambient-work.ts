import { AMBIENT_STAGE_LABELS, type AmbientCompletion, type AmbientControlRequest, type AmbientModel, type AmbientOutput, type AmbientSnapshot, type AmbientTask } from '../shared/ambient-work.js';

export interface AmbientWorkOptions {
  host: HTMLElement;
  control: (request: AmbientControlRequest) => Promise<AmbientSnapshot | null>;
  output: (output: AmbientOutput) => Promise<unknown>;
  chat: (sessionId: string) => Promise<unknown>;
  workbench: (task: AmbientTask | null) => void;
  beforePreview?: () => void;
}

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text = ''): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag); node.className = className; node.textContent = text; return node;
}
function action(text: string, className = ''): HTMLButtonElement {
  const node = element('button', `ambient-action ${className}`, text); node.type = 'button'; return node;
}
export function ambientModelLabel(model: AmbientModel): string {
  if (!model.model) return 'Model selection not confirmed';
  return `${model.model} · ${model.reasoningEffort ?? 'reasoning not recorded'}${model.evidence === 'confirmed' ? ' · confirmed' : ' · requested, unconfirmed'}`;
}
function duration(start: number | null, end: number): string {
  if (!start) return '';
  const seconds = Math.max(0, Math.floor((end - start) / 1000));
  return seconds < 60 ? `${seconds}s` : seconds < 3600 ? `${Math.floor(seconds / 60)}m ${seconds % 60}s` : `${Math.floor(seconds / 3600)}h ${Math.floor(seconds / 60) % 60}m`;
}

/** Only presentation lives here. Closing either surface never calls a task control. */
export function createAmbientWork(options: AmbientWorkOptions) {
  const edge = element('aside', 'ambient-edge'); edge.setAttribute('aria-label', 'Ambient Work Mode');
  const capsule = action('', 'ambient-edge-main'); capsule.setAttribute('aria-expanded', 'false'); capsule.setAttribute('aria-controls', 'ambientWorkPreview');
  const signal = element('span', 'ambient-signal'); signal.setAttribute('aria-hidden', 'true');
  const capsuleState = element('span', 'ambient-edge-state', 'Idle');
  const capsuleTime = element('span', 'ambient-edge-time');
  const capsuleCount = element('span', 'ambient-edge-count'); capsule.append(signal, capsuleState, capsuleTime, capsuleCount); edge.append(capsule);

  const preview = element('section', 'ambient-peek'); preview.id = 'ambientWorkPreview'; preview.hidden = true;
  preview.setAttribute('aria-labelledby', 'ambientWorkHeading');
  const header = element('header', 'ambient-peek-head');
  const heading = element('div', 'ambient-heading');
  const eyebrow = element('span', 'ambient-eyebrow', 'AMBIENT WORK MODE');
  const title = element('h2', '', 'Your space. Work in motion.'); title.id = 'ambientWorkHeading';
  heading.append(eyebrow, title, element('p', '', 'Live activity, quietly in the background.'));
  const close = action('×', 'ambient-close'); close.setAttribute('aria-label', 'Close background preview'); header.append(heading, close);
  const body = element('div', 'ambient-peek-body');
  const chooserLabel = element('label', 'ambient-task-label', 'Task');
  const chooser = element('select', 'ambient-task-select'); chooser.setAttribute('aria-label', 'Background task'); chooserLabel.append(chooser);
  const statusRow = element('div', 'ambient-status-row'); const stage = element('span', 'ambient-stage');
  const elapsed = element('span', 'ambient-elapsed'); statusRow.append(stage, elapsed);
  const model = element('p', 'ambient-model');
  const latest = element('p', 'ambient-latest'); latest.setAttribute('role', 'status'); latest.setAttribute('aria-live', 'polite'); latest.setAttribute('aria-atomic', 'true');
  const progress = element('progress', 'ambient-progress'); progress.hidden = true; progress.setAttribute('aria-label', 'Acknowledged plan steps');
  const warning = element('p', 'ambient-warning'); warning.hidden = true;
  const workers = element('div', 'ambient-workers'); workers.setAttribute('aria-label', 'Workers and confirmed models');
  const outputs = element('div', 'ambient-outputs'); outputs.setAttribute('aria-label', 'Recorded outputs');
  const controls = element('div', 'ambient-controls');
  const controlNote = element('p', 'ambient-control-note');
  const message = element('p', 'ambient-control-status'); message.setAttribute('role', 'status');
  const footer = element('footer', 'ambient-peek-actions');
  const background = action('Keep in background'); const workbench = action('Open workbench', 'ambient-primary');
  const linked = action('Open linked chat'); footer.append(background, workbench, linked);
  body.append(chooserLabel, statusRow, model, latest, progress, warning, workers, outputs, controlNote, controls, message); preview.append(header, body, footer);

  const toast = element('aside', 'ambient-complete'); toast.hidden = true; toast.setAttribute('role', 'status'); toast.setAttribute('aria-live', 'polite');
  const toastCopy = element('div', 'ambient-complete-copy'); const toastTitle = element('strong', '', 'Work complete'); const toastDetail = element('span', ''); toastCopy.append(toastTitle, toastDetail);
  const toastOutput = action('Open output'); const toastClose = action('×', 'ambient-close'); toastClose.setAttribute('aria-label', 'Dismiss completion'); toast.append(toastCopy, toastOutput, toastClose);
  // In-flow notice reserves its own row: it cannot sit over the composer or header buttons.
  const noticeHost = options.host.querySelector('main') ?? options.host; noticeHost.prepend(toast);
  options.host.append(preview, edge); options.host.classList.add('has-ambient-work');

  let snapshot: AmbientSnapshot | null = null;
  let selected: string | null = null;
  let selectionEpoch = 0;
  let busy = false;
  let alive = true;
  let clock: ReturnType<typeof setInterval> | null = null;
  let toastTimer: ReturnType<typeof setTimeout> | null = null;
  let currentCompletion: AmbientCompletion | null = null;
  const seen = new Set<string>();
  const current = () => snapshot?.tasks.find(task => task.id === selected) ?? null;
  const taskIdentity = () => { const task = current(); return task ? `${task.sessionId}\u0000${task.conversationId}\u0000${task.turnId}` : null; };
  function setMessage(value: string) { message.textContent = value; }
  function dismissToast(restoreFocus = false) {
    const focusInside = toast.contains(document.activeElement);
    toast.hidden = true; currentCompletion = null; options.host.classList.remove('has-ambient-notice');
    if (toastTimer) clearTimeout(toastTimer); toastTimer = null;
    if (restoreFocus && focusInside) capsule.focus();
  }
  function expireToast() {
    // A timed notice must not remove a keyboard user's current action from under them.
    if (toast.contains(document.activeElement)) { toastTimer = setTimeout(expireToast, 1000); return; }
    dismissToast();
  }
  function notify(completion: AmbientCompletion) {
    currentCompletion = completion; toastDetail.textContent = completion.summary;
    toastOutput.hidden = !completion.output; toast.hidden = false; options.host.classList.add('has-ambient-notice');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(expireToast, 10000);
  }
  function hide(restoreFocus = false) {
    if (preview.hidden) return;
    const focusInside = preview.contains(document.activeElement);
    preview.hidden = true; options.host.classList.remove('has-ambient-peek'); capsule.setAttribute('aria-expanded', 'false');
    if (restoreFocus && focusInside) capsule.focus();
  }
  function open() {
    if (!preview.hidden) return;
    options.beforePreview?.(); preview.hidden = false; options.host.classList.add('has-ambient-peek'); capsule.setAttribute('aria-expanded', 'true');
    chooser.disabled ? close.focus() : chooser.focus();
  }
  function paintTime() {
    const task = current();
    const text = task ? duration(task.startedAt, task.live ? Date.now() : task.updatedAt) : '';
    capsuleTime.textContent = text; elapsed.textContent = text ? `${text} elapsed` : '';
  }
  async function perform(request: AmbientControlRequest) {
    if (busy) return;
    const epoch = selectionEpoch;
    const identity = taskIdentity();
    const ownsMessage = () => alive && epoch === selectionEpoch && identity === taskIdentity();
    busy = true; paintControls(); setMessage('Applying your request…');
    try {
      const next = await options.control(request);
      if (!alive) return;
      if (next) update(next);
      if (ownsMessage()) setMessage(next ? 'Request applied to this task.' : 'The request could not be confirmed. Inspect the current task before trying again.');
    } catch (error) {
      if (ownsMessage()) setMessage(error instanceof Error ? error.message : 'The task control could not be confirmed.');
    } finally { busy = false; if (alive) paintControls(); }
  }
  function paintControls() {
    const task = current();
    const foreground = task?.controls.find(control => control.action === 'foreground');
    controlNote.textContent = foreground?.reason ?? 'Pause stops automatic follow-ups; an in-flight reply continues. Stop targets this task only.';
    const wanted = new Set(task?.controls.map(control => control.action) ?? []);
    for (const node of [...controls.querySelectorAll<HTMLButtonElement>('button')]) if (!wanted.has(node.dataset.action as never)) node.remove();
    for (const control of task?.controls ?? []) {
      let node = controls.querySelector<HTMLButtonElement>(`[data-action="${control.action}"]`);
      if (!node) { node = action(control.label); node.dataset.action = control.action; controls.append(node); }
      node.textContent = control.label; node.disabled = busy || !control.enabled; node.title = control.reason ?? '';
      node.onclick = () => {
        const live = current(); const available = live?.controls.find(item => item.action === control.action);
        if (!live || !available?.enabled) return;
        void perform({ sessionId: live.sessionId, conversationId: live.conversationId, turnId: live.turnId, action: available.action, ...(available.inputId ? { inputId: available.inputId } : {}) });
      };
    }
  }
  function paintTask() {
    const task = current();
    const state = task?.state ?? 'idle'; edge.dataset.state = state;
    capsuleState.textContent = state.startsWith('waiting') ? 'Waiting' : state === 'opening-workspace' || state === 'selecting-model' || state === 'preparing' ? 'Setup' : state === 'packaging' || state === 'verifying' ? 'Working' : AMBIENT_STAGE_LABELS[state];
    const activeWorkers = new Set(snapshot?.tasks.flatMap(item => item.workers.filter(worker => worker.active).map(worker => `${worker.runId}:${worker.id}:${worker.conversationId}`)) ?? []);
    capsuleCount.textContent = activeWorkers.size ? `${activeWorkers.size} w` : '';
    capsule.setAttribute('aria-label', `Background work: ${AMBIENT_STAGE_LABELS[state]}. ${task?.title ?? 'No task selected'}. ${activeWorkers.size} active workers.`);
    stage.textContent = task?.stage ?? 'No active task'; stage.dataset.state = state;
    model.textContent = task ? ambientModelLabel(task.model) : 'Models are shown only from task evidence.';
    latest.textContent = task?.activity[0]?.description ?? (task?.live ? 'Waiting for a recorded activity update.' : 'Start a task in the composer. Its activity will appear here.');
    warning.hidden = !task?.warning && !snapshot?.error; warning.textContent = task?.warning ?? snapshot?.error ?? '';
    const fraction = task?.progress;
    progress.hidden = !fraction || fraction.total <= 0;
    if (fraction && fraction.total > 0) { progress.max = fraction.total; progress.value = fraction.completed; progress.setAttribute('aria-valuetext', `${fraction.completed} of ${fraction.total} plan steps acknowledged`); }
    // Reconcile by worker identity, retaining focused reveal buttons during activity pushes.
    for (const row of [...workers.children] as HTMLElement[]) if (!task?.workers.some(worker => `${worker.runId}:${worker.id}:${worker.conversationId}` === row.dataset.worker)) row.remove();
    for (const worker of task?.workers ?? []) {
      const key = `${worker.runId}:${worker.id}:${worker.conversationId}`;
      let row = [...workers.children].find(node => (node as HTMLElement).dataset.worker === key) as HTMLElement | undefined;
      if (!row) { row = element('div', 'ambient-worker'); row.dataset.worker = key; row.append(element('strong', ''), element('span', ''), action('Open chat')); workers.append(row); }
      row.querySelector('strong')!.textContent = `${worker.name} · ${worker.state}`;
      row.querySelector('span')!.textContent = ambientModelLabel(worker.model);
      const button = row.querySelector('button')!; button.disabled = !worker.sessionId; button.setAttribute('aria-label', `Open linked chat for ${worker.name}`);
      button.onclick = () => { const exact = current()?.workers.find(item => `${item.runId}:${item.id}:${item.conversationId}` === key); if (exact?.sessionId) void safely(() => options.chat(exact.sessionId!)); };
    }
    for (const row of [...outputs.children] as HTMLElement[]) if (!task?.outputs.some(output => output.id === row.dataset.output)) row.remove();
    for (const output of task?.outputs ?? []) {
      let node = [...outputs.children].find(row => (row as HTMLElement).dataset.output === output.id) as HTMLButtonElement | undefined;
      if (!node) { node = action(''); node.dataset.output = output.id; outputs.append(node); }
      node.textContent = output.name; node.setAttribute('aria-label', `Open output ${output.name}`);
      node.onclick = () => { const exact = current()?.outputs.find(item => item.id === output.id); if (exact) void safely(() => options.output(exact)); };
    }
    linked.disabled = !task?.sessionId; paintControls(); paintTime();
    if (clock) clearInterval(clock); clock = task?.live ? setInterval(paintTime, 1000) : null;
  }
  async function safely(work: () => Promise<unknown>) {
    try { await work(); } catch (error) { if (alive) setMessage(error instanceof Error ? error.message : 'This action could not be completed.'); }
  }
  function update(next: AmbientSnapshot) {
    if (!alive || (snapshot && next.revision < snapshot.revision)) return;
    const previousIdentity = taskIdentity();
    const first = snapshot === null; snapshot = next;
    if (!next.tasks.some(task => task.id === selected)) selected = next.tasks.find(task => task.live)?.id ?? next.tasks[0]?.id ?? null;
    if (previousIdentity !== taskIdentity()) { selectionEpoch++; setMessage(''); }
    const priorOptions = new Map([...chooser.options].map(option => [option.value, option]));
    for (const task of next.tasks) {
      const option = priorOptions.get(task.id) ?? document.createElement('option'); priorOptions.delete(task.id);
      option.value = task.id; option.textContent = task.title; if (!option.parentNode) chooser.append(option);
    }
    for (const option of priorOptions.values()) option.remove();
    chooser.value = selected ?? ''; chooser.disabled = !next.tasks.length;
    for (const completion of next.completions) {
      if (!first && next.notificationsEnabled && !seen.has(completion.id)) notify(completion);
      seen.add(completion.id);
    }
    // A settings/state push is passive. It may retire a notice, but must never
    // pull focus away from whatever the user is currently doing.
    if (!next.notificationsEnabled) dismissToast(false);
    paintTask();
  }
  const keydown = (event: KeyboardEvent) => {
    if (event.key !== 'Escape' || preview.hidden || document.querySelector('dialog[open]')) return;
    event.preventDefault(); hide(true);
  };
  document.addEventListener('keydown', keydown);
  capsule.onclick = () => preview.hidden ? open() : hide(true);
  close.onclick = () => hide(true); background.onclick = () => hide(true);
  chooser.onchange = () => { selected = chooser.value; selectionEpoch++; setMessage(''); paintTask(); };
  workbench.onclick = () => { const task = current(); hide(); options.workbench(task); };
  linked.onclick = () => { const task = current(); if (task?.sessionId) void safely(() => options.chat(task.sessionId)); };
  toastClose.onclick = () => dismissToast(true);
  toastOutput.onclick = () => { const output = currentCompletion?.output; if (output) void safely(() => options.output(output)); };
  capsule.setAttribute('aria-label', 'Background work: Idle. No active task.');
  return { update, open, hide, isOpen: () => !preview.hidden,
    destroy() { alive = false; if (clock) clearInterval(clock); dismissToast(); document.removeEventListener('keydown', keydown); edge.remove(); preview.remove(); toast.remove(); options.host.classList.remove('has-ambient-work', 'has-ambient-peek'); }
  };
}
