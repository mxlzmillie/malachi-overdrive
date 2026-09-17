import type { ChatModelCatalog } from '../shared/chat-models.js';
import { canonicalRequestedChatModel, chatModelDisplayLabel, chatModelDisplayName } from '../shared/chat-models.js';
import type { Config } from '../shared/types.js';
import type { ReasoningEffort } from '../shared/session.js';
import { $, el, run } from './dom.js';

let catalog: ChatModelCatalog = { state: 'unknown', requestedAt: null, observedAt: null, models: [] };
let generation = 0;
let onComposerPaint: (() => void) | undefined;
const catalogWaiters = new Set<() => void>();
let discovery: Promise<void> | null = null;
let catalogSubscribed = false;
type ObservedSelection = { model: string; reasoningEffort?: ReasoningEffort; observedAt: number };
let composerContext: { scope: string | null; observation: ObservedSelection | null; edited: boolean } | null = null;
// This is a renderer choice, never a provider model id. Null on the wire means do
// not touch the native picker in this existing conversation.
const CURRENT_BROWSER_MODEL = ':current-browser:';
export type ComposerModelSettings = { model: string; reasoningEffort: ReasoningEffort } | { model: null; reasoningEffort: null };
/** Read-only renderer projection for surfaces such as Control Rail; catalog ownership stays here. */
export function chatModelCatalogSummary(): Pick<ChatModelCatalog, 'state' | 'observedAt' | 'error'> & { count: number } {
  return { state: catalog.state, observedAt: catalog.observedAt, count: catalog.models.length, ...(catalog.error ? { error: catalog.error } : {}) };
}
const pairs = [['composerModel', 'composerReasoning'], ['workerModel', 'workerReasoning'], ['helperModel', 'helperReasoning']] as const;
const effortNames: Record<string, string> = { none: 'Instant', minimal: 'Minimal', low: 'Low', medium: 'Medium', high: 'High', xhigh: 'Extra high', max: 'Max', ultra: 'Ultra', pro: 'Pro' } satisfies Record<ReasoningEffort, string>;
const composerEfforts = ['low', 'medium', 'high', 'xhigh', 'max', 'ultra', 'pro'] as const;
function observedModel(value: string, effort?: ReasoningEffort | '' | null) {
  const normalize = (text: string) => text.toLowerCase().replace(/[^a-z0-9.]/g, '');
  const requested = canonicalRequestedChatModel(value, effort) ?? value.trim();
  const matches = catalog.models.filter(choice => choice.id === requested || choice.aliases?.includes(requested) || normalize(choice.label) === normalize(requested));
  return matches.length === 1 ? matches[0] : undefined;
}

function displayModelName(choice: { id: string; label: string }, effort?: ReasoningEffort): string {
  return chatModelDisplayName(choice.label, effort);
}

function displayModelLabel(choice: { id: string; label: string }, effort: ReasoningEffort): string {
  return chatModelDisplayLabel(choice.label, effort, effortNames[effort]!);
}

function canUseBrowserModel(): boolean {
  return !!composerContext?.scope && !!composerContext.observation;
}

function nativeModelOnly(): boolean {
  return canUseBrowserModel() && !observedModel(composerContext!.observation!.model);
}

function browserModelDescription(): string {
  const observed = composerContext?.observation;
  const recorded = observed ? `${observed.model}${observed.reasoningEffort ? ` · ${effortNames[observed.reasoningEffort]}` : ''}` : 'Unknown';
  return `Last recorded: ${recorded}. Sends with the model currently selected in ChatGPT, which may differ. Change the model and thinking effort in ChatGPT.`;
}

function paintComposerContext(): void {
  if (!composerContext || composerContext.edited) return;
  const observed = composerContext.observation;
  if (composerContext.scope === null) return;
  const match = observed && observedModel(observed.model);
  // A Work execution slug is not permission to select a similarly named Chat
  // model. Preserve the native choice when its identity is outside this catalog.
  paintPair('composerModel', 'composerReasoning', match?.id ?? (canUseBrowserModel() ? CURRENT_BROWSER_MODEL : 'not-observed'), observed?.reasoningEffort ?? 'not-observed');
}

/** Scope comes from the caller's session + selection generation; no browser mutation. */
export function applyComposerSessionModel(scope: string | null, observation: ObservedSelection | null): void {
  if (!composerContext || composerContext.scope !== scope) {
    composerContext = { scope, observation, edited: false };
    if (scope === null) paintPair('composerModel', 'composerReasoning', '', '');
  } else if (observation && (!composerContext.observation || observation.observedAt >= composerContext.observation.observedAt)) {
    composerContext.observation = observation;
  }
  paintComposerContext(); paintStatus();
}

/** Provider order and available efforts define the slider, including newly released models. */
function composerModels() {
  // The account catalog belongs to Chat. An unmatched conversation identity (for
  // example Work) cannot claim those controls merely because their labels look alike.
  if (!catalog.models.length || nativeModelOnly()) return [];
  return catalog.models
    .map(model => ({ ...model, efforts: composerEfforts.filter(effort => model.efforts.includes(effort)) }))
    .filter(model => model.efforts.length > 0);
}

function options(select: HTMLSelectElement, choices: Array<{ id: string; label: string }>, value: string, unavailableLabel?: string): void {
  const option = (label: string, id: string) => {
    const node = document.createElement('option'); node.textContent = label; node.value = id; return node;
  };
  const desired = choices.map(choice => option(choice.label, choice.id));
  if (!desired.length && !value) {
    const unavailable = option('No observed choices', ''); unavailable.disabled = true; desired.push(unavailable);
  }
  if (value && !choices.some(choice => choice.id === value)) {
    const unverified = option(unavailableLabel ?? `${value} · not verified`, value);
    unverified.disabled = true;
    desired.push(unverified);
  }
  // State pushes must not close a native picker or replace nodes while its choices are unchanged.
  if (select.options.length !== desired.length || desired.some((node, index) => {
    const current = select.options[index];
    return !current || current.value !== node.value || current.text !== node.text || current.disabled !== node.disabled;
  })) select.replaceChildren(...desired);
  select.value = value;
}

function paintPair(modelId: string, effortId: string, modelValue?: string, effortValue?: string): void {
  const model = document.getElementById(modelId) as HTMLSelectElement | null;
  const effort = document.getElementById(effortId) as HTMLSelectElement | null;
  if (!model || !effort) return;
  const models = modelId === 'composerModel' ? composerModels() : catalog.models;
  let nextModel = modelValue ?? model.value;
  let nextEffort = effortValue ?? effort.value;
  nextModel = observedModel(nextModel, nextEffort as ReasoningEffort | '' | null)?.id ?? nextModel;
  if (models.length && !nextModel) {
    // A preference selects only a model/effort actually observed in this catalog. Pro is the
    // strongest account-exposed GPT-6 variant and may be the only GPT-6 choice; requiring High
    // here silently demoted those accounts to the first (often 5.6) catalog row.
    const six = models.filter(item => /^gpt[ -]?6(?:$|[ -])/i.test(item.label));
    const preferred = six.find(item => item.efforts.includes('pro')) ??
      six.find(item => item.efforts.includes('high'));
    nextModel = (preferred ?? models[0]!).id;
    nextEffort = '';
  }
  const supported = models.find(item => item.id === nextModel)?.efforts;
  if (supported && !nextEffort) {
    nextEffort = supported.includes('high') ? 'high' : supported[0] ?? '';
  }
  const choices = models.map(choice => ({ ...choice, label: displayModelName(choice) }));
  if (modelId === 'composerModel' && canUseBrowserModel()) choices.unshift({ id: CURRENT_BROWSER_MODEL, label: 'Current browser model', efforts: [] });
  options(model, choices, nextModel, `${chatModelDisplayName(nextModel, nextEffort as ReasoningEffort)} · ${catalog.state === 'ready' ? 'Unavailable in ChatGPT' : 'not verified'}`);
  options(effort, (models.find(item => item.id === model.value)?.efforts ?? []).map(id => ({ id, label: effortNames[id] ?? id })), nextModel === CURRENT_BROWSER_MODEL ? '' : nextEffort);
}

function paintComposerChoices(): void {
  const models = document.getElementById('composerModelChoices');
  const powers = document.getElementById('composerPowerChoices');
  if (!models || !powers) return;
  const selected = $<HTMLSelectElement>('composerModel');
  const effort = $<HTMLSelectElement>('composerReasoning');
  const choices = composerModels();
  const signature = JSON.stringify([catalog.state, choices, selected.value, effort.value, composerContext?.scope, composerContext?.observation]);
  if (models.dataset.signature === signature) return;
  models.dataset.signature = signature;
  models.replaceChildren();
  powers.replaceChildren();
  if (canUseBrowserModel()) {
    const inherit = document.createElement('button');
    inherit.className = 'btn'; inherit.textContent = 'Use current browser model';
    inherit.type = 'button'; inherit.dataset.modelChoice = 'current-browser';
    inherit.setAttribute('aria-pressed', String(selected.value === CURRENT_BROWSER_MODEL));
    inherit.title = browserModelDescription();
    inherit.onclick = () => {
      if (!canUseBrowserModel()) return;
      composerContext!.edited = true;
      paintPair('composerModel', 'composerReasoning', CURRENT_BROWSER_MODEL, '');
      paintStatus();
    };
    models.append(inherit);
  }
  // Order supported levels from Low upwards; never manufacture an unobserved step.
  const steps = choices.flatMap(choice => choice.efforts.map(power => ({
    model: choice.id, modelLabel: displayModelName(choice, power), effort: power, label: displayModelLabel(choice, power)
  })));
  const title = document.getElementById('composerPowerTitle');
  const subtitle = document.getElementById('composerPowerModel');
  const inherited = selected.value === CURRENT_BROWSER_MODEL && canUseBrowserModel();
  if (!steps.length) {
    if (title) title.textContent = inherited ? 'Current browser model' : catalog.state === 'pending' ? 'Loading models…' : 'Models unavailable';
    if (subtitle) subtitle.textContent = inherited ? 'Uses ChatGPT’s native setting' : catalog.state === 'pending' ? 'Reading your ChatGPT account' : 'Reload models';
    return;
  }
  const current = steps.findIndex(step => step.model === selected.value && step.effort === effort.value);
  const track = el('div', 'power-track');
  const dots = el('div', 'power-dots'); dots.setAttribute('aria-hidden', 'true');
  dots.append(...steps.map(() => el('span', 'power-dot')));
  const slider = document.createElement('input'); slider.type = 'range'; slider.min = '0'; slider.max = String(steps.length - 1); slider.step = '1';
  slider.value = String(Math.max(0, current));
  slider.setAttribute('aria-label', 'Model and thinking effort');
  const show = () => {
    const step = steps[Number(slider.value)]!;
    if (title) title.textContent = effortNames[step.effort] ?? step.effort;
    if (subtitle) subtitle.textContent = step.modelLabel;
    slider.setAttribute('aria-valuetext', step.label);
    track.style.setProperty('--power-position', `${steps.length > 1 ? Number(slider.value) / (steps.length - 1) * 100 : 100}%`);
    return step;
  };
  if (current >= 0) show();
  else {
    if (title) title.textContent = inherited ? 'Current browser model' : 'Choose a level';
    if (subtitle) subtitle.textContent = inherited ? 'Uses ChatGPT’s native setting' : 'Previous selection unavailable';
    slider.setAttribute('aria-valuetext', 'Choose an available model and effort');
  }
  const choose = () => {
    if (composerContext) composerContext.edited = true;
    const step = show();
    paintPair('composerModel', 'composerReasoning', step.model, step.effort);
    models.querySelector('[data-model-choice="current-browser"]')?.setAttribute('aria-pressed', 'false');
    models.dataset.signature = JSON.stringify([catalog.state, choices, selected.value, effort.value, composerContext?.scope, composerContext?.observation]);
    paintStatus();
  };
  slider.oninput = choose;
  slider.onclick = () => { if (current < 0) choose(); };
  // Keep the range node alive through pointer/keyboard adjustment; hidden selects remain
  // the existing send authority, and no separate model selection state is introduced.
  track.append(dots, slider); powers.append(track);
}

/** Admission guard for desktop sends: a stale selection is not permission to use defaults. */
export function confirmedComposerModel(): ComposerModelSettings | null {
  const model = $<HTMLSelectElement>('composerModel').value;
  if (model === CURRENT_BROWSER_MODEL && canUseBrowserModel()) return { model: null, reasoningEffort: null };
  if (!catalog.models.length) return null;
  const reasoningEffort = $<HTMLSelectElement>('composerReasoning').value;
  const confirmed = composerModels().find(choice => choice.id === model)?.efforts.find(effort => effort === reasoningEffort);
  return confirmed ? { model, reasoningEffort: confirmed } : null;
}

function paintComposerLabel(): void {
  // Display the same admission decision as Send, including discovery and removed efforts.
  const confirmed = confirmedComposerModel();
  const selected = confirmed?.model === null ? undefined : composerModels().find(model => model.id === confirmed?.model);
  const label = confirmed
    ? confirmed.model === null ? 'Current browser model' : selected ? displayModelLabel(selected, confirmed.reasoningEffort) : confirmed.model
    : catalog.state === 'pending' ? 'Loading models…' : 'Select model';
  const node = $('composerModelLabel');
  node.textContent = label;
  node.title = confirmed?.model === null ? browserModelDescription() : label;
  onComposerPaint?.();
}

function paintStatus(): void {
  paintComposerChoices();
  // An unavailable saved choice stays selected and unsendable until the person
  // chooses another model or a refreshed account catalog confirms the same pair.
  const unavailableChoice = (modelId: string, effortId: string): string | null => {
    const model = $<HTMLSelectElement>(modelId).value;
    const value = $<HTMLSelectElement>(effortId).value;
    if (!model || model === CURRENT_BROWSER_MODEL || model === 'not-observed' || !value || value === 'not-observed') return null;
    const effort = value as ReasoningEffort;
    const choices = modelId === 'composerModel' ? composerModels() : catalog.models;
    const choice = choices.find(item => item.id === model);
    return choice?.efforts.includes(effort) ? null : displayModelLabel(choice ?? { id: model, label: model }, effort);
  };
  const unavailable = unavailableChoice('composerModel', 'composerReasoning');
  const savedUnavailable = pairs.slice(1).map(([model, effort]) => unavailableChoice(model, effort)).filter(Boolean);
  const message = catalog.state === 'pending' ? 'Reading your account’s model choices…'
    : catalog.state === 'ready' ? savedUnavailable.length
      ? `Saved choices unavailable in the current ChatGPT model list: ${[...new Set(savedUnavailable)].join(', ')}. Choose an available model or reload models.`
      : `Available in your ChatGPT account · checked ${new Date(catalog.observedAt!).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
    : catalog.error ?? 'Connect to ChatGPT to load your models.';
  for (const id of ['chatModelStatus', 'composerModelStatus']) {
    const node = document.getElementById(id);
    if (node) {
      node.textContent = id === 'composerModelStatus' ? (catalog.state === 'pending' ? 'Loading models…' : catalog.error ?? 'Models unavailable · retry discovery') : message;
      if (id === 'composerModelStatus') {
        const inherited = confirmedComposerModel()?.model === null;
        const nativeOnly = nativeModelOnly();
        if (inherited || nativeOnly) node.textContent = browserModelDescription();
        else if (unavailable && catalog.state === 'ready') node.textContent = `${unavailable} is unavailable in the current ChatGPT model list. Choose an available model or reload models.`;
        node.hidden = !inherited && !nativeOnly && !unavailable && catalog.state === 'ready';
      }
    }
  }
  for (const id of ['refreshChatModels', 'refreshComposerModels']) {
    const button = document.getElementById(id) as HTMLButtonElement | null;
    if (button) {
      // Refresh can promote passive discovery; main coalesces repeated explicit clicks.
      button.disabled = false;
      if (id === 'refreshComposerModels') {
        button.hidden = false;
        button.title = catalog.state === 'pending' ? 'Reading ChatGPT models' : 'Reload ChatGPT models';
        button.setAttribute('aria-label', button.title);
      }
    }
  }
  paintComposerLabel();
  for (const waiter of catalogWaiters) waiter();
}

/** Refresh and Send share one request; state pushes complete waiting sends without polling. */
function discoverModels(): Promise<void> {
  if (discovery) return discovery;
  const requested = ++generation;
  catalog = { ...catalog, state: 'pending', requestedAt: Date.now(), error: undefined };
  paintStatus();
  const work = (async () => {
    const result = await run(window.api.requestChatModels()).catch(() => null);
    if (requested !== generation) return;
    catalog = result ?? { ...catalog, state: 'unavailable', error: 'Model discovery could not start.' };
    for (const [modelId, effortId] of pairs) paintPair(modelId, effortId);
    paintComposerContext(); paintStatus();
  })();
  discovery = work.finally(() => { discovery = null; });
  return discovery;
}

export async function ensureComposerModel(): Promise<ReturnType<typeof confirmedComposerModel>> {
  const confirmed = confirmedComposerModel();
  if (confirmed) return confirmed;
  if (catalog.models.length) return confirmedComposerModel();
  const ready = new Promise<void>(resolve => {
    const finish = () => { clearTimeout(timer); catalogWaiters.delete(check); resolve(); };
    const check = () => { if (catalog.state === 'ready' || catalog.state === 'unavailable') finish(); };
    const timer = setTimeout(finish, 125000);
    catalogWaiters.add(check);
  });
  await discoverModels();
  await ready;
  return confirmedComposerModel();
}

export function applyChatModels(config: Config, previous?: Config): void {
  // Preserve configured values even before an observation arrives; unrelated saves must not erase them.
  const chosen = (id: string, value: string, prior?: string) => {
    const select = document.getElementById(id) as HTMLSelectElement | null;
    return select && document.activeElement === select && previous && select.value !== (prior ?? '') ? select.value : value;
  };
  paintPair('workerModel', 'workerReasoning', chosen('workerModel', config.multiAgent.defaultModel ?? '', previous?.multiAgent.defaultModel), chosen('workerReasoning', config.multiAgent.defaultReasoning ?? '', previous?.multiAgent.defaultReasoning));
  paintPair('helperModel', 'helperReasoning', chosen('helperModel', config.goal.helperModel ?? 'gpt-5.6-sol', previous?.goal.helperModel ?? 'gpt-5.6-sol'), chosen('helperReasoning', config.goal.helperReasoning ?? 'high', previous?.goal.helperReasoning ?? 'high'));
  if (catalogSubscribed && catalog.state !== 'unknown') return;
  const requested = ++generation;
  void window.api.getChatModels().then(result => {
    if (requested !== generation || !result?.ok || !result.data) return;
    catalog = result.data;
    for (const [modelId, effortId] of pairs) paintPair(modelId, effortId);
    paintComposerContext();
    paintStatus();
  });
}

export function initChatModels(onPaint?: () => void): void {
  onComposerPaint = onPaint;
  if (window.api.onChatModelsChanged) {
    catalogSubscribed = true;
    window.api.onChatModelsChanged(value => {
      // A current push supersedes every older startup/read/refresh response.
      ++generation; catalog = value;
      for (const [modelId, effortId] of pairs) paintPair(modelId, effortId);
      paintComposerContext(); paintStatus();
    });
  }
  document.getElementById('modelMenu')?.addEventListener('toggle', () => {
    if (($('modelMenu') as HTMLDetailsElement).open && !catalog.models.length && confirmedComposerModel()?.model !== null) $('refreshComposerModels').click();
  });
  for (const [modelId, effortId] of pairs) {
    document.getElementById(modelId)?.addEventListener('change', () => {
      if (modelId === 'composerModel' && composerContext) composerContext.edited = true;
      const model = $<HTMLSelectElement>(modelId);
      const choices = modelId === 'composerModel' ? composerModels() : catalog.models;
      const supported = choices.find(item => item.id === model.value)?.efforts ?? [];
      paintPair(modelId, effortId, model.value, supported.includes('high') ? 'high' : supported[0] ?? '');
      paintStatus();
    });
    document.getElementById(effortId)?.addEventListener('change', () => {
      if (effortId === 'composerReasoning' && composerContext) composerContext.edited = true;
      paintStatus();
    });
  }
  for (const id of ['refreshChatModels', 'refreshComposerModels']) document.getElementById(id)?.addEventListener('click', () => { void discoverModels(); });
  for (const [modelId, effortId] of pairs) paintPair(modelId, effortId);
  paintStatus();
}
