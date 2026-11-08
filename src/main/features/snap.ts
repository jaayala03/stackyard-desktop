import { execFile } from 'node:child_process'
import { stat } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import type { IpcMain } from 'electron'
import { isValidSnapshotName, parseSnapshotList, type Snapshot } from './snap-parse'

export interface SnapResult {
  ok: boolean
  output: string
}

const TIMEOUT = 10 * 60_000
const MAX_BUFFER = 20 * 1024 * 1024

function ddev(cwd: string, args: string[]): Promise<SnapResult> {
  return new Promise((done) => {
    execFile('ddev', args, { cwd, timeout: TIMEOUT, maxBuffer: MAX_BUFFER, windowsHide: true }, (err, stdout, stderr) => {
      const out = stdout?.toString() ?? ''
      const errText = stderr?.toString() ?? ''
      const output = out + (out && errText ? '\n' : '') + errText
      done({ ok: !err, output: err && !output ? err.message : output })
    })
  })
}

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

function checkName(name: unknown): string {
  if (!isValidSnapshotName(name)) throw new Error('Invalid snapshot name')
  return name
}

export function register(ipcMain: IpcMain): void {
  ipcMain.handle('snap:list', async (_e, approot: string, project: string): Promise<Snapshot[]> => {
    const root = await checkRoot(approot)
    const res = await ddev(root, ['snapshot', '--list', '-j'])
    if (!res.ok) throw new Error(res.output.trim() || 'ddev failed')
    return parseSnapshotList(res.output, String(project))
  })
  ipcMain.handle('snap:create', async (_e, approot: string, name: string) =>
    ddev(await checkRoot(approot), ['snapshot', '--name', checkName(name)])
  )
  ipcMain.handle('snap:restore', async (_e, approot: string, name: string) =>
    ddev(await checkRoot(approot), ['snapshot', 'restore', checkName(name)])
  )
  ipcMain.handle('snap:delete', async (_e, approot: string, name: string) =>
    ddev(await checkRoot(approot), ['snapshot', '--cleanup', '--name', checkName(name), '-y'])
  )
  ipcMain.handle('snap:cleanup', async (_e, approot: string) => ddev(await checkRoot(approot), ['snapshot', '--cleanup', '-y']))
}
