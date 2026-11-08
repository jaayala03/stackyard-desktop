// Pure helpers for the update check (no Electron or Node imports, so they are easy to test).

/** GitHub repository that publishes the releases. Change it here only. */
export const REPO = 'jaayala03/stackyard-desktop'
export const RELEASES_API = `https://api.github.com/repos/${REPO}/releases/latest`
export const RELEASE_URL_PREFIX = `https://github.com/${REPO}/`

export interface UpdateInfo {
  available: boolean
  version: string
  url: string
  notes: string
}

export const NO_UPDATE: UpdateInfo = { available: false, version: '', url: '', notes: '' }

export interface ParsedVersion {
  nums: [number, number, number]
  pre: string[]
}

/** Parses "v1.2.3-beta.1+build" into numbers and pre-release identifiers. Returns null if no number is found. */
export function parseVersion(text: string): ParsedVersion | null {
  const m = /^\s*v?(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?\s*$/.exec(text ?? '')
  if (!m) return null
  return { nums: [Number(m[1]), Number(m[2] ?? 0), Number(m[3] ?? 0)], pre: m[4] ? m[4].split('.') : [] }
}

function comparePre(a: string[], b: string[]): number {
  // A release (no pre-release tag) is newer than any pre-release of the same version.
  if (!a.length && !b.length) return 0
  if (!a.length) return 1
  if (!b.length) return -1
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i]
    const y = b[i]
    if (x === undefined) return -1
    if (y === undefined) return 1
    const nx = /^\d+$/.test(x)
    const ny = /^\d+$/.test(y)
    if (nx && ny) {
      if (Number(x) !== Number(y)) return Number(x) < Number(y) ? -1 : 1
    } else if (nx !== ny) {
      return nx ? -1 : 1
    } else if (x !== y) {
      return x < y ? -1 : 1
    }
  }
  return 0
}

/** True when `remote` is strictly newer than `local`. Unparseable versions are never newer. */
export function isNewer(remote: string, local: string): boolean {
  const r = parseVersion(remote)
  const l = parseVersion(local)
  if (!r || !l) return false
  for (let i = 0; i < 3; i++) if (r.nums[i] !== l.nums[i]) return r.nums[i] > l.nums[i]
  return comparePre(r.pre, l.pre) > 0
}

/** Turns the GitHub "latest release" payload into an UpdateInfo for the running version. */
export function releaseToInfo(data: unknown, current: string, dismissed = ''): UpdateInfo {
  if (!data || typeof data !== 'object') return NO_UPDATE
  const d = data as Record<string, unknown>
  if (d.draft === true || d.prerelease === true) return NO_UPDATE
  const tag = typeof d.tag_name === 'string' ? d.tag_name.trim() : ''
  const version = tag.replace(/^v/i, '')
  if (!version || !isNewer(version, current) || version === dismissed) return NO_UPDATE
  const url = typeof d.html_url === 'string' && isReleaseUrl(d.html_url) ? d.html_url : `${RELEASE_URL_PREFIX}releases/latest`
  const notes = typeof d.body === 'string' ? d.body.slice(0, 4000) : ''
  return { available: true, version, url, notes }
}

/** Only links inside the project's repository may be opened from the banner. */
export function isReleaseUrl(url: unknown): url is string {
  return typeof url === 'string' && url.startsWith(RELEASE_URL_PREFIX)
}
