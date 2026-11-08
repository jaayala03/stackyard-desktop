import { describe, expect, it } from 'vitest'
import { defaultSnapshotName, humanSize, isValidSnapshotName, parseSnapshotList, shortWhen } from '../src/main/features/snap-parse'

const item = (Name: string, Created: string, Size = 2048) => ({ Name, Created, Size, DBVersion: 'mariadb_11.8' })

describe('parseSnapshotList', () => {
  it('reads the raw object keyed by project name, newest first', () => {
    const raw = { 'my-app': [item('old', '2026-01-01T10:00:00Z'), item('new', '2026-02-01T10:00:00Z')] }
    const out = `noise\n${JSON.stringify({ level: 'info', raw })}\n`
    const list = parseSnapshotList(out, 'my-app')
    expect(list.map((s) => s.name)).toEqual(['new', 'old'])
    expect(list[0]).toMatchObject({ size: 2048, dbVersion: 'mariadb_11.8' })
  })
  it('accepts a plain array and skips malformed entries', () => {
    const out = JSON.stringify({ raw: [item('a', '2026-01-01'), null, { Size: 1 }, 'x'] })
    expect(parseSnapshotList(out, 'p').map((s) => s.name)).toEqual(['a'])
  })
  it('returns an empty list when the project has no snapshots', () => {
    expect(parseSnapshotList(JSON.stringify({ raw: {} }), 'p')).toEqual([])
    expect(parseSnapshotList(JSON.stringify({ raw: null }), 'p')).toEqual([])
  })
  it('ignores non-JSON lines and throws when there is no raw field', () => {
    expect(() => parseSnapshotList('nothing here\n{"level":"info"}\n{bad', 'p')).toThrow()
  })
})

describe('names', () => {
  it('validates snapshot names', () => {
    for (const ok of ['a', 'my-app_20260101-1200', 'A1_b-2']) expect(isValidSnapshotName(ok)).toBe(true)
    for (const bad of ['', '-x', '_x', 'a b', 'a/b', '..', 'a;rm', 'x'.repeat(101), 5, null]) expect(isValidSnapshotName(bad)).toBe(false)
  })
  it('builds a valid default name', () => {
    const name = defaultSnapshotName('my.app', new Date(2026, 10, 8, 9, 5))
    expect(name).toBe('my-app_20261108-0905')
    expect(isValidSnapshotName(name)).toBe(true)
    expect(isValidSnapshotName(defaultSnapshotName('...'))).toBe(true)
  })
})

describe('formatting', () => {
  it('formats sizes and dates', () => {
    expect(humanSize(512)).toBe('512 B')
    expect(humanSize(1536)).toBe('1.5 KB')
    expect(humanSize(5 * 1024 * 1024)).toBe('5.0 MB')
    expect(humanSize(-1)).toBe('—')
    expect(shortWhen('2026-11-07T20:06:29.17-05:00')).toBe('2026-11-07 20:06')
  })
})
