import type { IpcMain } from 'electron'

/** IPC handlers for the git tab. Channels must start with 'git:' (see preload allow-list). */
export function register(ipcMain: IpcMain): void {
  void ipcMain
}
