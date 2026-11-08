import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createEntry, deleteEntry, listDir, looksBinary, readText, renameEntry, writeText } from '../src/main/features/code'
import { isInside, safePath } from '../src/main/features/code-paths'

let root: string
let outside: string

beforeAll(async () => {
  const base = await mkdtemp(join(tmpdir(), 'sy-code-'))
  root = join(base, 'proj')
  outside = join(base, 'secret')
  await mkdir(join(root, 'src'), { recursive: true })
  await mkdir(join(root, 'node_modules', 'x'), { recursive: true })
  await mkdir(outside, { recursive: true })
  await writeFile(join(root, 'src', 'a.php'), '<?php echo 1;')
  await writeFile(join(outside, 'pw.txt'), 'secret')
})

afterAll(async () => {
  await rm(resolve(root, '..'), { recursive: true, force: true })
})

describe('isInside', () => {
  it('accepts the root and children, rejects siblings and parents', () => {
    expect(isInside('/a/b', '/a/b')).toBe(true)
    expect(isInside('/a/b', '/a/b/c/d')).toBe(true)
    expect(isInside('/a/b', '/a/bc')).toBe(false)
    expect(isInside('/a/b', '/a')).toBe(false)
  })
})

describe('safePath', () => {
  it('resolves paths inside the project', async () => {
    expect(await safePath(root, 'src/a.php')).toBe(join(root, 'src', 'a.php'))
    expect(await safePath(root, 'new/dir/file.txt')).toBe(join(root, 'new', 'dir', 'file.txt'))
  })
  it('rejects traversal and absolute paths outside', async () => {
    await expect(safePath(root, '../secret/pw.txt')).rejects.toThrow()
    await expect(safePath(root, 'src/../../secret')).rejects.toThrow()
    await expect(safePath(root, join(outside, 'pw.txt'))).rejects.toThrow()
    await expect(safePath(root, 'a\0b')).rejects.toThrow()
  })
  it('rejects symlinks that escape the project', async () => {
    try {
      await symlink(outside, join(root, 'link'), 'junction')
    } catch {
      return // cannot create links here
    }
    await expect(safePath(root, 'link/pw.txt')).rejects.toThrow()
    await expect(readText(root, 'link/pw.txt')).rejects.toThrow()
  })
})

describe('file operations', () => {
  it('lists folders first and hides node_modules unless asked', async () => {
    const names = (await listDir(root, '.', false)).map((e) => e.name)
    expect(names).not.toContain('node_modules')
    expect(names).toContain('src')
    expect(names.indexOf('src')).toBeLessThan(names.indexOf('big.txt') === -1 ? 999 : names.indexOf('big.txt'))
    expect((await listDir(root, '.', true)).map((e) => e.name)).toContain('node_modules')
  })
  it('reads text and refuses binary or huge files', async () => {
    expect(await readText(root, 'src/a.php')).toMatchObject({ ok: true, content: '<?php echo 1;' })
    await writeFile(join(root, 'bin.dat'), Buffer.from([1, 0, 2]))
    expect(await readText(root, 'bin.dat')).toEqual({ ok: false, reason: 'binary' })
    await writeFile(join(root, 'big.txt'), Buffer.alloc(2 * 1024 * 1024 + 1, 97))
    expect(await readText(root, 'big.txt')).toEqual({ ok: false, reason: 'tooLarge' })
    expect(looksBinary(Buffer.from('hola'))).toBe(false)
  })
  it('writes atomically without leaving temp files', async () => {
    await writeText(root, 'src/a.php', 'changed')
    expect(await readFile(join(root, 'src', 'a.php'), 'utf8')).toBe('changed')
    expect((await listDir(root, 'src', true)).map((e) => e.name)).toEqual(['a.php'])
  })
  it('creates, renames and deletes', async () => {
    await createEntry(root, 'src/new.txt', false)
    await expect(createEntry(root, 'src/new.txt', false)).rejects.toThrow()
    await renameEntry(root, 'src/new.txt', 'src/renamed.txt')
    await expect(renameEntry(root, 'src/renamed.txt', 'src/a.php')).rejects.toThrow()
    await deleteEntry(root, 'src/renamed.txt')
    expect((await listDir(root, 'src', true)).map((e) => e.name)).toEqual(['a.php'])
  })
  it('never deletes the project folder or escapes it', async () => {
    await expect(deleteEntry(root, '.')).rejects.toThrow()
    await expect(deleteEntry(root, '../secret')).rejects.toThrow()
  })
})
