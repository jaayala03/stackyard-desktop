import { describe, expect, it } from 'vitest'
import { classifyDiff, parseBranches, parseLog, parseStatus, LOG_FORMAT } from '../src/main/features/git-parse'
import { safePaths, safeRef } from '../src/main/features/git'

describe('parseStatus', () => {
  it('reads branch info and ahead/behind', () => {
    const out = ['# branch.oid abc', '# branch.head main', '# branch.upstream origin/main', '# branch.ab +2 -1', ''].join('\0')
    expect(parseStatus(out)).toMatchObject({ branch: 'main', upstream: 'origin/main', ahead: 2, behind: 1, detached: false })
  })
  it('reads ordinary, renamed, untracked and conflicted entries', () => {
    const out = [
      '# branch.head dev',
      '1 M. N... 100644 100644 100644 aaa bbb src/a b.ts',
      '1 .M N... 100644 100644 100644 aaa bbb README.md',
      '2 R. N... 100644 100644 100644 aaa bbb R100 new.txt',
      'old.txt',
      'u UU N... 100644 100644 100644 100644 a b c conflict.txt',
      '? notes.md',
      ''
    ].join('\0')
    const { changes } = parseStatus(out)
    expect(changes).toHaveLength(5)
    expect(changes[0]).toMatchObject({ path: 'src/a b.ts', index: 'M', worktree: '.' })
    expect(changes[1]).toMatchObject({ path: 'README.md', index: '.', worktree: 'M' })
    expect(changes[2]).toMatchObject({ path: 'new.txt', origPath: 'old.txt', index: 'R' })
    expect(changes[3]).toMatchObject({ path: 'conflict.txt', conflicted: true })
    expect(changes[4]).toMatchObject({ path: 'notes.md', untracked: true })
  })
  it('flags a detached HEAD', () => {
    const s = parseStatus('# branch.head (detached)\0')
    expect(s.detached).toBe(true)
    expect(s.branch).toBe('')
  })
})

describe('parseLog', () => {
  it('splits commits using the record/unit separators', () => {
    expect(LOG_FORMAT).toContain('%x1e')
    const out = 'h1\x1fh\x1fAna\x1f2026-01-01T00:00:00Z\x1fFirst | commit\x1e\nh2\x1fg\x1fLuis\x1f2026-01-02T00:00:00Z\x1fSecond\x1e\n'
    const log = parseLog(out)
    expect(log).toHaveLength(2)
    expect(log[0]).toMatchObject({ hash: 'h1', short: 'h', author: 'Ana', subject: 'First | commit' })
    expect(log[1].subject).toBe('Second')
  })
  it('returns [] for empty output', () => {
    expect(parseLog('')).toEqual([])
  })
})

describe('parseBranches', () => {
  it('separates local and remote branches and finds the current one', () => {
    const out = '*|refs/heads/main\n |refs/heads/feat/x\n |refs/remotes/origin/HEAD\n |refs/remotes/origin/main\n'
    expect(parseBranches(out)).toEqual({ current: 'main', local: ['main', 'feat/x'], remote: ['origin/main'] })
  })
})

describe('classifyDiff', () => {
  it('classifies lines', () => {
    const kinds = classifyDiff('diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -1 +1 @@\n-old\n+new\n same\n').map((l) => l.kind)
    expect(kinds).toEqual(['meta', 'meta', 'meta', 'hunk', 'del', 'add', 'ctx'])
  })
})

describe('safePaths', () => {
  const root = process.platform === 'win32' ? 'C:\\proj' : '/proj'
  it('accepts paths inside the project and normalises separators', () => {
    expect(safePaths(root, ['src/a.ts', 'dir\\b.ts'])).toEqual(['src/a.ts', 'dir/b.ts'])
  })
  it('rejects traversal, absolute paths and the root itself', () => {
    expect(() => safePaths(root, ['../x'])).toThrow()
    expect(() => safePaths(root, ['a/../../x'])).toThrow()
    expect(() => safePaths(root, [process.platform === 'win32' ? 'C:\\other\\x' : '/etc/passwd'])).toThrow()
    expect(() => safePaths(root, ['.'])).toThrow()
    expect(() => safePaths(root, [])).toThrow()
  })
})

describe('safeRef', () => {
  it('rejects option-like and malformed names', () => {
    for (const bad of ['', '-x', '--force', 'a b', 'a..b', 'a~1', 'a:b', 'a\\b']) expect(() => safeRef(bad)).toThrow()
    expect(safeRef('feature/login-2')).toBe('feature/login-2')
  })
})
