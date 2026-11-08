import { realpath } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'

export class PathError extends Error {}

/** True when `target` is `root` or lives inside it (purely lexical, both absolute). */
export function isInside(root: string, target: string): boolean {
  const rel = relative(root, target)
  return rel === '' || (!rel.startsWith('..' + sep) && rel !== '..' && !isAbsolute(rel))
}

/** Real path of the nearest existing ancestor of `p` (so not-yet-created files can be checked too). */
async function realOfExisting(p: string): Promise<string> {
  let current = p
  for (;;) {
    try {
      return await realpath(current)
    } catch (e: any) {
      if (e?.code !== 'ENOENT' && e?.code !== 'ENOTDIR') throw e
      const parent = dirname(current)
      if (parent === current) throw e
      current = parent
    }
  }
}

/**
 * Resolves `rel` (relative to the project root, or absolute) and guarantees the result stays
 * inside `root`, both lexically (`..`) and after following symlinks.
 */
export async function safePath(root: string, rel: string): Promise<string> {
  if (typeof root !== 'string' || !root || typeof rel !== 'string') throw new PathError('Invalid path')
  if (rel.includes('\0')) throw new PathError('Invalid path')
  const base = resolve(root)
  const target = resolve(base, rel)
  if (!isInside(base, target)) throw new PathError('Path is outside the project')
  const realBase = await realpath(base)
  const realTarget = await realOfExisting(target)
  if (!isInside(realBase, realTarget)) throw new PathError('Path escapes the project through a link')
  return target
}
