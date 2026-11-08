import { describe, expect, it } from 'vitest'
import { parseConfig, parseList } from '../src/main/ddev'
import { actionSteps, configFlags, createSteps, q } from '../src/main/steps'
import type { CreateOptions } from '../src/shared/types'

const base: CreateOptions = {
  mode: 'new',
  name: 'my-app',
  path: '/tmp/my-app',
  type: 'laravel',
  docroot: 'public',
  php: '8.4',
  node: '24',
  webserver: 'apache-fpm',
  db: 'mariadb:11.8',
  scheme: 'https',
  scaffold: true,
  deps: false,
  phpmyadmin: false,
  launch: false
}

describe('parseList', () => {
  it('reads the raw projects from ddev list -j output', () => {
    const out = 'noise\n{"level":"info","raw":[{"name":"a","status":"running"}]}\n'
    expect(parseList(out)).toEqual([{ name: 'a', status: 'running' }])
  })
  it('throws when there is no JSON', () => {
    expect(() => parseList('nothing')).toThrow()
  })
})

describe('parseConfig', () => {
  it('extracts versions and database', () => {
    const cfg = parseConfig('type: laravel\ndocroot: public\nphp_version: "8.3"\ndatabase:\n  type: mysql\n  version: "8.0"\n')
    expect(cfg).toMatchObject({ type: 'laravel', docroot: 'public', php: '8.3', db: 'mysql:8.0' })
  })
  it('survives invalid YAML', () => {
    expect(parseConfig(': : :\n\t').type).toBe('')
  })
})

describe('quoting', () => {
  it('escapes single quotes for POSIX and PowerShell', () => {
    expect(q("it's", false)).toBe(`'it'\\''s'`)
    expect(q("it's", true)).toBe("'it''s'")
  })
})

describe('createSteps', () => {
  it('configures, scaffolds and starts a new Laravel project', () => {
    const titles = createSteps(base).map((s) => s.title)
    expect(titles).toEqual(['Creating folder /tmp/my-app', 'Configuring DDEV', 'Installing Laravel', 'Starting the project'])
  })
  it('clones before configuring and installs dependencies conditionally', () => {
    const steps = createSteps({ ...base, mode: 'clone', repo: 'https://x/y.git', branch: 'dev', deps: true })
    expect(steps[0].command).toContain("--branch 'dev'")
    expect(steps.filter((s) => s.when).length).toBeGreaterThanOrEqual(3)
  })
  it('adds phpMyAdmin before starting', () => {
    const titles = createSteps({ ...base, phpmyadmin: true }).map((s) => s.title)
    expect(titles.indexOf('Adding phpMyAdmin')).toBeLessThan(titles.indexOf('Starting the project'))
  })
})

describe('configFlags / actions', () => {
  it('omits the project type for automatic detection', () => {
    expect(configFlags({ ...base, type: '' })).not.toContain('--project-type')
  })
  it('builds a ddev command per action', () => {
    expect(actionSteps('/p', 'restart')[0].command).toBe('ddev restart')
  })
})
