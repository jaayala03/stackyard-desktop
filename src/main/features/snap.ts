import type { IpcMain } from 'electron'

/** IPC handlers for the snap tab. Channels start with 'snap:' (preload allow-list). */
export function register(ipcMain: IpcMain): void {
  void ipcMain
}
