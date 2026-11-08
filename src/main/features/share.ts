import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { statSync } from 'node:fs'
import { delimiter, join, resolve } from 'node:path'
import { app, type IpcMain } from 'electron'
import {
  appendLog,
  findUrl,
  isProvider,
  shareArgs,
  tokenArgs,
  toLines,
  validToken,
  type ShareProvider,
  type ShareProviders,
  type ShareStatus
} from './share-parse'

export type { ShareProviders, ShareStatus } from './share-parse'

interface Session {
  child: ChildProcess
  status: ShareStatus
}

const win = process.platform === 'win32'
const sessions = new Map<string, Session>()

const keyOf = (approot: string): string => (win ? resolve(approot).toLowerCase() : resolve(approot))

function isProject(approot: string): boolean {
  try {
    return statSync(join(approot, '.ddev')).isDirectory()
  } catch {
    return false
  }
}

function assertProject(approot: unknown): asserts approot is string {
  if (typeof approot !== 'string' || !isProject(approot)) throw new Error('Not a DDEV project')
}

/** True when `name` is an executable file in one of the PATH folders. */
function onPath(name: string): boolean {
  const exts = win ? (process.env.PATHEXT ?? '.EXE;.CMD;.BAT').split(';').concat('') : ['']
  for (const dir of (process.env.PATH ?? '').split(delimiter)) {
    if (!dir) continue
    for (const ext of exts) {
      try {
        if (statSync(join(dir, name + ext)).isFile()) return true
      } catch {
        /* not here */
      }
    }
  }
  return false
}

export function detectProviders(): ShareProviders {
  return { cloudflared: onPath('cloudflared'), ngrok: onPath('ngrok') }
}

const idle = (): ShareStatus => ({ running: false, provider: null, url: null, log: [], exitCode: null })

function snapshot(approot: string): ShareStatus {
  const s = sessions.get(keyOf(approot))
  return s ? { ...s.status, log: [...s.status.log] } : idle()
}

function killTree(child: ChildProcess): void {
  const pid = child.pid
  if (!pid) return
  if (win) {
    execFile('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true }, () => {})
    return
  }
  try {
    process.kill(-pid, 'SIGTERM') // the child leads its own process group (detached)
  } catch {
    try {
      child.kill('SIGTERM')
    } catch {
      /* already gone */
    }
  }
}

function start(approot: string, provider: ShareProvider): ShareStatus {
  const key = keyOf(approot)
  const current = sessions.get(key)
  if (current?.status.running) return snapshot(approot)

  const child = spawn('ddev', shareArgs(provider), {
    cwd: approot,
    windowsHide: true,
    detached: !win,
    stdio: ['ignore', 'pipe', 'pipe']
  })
  const status: ShareStatus = { running: true, provider, url: null, log: [], exitCode: null }
  sessions.set(key, { child, status })

  const onData = (chunk: Buffer): void => {
    const text = chunk.toString()
    status.log = appendLog(status.log, toLines(text))
    if (!status.url) status.url = findUrl(text)
  }
  child.stdout?.on('data', onData)
  child.stderr?.on('data', onData)
  child.on('error', (err) => {
    status.log = appendLog(status.log, [err.message])
    status.running = false
    status.exitCode = 1
  })
  child.on('exit', (code) => {
    status.running = false
    status.exitCode = code ?? 0
    status.url = null // the tunnel is gone together with the process
  })
  return snapshot(approot)
}

function stop(approot: string): ShareStatus {
  const s = sessions.get(keyOf(approot))
  if (s?.status.running) killTree(s.child)
  return snapshot(approot)
}

/** Stops every running tunnel (called when the app quits). */
export function stopAll(): void {
  for (const s of sessions.values()) if (s.status.running) killTree(s.child)
}

function saveToken(token: unknown): Promise<{ ok: boolean; message: string }> {
  if (!validToken(token)) return Promise.resolve({ ok: false, message: 'invalid' })
  return new Promise((done) => {
    // The token is only passed as an argument; it is never logged or echoed back.
    execFile('ddev', tokenArgs(token), { timeout: 60_000, windowsHide: true }, (err) => {
      done({ ok: !err, message: err ? 'failed' : 'saved' })
    })
  })
}

/** IPC handlers for the share tab. Channels start with 'share:' (preload allow-list). */
export function register(ipcMain: IpcMain): void {
  ipcMain.handle('share:providers', (): ShareProviders => detectProviders())

  ipcMain.handle('share:status', (_e, approot: unknown): ShareStatus => {
    assertProject(approot)
    return snapshot(approot)
  })

  ipcMain.handle('share:start', (_e, approot: unknown, provider: unknown): ShareStatus => {
    assertProject(approot)
    if (!isProvider(provider)) throw new Error('Unknown provider')
    return start(approot, provider)
  })

  ipcMain.handle('share:stop', (_e, approot: unknown): ShareStatus => {
    assertProject(approot)
    return stop(approot)
  })

  ipcMain.handle('share:saveToken', (_e, token: unknown) => saveToken(token))

  app.on('before-quit', stopAll)
}
