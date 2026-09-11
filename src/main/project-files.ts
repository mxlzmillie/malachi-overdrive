import path from 'node:path';
import { constants } from 'node:fs';
import { rawPromises as fs } from './rawfs.js';
import { projectWorkspace } from './projects.js';
import { getConfig } from './config.js';
import { isContained, resolvePath } from './sandbox.js';

export interface ProjectFile { path: string; size: number; modified: number }
export interface ProjectFiles { files: ProjectFile[]; limited: boolean; skipped: number }
const excluded = new Set(['node_modules', '.git', 'dist', 'out', '.next', '__pycache__', '.venv']);

async function contained(base: string, relative: string): Promise<string> {
  if (path.isAbsolute(relative) || relative.split(/[\\/]/).some(part => part === '..')) throw new Error('Invalid project file');
  const resolved = await resolvePath(getConfig().roots, path.join(base, relative));
  if (!isContained(base, resolved.real)) throw new Error('File is outside this project');
  return resolved.real;
}

/** Flatten nested folders once, with bounded traversal and no symlink following. */
export async function projectFiles(id: string): Promise<ProjectFiles> {
  const { real } = await projectWorkspace(id);
  const files: ProjectFile[] = []; const queue = ['']; let visited = 0, skipped = 0;
  const deadline = Date.now() + 15000;
  while (queue.length && files.length < 10000 && visited < 30000 && Date.now() < deadline) {
    const relative = queue.shift()!;
    try {
      const dir = await fs.opendir(await contained(real, relative));
      for await (const entry of dir) {
        if (++visited > 30000 || files.length >= 10000 || Date.now() >= deadline) { queue.push(relative); break; }
        if (entry.isSymbolicLink() || excluded.has(entry.name)) continue;
        const name = path.join(relative, entry.name);
        if (entry.isDirectory()) { queue.push(name); continue; }
        if (!entry.isFile()) continue;
        try {
          const stat = await fs.stat(await contained(real, name));
          files.push({ path: name.split(path.sep).join('/'), size: stat.size, modified: stat.mtimeMs });
        } catch { skipped++; }
      }
    } catch { skipped++; }
  }
  files.sort((a, b) => b.modified - a.modified || a.path.localeCompare(b.path));
  return { files, limited: queue.length > 0, skipped };
}

export async function projectFilePreview(id: string, relative: string): Promise<{ text: string; truncated: boolean }> {
  const { real } = await projectWorkspace(id);
  const target = await contained(real, relative);
  const handle = await fs.open(target, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    if (!(await handle.stat()).isFile()) throw new Error('Choose a regular file');
    if (await contained(real, relative) !== target) throw new Error('File changed; select it again');
    const buffer = Buffer.alloc(128 * 1024 + 1);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    if (buffer.subarray(0, bytesRead).includes(0)) return { text: 'Preview is unavailable for this binary file.', truncated: false };
    return { text: buffer.subarray(0, Math.min(bytesRead, 128 * 1024)).toString('utf8'), truncated: bytesRead > 128 * 1024 };
  } finally { await handle.close(); }
}
