import type { IpcMain } from 'electron'

/** IPC handlers for the deploy tab. Channels start with 'deploy:' (preload allow-list). */
export function register(ipcMain: IpcMain): void {
  void ipcMain
}
