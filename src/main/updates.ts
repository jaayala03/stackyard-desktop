import type { BrowserWindow } from 'electron'

/** Update checks. Called once after the window exists; IPC channels start with 'update:'. */
export function setupUpdates(getWindow: () => BrowserWindow | null): void {
  void getWindow
}
