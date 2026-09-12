import type { ReasoningEffort } from './session.js';
/** GPT-6 Pro is Astra. Compare exact picker names/slugs, never arbitrary substring matches. */
export function isAstraModel(model: string | null | undefined, effort?: ReasoningEffort): boolean {
  const normalized = (model ?? '').trim().toLowerCase().replace(/\s+/g, '-');
  return /^(?:astra|gpt-?6(?:\.0)?-pro|gpt-?6-astra)$/.test(normalized) ||
    (/^(?:gpt-?)?6(?:\.0)?$/.test(normalized) && effort === 'pro');
}
export type ChatModelOption = { id: string; label: string; efforts: ReasoningEffort[]; aliases?: string[] };

const normalizedModelName = (value: string): string => value.trim().toLowerCase().replace(/[^a-z0-9.]/g, '');

/**
 * Converts only the legacy GPT-6 family spellings that unambiguously mean the Pro lane into
 * ChatGPT's exact execution alias. Other provider ids remain opaque: Work/future model ids are
 * not ours to reinterpret.
 */
export function canonicalRequestedChatModel(
  model: string | null | undefined,
  effort?: ReasoningEffort | '' | null
): string | null {
  const value = model?.trim() ?? '';
  if (!value) return null;
  const normalized = value.toLowerCase().replace(/\s+/g, '-');
  if (effort === 'pro' && /^(?:6|gpt-?6(?:\.0)?|gpt-?6-astra)$/.test(normalized)) return 'gpt-6-pro';
  return value;
}

/**
 * Resolves one requested model/effort only against choices ChatGPT actually exposed for this
 * account. Exact family/alias ids win; normalized labels are compatibility for persisted display
 * values. No match means unavailable — never permission to fall back to the account default.
 */
export function observedChatModelSelection(
  models: readonly ChatModelOption[],
  model: string | null | undefined,
  effort?: ReasoningEffort | '' | null
): ChatModelOption | null {
  const requested = canonicalRequestedChatModel(model, effort);
  const requestedName = requested ? normalizedModelName(requested) : '';
  for (const choice of models) {
    if (effort && !choice.efforts.includes(effort as ReasoningEffort)) continue;
    if (!requested) return choice;
    if (choice.id === requested || choice.aliases?.includes(requested)) return choice;
    if (normalizedModelName(choice.label) === requestedName) return choice;
  }
  return null;
}
/** Pro silence policy follows the selected provider identity, including the older generation. */
export function isProModel(model: string | null | undefined, effort?: ReasoningEffort): boolean {
  const normalized = (model ?? '').trim().toLowerCase().replace(/\s+/g, '-');
  return effort === 'pro' || isAstraModel(model, effort) || /^gpt-?\d+(?:[.-]\d+)?-pro$/.test(normalized);
}
/** Expose ChatGPT's public engine name while preserving the provider's opaque model identity. */
export function chatModelDisplayName(label: string, effort?: ReasoningEffort): string {
  return isAstraModel(label, effort) ? 'GPT-6 Astra' : label;
}

/** Keep the selected generation and thinking level visible as separate facts. */
export function chatModelDisplayLabel(label: string, effort: ReasoningEffort, effortLabel: string): string {
  const model = chatModelDisplayName(label, effort);
  if (effort === 'pro') {
    if (isAstraModel(label, effort)) return `${model} · Pro`;
    return /\bpro$/i.test(label) ? label : `${label.replace(/\s+Sol$/i, '')} Pro`;
  }
  return `${model} · ${effortLabel}`;
}
export type ChatModelCatalog = {
  state: 'unknown' | 'pending' | 'ready' | 'unavailable';
  requestedAt: number | null;
  observedAt: number | null;
  models: ChatModelOption[];
  error?: string;
};
