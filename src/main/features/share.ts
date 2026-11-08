import type { IpcMain } from 'electron'

/** IPC handlers for the share tab. Channels start with 'share:' (preload allow-list). */
export function register(ipcMain: IpcMain): void {
  void ipcMain
}
