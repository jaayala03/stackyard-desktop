import type { IpcMain } from 'electron'
import { access, lstat, mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { randomBytes } from 'node:crypto'
import { basename, dirname, join, relative, sep } from 'node:path'
import { safePath } from './code-paths'

export const MAX_FILE_BYTES = 2 * 1024 * 1024
const HIDDEN_DIRS = new Set(['node_modules', '.git', 'vendor'])

export interface CodeEntry {
  name: string
  /** Path relative to the project root, always with '/'. */
  path: string
  dir: boolean
}

export type ReadResult =
  | { ok: true; content: string; mtime: number }
  | { ok: false; reason: 'binary' | 'tooLarge' | 'notFile' }

const posix = (p: string): string => p.split(sep).join('/')

export function looksBinary(buf: Buffer): boolean {
  const n = Math.min(buf.length, 8000)
  for (let i = 0; i < n; i++) if (buf[i] === 0) return true
  return false
}

/** The renderer only gets to touch DDEV project folders. */
async function assertProject(root: string): Promise<void> {
  if (typeof root !== 'string' || !root) throw new Error('Invalid project')
  await access(join(root, '.ddev')).catch(() => {
    throw new Error('Not a DDEV project folder')
  })
}

export async function listDir(root: string, rel: string, showHidden: boolean): Promise<CodeEntry[]> {
  const dir = await safePath(root, rel)
  const entries = await readdir(dir, { withFileTypes: true })
  const out: CodeEntry[] = []
  for (const e of entries) {
    const isDir = e.isDirectory() || (e.isSymbolicLink() && (await stat(join(dir, e.name)).then((s) => s.isDirectory()).catch(() => false)))
    if (isDir && !showHidden && HIDDEN_DIRS.has(e.name)) continue
    out.push({ name: e.name, path: posix(relative(root, join(dir, e.name))), dir: isDir })
  }
  return out.sort((a, b) => Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name))
}

export async function readText(root: string, rel: string): Promise<ReadResult> {
  const file = await safePath(root, rel)
  const st = await stat(file)
  if (!st.isFile()) return { ok: false, reason: 'notFile' }
  if (st.size > MAX_FILE_BYTES) return { ok: false, reason: 'tooLarge' }
  const buf = await readFile(file)
  if (looksBinary(buf)) return { ok: false, reason: 'binary' }
  return { ok: true, content: buf.toString('utf8'), mtime: st.mtimeMs }
}

/** Writes through a temp file in the same folder, then renames over the target. */
export async function writeText(root: string, rel: string, content: string): Promise<number> {
  const file = await safePath(root, rel)
  const tmp = join(dirname(file), `.${basename(file)}.${randomBytes(4).toString('hex')}.tmp`)
  await writeFile(tmp, content, 'utf8')
  try {
    await rename(tmp, file)
  } catch (e) {
    await rm(tmp, { force: true })
    throw e
  }
  return (await stat(file)).mtimeMs
}

export async function createEntry(root: string, rel: string, dir: boolean): Promise<void> {
  const target = await safePath(root, rel)
  if (dir) await mkdir(target, { recursive: false })
  else await writeFile(target, '', { flag: 'wx' })
}

export async function renameEntry(root: string, from: string, to: string): Promise<void> {
  const src = await safePath(root, from)
  const dst = await safePath(root, to)
  if (src === (await safePath(root, '.'))) throw new Error('Cannot rename the project folder')
  await lstat(src)
  const taken = await lstat(dst).then(
    () => true,
    () => false
  )
  if (taken) throw new Error('Destination already exists')
  await rename(src, dst)
}

export async function deleteEntry(root: string, rel: string): Promise<void> {
  const target = await safePath(root, rel)
  if (target === (await safePath(root, '.'))) throw new Error('Cannot delete the project folder')
  await rm(target, { recursive: true })
}

/** IPC handlers for the code tab. Channels must start with 'code:' (see preload allow-list). */
export function register(ipcMain: IpcMain): void {
  const guarded =
    <A extends unknown[], R>(fn: (root: string, ...args: A) => Promise<R>) =>
    async (_e: unknown, root: string, ...args: A): Promise<R> => {
      await assertProject(root)
      return fn(root, ...args)
    }
  ipcMain.handle('code:list', guarded((root, rel: string, showHidden: boolean) => listDir(root, rel, !!showHidden)))
  ipcMain.handle('code:read', guarded((root, rel: string) => readText(root, rel)))
  ipcMain.handle('code:write', guarded((root, rel: string, content: string) => writeText(root, rel, String(content))))
  ipcMain.handle('code:create', guarded((root, rel: string, dir: boolean) => createEntry(root, rel, !!dir)))
  ipcMain.handle('code:rename', guarded((root, from: string, to: string) => renameEntry(root, from, to)))
  ipcMain.handle('code:delete', guarded((root, rel: string) => deleteEntry(root, rel)))
}
