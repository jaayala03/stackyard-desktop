// Pure parsers for git output (no I/O) so they can be unit tested.

export interface GitChange {
  path: string
  /** Original path for renames/copies. */
  origPath?: string
  /** Status letter in the index ('.' = unchanged). */
  index: string
  /** Status letter in the worktree ('.' = unchanged). */
  worktree: string
  untracked?: boolean
  conflicted?: boolean
}

export interface GitStatus {
  branch: string
  upstream: string
  ahead: number
  behind: number
  detached: boolean
  changes: GitChange[]
}

/** Parses `git status --porcelain=v2 --branch -z` (NUL separated records). */
export function parseStatus(output: string): GitStatus {
  const status: GitStatus = { branch: '', upstream: '', ahead: 0, behind: 0, detached: false, changes: [] }
  const records = output.split('\0')
  for (let i = 0; i < records.length; i++) {
    const rec = records[i]
    if (!rec) continue
    if (rec.startsWith('# branch.head ')) {
      const head = rec.slice('# branch.head '.length)
      status.detached = head === '(detached)'
      status.branch = status.detached ? '' : head
    } else if (rec.startsWith('# branch.upstream ')) {
      status.upstream = rec.slice('# branch.upstream '.length)
    } else if (rec.startsWith('# branch.ab ')) {
      const m = /\+(\d+) -(\d+)/.exec(rec)
      if (m) {
        status.ahead = Number(m[1])
        status.behind = Number(m[2])
      }
    } else if (rec.startsWith('1 ')) {
      // 1 XY sub mH mI mW hH hI path
      const parts = rec.split(' ')
      const xy = parts[1]
      status.changes.push({ path: parts.slice(8).join(' '), index: xy[0], worktree: xy[1] })
    } else if (rec.startsWith('2 ')) {
      // 2 XY sub mH mI mW hH hI Xscore path \0 origPath
      const parts = rec.split(' ')
      const xy = parts[1]
      status.changes.push({ path: parts.slice(9).join(' '), origPath: records[++i], index: xy[0], worktree: xy[1] })
    } else if (rec.startsWith('u ')) {
      // u XY sub m1 m2 m3 mW h1 h2 h3 path
      const parts = rec.split(' ')
      const xy = parts[1]
      status.changes.push({ path: parts.slice(10).join(' '), index: xy[0], worktree: xy[1], conflicted: true })
    } else if (rec.startsWith('? ')) {
      status.changes.push({ path: rec.slice(2), index: '.', worktree: '?', untracked: true })
    }
  }
  return status
}

export interface GitCommit {
  hash: string
  short: string
  author: string
  date: string
  subject: string
}

export const LOG_FORMAT = '%H%x1f%h%x1f%an%x1f%aI%x1f%s%x1e'

/** Parses `git log --format=LOG_FORMAT` output. */
export function parseLog(output: string): GitCommit[] {
  return output
    .split('\x1e')
    .map((r) => r.replace(/^\s+/, ''))
    .filter(Boolean)
    .map((r) => {
      const [hash, short, author, date, subject] = r.split('\x1f')
      return { hash, short, author, date, subject: subject ?? '' }
    })
}

export interface GitBranches {
  current: string
  local: string[]
  remote: string[]
}

/** Parses `git branch -a --format=%(HEAD)|%(refname)`. */
export function parseBranches(output: string): GitBranches {
  const result: GitBranches = { current: '', local: [], remote: [] }
  for (const line of output.split(/\r?\n/)) {
    if (!line) continue
    const sep = line.indexOf('|')
    const head = line.slice(0, sep).trim()
    const ref = line.slice(sep + 1)
    if (ref.startsWith('refs/heads/')) {
      const name = ref.slice('refs/heads/'.length)
      result.local.push(name)
      if (head === '*') result.current = name
    } else if (ref.startsWith('refs/remotes/')) {
      const name = ref.slice('refs/remotes/'.length)
      if (!name.endsWith('/HEAD')) result.remote.push(name)
    }
  }
  return result
}

export type DiffLineKind = 'add' | 'del' | 'hunk' | 'meta' | 'ctx'

/** Classifies each line of a unified diff for display. */
export function classifyDiff(diff: string): Array<{ kind: DiffLineKind; text: string }> {
  return diff
    .replace(/\r?\n$/, '')
    .split(/\r?\n/)
    .map((text) => {
      let kind: DiffLineKind = 'ctx'
      if (text.startsWith('@@')) kind = 'hunk'
      else if (/^(diff --git|index |--- |\+\+\+ |new file|deleted file|similarity|rename |old mode|new mode|Binary files)/.test(text)) kind = 'meta'
      else if (text.startsWith('+')) kind = 'add'
      else if (text.startsWith('-')) kind = 'del'
      return { kind, text }
    })
}
