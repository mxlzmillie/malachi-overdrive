import { beforeEach, describe, expect, it, vi } from 'vitest';
const native = vi.hoisted(() => ({ act: vi.fn(), list: vi.fn(), session: vi.fn() }));
vi.mock('../src/main/computer/index.js', () => ({
  ComputerError: class extends Error {}, DEFAULT_SCREENSHOT_WIDTH: 1280, MAX_SCREENSHOT_WIDTH: 4096,
  actAndCapture: native.act, listWindows: native.list, activeWindow: vi.fn(), findUi: vi.fn(), getWindowState: vi.fn(), screenshot: vi.fn(), waitForWindow: vi.fn(),
  withDesktopAuthorization: (_authorize: unknown, work: () => unknown) => work()
}));
vi.mock('../src/main/session/store.js', async importOriginal => ({ ...await importOriginal<object>(), getSession: native.session }));
import { backgroundDesktopRefusal, registerDesktopTools } from '../src/main/mcp/tools-desktop.js';
import { emptyEvidence, runInCallContext, type CallContext } from '../src/main/mcp/call-context.js';
import { grantForegroundTurn } from '../src/main/desktop-custody.js';

function call(conversationId: string | null = 'desktop-chat'): CallContext {
  return { startedAt: 2000, transportKey: null, agent: null,
    caller: { transportKey: null, requestId: 'request-one', conversationId, sessionId: 'desktop-session' },
    evidence: emptyEvidence() } as CallContext;
}
beforeEach(() => { vi.clearAllMocks(); native.session.mockResolvedValue({ conversationId: 'desktop-chat', activeTurnId: 'desktop-turn' }); });
describe('ambient physical-desktop enforcement', () => {
  it('blocks observe and clipboard/mouse actions before native execution, including ordinary prime calls', async () => {
    const handlers = new Map<string, (input: unknown) => Promise<unknown>>();
    registerDesktopTools({ caps: { screen: true, control: true, clipboardRead: true, clipboardWrite: true },
      exposedCaps: { screen: true, control: true, clipboardRead: true, clipboardWrite: true }, ctx: {},
      register(name: string, _options: unknown, handler: (input: unknown) => Promise<unknown>) { handlers.set(name, handler); },
      guarded: async (_cap: string, _name: string, fn: () => unknown) => fn()
    } as never);
    for (const [name, input] of [['observe', { what: 'windows' }], ['computer', { actions: [{ type: 'read_clipboard' }] }]] as const) {
      const result = await runInCallContext(call(), () => handlers.get(name)!(input));
      expect(JSON.stringify(result)).toContain('FOREGROUND_CONTROL_REQUIRED');
    }
    expect(native.act).not.toHaveBeenCalled(); expect(native.list).not.toHaveBeenCalled();
  });
  it('accepts a matching explicit handoff but rejects unknown, rebinding and later-turn callers', async () => {
    grantForegroundTurn('desktop-session', 'desktop-chat', 'desktop-turn', 1000);
    expect(await runInCallContext(call(), backgroundDesktopRefusal)).toBeNull();
    expect(await runInCallContext(call(null), backgroundDesktopRefusal)).toContain('FOREGROUND_CONTROL_REQUIRED');
    native.session.mockResolvedValue({ conversationId: 'other-chat', activeTurnId: 'desktop-turn' });
    expect(await runInCallContext(call(), backgroundDesktopRefusal)).toContain('FOREGROUND_CONTROL_REQUIRED');
    native.session.mockResolvedValue({ conversationId: 'desktop-chat', activeTurnId: 'new-turn' });
    expect(await runInCallContext(call(), backgroundDesktopRefusal)).toContain('FOREGROUND_CONTROL_REQUIRED');
  });
});
