import { execFile } from 'node:child_process'
import { readdir, readFile, stat } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import { promisify } from 'node:util'
import type { IpcMain } from 'electron'
import { parse as parseYaml } from 'yaml'
import type { TermSession } from '../../shared/types'
import { openShell } from '../terminals'
import {
  DEPLOY_ACTIONS,
  ddevImage,
  evalDockerArgs,
  findEcosystem,
  lastLine,
  parseSshAdd,
  planAction,
  stripJson5,
  summarize,
  type DeployAction,
  type DeploySummary
} from './deploy-parse'

const run = promisify(execFile)
const win = process.platform === 'win32'
const cache = new Map<string, { mtime: number; data: unknown }>()

/** Only real DDEV project folders are accepted as working directory. */
async function checkRoot(approot: unknown): Promise<string> {
  if (typeof approot !== 'string' || !approot || approot.includes('\0') || !isAbsolute(approot)) throw new Error('Invalid project folder')
  try {
    if (!(await stat(join(approot, '.ddev'))).isDirectory()) throw new Error()
  } catch {
    throw new Error('Not a DDEV project folder')
  }
  return approot
}

async function evalScript(root: string, file: string): Promise<unknown> {
  let image = ddevImage('')
  try {
    image = ddevImage((await run('ddev', ['--version'], { timeout: 10_000, windowsHide: true })).stdout)
  } catch {
    /* keep `latest` */
  }
  try {
    const { stdout } = await run('docker', evalDockerArgs(root, file, image, win), {
      timeout: 120_000,
      maxBuffer: 10 * 1024 * 1024,
      windowsHide: true
    })
    return JSON.parse(stdout)
  } catch (e: any) {
    throw new Error(lastLine(String(e?.stderr || e?.stdout || e?.message || '')))
  }
}

/** The evaluated ecosystem (cached by modification time). JS/CJS/MJS/TS run in the DDEV image, JSON/YAML are parsed here. */
async function load(root: string, file: string): Promise<unknown> {
  const path = join(root, file)
  const mtime = (await stat(path)).mtimeMs
  const hit = cache.get(path)
  if (hit && hit.mtime === mtime) return hit.data
  let data: unknown
  if (file.endsWith('.json') || file.endsWith('.json5')) {
    const text = await readFile(path, 'utf8')
    data = JSON.parse(file.endsWith('.json5') ? stripJson5(text) : text)
  } else if (file.endsWith('.yaml') || file.endsWith('.yml')) {
    data = parseYaml(await readFile(path, 'utf8'))
  } else {
    data = await evalScript(root, file)
  }
  cache.set(path, { mtime, data })
  return data
}

/** Summary of the project's ecosystem file, `null` when it has none; read errors come back in `error`. */
export async function readSummary(approot: string): Promise<DeploySummary | null> {
  const root = await checkRoot(approot)
  const file = findEcosystem(await readdir(root))
  if (!file) return null
  try {
    return summarize(file, await load(root, file))
  } catch (e: any) {
    return { file, apps: [], deploy: {}, error: String(e?.message ?? e) }
  }
}

async function sshKeys(approot: string): Promise<number | null> {
  const root = await checkRoot(approot)
  try {
    const { stdout, stderr } = await run('ddev', ['exec', 'ssh-add', '-l'], { cwd: root, timeout: 30_000, windowsHide: true })
    return parseSshAdd(stdout, stderr, true)
  } catch (e: any) {
    return parseSshAdd(String(e?.stdout ?? ''), String(e?.stderr ?? ''), false)
  }
}

export function register(ipcMain: IpcMain): void {
  ipcMain.handle('deploy:summary', (_e, approot: string) => readSummary(approot))
  ipcMain.handle('deploy:ssh-keys', (_e, approot: string) => sshKeys(approot))
  // The command is rebuilt here from the project's own ecosystem file: the renderer only names the action and environment.
  ipcMain.handle('deploy:run', async (_e, approot: string, action: DeployAction, env: string | null): Promise<TermSession> => {
    const root = await checkRoot(approot)
    if (!DEPLOY_ACTIONS.includes(action)) throw new Error('Unknown action')
    const summary = (await readSummary(root)) ?? { file: '', apps: [], deploy: {} }
    if (action !== 'auth' && summary.error) throw new Error(summary.error)
    const plan = planAction(action, summary, env, win)
    return openShell(plan.title, plan.command, root)
  })
}
