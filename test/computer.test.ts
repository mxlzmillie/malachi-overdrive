import { describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import { findWindowsPowerShell } from '../src/main/exec.js';
import {
  act,
  actAndCapture,
  activeWindow,
  findUi,
  focusWindow,
  getWindowState,
  listWindows,
  screenshot,
  waitForWindow
} from '../src/main/computer/index.js';
import { IS_WINDOWS } from './helpers.js';

describe.runIf(IS_WINDOWS)('desktop helper', () => {
  // A hosted runner can have no visible desktop window at all, and getWindowState is right
  // to answer that with WINDOW_NOT_FOUND — that is the production semantic, not a bug to
  // work around here. The tests below are about what a window state *says* once there is a
  // window, so they find one first and skip when the desktop has none, the way the window
  // tests above already do. Naming the window also removes a race the foreground introduces:
  // between probing and asking, whatever happened to be in front may no longer be.
  const visibleWindow = async (): Promise<number | null> => {
    const active = (await activeWindow()).window;
    if (active) return active.id;
    const { windows } = await listWindows();
    return windows.find((w) => w.state !== 'minimized')?.id ?? null;
  };

  it('starts once and serves repeated window queries', async () => {
    const first = await listWindows();
    const second = await listWindows();
    expect(first.screen.width).toBeGreaterThan(0);
    expect(first.screen.height).toBeGreaterThan(0);
    expect(Array.isArray(first.windows)).toBe(true);
    expect(second.screen.width).toBe(first.screen.width);
  });

  it('reports the active window without a screenshot', async () => {
    const result = await activeWindow();
    expect(result.screen.width).toBeGreaterThan(0);
    if (result.window) {
      expect(result.window.id).toBeGreaterThan(0);
      expect(result.window.width).toBeGreaterThan(0);
    }
  });

  it('reports a failed focus instead of claiming success', async () => {
    expect(await focusWindow(999_999_999)).toBe(false);
  });

  // Capturing deliberately no longer demands the foreground: looking at a window that
  // something else is covering is a picture, not a failure. A window that does not exist
  // at all is still an error, and it has to say so as one.
  it('captures a window that will not come forward, but refuses one that does not exist', async () => {
    // A closed window is a named code, not a generic helper failure: the model reads
    // WINDOW_NOT_FOUND and goes back to observe rather than retrying the same id.
    await expect(screenshot({ window: 999_999_999, maxWidth: 320 })).rejects.toThrow(
      /WINDOW_NOT_FOUND: window 999999999 is no longer open/
    );
    const { windows } = await listWindows();
    const background = windows.find((w) => w.state !== 'minimized');
    if (!background) return;
    const shot = await screenshot({ window: background.id, maxWidth: 320 });
    expect(shot.width).toBeGreaterThan(0);
    expect(typeof shot.focused).toBe('boolean');
  });

  it('does not move foreground focus while observing a background window', async () => {
    const before = (await activeWindow()).window;
    if (!before) return;
    const { windows } = await listWindows();
    const background = windows.find((window) => window.id !== before.id && window.state !== 'minimized');
    if (!background) return;

    const shot = await screenshot({ window: background.id, maxWidth: 320 });
    expect(['window', 'screen_fallback']).toContain(shot.captureMode);
    expect((await activeWindow()).window?.id).toBe(before.id);
  });

  it('crops using coordinates from the most recent returned frame', async () => {
    const base = await screenshot({ maxWidth: 320 });
    const width = Math.min(100, base.width);
    const height = Math.min(80, base.height);
    const crop = await screenshot({ crop: { x: 0, y: 0, width, height } });
    expect(crop.width).toBe(width);
    expect(crop.height).toBe(height);
    expect(crop.region.width).toBeGreaterThan(0);
    expect(crop.region.height).toBeGreaterThan(0);
  });

  it('waits for an existing visible window without a fixed sleep', async () => {
    const { windows } = await listWindows();
    const candidate = windows[0];
    if (!candidate) return;
    const found = await waitForWindow({ process: candidate.process, timeoutMs: 1000 });
    expect(found.process.toLowerCase()).toContain(candidate.process.toLowerCase());
  });

  it('queries Windows UI Automation without requiring a screenshot', async () => {
    // The ARM64 release runner timed out in an unrelated foreground UIA provider. This
    // query tests our protocol, so own its window and require an exact HWND + known control;
    // neither the runner's foreground nor an empty result is evidence that UIA works.
    const script = `
$ErrorActionPreference = 'Stop'
Add-Type -ReferencedAssemblies System -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

public static class AmbientUiaFixture {
  private const uint WS_OVERLAPPEDWINDOW = 0x00CF0000;
  private const uint WS_CHILD = 0x40000000;
  private const uint WS_VISIBLE = 0x10000000;
  private const uint WS_EX_TOOLWINDOW = 0x00000080;
  private const uint WS_EX_NOACTIVATE = 0x08000000;
  private const int SW_SHOWNOACTIVATE = 4;
  private const uint WM_DESTROY = 0x0002;

  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  private struct WNDCLASSEX {
    public uint cbSize;
    public uint style;
    public IntPtr lpfnWndProc;
    public int cbClsExtra;
    public int cbWndExtra;
    public IntPtr hInstance;
    public IntPtr hIcon;
    public IntPtr hCursor;
    public IntPtr hbrBackground;
    [MarshalAs(UnmanagedType.LPWStr)] public string lpszMenuName;
    [MarshalAs(UnmanagedType.LPWStr)] public string lpszClassName;
    public IntPtr hIconSm;
  }

  [StructLayout(LayoutKind.Sequential)]
  private struct POINT { public int x; public int y; }

  [StructLayout(LayoutKind.Sequential)]
  private struct RECT { public int left; public int top; public int right; public int bottom; }

  [StructLayout(LayoutKind.Sequential)]
  private struct MSG {
    public IntPtr hwnd;
    public uint message;
    public UIntPtr wParam;
    public IntPtr lParam;
    public uint time;
    public POINT pt;
    public uint lPrivate;
  }

  [UnmanagedFunctionPointer(CallingConvention.Winapi)]
  private delegate IntPtr WndProc(IntPtr hwnd, uint message, UIntPtr wParam, IntPtr lParam);

  private static readonly WndProc WindowProc = WindowProcedure;

  [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
  private static extern IntPtr GetModuleHandle(string name);
  [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  private static extern ushort RegisterClassExW(ref WNDCLASSEX windowClass);
  [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  private static extern IntPtr CreateWindowExW(uint exStyle, string className, string windowName,
    uint style, int x, int y, int width, int height, IntPtr parent, IntPtr menu,
    IntPtr instance, IntPtr parameter);
  [DllImport("user32.dll")]
  private static extern bool ShowWindow(IntPtr hwnd, int command);
  [DllImport("user32.dll")]
  private static extern bool UpdateWindow(IntPtr hwnd);
  [DllImport("user32.dll")]
  private static extern bool IsWindowVisible(IntPtr hwnd);
  [DllImport("user32.dll")]
  private static extern bool GetWindowRect(IntPtr hwnd, out RECT rect);
  [DllImport("user32.dll")]
  private static extern int GetMessageW(out MSG message, IntPtr hwnd, uint min, uint max);
  [DllImport("user32.dll")]
  private static extern bool TranslateMessage(ref MSG message);
  [DllImport("user32.dll")]
  private static extern IntPtr DispatchMessageW(ref MSG message);
  [DllImport("user32.dll")]
  private static extern IntPtr DefWindowProcW(IntPtr hwnd, uint message, UIntPtr wParam, IntPtr lParam);
  [DllImport("user32.dll")]
  private static extern void PostQuitMessage(int exitCode);

  private static IntPtr WindowProcedure(IntPtr hwnd, uint message, UIntPtr wParam, IntPtr lParam) {
    if (message == WM_DESTROY) {
      PostQuitMessage(0);
      return IntPtr.Zero;
    }
    return DefWindowProcW(hwnd, message, wParam, lParam);
  }

  public static void Run() {
    IntPtr instance = GetModuleHandle(null);
    string className = "MalachiAmbientUiaFixture_" + System.Diagnostics.Process.GetCurrentProcess().Id;
    var windowClass = new WNDCLASSEX {
      cbSize = (uint)Marshal.SizeOf(typeof(WNDCLASSEX)),
      lpfnWndProc = Marshal.GetFunctionPointerForDelegate(WindowProc),
      hInstance = instance,
      hbrBackground = new IntPtr(6),
      lpszClassName = className
    };
    if (RegisterClassExW(ref windowClass) == 0) {
      throw new InvalidOperationException("RegisterClassExW failed: " + Marshal.GetLastWin32Error());
    }

    IntPtr parent = CreateWindowExW(
      WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE,
      className,
      "MALACHI UIA test fixture",
      WS_OVERLAPPEDWINDOW,
      48, 48, 320, 180,
      IntPtr.Zero, IntPtr.Zero, instance, IntPtr.Zero);
    if (parent == IntPtr.Zero) {
      throw new InvalidOperationException("CreateWindowExW(parent) failed: " + Marshal.GetLastWin32Error());
    }

    IntPtr button = CreateWindowExW(
      0,
      "BUTTON",
      "Owned UIA button",
      WS_CHILD | WS_VISIBLE,
      24, 24, 160, 32,
      parent, new IntPtr(101), instance, IntPtr.Zero);
    if (button == IntPtr.Zero) {
      throw new InvalidOperationException("CreateWindowExW(button) failed: " + Marshal.GetLastWin32Error());
    }

    // The Node child is intentionally launched with a hidden console. Windows can apply that
    // STARTUPINFO show state to the process's first ShowWindow call, so make the second call the
    // authoritative one. SW_SHOWNOACTIVATE keeps this owned test surface from stealing focus.
    ShowWindow(parent, SW_SHOWNOACTIVATE);
    ShowWindow(parent, SW_SHOWNOACTIVATE);
    UpdateWindow(parent);

    RECT parentRect;
    RECT buttonRect;
    if (!IsWindowVisible(parent) || !IsWindowVisible(button) ||
        !GetWindowRect(parent, out parentRect) || !GetWindowRect(button, out buttonRect) ||
        parentRect.right <= parentRect.left || parentRect.bottom <= parentRect.top ||
        buttonRect.right <= buttonRect.left || buttonRect.bottom <= buttonRect.top) {
      throw new InvalidOperationException("Native UIA fixture did not become visible with non-zero bounds");
    }

    Console.WriteLine("READY:" + parent.ToInt64() + ":" + button.ToInt64());
    Console.Out.Flush();

    MSG message;
    while (GetMessageW(out message, IntPtr.Zero, 0, 0) > 0) {
      TranslateMessage(ref message);
      DispatchMessageW(ref message);
    }
  }
}
'@
[AmbientUiaFixture]::Run()
`;
    const fixture = spawn(findWindowsPowerShell() ?? 'powershell.exe', [
      '-NoProfile', '-NonInteractive', '-NoLogo', '-STA', '-EncodedCommand',
      Buffer.from(script, 'utf16le').toString('base64')
    ], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const closed = new Promise<void>((resolve) => fixture.once('close', () => resolve()));
    let stderr = '';
    fixture.stderr.on('data', (chunk: Buffer) => { stderr = `${stderr}${chunk.toString('utf8')}`.slice(-2000); });
    try {
      const owned = await new Promise<{ window: number; button: number }>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`UIA fixture did not become ready: ${stderr}`)), 15_000);
        let stdout = '';
        fixture.stdout.on('data', (chunk: Buffer) => {
          stdout += chunk.toString('utf8');
          const ready = stdout.match(/READY:(\d+):(\d+)/);
          if (ready) {
            clearTimeout(timer);
            resolve({ window: Number(ready[1]), button: Number(ready[2]) });
          }
        });
        fixture.once('error', (error) => { clearTimeout(timer); reject(error); });
        fixture.once('exit', (code) => {
          clearTimeout(timer);
          reject(new Error(`UIA fixture exited (${code}): ${stderr}`));
        });
      });
      const result = await findUi({ window: owned.window, query: 'Owned UIA button', role: 'Button', maxResults: 5 });
      expect(result.window).toBe(owned.window);
      if (!result.elements.some((element) => element.name === 'Owned UIA button')) {
        const unfiltered = await findUi({ window: owned.window, maxResults: 20 });
        throw new Error(
          `Owned native BUTTON ${owned.button} missing from UIA ControlView; ` +
          `filtered=${JSON.stringify(result.elements)} unfiltered=${JSON.stringify(unfiltered.elements)}`
        );
      }
      expect(result.elements.length).toBeLessThanOrEqual(5);
      expect(result.snapshotId).toBeGreaterThan(0);
      for (const element of result.elements) expect(element.ref).toMatch(/^g\d+_s\d+_e\d+$/);
    } finally {
      fixture.kill();
      await closed;
    }
  });

  it('returns a Codex-style window state with semantic UI refs', async () => {
    const target = await visibleWindow();
    if (target === null) return;
    const state = await getWindowState({ window: target, includeScreenshot: false, maxElements: 8 });
    expect(state.window.id).toBeGreaterThan(0);
    expect(state.screenshot).toBeNull();
    expect(state.elements.length).toBeLessThanOrEqual(8);
    expect(state.snapshotId).toBeGreaterThan(0);
    for (const element of state.elements) expect(element.ref).toMatch(/^g\d+_s\d+_e\d+$/);
  });

  it('refuses an invented semantic element ref instead of clicking cached coordinates', async () => {
    await expect(act([{ type: 'click_ref', ref: 'g1_e999999_999999' }])).rejects.toThrow(/UNKNOWN_UI_REF/);
  });

  it('keeps a recent immutable frame usable across an unrelated observation', async () => {
    const earlier = await screenshot({ maxWidth: 320 });
    const current = await screenshot({ maxWidth: 320 });
    expect(current.frameId).toBeGreaterThan(earlier.frameId);

    // Another caller taking a picture no longer invalidates this frame. A window-bound
    // frame is revalidated against its HWND and geometry inside the helper before input.
    await expect(act([{ type: 'move', x: 1, y: 1 }], { frameId: earlier.frameId })).resolves.toBeTruthy();
    await expect(act([{ type: 'move', x: 1, y: 1 }], { frameId: current.frameId })).resolves.toBeTruthy();
    await expect(act([{ type: 'move', x: 1, y: 1 }])).rejects.toThrow(/FRAME_REQUIRED/);
  });

  it('refuses a frame after the bounded immutable history evicts it', async () => {
    const old = await screenshot({ maxWidth: 320 });
    for (let index = 0; index < 16; index++) await screenshot({ maxWidth: 320 });
    await expect(act([{ type: 'move', x: 1, y: 1 }], { frameId: old.frameId })).rejects.toThrow(/STALE_FRAME/);
  });

  it('does not check the frame for semantic refs, which do not use coordinates', async () => {
    const stale = await screenshot({ maxWidth: 320 });
    await screenshot({ maxWidth: 320 });
    // Nothing here should mention the frame: the failure must be about the ref itself.
    await expect(
      act([{ type: 'click_ref', ref: 'g1_e999999_999999' }], { frameId: stale.frameId })
    ).rejects.toThrow(/UNKNOWN_UI_REF/);
  });

  it('takes its verification picture before anyone else can touch the desktop', async () => {
    // captureAfter exists to make action and verification one round trip. If the lock is
    // released between them, another agent's capture can land in the gap and the "after"
    // picture proves nothing about the action it was supposed to verify.
    const order: string[] = [];
    const base = await screenshot({ maxWidth: 320 });

    const combined = actAndCapture([{ type: 'move', x: 1, y: 1 }], {
      frameId: base.frameId,
      capture: { maxWidth: 320 }
    }).then((result) => {
      order.push('combined');
      return result;
    });
    const interloper = screenshot({ maxWidth: 320 }).then((shot) => {
      order.push('interloper');
      return shot;
    });

    const [result, other] = await Promise.all([combined, interloper]);
    expect(result.screenshot).not.toBeNull();
    expect(order).toEqual(['combined', 'interloper']);
    // Frames are numbered in capture order: the verification picture is the very next one
    // after the frame the action was aimed at, and the interloper's comes after that.
    expect(result.screenshot!.frameId).toBe(base.frameId + 1);
    expect(other.frameId).toBe(result.screenshot!.frameId + 1);
  });

  it('waits for a compact postcondition inside the same action call', async () => {
    const current = (await activeWindow()).window;
    if (!current) return;
    const result = await actAndCapture([{ type: 'wait', ms: 0 }], {
      verify: { until: 'foreground', window: current.id, timeoutMs: 250 }
    });
    expect(result.completedCount).toBe(1);
    expect(result.verification).toMatchObject({ until: 'foreground', snapshotId: null });
  });

  it('marks all executed actions when postcondition verification times out', async () => {
    await expect(
      actAndCapture([{ type: 'wait', ms: 0 }], {
        verify: { until: 'window_exists', match: 'clf-window-that-cannot-exist-5f2dc5', timeoutMs: 0 }
      })
    ).rejects.toMatchObject({
      completedCount: 1,
      message: expect.stringMatching(/POSTCONDITION_FAILED: completed_count=1.*VERIFY_TIMEOUT/)
    });
  });

  it('resolves a captureAfter crop against the frame that was current before the actions', async () => {
    const base = await screenshot({ maxWidth: 320 });
    const width = Math.min(64, base.width);
    const height = Math.min(48, base.height);
    const result = await actAndCapture([{ type: 'wait', ms: 0 }], {
      frameId: base.frameId,
      capture: { crop: { x: 0, y: 0, width, height } }
    });
    expect(result.screenshot).not.toBeNull();
    expect(result.screenshot!.width).toBe(width);
    expect(result.screenshot!.height).toBe(height);
  });

  it('requires a retained screenshot identity for captureAfter crops', async () => {
    const earlier = await screenshot({ maxWidth: 320 });
    const current = await screenshot({ maxWidth: 320 });
    const crop = { x: 0, y: 0, width: Math.min(32, current.width), height: Math.min(24, current.height) };

    await expect(actAndCapture([{ type: 'wait', ms: 0 }], { capture: { crop } })).rejects.toThrow(/FRAME_REQUIRED/);
    await expect(
      actAndCapture([{ type: 'wait', ms: 0 }], { frameId: earlier.frameId, capture: { crop } })
    ).resolves.toBeTruthy();

    for (let index = 0; index < 16; index++) await screenshot({ maxWidth: 320 });
    await expect(
      actAndCapture([{ type: 'wait', ms: 0 }], { frameId: earlier.frameId, capture: { crop } })
    ).rejects.toThrow(/STALE_FRAME/);
  });

  it('pairs window state element centres with the screenshot it returned', async () => {
    // A competing capture is fired while get_window_state is mid-acquisition. The state
    // it returns must describe one moment: centres computed against its own screenshot,
    // never against the frame the interloper installed.
    const target = await visibleWindow();
    if (target === null) return;
    const statePromise = getWindowState({ window: target, includeScreenshot: true, maxWidth: 640, maxElements: 12 });
    const interloper = screenshot({ maxWidth: 320 });
    const [state, other] = await Promise.all([statePromise, interloper]);

    expect(state.screenshot).not.toBeNull();
    const shot = state.screenshot!;
    // Different capture, therefore a different region and scale to be mapped against.
    expect(shot.frameId).not.toBe(other.frameId);
    // A window with no automation tree has no centres to pair. That is a property of the
    // desktop this happens to run on, not of the mapping under test, so it is a skip rather
    // than a failure; the checked count below still holds the assertion that matters.
    if (state.elements.length === 0) return;

    let checked = 0;
    for (const element of state.elements) {
      if (!element.imageBounds || !element.imageCenter) continue;
      checked++;
      // Recompute the mapping from the screenshot that came back with these elements.
      // Any other frame's region or scale gives different numbers.
      expect(element.imageBounds.x).toBe(Math.round((element.bounds.x - shot.region.x) * shot.scale));
      expect(element.imageBounds.y).toBe(Math.round((element.bounds.y - shot.region.y) * shot.scale));
      expect(element.imageBounds.width).toBe(Math.round(element.bounds.width * shot.scale));
      expect(element.imageCenter.x).toBe(
        Math.round(element.imageBounds.x + element.imageBounds.width / 2)
      );
      expect(element.imageBounds.x + element.imageBounds.width).toBeLessThanOrEqual(shot.width);
      expect(element.imageBounds.y + element.imageBounds.height).toBeLessThanOrEqual(shot.height);
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('refuses a ref minted before the desktop helper restarted', async () => {
    // A UI Automation runtime id is meaningless to a different helper process, so acting
    // on one would target whatever now holds that id rather than what the model saw.
    const target = await visibleWindow();
    if (target === null) return;
    const state = await getWindowState({ window: target, includeScreenshot: false, maxElements: 4 });
    const live = state.elements.find((element) => element.ref.startsWith('g'));
    if (!live) return;
    const older = live.ref.replace(/^g(\d+)/, (_match, gen: string) => `g${Number(gen) - 1}`);
    await expect(act([{ type: 'click_ref', ref: older }])).rejects.toThrow(/UNKNOWN_UI_REF|STALE_REF/);
  });
});
