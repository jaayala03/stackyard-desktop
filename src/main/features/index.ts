import type { BrowserWindow, IpcMain } from 'electron'
import * as code from './code'
import * as env from './env'
import * as git from './git'

export interface FeatureContext {
  ipcMain: IpcMain
  getWindow: () => BrowserWindow | null
}

export function registerFeatures({ ipcMain }: FeatureContext): void {
  git.register(ipcMain)
  code.register(ipcMain)
  env.register(ipcMain)
}
