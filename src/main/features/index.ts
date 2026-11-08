import type { BrowserWindow, IpcMain } from 'electron'
import * as code from './code'
import * as env from './env'
import * as git from './git'
import * as snap from './snap'
import * as db from './db'
import * as node from './node'
import * as deploy from './deploy'
import * as share from './share'

export interface FeatureContext {
  ipcMain: IpcMain
  getWindow: () => BrowserWindow | null
}

export function registerFeatures({ ipcMain }: FeatureContext): void {
  git.register(ipcMain)
  code.register(ipcMain)
  env.register(ipcMain)
  snap.register(ipcMain)
  db.register(ipcMain)
  node.register(ipcMain)
  deploy.register(ipcMain)
  share.register(ipcMain)
}
