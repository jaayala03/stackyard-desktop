// File-system side of the .env editor. No Electron imports, so it can be unit-tested.
import { copyFile, chmod, readdir, readFile, realpath, rename, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'

export const SKIP_DIRS = new Set(['node_modules', '.git', '.ddev', 'vendor', 'dist', 'build', '.next', '.nuxt', 'storage', 'coverage', 'out'])
export const MAX_DEPTH = 3
export const EXAMPLE_SUFFIXES = ['.example', '.sample', '.dist', '.template']
const IGNORED_SUFFIXES = ['.bak', '.swp', '.tmp']

export interface EnvListing {
  files: string[]
  creatable: Array<{ example: string; target: string }>
}

const toPosix = (p: string): string => p.split(sep).join('/')

/** Resolves `rel` under `approot`; throws unless it is an `.env*` file inside the project (symlinks included). */
export async function safePath(approot: string, rel: string): Promise<string> {
  if (!rel || isAbsolute(rel) || rel.includes('\0')) throw new Error('Invalid path')
  const root = resolve(approot)
  const full = resolve(root, rel)
  const inside = (base: string, p: string): boolean => {
    const r = relative(base, p)
    return r !== '' && !r.startsWith('..') && !isAbsolute(r)
  }
  if (!inside(root, full)) throw new Error('Path is outside the project')
  if (!basename(full).startsWith('.env')) throw new Error('Not an .env file')
  // Resolve symlinks on the deepest existing ancestor and check again.
  let probe = full
  for (;;) {
    try {
      const real = await realpath(probe)
      if (!inside(await realpath(root), real) && real !== (await realpath(root))) throw new Error('Path is outside the project')
      break
    } catch (e: any) {
      if (e?.code !== 'ENOENT') throw e
      const parent = dirname(probe)
      if (parent === probe) throw e
      probe = parent
    }
  }
  return full
}

/** Every .env-style file of the project (root and sub-folders), relative POSIX paths; root files first, `.env` leading each folder. */
export async function listEnvFiles(approot: string): Promise<string[]> {
  const root = resolve(approot)
  const found: string[] = []
  const walk = async (dir: string, depth: number): Promise<void> => {
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      if (e.isFile() && e.name.startsWith('.env') && !IGNORED_SUFFIXES.some((s) => e.name.endsWith(s))) {
        found.push(toPosix(relative(root, join(dir, e.name))))
      } else if (e.isDirectory() && depth < MAX_DEPTH && !SKIP_DIRS.has(e.name) && !e.name.startsWith('.')) {
        await walk(join(dir, e.name), depth + 1)
      }
    }
  }
  await walk(root, 0)
  const key = (rel: string): Array<string | number> => {
    const parts = rel.split('/')
    const name = parts[parts.length - 1]
    return [parts.length > 1 ? 1 : 0, parts.slice(0, -1).join('/'), name !== '.env' ? 1 : 0, name]
  }
  return found.sort((a, b) => {
    const ka = key(a)
    const kb = key(b)
    for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return ka[i] < kb[i] ? -1 : 1
    return 0
  })
}

/** Example files whose real file does not exist yet, e.g. backend/.env.example → backend/.env. */
export async function creatablePairs(approot: string, files: string[]): Promise<EnvListing['creatable']> {
  const pairs: EnvListing['creatable'] = []
  for (const rel of files) {
    const name = basename(rel)
    const suffix = EXAMPLE_SUFFIXES.find((s) => name.endsWith(s))
    if (!suffix) continue
    const target = toPosix(join(dirname(rel), name.slice(0, -suffix.length)))
    if (!files.includes(target)) pairs.push({ example: rel, target })
  }
  return pairs
}

export async function listing(approot: string): Promise<EnvListing> {
  const files = await listEnvFiles(approot)
  return { files, creatable: await creatablePairs(approot, files) }
}

export async function readEnv(approot: string, rel: string): Promise<string> {
  return readFile(await safePath(approot, rel), 'utf8')
}

/** Atomic write that keeps the previous version as `<name>.bak`. */
export async function writeEnv(approot: string, rel: string, text: string): Promise<void> {
  const path = await safePath(approot, rel)
  let mode: number | undefined
  try {
    mode = (await stat(path)).mode & 0o777
    await copyFile(path, path + '.bak')
  } catch {
    /* new file: nothing to back up */
  }
  const tmp = path + '.tmp'
  await writeFile(tmp, text, 'utf8')
  if (mode !== undefined) await chmod(tmp, mode).catch(() => undefined)
  await rename(tmp, path)
}

export async function createFromExample(approot: string, example: string, target: string): Promise<void> {
  const from = await safePath(approot, example)
  const to = await safePath(approot, target)
  await copyFile(from, to, 1 /* COPYFILE_EXCL: never overwrite */)
}
