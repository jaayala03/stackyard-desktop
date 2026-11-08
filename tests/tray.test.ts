import { describe, expect, it } from 'vitest'
import { trayEn, trayEs } from '../src/renderer/src/locales/tray'
import { IdleTracker, parseBytes, parseOwners, parseStats, projectMark, shouldNotify, type Usage } from '../src/main/tray-logic'

const usage = (webCpu: number, webRx: number): Usage => ({ cpu: webCpu, mem: 0, webCpu, webRx })
const MIN = 60_000

describe('parseBytes', () => {
  it('handles decimal and binary units', () => {
    expect(parseBytes('1.5MiB')).toBe(1572864)
    expect(parseBytes('2kB')).toBe(2000)
    expect(parseBytes('10 GiB')).toBe(10 * 1024 ** 3)
  })
  it('returns 0 for garbage', () => {
    expect(parseBytes('')).toBe(0)
    expect(parseBytes(undefined)).toBe(0)
    expect(parseBytes('abc')).toBe(0)
  })
})

describe('parseOwners / parseStats', () => {
  const ps = 'ddev-app-web|app|web\nddev-app-db|app|db\nddev-router|\nother|x|y\n'
  const stats = [
    { Name: 'ddev-app-web', CPUPerc: '2.50%', MemUsage: '100MiB / 2GiB', NetIO: '5kB / 1kB' },
    { Name: 'ddev-app-db', CPUPerc: '0.50%', MemUsage: '50MiB / 2GiB', NetIO: '1kB / 1kB' },
    { Name: 'ddev-router', CPUPerc: '0.10%', MemUsage: '10MiB / 2GiB', NetIO: '0B / 0B' },
    { Name: 'other', CPUPerc: '90%', MemUsage: '1GiB / 2GiB', NetIO: '0B / 0B' }
  ]
    .map((s) => JSON.stringify(s))
    .join('\n')

  it('keeps only ddev containers and groups the router under __ddev__', () => {
    const owners = parseOwners(ps)
    expect([...owners.keys()].sort()).toEqual(['ddev-app-db', 'ddev-app-web', 'ddev-router'])
    expect(owners.get('ddev-router')?.site).toBe('__ddev__')
  })
  it('aggregates CPU and memory per project and reads the web container', () => {
    const out = parseStats(stats + '\nnot json', parseOwners(ps))
    expect(out.app.cpu).toBeCloseTo(3)
    expect(out.app.mem).toBe(150 * 1024 ** 2)
    expect(out.app.webCpu).toBeCloseTo(2.5)
    expect(out.app.webRx).toBe(5000)
    expect(Object.keys(out).sort()).toEqual(['__ddev__', 'app'])
  })
})

describe('IdleTracker', () => {
  it('flags a project that stays quiet longer than the limit', () => {
    const t = new IdleTracker()
    t.update({ a: usage(0, 100) }, ['a'], 0)
    t.update({ a: usage(0.2, 100) }, ['a'], 20 * MIN)
    expect(t.idleProjects(30, 29 * MIN)).toEqual([])
    expect(t.idleProjects(30, 30 * MIN)).toEqual(['a'])
  })
  it('CPU activity or network traffic resets the clock', () => {
    const t = new IdleTracker()
    t.update({ a: usage(0, 100) }, ['a'], 0)
    t.update({ a: usage(5, 100) }, ['a'], 25 * MIN)
    expect(t.idleProjects(30, 40 * MIN)).toEqual([])
    t.update({ a: usage(0, 900) }, ['a'], 50 * MIN)
    expect(t.idleProjects(30, 70 * MIN)).toEqual([])
    expect(t.idleProjects(30, 80 * MIN)).toEqual(['a'])
  })
  it('never flags anything when disabled or without stats', () => {
    const t = new IdleTracker()
    t.update({}, ['a'], 0)
    expect(t.idleProjects(30, 999 * MIN)).toEqual([])
    t.update({ a: usage(0, 0) }, ['a'], 0)
    expect(t.idleProjects(0, 999 * MIN)).toEqual([])
  })
  it('forgets stopped projects and honours reset', () => {
    const t = new IdleTracker()
    t.update({ a: usage(0, 0) }, ['a'], 0)
    t.update({}, [], 10 * MIN)
    expect(t.idleProjects(5, 60 * MIN)).toEqual([])
    t.update({ a: usage(0, 0) }, ['a'], 100 * MIN)
    t.reset('a', 120 * MIN)
    expect(t.idleProjects(30, 140 * MIN)).toEqual([])
  })
})

describe('shouldNotify / projectMark', () => {
  it('follows the mode', () => {
    expect(shouldNotify('never', false)).toBe(false)
    expect(shouldNotify('always', true)).toBe(true)
    expect(shouldNotify('background', true)).toBe(false)
    expect(shouldNotify('background', false)).toBe(true)
  })
  it('marks busy, running and stopped projects', () => {
    expect(projectMark('running', true)).toBe('⏳')
    expect(projectMark('running', false)).toBe('●')
    expect(projectMark('stopped', false)).toBe('○')
  })
})

describe('tray locales', () => {
  it('Spanish has exactly the English keys and placeholders', () => {
    expect(Object.keys(trayEs).sort()).toEqual(Object.keys(trayEn).sort())
    const vars = (s: string): string[] => (s.match(/\{\w+\}/g) ?? []).sort()
    for (const k of Object.keys(trayEn) as Array<keyof typeof trayEn>) expect(vars(trayEs[k])).toEqual(vars(trayEn[k]))
  })
})
