import type { IpcMain } from 'electron'

/** IPC handlers for the db tab. Channels start with 'db:' (preload allow-list). */
export function register(ipcMain: IpcMain): void {
  void ipcMain
}
