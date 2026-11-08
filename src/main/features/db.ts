import { execFile } from 'node:child_process'
import { existsSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { BrowserWindow, dialog, type IpcMain } from 'electron'
import { defaultExportName, exportArgs, IMPORT_EXTENSIONS, importArgs, parseDescribe, validDatabaseName, type DbInfo } from './db-parse'

export interface DbResult {
  ok: boolean
  output: string
}

export interface DbOverview {
  running: boolean
  info: DbInfo | null
  hasPhpmyadmin: boolean
  phpmyadminUrl: string
  error?: string
}

const TIMEOUT = 15 * 60 * 1000
const MAX_BUFFER = 50 * 1024 * 1024

function ddev(cwd: string, args: string[], timeout = TIMEOUT): Promise<DbResult> {
  return new Promise((done) => {
    execFile('ddev', args, { cwd, timeout, maxBuffer: MAX_BUFFER, windowsHide: true }, (err, stdout, stderr) => {
      const out = stdout?.toString() ?? ''
      const errText = stderr?.toString() ?? ''
      const output = out + (out && errText ? '\n' : '') + errText
      done({ ok: !err, output: err && !output ? err.message : output })
    })
  })
}

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

const hasPhpmyadmin = (approot: string): boolean => existsSync(join(approot, '.ddev', 'docker-compose.phpmyadmin.yaml'))

async function overview(approot: string): Promise<DbOverview> {
  const pma = hasPhpmyadmin(approot)
  const res = await ddev(approot, ['describe', '-j'], 60_000)
  if (!res.ok) return { running: false, info: null, hasPhpmyadmin: pma, phpmyadminUrl: '', error: res.output.trim() }
  const { info, phpmyadminUrl } = parseDescribe(res.output)
  return { running: info !== null, info, hasPhpmyadmin: pma, phpmyadminUrl: pma ? phpmyadminUrl : '' }
}

function parent(): BrowserWindow | undefined {
  return BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
}

/** IPC handlers for the database tab. Channels start with 'db:' (preload allow-list). */
export function register(ipcMain: IpcMain): void {
  ipcMain.handle('db:overview', (_e, approot: unknown) => {
    assertProject(approot)
    return overview(approot)
  })

  ipcMain.handle('db:pickImport', async (): Promise<string | null> => {
    const win = parent()
    const opts = {
      title: 'Import database',
      properties: ['openFile' as const],
      filters: [
        { name: 'SQL dumps', extensions: IMPORT_EXTENSIONS },
        { name: 'All files', extensions: ['*'] }
      ]
    }
    const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    return res.canceled ? null : res.filePaths[0]
  })

  ipcMain.handle('db:pickExport', async (_e, project: unknown): Promise<string | null> => {
    const win = parent()
    const opts = {
      title: 'Export database',
      defaultPath: defaultExportName(typeof project === 'string' ? project : 'database'),
      filters: [
        { name: 'SQL (gzip)', extensions: ['gz'] },
        { name: 'SQL', extensions: ['sql'] }
      ]
    }
    const res = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts)
    return res.canceled || !res.filePath ? null : res.filePath
  })

  ipcMain.handle('db:import', async (_e, approot: unknown, file: unknown, database: unknown): Promise<DbResult> => {
    assertProject(approot)
    const db = typeof database === 'string' ? database.trim() : ''
    if (typeof file !== 'string' || !existsSync(file) || !statSync(file).isFile()) return { ok: false, output: 'File not found' }
    if (!validDatabaseName(db)) return { ok: false, output: 'Invalid database name' }
    return ddev(approot, importArgs(file, db))
  })

  ipcMain.handle('db:export', async (_e, approot: unknown, file: unknown): Promise<DbResult> => {
    assertProject(approot)
    if (typeof file !== 'string' || !file) return { ok: false, output: 'No file' }
    return ddev(approot, exportArgs(file))
  })

  ipcMain.handle('db:addPhpmyadmin', async (_e, approot: unknown): Promise<DbResult> => {
    assertProject(approot)
    const add = await ddev(approot, ['add-on', 'get', 'ddev/ddev-phpmyadmin'])
    if (!add.ok) return add
    const restart = await ddev(approot, ['restart'])
    return { ok: restart.ok, output: add.output + '\n' + restart.output }
  })
}
