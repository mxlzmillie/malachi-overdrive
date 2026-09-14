from pathlib import Path


def replace_between(text: str, start: str, end: str, replacement: str, label: str) -> str:
    if text.count(start) != 1:
        raise SystemExit(f"{label}: expected one start marker, got {text.count(start)}")
    begin = text.index(start)
    finish = text.index(end, begin)
    return text[:begin] + replacement + text[finish:]


goal_path = Path("test/goal-backends.test.ts")
goal = goal_path.read_text()
new_goal = """async function settled(id: string) {
  const view = () => goal.goalViewFor(id);
  const done = () => {
    const stage = view()?.stage;
    return stage !== undefined && stage !== 'sending' && stage !== 'answering';
  };
  if (!done()) await new Promise<void>((resolve) => {
    const unsubscribe = goal.onGoalChange(() => {
      if (!done()) return;
      unsubscribe();
      resolve();
    });
    if (done()) {
      unsubscribe();
      resolve();
    }
  });
  return view()!;
}
"""
goal_path.write_text(replace_between(
    goal,
    "async function settled(id: string) {",
    "describe('Goal decision backends', () => {",
    new_goal,
    "goal settled helper",
))

plugin_path = Path("test/plugins-manager.test.ts")
plugin = plugin_path.read_text()
new_plugin = """  it('does not let a slow startup block a ready peer call or shutdown its process', async () => {
    const h = await trackedFixture();
    const slowEntry = path.join(dir, 'slow-server.cjs');
    await fs.writeFile(slowEntry, fixture.replaceAll('Echo.Mixed', 'Slow.Echo'));
    const slow = (await manager.install({ source: { kind: 'command', command: process.execPath, args: [slowEntry] }, credentials: { TEST_SECRET: 'slow' } })).plugins.find(row => row.id !== h.row.id)!;
    await manager.close();
    let release!: (value: string) => void;
    vi.mocked(getSecret).mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    manager = new PluginManager();
    await manager.initialize(dir);
    const peerReady = () => manager.snapshot().plugins.find(row => row.id === h.row.id)?.status === 'ready';
    try {
      if (!peerReady()) await new Promise<void>((resolve) => {
        const unsubscribe = manager.onChanged(() => {
          if (!peerReady()) return;
          unsubscribe();
          resolve();
        });
        if (peerReady()) {
          unsubscribe();
          resolve();
        }
      });
      expect(manager.snapshot().plugins.find(row => row.id === slow.id)!.status).toBe('connecting');
      const result = await manager.call('Echo.Mixed', { value: 'ready peer' });
      expect(result.isError).not.toBe(true);
      expect(result.structuredContent).toEqual({ value: 'ready peer' });
      expect(manager.snapshot().plugins.find(row => row.id === slow.id)!.status).toBe('connecting');
      const active = (await h.pids()).at(-1)!;
      await manager.close();
      expect(alive(active.pid)).toBe(false);
    } finally { release?.('slow'); }
  });
"""
plugin_path.write_text(replace_between(
    plugin,
    "  it('does not let a slow startup block a ready peer call or shutdown its process', async () => {",
    "  it('starts with zero installations and does not wait for enabled-server credential discovery on reopen', async () => {",
    new_plugin,
    "plugin slow-start test",
))
