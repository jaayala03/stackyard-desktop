import { describe, expect, it } from 'vitest'
import { defaultExportName, exportArgs, exportGzip, importArgs, parseDescribe, phpmyadminUrl, validDatabaseName } from '../src/main/features/db-parse'
import { dbEn, dbEs } from '../src/renderer/src/locales/db'

const describeOut = JSON.stringify({
  level: 'info',
  raw: {
    name: 'my-app',
    httpsurl: 'https://my-app.ddev.site',
    httpurl: 'http://my-app.ddev.site',
    dbinfo: {
      database_type: 'mariadb',
      database_version: '11.8',
      dbPort: '3306',
      dbname: 'db',
      host: 'db',
      password: 'db',
      published_port: 32801,
      username: 'db'
    }
  }
})

describe('parseDescribe', () => {
  it('reads connection info and the phpMyAdmin URL', () => {
    const res = parseDescribe('warning line\n' + describeOut + '\n')
    expect(res.info).toEqual({
      engine: 'mariadb',
      version: '11.8',
      host: 'db',
      port: '3306',
      publishedPort: '32801',
      database: 'db',
      username: 'db',
      password: 'db'
    })
    expect(res.phpmyadminUrl).toBe('https://my-app.ddev.site:8037')
  })
  it('defaults the postgres port and tolerates missing fields', () => {
    const out = JSON.stringify({ raw: { dbinfo: { database_type: 'postgres' } } })
    expect(parseDescribe(out).info).toMatchObject({ port: '5432', host: 'db', username: 'db' })
  })
  it('returns null info for a stopped project or garbage', () => {
    expect(parseDescribe(JSON.stringify({ raw: { name: 'x' } })).info).toBeNull()
    expect(parseDescribe('not json').info).toBeNull()
  })
})

describe('phpmyadminUrl', () => {
  it('falls back to http and handles empty input', () => {
    expect(phpmyadminUrl('', 'http://a.ddev.site')).toBe('http://a.ddev.site:8036')
    expect(phpmyadminUrl('', '')).toBe('')
  })
})

describe('command arguments', () => {
  it('builds import args without manual quoting', () => {
    expect(importArgs('C:\\my dumps\\a b.sql.gz', '')).toEqual(['import-db', '--file=C:\\my dumps\\a b.sql.gz'])
    expect(importArgs('/x.sql', 'other')).toEqual(['import-db', '--file=/x.sql', '--database=other'])
  })
  it('gzips exports unless the name ends in .sql', () => {
    expect(exportGzip('a.sql.gz')).toBe(true)
    expect(exportGzip('a.sql')).toBe(false)
    expect(exportArgs('a.sql')).toEqual(['export-db', '--file=a.sql', '--gzip=false'])
    expect(exportArgs('a.sql.gz')).toEqual(['export-db', '--file=a.sql.gz', '--gzip=true'])
  })
  it('validates database names', () => {
    expect(validDatabaseName('')).toBe(true)
    expect(validDatabaseName('my_db1')).toBe(true)
    expect(validDatabaseName('x; drop')).toBe(false)
    expect(validDatabaseName('--evil')).toBe(false)
  })
  it('names exports with a timestamp', () => {
    expect(defaultExportName('shop', new Date(2026, 10, 8, 9, 5))).toBe('shop-20261108-0905.sql.gz')
  })
})

describe('locales', () => {
  it('have the same keys in English and Spanish', () => {
    expect(Object.keys(dbEs).sort()).toEqual(Object.keys(dbEn).sort())
  })
})
