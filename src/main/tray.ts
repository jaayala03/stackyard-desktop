import type { BrowserWindow } from 'electron'

export interface TrayContext {
  getWindow: () => BrowserWindow | null
  showWindow: () => void
}

/** Creates the tray icon/menu and background notifications. Called once after the window exists. */
export function setupTray(ctx: TrayContext): void {
  void ctx
}
