import { randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { spawn, type IPty } from '@lydell/node-pty'
import type { TermSession } from '../shared/types'
import type { Step } from './steps'

const MAX_BUFFER = 200_000
const win = process.platform === 'win32'

interface Session extends TermSession {
  pty?: IPty
  buffer: string
  cols: number
  rows: number
  cancelled: boolean
}

type Emit = (channel: 'data' | 'exit', id: string, payload: string | number) => void

const sessions = new Map<string, Session>()
let emit: Emit = () => {}

export function setEmitter(fn: Emit): void {
  emit = fn
}

/** argv that runs a command line in the platform shell. */
export function shellArgv(command: string): [string, string[]] {
  return win
    ? ['powershell.exe', ['-NoLogo', '-NoProfile', '-Command', command]]
    : [process.env.SHELL || '/bin/bash', ['-lc', command]]
}

function push(s: Session, data: string): void {
  s.buffer = (s.buffer + data).slice(-MAX_BUFFER)
  emit('data', s.id, data)
}

function make(title: string, kind: TermSession['kind']): Session {
  const s: Session = { id: randomUUID(), title, kind, running: true, buffer: '', cols: 100, rows: 24, cancelled: false }
  sessions.set(s.id, s)
  return s
}

function info(s: Session): TermSession {
  return { id: s.id, title: s.title, kind: s.kind, running: s.running }
}

function finish(s: Session, code: number): void {
  s.running = false
  s.pty = undefined
  emit('exit', s.id, code)
}

function exec(s: Session, command: string, cwd?: string): Promise<number> {
  return new Promise((resolve) => {
    const [file, args] = shellArgv(command)
    const pty = spawn(file, args, {
      name: 'xterm-256color',
      cols: s.cols,
      rows: s.rows,
      cwd: cwd || homedir(),
      env: process.env as Record<string, string>
    })
    s.pty = pty
    pty.onData((d) => push(s, d))
    pty.onExit(({ exitCode }) => resolve(exitCode))
  })
}

const banner = (text: string): string => `\r\n\x1b[1;36m==> ${text}\x1b[0m\r\n`

/** Runs steps one after another, stopping at the first failure. */
export function runJob(title: string, steps: Step[], doneMessage: string): TermSession {
  const s = make(title, 'job')
  void (async () => {
    try {
      for (const step of steps) {
        if (s.cancelled) throw new Error('cancelled')
        if (step.when && !(await step.when())) continue
        push(s, banner(step.title))
        if (step.run) await step.run()
        if (step.command) {
          const code = await exec(s, step.command, step.cwd)
          if (code !== 0) throw new Error(`exit code ${code}`)
        }
      }
      push(s, `\r\n\x1b[1;32m✔ ${doneMessage}\x1b[0m\r\n`)
      finish(s, 0)
    } catch (e: any) {
      push(s, `\r\n\x1b[1;31m✘ ${e?.message ?? e}\x1b[0m\r\n`)
      finish(s, 1)
    }
  })()
  return info(s)
}

/** Interactive session (e.g. `ddev ssh`, `ddev logs -f`). */
export function openShell(title: string, command: string, cwd?: string): TermSession {
  const s = make(title, 'shell')
  void exec(s, command, cwd).then((code) => finish(s, code))
  return info(s)
}

export function attach(id: string): string {
  return sessions.get(id)?.buffer ?? ''
}

export function write(id: string, data: string): void {
  sessions.get(id)?.pty?.write(data)
}

export function resize(id: string, cols: number, rows: number): void {
  const s = sessions.get(id)
  if (!s) return
  s.cols = cols
  s.rows = rows
  try {
    s.pty?.resize(cols, rows)
  } catch {
    /* the process may have just exited */
  }
}

export function kill(id: string): void {
  const s = sessions.get(id)
  if (!s) return
  s.cancelled = true
  try {
    s.pty?.kill()
  } catch {
    /* already gone */
  }
}

export function killAll(): void {
  for (const id of sessions.keys()) kill(id)
}
