import { describe, expect, it } from 'vitest';
import { foregroundCallGranted, foregroundTurnGranted, grantForegroundTurn } from '../src/main/desktop-custody.js';

describe('explicit foreground custody', () => {
  it('defaults to no device control and grants only the exact user-selected session/conversation/turn', () => {
    expect(foregroundTurnGranted('session-one', 'conversation-one', 'turn-one')).toBe(false);
    grantForegroundTurn('session-one', 'conversation-one', 'turn-one', 1000);
    expect(foregroundCallGranted('session-one', 'conversation-one', 'turn-one', 1001)).toBe(true);
    expect(foregroundCallGranted('other-session', 'conversation-one', 'turn-one', 1001)).toBe(false);
    expect(foregroundCallGranted('session-one', 'other-conversation', 'turn-one', 1001)).toBe(false);
    expect(foregroundCallGranted('session-one', 'conversation-one', 'new-turn', 1001)).toBe(false);
    expect(foregroundCallGranted('session-one', 'conversation-one', 'turn-one', 999)).toBe(false);
  });
  it('cannot apply a new-turn handoff to an older tool call that finished attribution late', () => {
    grantForegroundTurn('session-two', 'conversation-two', 'turn-new', 3000);
    expect(foregroundCallGranted('session-two', 'conversation-two', 'turn-new', 2000)).toBe(false);
    expect(foregroundCallGranted('session-two', 'conversation-two', 'turn-new', 3100)).toBe(true);
  });
});
