import { describe, expect, it } from 'vitest';
import {
  CODING_AGENT_TRANSPORT_CONTRACT,
  STANDING_INSTRUCTIONS_HEADING,
  codingAgentDeliveryText
} from '../src/main/session/input-instructions.js';

describe('coding-agent delivery instructions', () => {
  it('keeps the authored request intact at the front and adds the public execution contract once', () => {
    const authored = 'Implement the requested feature.\nKeep this second line.';
    const delivered = codingAgentDeliveryText(authored);
    expect(delivered.startsWith(authored + '\n\n')).toBe(true);
    expect(delivered.split(CODING_AGENT_TRANSPORT_CONTRACT)).toHaveLength(2);
    expect(delivered).toContain('AGENTS.override.md');
    expect(delivered).toContain('AGENTS.md');
    expect(delivered).not.toContain(STANDING_INSTRUCTIONS_HEADING);
  });

  it('attributes trimmed configured standing instructions after the app contract', () => {
    const delivered = codingAgentDeliveryText('Build it', { standingInstructions: '  Always run the focused tests.  ' });
    expect(delivered.indexOf(CODING_AGENT_TRANSPORT_CONTRACT)).toBeLessThan(delivered.indexOf(STANDING_INSTRUCTIONS_HEADING));
    expect(delivered.endsWith(`${STANDING_INSTRUCTIONS_HEADING}\nAlways run the focused tests.`)).toBe(true);
  });

  it('moves an existing terminal instruction to one exact final occurrence', () => {
    const terminal = '\n\nFINAL CONTROL';
    const delivered = codingAgentDeliveryText(`First${terminal}\n\nSecond${terminal}`, {
      standingInstructions: `Verify the result.${terminal}`,
      terminalInstruction: terminal
    });
    expect(delivered.split(terminal)).toHaveLength(2);
    expect(delivered.endsWith(terminal)).toBe(true);
    expect(delivered).toContain('First\n\nSecond');
    expect(delivered.indexOf('Verify the result.')).toBeLessThan(delivered.indexOf(terminal));
  });

  it('describes public execution behavior without claiming to be a private system prompt', () => {
    expect(CODING_AGENT_TRANSPORT_CONTRACT).not.toMatch(/private|system prompt|hidden codex/i);
  });
});
