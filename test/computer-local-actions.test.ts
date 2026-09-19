import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  spawn: vi.fn(() => {
    throw new Error('desktop helper must not start');
  }),
  readText: vi.fn(() => 'clipboard-value'),
  writeText: vi.fn()
}));

vi.mock('node:child_process', () => ({ spawn: mocks.spawn }));
vi.mock('electron', () => ({
  clipboard: {
    readText: mocks.readText,
    writeText: mocks.writeText
  }
}));

import { act, actAndCapture, listWindows, withDesktopAuthorization } from '../src/main/computer/index.js';

describe('desktop local-only action path', () => {
  beforeEach(() => {
    mocks.spawn.mockClear();
    mocks.readText.mockClear();
    mocks.writeText.mockClear();
  });

  it('runs clipboard-only work without starting the PowerShell desktop helper', async () => {
    const result = await act([
      { type: 'write_clipboard', text: 'next' },
      { type: 'wait', ms: 0 },
      { type: 'read_clipboard' }
    ]);

    expect(mocks.writeText).toHaveBeenCalledWith('next');
    expect(result.clipboard).toEqual(['clipboard-value']);
    expect(result.cursor).toBeNull();
    expect(mocks.spawn).not.toHaveBeenCalled();
  });

  it('preflights semantic refs before an earlier clipboard action can mutate state', async () => {
    await expect(
      act([
        { type: 'write_clipboard', text: 'must-not-land' },
        { type: 'click_ref', ref: 'g999_e999_999' }
      ])
    ).rejects.toThrow(/UNKNOWN_UI_REF|STALE_REF/);

    expect(mocks.writeText).not.toHaveBeenCalled();
    expect(mocks.spawn).not.toHaveBeenCalled();
  });

  it('rechecks revoked foreground custody after an earlier operation releases the exclusive queue', async () => {
    let enter!: () => void; const entered = new Promise<void>(resolve => { enter = resolve; });
    let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
    let first = true;
    const holding = actAndCapture([{ type: 'wait', ms: 0 }], { authorize: async () => { if (first) { first = false; enter(); await gate; } } });
    await entered;
    let allowed = true;
    const queued = actAndCapture([{ type: 'write_clipboard', text: 'must-not-land' }], {
      authorize: async () => { if (!allowed) throw new Error('FOREGROUND_CONTROL_REQUIRED'); }
    });
    const rejected = expect(queued).rejects.toThrow('FOREGROUND_CONTROL_REQUIRED');
    allowed = false; release(); await holding; await rejected;
    expect(mocks.writeText).not.toHaveBeenCalled(); expect(mocks.spawn).not.toHaveBeenCalled();
  });

  it('does not run the next action after a handoff is revoked midway through a local batch', async () => {
    let allowed = true;
    mocks.writeText.mockImplementationOnce(() => { allowed = false; });
    await expect(actAndCapture([{ type: 'write_clipboard', text: 'accepted' }, { type: 'write_clipboard', text: 'revoked' }], {
      authorize: async () => { if (!allowed) throw new Error('FOREGROUND_CONTROL_REQUIRED'); }
    })).rejects.toThrow(/completed_count=1.*FOREGROUND_CONTROL_REQUIRED/);
    expect(mocks.writeText).toHaveBeenCalledTimes(1); expect(mocks.writeText).toHaveBeenCalledWith('accepted');
  });

  it('refuses an unauthorized observation before starting a native helper', async () => {
    await expect(withDesktopAuthorization(async () => { throw new Error('FOREGROUND_CONTROL_REQUIRED'); }, () => listWindows()))
      .rejects.toThrow('FOREGROUND_CONTROL_REQUIRED');
    expect(mocks.spawn).not.toHaveBeenCalled();
  });
});
