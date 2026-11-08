// Pure helpers for the snapshots tab (no Node or Electron imports: the renderer imports this file too).

export interface Snapshot {
  name: string
  created: string
  size: number
  dbVersion: string
}

export const SNAP_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9_-]*$/

export function isValidSnapshotName(name: unknown): name is string {
  return typeof name === 'string' && name.length <= 100 && SNAP_NAME_RE.test(name)
}

export function defaultSnapshotName(project: string, now = new Date()): string {
  const p = (n: number): string => String(n).padStart(2, '0')
  const stamp = `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}`
  const base = project.replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+/, '') || 'snapshot'
  return `${base}_${stamp}`
}

function toSnapshot(item: unknown): Snapshot | null {
  if (!item || typeof item !== 'object') return null
  const o = item as Record<string, unknown>
  const name = o.Name ?? o.name
  if (typeof name !== 'string' || !name) return null
  const size = Number(o.Size ?? o.size ?? 0)
  return {
    name,
    created: String(o.Created ?? o.created ?? ''),
    size: Number.isFinite(size) ? size : 0,
    dbVersion: String(o.DBVersion ?? o.dbVersion ?? '')
  }
}

/**
 * Reads `ddev snapshot --list -j`: JSON lines whose `raw` field is either an object keyed by
 * project name ({ "my-app": [ {Name, Created, Size, DBVersion} ] }) or a plain array.
 * Newest snapshots come first. Throws when there is no JSON `raw` at all.
 */
export function parseSnapshotList(stdout: string, project: string): Snapshot[] {
  for (const line of stdout.split(/\r?\n/)) {
    const text = line.trim()
    if (!text.startsWith('{')) continue
    let data: any
    try {
      data = JSON.parse(text)
    } catch {
      continue
    }
    if (!data || !('raw' in data)) continue
    const raw = data.raw
    const items: unknown[] = Array.isArray(raw) ? raw : Array.isArray(raw?.[project]) ? raw[project] : []
    return items
      .map(toSnapshot)
      .filter((s): s is Snapshot => s !== null)
      .sort((a, b) => b.created.localeCompare(a.created))
  }
  throw new Error('ddev returned no snapshot data')
}

export function humanSize(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '—'
  const units = ['B', 'KB', 'MB', 'GB']
  let i = 0
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024
    i++
  }
  return i === 0 ? `${Math.round(n)} B` : `${n.toFixed(1)} ${units[i]}`
}

/** '2026-11-07T20:06:29.17-05:00' -> '2026-11-07 20:06' (as reported by ddev). */
export function shortWhen(iso: string): string {
  return iso.slice(0, 16).replace('T', ' ')
}
