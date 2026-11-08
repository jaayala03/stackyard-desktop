import { execFile } from 'node:child_process'
import { statSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import type { IpcMain } from 'electron'
import { NAME_RE } from '../../shared/catalog'
import type { NodeResult, NodeStatus } from '../../shared/node'
import { projectTld } from '../ddev'
import { applyPlan } from './node-apply'
import { ddevConfigArgs, svcUrl } from './node-gen'
import { analyze, exists, isNodeProject, loadOverrides, saveOverrides } from './node-plan'
import { configureVite, viteStatus } from './node-vite'

const TIMEOUT = 15 * 60 * 1000
const MAX_BUFFER = 50 * 1024 * 1024

function ddev(cwd: string, args: string[]): Promise<NodeResult> {
  return new Promise((done) => {
    execFile('ddev', args, { cwd, timeout: TIMEOUT, maxBuffer: MAX_BUFFER, windowsHide: true }, (err, stdout, stderr) => {
      const out = stdout?.toString() ?? ''
      const errText = stderr?.toString() ?? ''
      const output = out + (out && errText ? '\n' : '') + errText
      done({ ok: !err, output: err && !output ? err.message : output })
    })
  })
}

function assertProject(approot: unknown): asserts approot is string {
  let ok = false
  try {
    ok = typeof approot === 'string' && isAbsolute(approot) && statSync(join(approot, '.ddev')).isDirectory()
  } catch {
    ok = false
  }
  if (!ok) throw new Error('Not a DDEV project')
}

const asScheme = (v: unknown): 'https' | 'http' => (v === 'http' ? 'http' : 'https')

function asName(v: unknown): string {
  if (typeof v !== 'string' || !NAME_RE.test(v)) throw new Error('Invalid project name')
  return v
}

const asNodeVersion = (v: unknown): string => (typeof v === 'string' && /^\d{1,2}$/.test(v) ? v : '24')

async function status(approot: string, name: string, scheme: 'https' | 'http'): Promise<NodeStatus> {
  const overrides = await loadOverrides(approot)
  const plan = await analyze(approot, scheme, overrides)
  const tld = await projectTld()
  const urls: Record<string, string> = {}
  if (plan) for (const s of plan.services) urls[s.name] = svcUrl(name, tld, s, scheme)
  return {
    isNode: plan !== null || (await isNodeProject(approot)),
    configured: await exists(join(approot, '.ddev', 'config.stackyard.yaml')),
    plan,
    urls,
    tld,
    overrides,
    vite: await viteStatus(approot)
  }
}

/** IPC handlers for the Node tab. Channels start with 'node:' (preload allow-list). */
export function register(ipcMain: IpcMain): void {
  ipcMain.handle('node:status', (_e, approot: unknown, name: unknown, scheme: unknown) => {
    assertProject(approot)
    return status(approot, asName(name), asScheme(scheme))
  })

  // Saves the user's edits, regenerates the DDEV files and restarts the project.
  ipcMain.handle('node:apply', async (_e, approot: unknown, name: unknown, scheme: unknown, node: unknown, overrides: unknown): Promise<NodeResult> => {
    assertProject(approot)
    const projectName = asName(name)
    const sch = asScheme(scheme)
    const saved = await saveOverrides(approot, overrides ?? (await loadOverrides(approot)))
    const plan = await analyze(approot, sch, saved)
    if (!plan) return { ok: false, output: 'Not a Node project.' }
    const config = await ddev(approot, ['config', ...ddevConfigArgs(plan, asNodeVersion(node))])
    if (!config.ok) return config
    const report = await applyPlan(plan, projectName, await projectTld())
    const restart = await ddev(approot, ['restart'])
    return { ok: restart.ok, output: [config.output.trim(), report.join('\n'), restart.output.trim()].filter(Boolean).join('\n\n') }
  })

  // Installs (or force-reinstalls) the dependencies of every service inside the container.
  ipcMain.handle('node:install', (_e, approot: unknown): Promise<NodeResult> => {
    assertProject(approot)
    return ddev(approot, ['exec', 'bash', '/var/www/html/.ddev/stackyard-node-prepare.sh', '--force'])
  })

  ipcMain.handle('node:vite', async (_e, approot: unknown): Promise<NodeResult> => {
    assertProject(approot)
    let result
    try {
      result = await configureVite(approot)
    } catch (e) {
      return { ok: false, output: String((e as Error).message ?? e) }
    }
    const restart = await ddev(approot, ['restart'])
    return { ok: restart.ok, output: restart.output.trim(), snippet: result.snippet ?? undefined }
  })
}
