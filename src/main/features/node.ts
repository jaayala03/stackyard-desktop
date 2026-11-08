import type { IpcMain } from 'electron'

/** IPC handlers for the node tab. Channels start with 'node:' (preload allow-list). */
export function register(ipcMain: IpcMain): void {
  void ipcMain
}
