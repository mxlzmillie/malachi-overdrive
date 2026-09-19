/** Physical desktop custody requires an explicit local user action for one exact live turn.
 * It is deliberately not persisted: app restart or a new turn requires fresh permission. */
const foreground = new Map<string, { sessionId: string; turnId: string; startedAt: number }>();
export function grantForegroundTurn(sessionId: string, conversationId: string, turnId: string, startedAt: number): void {
  foreground.set(conversationId, { sessionId, turnId, startedAt });
  if (foreground.size > 256) foreground.delete(foreground.keys().next().value!);
}
export function revokeForegroundTurn(conversationId: string): void { foreground.delete(conversationId); }
export function foregroundCallGranted(sessionId: string, conversationId: string, turnId: string, callStartedAt: number): boolean {
  const grant = foreground.get(conversationId);
  return foregroundTurnGranted(sessionId, conversationId, turnId) && callStartedAt >= grant!.startedAt;
}
export function foregroundTurnGranted(sessionId: string, conversationId: string, turnId: string): boolean {
  const grant = foreground.get(conversationId);
  return !!grant && grant.sessionId === sessionId && grant.turnId === turnId;
}
