import { execFile } from 'node:child_process'
import type { IpcMain } from 'electron'
import { createFromExample, listing, readEnv, writeEnv } from './env-files'

/** IPC handlers for the .env tab. Channels start with 'env:' (see the preload allow-list). */
export function register(ipcMain: IpcMain): void {
  ipcMain.handle('env:list', (_e, approot: string) => listing(approot))
  ipcMain.handle('env:read', (_e, approot: string, rel: string) => readEnv(approot, rel))
  ipcMain.handle('env:write', (_e, approot: string, rel: string, text: string) => writeEnv(approot, rel, text))
  ipcMain.handle('env:create', (_e, approot: string, example: string, target: string) => createFromExample(approot, example, target))
  ipcMain.handle(
    'env:clearCache',
    (_e, approot: string) =>
      new Promise<boolean>((resolve) => {
        execFile('ddev', ['artisan', 'config:clear'], { cwd: approot, timeout: 60_000, windowsHide: true }, (err) => resolve(!err))
      })
  )
}
