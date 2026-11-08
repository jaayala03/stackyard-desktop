import { execFile } from 'node:child_process'
import { isAbsolute, relative, resolve } from 'node:path'
import type { IpcMain } from 'electron'
import { LOG_FORMAT, parseBranches, parseLog, parseStatus, type GitBranches, type GitCommit, type GitStatus } from './git-parse'

export interface GitResult {
  ok: boolean
  output: string
}

export interface GitOverview {
  isRepo: boolean
  status?: GitStatus
}

const MAX_BUFFER = 20 * 1024 * 1024

function git(cwd: string, args: string[], timeout = 120_000): Promise<GitResult> {
  return new Promise((done) => {
    execFile(
      'git',
      args,
      { cwd, timeout, maxBuffer: MAX_BUFFER, windowsHide: true, env: { ...process.env, GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C' } },
      (err, stdout, stderr) => {
        const out = stdout?.toString() ?? ''
        const errText = stderr?.toString() ?? ''
        const output = out + (out && errText ? '\n' : '') + errText
        done({ ok: !err, output: err && !output ? err.message : output })
      }
    )
  })
}

async function gitOut(cwd: string, args: string[]): Promise<string> {
  const res = await git(cwd, args)
  if (!res.ok) throw new Error(res.output.trim() || 'git failed')
  return res.output
}

/** Paths must stay inside the project folder (no absolute paths or `..`). */
export function safePaths(approot: string, paths: unknown): string[] {
  if (!Array.isArray(paths) || paths.length === 0) throw new Error('No paths given')
  const root = resolve(approot)
  return paths.map((p) => {
    if (typeof p !== 'string' || !p || p.includes('\0') || isAbsolute(p)) throw new Error('Invalid path')
    const rel = relative(root, resolve(root, p))
    if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) throw new Error(`Path outside the project: ${p}`)
    return rel.split('\\').join('/')
  })
}

/** Branch names: nothing that could be read as an option, and no characters git refuses. */
export function safeRef(name: unknown): string {
  if (typeof name !== 'string' || !name || name.startsWith('-') || /[\s\0~^:?*[\\]/.test(name) || name.includes('..')) {
    throw new Error('Invalid name')
  }
  return name
}

function approotOf(value: unknown): string {
  if (typeof value !== 'string' || !value) throw new Error('Invalid project folder')
  return value
}

export function register(ipcMain: IpcMain): void {
  ipcMain.handle('git:status', async (_e, approot: string): Promise<GitOverview> => {
    const root = approotOf(approot)
    const inside = await git(root, ['rev-parse', '--is-inside-work-tree'])
    if (!inside.ok || !inside.output.trim().startsWith('true')) return { isRepo: false }
    const out = await gitOut(root, ['status', '--porcelain=v2', '--branch', '-z', '--untracked-files=all'])
    return { isRepo: true, status: parseStatus(out) }
  })

  ipcMain.handle('git:init', (_e, approot: string) => git(approotOf(approot), ['init']))

  ipcMain.handle('git:diff', async (_e, approot: string, path: string, staged: boolean, untracked: boolean): Promise<string> => {
    const root = approotOf(approot)
    const [rel] = safePaths(root, [path])
    if (untracked) {
      // Diff against an empty file so new files show their whole content (exit code 1 just means "differs").
      const nul = process.platform === 'win32' ? 'NUL' : '/dev/null'
      return (await git(root, ['diff', '--no-index', '--no-color', '--', nul, rel])).output
    }
    const args = ['diff', '--no-color']
    if (staged) args.push('--cached')
    return gitOut(root, [...args, '--', rel])
  })

  ipcMain.handle('git:stage', (_e, approot: string, paths: string[]) => {
    const root = approotOf(approot)
    return git(root, ['add', '--', ...safePaths(root, paths)])
  })

  ipcMain.handle('git:unstage', (_e, approot: string, paths: string[]) => {
    const root = approotOf(approot)
    return git(root, ['reset', '-q', 'HEAD', '--', ...safePaths(root, paths)])
  })

  ipcMain.handle('git:stageAll', (_e, approot: string) => git(approotOf(approot), ['add', '-A']))

  /** Discards worktree changes: tracked files are restored, untracked files are deleted. */
  ipcMain.handle('git:discard', (_e, approot: string, paths: string[], untracked: boolean) => {
    const root = approotOf(approot)
    const safe = safePaths(root, paths)
    return untracked ? git(root, ['clean', '-fdq', '--', ...safe]) : git(root, ['checkout', '--', ...safe])
  })

  ipcMain.handle('git:commit', async (_e, approot: string, message: string, stageAll: boolean): Promise<GitResult> => {
    const root = approotOf(approot)
    if (typeof message !== 'string' || !message.trim()) return { ok: false, output: 'Empty commit message' }
    if (stageAll) {
      const added = await git(root, ['add', '-A'])
      if (!added.ok) return added
    }
    return git(root, ['commit', '-m', message])
  })

  ipcMain.handle('git:fetch', (_e, approot: string) => git(approotOf(approot), ['fetch', '--all', '--prune'], 300_000))
  ipcMain.handle('git:pull', (_e, approot: string) => git(approotOf(approot), ['pull', '--no-edit'], 300_000))
  ipcMain.handle('git:push', async (_e, approot: string): Promise<GitResult> => {
    const root = approotOf(approot)
    const res = await git(root, ['push'], 300_000)
    // First push of a new branch: set the upstream automatically.
    if (!res.ok && /no upstream branch|--set-upstream/.test(res.output)) {
      return git(root, ['push', '--set-upstream', 'origin', 'HEAD'], 300_000)
    }
    return res
  })

  ipcMain.handle('git:branches', async (_e, approot: string): Promise<GitBranches> =>
    parseBranches(await gitOut(approotOf(approot), ['branch', '-a', '--format=%(HEAD)|%(refname)']))
  )

  /** `remote` branches (e.g. origin/feature) are checked out as a tracking local branch. */
  ipcMain.handle('git:checkout', (_e, approot: string, branch: string, remote: boolean) => {
    const name = safeRef(branch)
    return git(approotOf(approot), remote ? ['checkout', '--track', name] : ['checkout', name])
  })

  ipcMain.handle('git:createBranch', (_e, approot: string, name: string) => git(approotOf(approot), ['checkout', '-b', safeRef(name)]))

  ipcMain.handle('git:log', async (_e, approot: string, limit = 30): Promise<GitCommit[]> => {
    const n = Math.min(Math.max(Number(limit) || 30, 1), 200)
    const res = await git(approotOf(approot), ['log', `-${n}`, `--format=${LOG_FORMAT}`])
    return res.ok ? parseLog(res.output) : []
  })
}
