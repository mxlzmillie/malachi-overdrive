import type { ReasoningEffort } from './session.js';
/** GPT-6 Pro is Astra. Compare exact picker names/slugs, never arbitrary substring matches. */
export function isAstraModel(model: string | null | undefined, effort?: ReasoningEffort): boolean {
  const normalized = (model ?? '').trim().toLowerCase().replace(/\s+/g, '-');
  return /^(?:astra|gpt-?6(?:\.0)?-pro|gpt-?6-astra)$/.test(normalized) ||
    (/^(?:gpt-?)?6(?:\.0)?$/.test(normalized) && effort === 'pro');
}
export type ChatModelOption = { id: string; label: string; efforts: ReasoningEffort[]; aliases?: string[] };
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
