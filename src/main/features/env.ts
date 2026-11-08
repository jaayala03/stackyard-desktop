import type { IpcMain } from 'electron'

/** IPC handlers for the env tab. Channels must start with 'env:' (see preload allow-list). */
export function register(ipcMain: IpcMain): void {
  void ipcMain
}
