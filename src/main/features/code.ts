import type { IpcMain } from 'electron'

/** IPC handlers for the code tab. Channels must start with 'code:' (see preload allow-list). */
export function register(ipcMain: IpcMain): void {
  void ipcMain
}
