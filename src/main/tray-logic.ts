import type { NotifyMode } from '../shared/types'

/** Pure logic for the tray: docker stats parsing, idle detection and notification rules. */

/** % of web container CPU that counts as activity. */
export const ACTIVE_CPU = 1.0

const UNITS: Record<string, number> = {
  b: 1,
  kb: 1e3,
  mb: 1e6,
  gb: 1e9,
  tb: 1e12,
  kib: 1024,
  mib: 1024 ** 2,
  gib: 1024 ** 3,
  tib: 1024 ** 4
}

/** "1.5MiB" → 1572864. Unknown input → 0. */
export function parseBytes(text: string | undefined): number {
  const m = /^\s*([\d.]+)\s*([A-Za-z]+)/.exec(text ?? '')
  if (!m) return 0
  return Math.floor(parseFloat(m[1]) * (UNITS[m[2].toLowerCase()] ?? 1))
}

export function humanBytes(n: number): string {
  return n >= 1024 ** 3 ? `${(n / 1024 ** 3).toFixed(1)} GB` : `${Math.round(n / 1024 ** 2)} MB`
}

export interface Owner {
  site: string
  service: string
}

/** Output of `docker ps --format '{{.Names}}|{{.Label "com.ddev.site-name"}}|{{.Label "com.docker.compose.service"}}'`. */
export function parseOwners(stdout: string): Map<string, Owner> {
  const owners = new Map<string, Owner>()
  for (const line of stdout.split(/\r?\n/)) {
    const [name, site = '', service = ''] = line.trim().split('|')
    if (name?.startsWith('ddev-')) owners.set(name, { site: site || '__ddev__', service })
  }
  return owners
}

export interface Usage {
  cpu: number
  mem: number
  webCpu: number
  webRx: number
}

/** Output of `docker stats --no-stream --format '{{json .}}'`, aggregated per DDEV project. */
export function parseStats(stdout: string, owners: Map<string, Owner>): Record<string, Usage> {
  const out: Record<string, Usage> = {}
  for (const line of stdout.split(/\r?\n/)) {
    let st: Record<string, string>
    try {
      st = JSON.parse(line)
    } catch {
      continue
    }
    const owner = owners.get(st.Name)
    if (!owner) continue
    const cpu = parseFloat((st.CPUPerc ?? '0').replace('%', '')) || 0
    const mem = parseBytes((st.MemUsage ?? '').split('/')[0])
    const agg = (out[owner.site] ??= { cpu: 0, mem: 0, webCpu: 0, webRx: 0 })
    agg.cpu += cpu
    agg.mem += mem
    if (owner.service === 'web') {
      agg.webCpu = cpu
      agg.webRx = parseBytes((st.NetIO ?? '').split('/')[0])
    }
  }
  return out
}

/** Remembers when each running project was last active (CPU above the threshold or network traffic). */
export class IdleTracker {
  private lastActive = new Map<string, number>()
  private lastRx = new Map<string, number>()

  update(stats: Record<string, Usage>, running: string[], now: number): void {
    for (const name of running) {
      const st = stats[name]
      if (!st) continue
      const rxGrew = st.webRx > (this.lastRx.get(name) ?? st.webRx)
      if (!this.lastActive.has(name) || st.webCpu >= ACTIVE_CPU || rxGrew) this.lastActive.set(name, now)
      this.lastRx.set(name, st.webRx)
    }
    for (const name of [...this.lastActive.keys()]) {
      if (!running.includes(name)) {
        // stopped: start counting again the next time it runs
        this.lastActive.delete(name)
        this.lastRx.delete(name)
      }
    }
  }

  idleProjects(minutes: number, now: number): string[] {
    if (!(minutes > 0)) return []
    return [...this.lastActive].filter(([, t]) => now - t >= minutes * 60_000).map(([n]) => n)
  }

  reset(name: string, now: number): void {
    this.lastActive.set(name, now)
  }
}

/** Whether a notification should be shown given the user's mode and the window state. */
export function shouldNotify(mode: NotifyMode, windowFocused: boolean): boolean {
  if (mode === 'never') return false
  if (mode === 'always') return true
  return !windowFocused
}

export type JobKind = 'start' | 'stop' | 'restart' | 'delete' | 'create' | 'poweroff'

export function projectMark(status: string, busy: boolean): string {
  return busy ? '⏳' : status === 'running' ? '●' : '○'
}
