import { beforeEach, afterEach, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { defaultConfig, initConfigPath, saveConfig } from '../src/main/config.js';
import { initDurableStore, resetDurableForTests } from '../src/main/durable.js';
import { addProject } from '../src/main/projects.js';
import { validateNewRoot } from '../src/main/sandbox.js';
import { projectFiles, projectFilePreview } from '../src/main/project-files.js';
let dir: string, root: string, id: string;
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'project-files-'));
  await fs.mkdir(path.join(dir, 'work', 'nested'), { recursive: true });
  root = await validateNewRoot(path.join(dir, 'work'), []);
  initConfigPath(dir); initDurableStore(dir);
  await saveConfig({ ...defaultConfig(), roots: [{ name: 'work', path: root }] });
  id = (await addProject(root)).id;
});
afterEach(async () => { resetDurableForTests(); await fs.rm(dir, { recursive: true, force: true }); });
it('shows nested files in one list and previews literal text without executing it', async () => {
  await fs.writeFile(path.join(root, 'nested', 'page.html'), '<script>alert(1)</script>');
  await fs.mkdir(path.join(root, 'node_modules')); await fs.writeFile(path.join(root, 'node_modules', 'ignored.txt'), 'x');
  expect((await projectFiles(id)).files.map(file => file.path)).toEqual(['nested/page.html']);
  expect(await projectFilePreview(id, 'nested/page.html')).toEqual({ text: '<script>alert(1)</script>', truncated: false });
});
it('refuses traversal and symlinks outside the project, and revoked root access', async () => {
  await fs.writeFile(path.join(dir, 'secret.txt'), 'private');
  await fs.symlink(path.join(dir, 'secret.txt'), path.join(root, 'escape.txt'));
  expect((await projectFiles(id)).files).toEqual([]);
  await expect(projectFilePreview(id, '../secret.txt')).rejects.toThrow();
  await expect(projectFilePreview(id, 'escape.txt')).rejects.toThrow();
  await saveConfig({ ...defaultConfig(), roots: [] });
  await expect(projectFiles(id)).rejects.toThrow();
});
it('bounds text previews and does not treat binary bytes as text', async () => {
  await fs.writeFile(path.join(root, 'large.txt'), 'a'.repeat(200000));
  const preview = await projectFilePreview(id, 'large.txt');
  expect(preview.truncated).toBe(true); expect(preview.text.length).toBe(128 * 1024);
  await fs.writeFile(path.join(root, 'binary'), Buffer.from([0, 1, 2]));
  expect((await projectFilePreview(id, 'binary')).text).toContain('binary');
});
