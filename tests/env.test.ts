import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createFromExample, listing, readEnv, safePath, writeEnv } from '../src/main/features/env-files'
import {
  fillDdevDb,
  findVar,
  getVars,
  hasDbVars,
  isSecretKey,
  parseEnv,
  removeAt,
  serializeEnv,
  setValueAt,
  setVar,
  syncFromExample
} from '../src/main/features/env-parser'

const SAMPLE = [
  '# App settings',
  'APP_NAME=Laravel',
  'APP_KEY=base64:abc=',
  '',
  'export DEBUG = true # trailing comment',
  'GREETING="hello world"',
  "RAW='single quoted'",
  'EMPTY=',
  '  INDENTED=1',
  'not a variable line',
  '# DB_HOST=127.0.0.1',
  ''
].join('\n')

describe('round trip', () => {
  it.each([
    ['LF', SAMPLE],
    ['CRLF', SAMPLE.replace(/\n/g, '\r\n')],
    ['no final newline', SAMPLE.replace(/\n$/, '')],
    ['BOM', '﻿' + SAMPLE],
    ['empty', ''],
    ['only blank', '\n\n']
  ])('is lossless for %s', (_name, text) => {
    expect(serializeEnv(parseEnv(text))).toBe(text)
  })
})

describe('parsing', () => {
  const doc = parseEnv(SAMPLE)
  it('reads keys, values and quotes', () => {
    expect(findVar(doc, 'APP_NAME')).toMatchObject({ value: 'Laravel', quote: '' })
    expect(findVar(doc, 'GREETING')).toMatchObject({ value: 'hello world', quote: '"' })
    expect(findVar(doc, 'RAW')).toMatchObject({ value: 'single quoted', quote: "'" })
    expect(findVar(doc, 'EMPTY')?.value).toBe('')
    expect(findVar(doc, 'INDENTED')?.value).toBe('1')
  })
  it('handles export prefix, spaces around = and inline comments', () => {
    expect(findVar(doc, 'DEBUG')).toMatchObject({ value: 'true', exported: 'export ', trailing: ' # trailing comment' })
  })
  it('does not treat comments or junk as variables', () => {
    expect(getVars(doc).map((v) => v.key)).not.toContain('DB_HOST')
    expect(doc.lines.some((l) => l.kind === 'raw')).toBe(true)
  })
  it('keeps # inside values without a leading space', () => {
    expect(findVar(parseEnv('URL=http://x/#anchor\n'), 'URL')?.value).toBe('http://x/#anchor')
  })
  it('keeps inline comments after a quoted value', () => {
    const v = findVar(parseEnv('A="x y" # note\n'), 'A')
    expect(v).toMatchObject({ value: 'x y', trailing: ' # note' })
  })
  it('treats an unterminated quote as a plain value', () => {
    expect(findVar(parseEnv('A="oops\n'), 'A')).toMatchObject({ value: '"oops', quote: '' })
  })
  it('unescapes double quoted values', () => {
    expect(findVar(parseEnv('A="a\\"b\\\\c\\nd"\n'), 'A')?.value).toBe('a"b\\c\nd')
  })
})

describe('editing', () => {
  it('only rewrites the edited line and keeps its decorations', () => {
    const doc = parseEnv(SAMPLE)
    const idx = doc.lines.findIndex((l) => l.kind === 'var' && l.key === 'DEBUG')
    const out = serializeEnv(setValueAt(doc, idx, 'false')).split('\n')
    expect(out[4]).toBe('export DEBUG = false # trailing comment')
    expect(out.filter((_l, i) => i !== 4)).toEqual(SAMPLE.split('\n').filter((_l, i) => i !== 4))
  })
  it('quotes only when needed and keeps the existing quote style', () => {
    let doc = parseEnv('A=1\nB="x"\nC=\'y\'\n')
    doc = setVar(doc, 'A', 'two words')
    doc = setVar(doc, 'B', 'plain')
    doc = setVar(doc, 'C', "it's")
    expect(serializeEnv(doc)).toBe('A="two words"\nB="plain"\nC="it\'s"\n')
  })
  it('escapes quotes, backslashes and newlines', () => {
    const out = serializeEnv(setVar(parseEnv(''), 'A', 'a"b\\c\nd'))
    expect(out).toBe('A="a\\"b\\\\c\\nd"\n')
    expect(findVar(parseEnv(out), 'A')?.value).toBe('a"b\\c\nd')
  })
  it('is a no-op when the value does not change', () => {
    const doc = parseEnv(SAMPLE)
    expect(setVar(doc, 'APP_NAME', 'Laravel')).toBe(doc)
  })
  it('appends new variables and creates the final newline', () => {
    expect(serializeEnv(setVar(parseEnv(''), 'A', '1'))).toBe('A=1\n')
    expect(serializeEnv(setVar(parseEnv('A=1'), 'B', '2'))).toBe('A=1\nB=2\n')
  })
  it('replaces a commented-out definition instead of appending', () => {
    const out = serializeEnv(setVar(parseEnv('# DB_HOST=127.0.0.1\nX=1\n'), 'DB_HOST', 'db'))
    expect(out).toBe('DB_HOST=db\nX=1\n')
  })
  it('removes a line', () => {
    const doc = parseEnv('A=1\nB=2\n')
    expect(serializeEnv(removeAt(doc, 0))).toBe('B=2\n')
  })
  it('preserves CRLF when appending', () => {
    expect(serializeEnv(setVar(parseEnv('A=1\r\n'), 'B', '2'))).toBe('A=1\r\nB=2\r\n')
  })
})

describe('sync from example', () => {
  it('adds only the missing keys, with their example values', () => {
    const doc = parseEnv('A=1\n')
    const example = parseEnv('A=changed\nB=2\n# note\nC="x y"\n')
    const res = syncFromExample(doc, example)
    expect(res.added).toEqual(['B', 'C'])
    expect(serializeEnv(res.doc)).toBe('A=1\n\nB=2\nC="x y"\n')
  })
  it('returns the same document when nothing is missing', () => {
    const doc = parseEnv('A=1\n')
    expect(syncFromExample(doc, parseEnv('A=9\n')).doc).toBe(doc)
  })
})

describe('DDEV database values', () => {
  it('fills MySQL/MariaDB settings', () => {
    const doc = parseEnv('DB_CONNECTION=sqlite\n# DB_HOST=127.0.0.1\n# DB_PORT=3306\nDB_DATABASE=laravel\nDB_USERNAME=root\nDB_PASSWORD=\n')
    expect(hasDbVars(doc)).toBe(true)
    const { doc: out, changed } = fillDdevDb(doc, 'mariadb:11.8')
    expect(changed).toEqual(['DB_CONNECTION', 'DB_HOST', 'DB_PORT', 'DB_DATABASE', 'DB_USERNAME', 'DB_PASSWORD'])
    expect(serializeEnv(out)).toBe('DB_CONNECTION=mysql\nDB_HOST=db\nDB_PORT=3306\nDB_DATABASE=db\nDB_USERNAME=db\nDB_PASSWORD=db\n')
  })
  it('uses 5432 and pgsql for PostgreSQL, and reports no changes the second time', () => {
    const first = fillDdevDb(parseEnv('DB_HOST=127.0.0.1\n'), 'postgres:17')
    expect(findVar(first.doc, 'DB_PORT')?.value).toBe('5432')
    expect(findVar(first.doc, 'DB_CONNECTION')?.value).toBe('pgsql')
    expect(fillDdevDb(first.doc, 'postgres:17').changed).toEqual([])
  })
})

describe('secrets', () => {
  it.each(['DB_PASSWORD', 'APP_KEY', 'STRIPE_SECRET', 'api_token', 'AWS_SECRET_ACCESS_KEY'])('masks %s', (k) => {
    expect(isSecretKey(k)).toBe(true)
  })
  it.each(['APP_NAME', 'DB_HOST', 'APP_DEBUG'])('does not mask %s', (k) => {
    expect(isSecretKey(k)).toBe(false)
  })
})

describe('file operations', () => {
  let root: string
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'env-test-'))
  })
  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('lists env files in the root and sub-folders, skipping vendor dirs and backups', async () => {
    await writeFile(join(root, '.env'), 'A=1\n')
    await writeFile(join(root, '.env.example'), 'A=\n')
    await writeFile(join(root, '.env.bak'), 'old\n')
    await mkdir(join(root, 'backend'))
    await writeFile(join(root, 'backend', '.env.example'), 'B=\n')
    await mkdir(join(root, 'node_modules', 'x'), { recursive: true })
    await writeFile(join(root, 'node_modules', 'x', '.env'), 'no\n')
    const res = await listing(root)
    expect(res.files).toEqual(['.env', '.env.example', 'backend/.env.example'])
    expect(res.creatable).toEqual([{ example: 'backend/.env.example', target: 'backend/.env' }])
  })

  it('writes atomically and keeps a .bak of the previous version', async () => {
    await writeFile(join(root, '.env'), 'A=1\n')
    await writeEnv(root, '.env', 'A=2\n')
    expect(await readEnv(root, '.env')).toBe('A=2\n')
    expect(await readFile(join(root, '.env.bak'), 'utf8')).toBe('A=1\n')
  })

  it('creates a new file without leaving temp files', async () => {
    await writeEnv(root, '.env', 'X=1\n')
    expect((await listing(root)).files).toEqual(['.env'])
  })

  it('creates a file from its example and never overwrites', async () => {
    await writeFile(join(root, '.env.example'), 'A=1\n')
    await createFromExample(root, '.env.example', '.env')
    expect(await readEnv(root, '.env')).toBe('A=1\n')
    await expect(createFromExample(root, '.env.example', '.env')).rejects.toThrow()
  })

  it('rejects paths outside the project or not named .env*', async () => {
    await expect(safePath(root, '../.env')).rejects.toThrow()
    await expect(safePath(root, join(root, '.env'))).rejects.toThrow()
    await expect(safePath(root, 'sub/../../.env')).rejects.toThrow()
    await expect(safePath(root, 'package.json')).rejects.toThrow()
    await expect(safePath(root, '')).rejects.toThrow()
    await expect(writeEnv(root, '../.env', 'x')).rejects.toThrow()
    await expect(safePath(root, 'a/.env')).resolves.toContain('.env')
  })

  it('rejects a symlink that escapes the project', async () => {
    const outside = await mkdtemp(join(tmpdir(), 'env-outside-'))
    try {
      await writeFile(join(outside, '.env'), 'SECRET=1\n')
      try {
        await symlink(outside, join(root, 'link'), 'junction')
      } catch {
        return // symlinks not permitted on this system
      }
      await expect(safePath(root, 'link/.env')).rejects.toThrow()
    } finally {
      await rm(outside, { recursive: true, force: true })
    }
  })
})
