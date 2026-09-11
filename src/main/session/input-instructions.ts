/**
 * Public user-role guidance added only to the bytes delivered to ChatGPT. The durable input
 * keeps the person's original text separately, so the local transcript and composer never
 * present this app-authored context as something the person typed.
 */
export const CODING_AGENT_TRANSPORT_CONTRACT = [
  'Local coding-agent instructions:',
  'Act as a persistent coding agent. For multi-step work, keep a concise plan current and continue until the user request is complete or a concrete blocker requires input.',
  'Inspect relevant files before editing, preserve unrelated work, use available tools and parallel agents when useful, and run focused validation after changes. Keep progress visible at meaningful phase changes and report changed files, tests, and blockers accurately.',
  'Before repository work, discover applicable AGENTS.override.md or AGENTS.md files from the repository root through the current working directory. In each directory prefer AGENTS.override.md; instructions nearer the working directory override broader ones.'
].join('\n');

export const STANDING_INSTRUCTIONS_HEADING = "The user's configured standing instructions:";

export interface CodingAgentDeliveryOptions {
  standingInstructions?: string;
  /** An exact control instruction which must occur once, after every other appended section. */
  terminalInstruction?: string;
}

/** Compose model-facing text without consulting config, disk, or mutable process state. */
export function codingAgentDeliveryText(text: string, options: CodingAgentDeliveryOptions = {}): string {
  const terminal = options.terminalInstruction ?? '';
  // Offline Goal drafts may already contain the marker. Move that app-owned instruction to
  // the end rather than placing new guidance after it or duplicating it in a planned workflow.
  const request = terminal ? text.split(terminal).join('') : text;
  const sections = [request, CODING_AGENT_TRANSPORT_CONTRACT];
  const configured = options.standingInstructions ?? '';
  const standing = (terminal ? configured.split(terminal).join('') : configured).trim();
  if (standing) sections.push(`${STANDING_INSTRUCTIONS_HEADING}\n${standing}`);
  return sections.join('\n\n') + terminal;
}
