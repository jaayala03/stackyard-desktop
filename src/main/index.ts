import { spawn } from 'node:child_process'
import { app, BrowserWindow, dialog, ipcMain, nativeTheme, shell } from 'electron'
import { join } from 'node:path'
import type { CreateOptions, ProjectAction } from '../shared/types'
import * as ddev from './ddev'
import { loadSettings, saveSettings } from './settings'
import { actionSteps, createSteps, q } from './steps'
import * as terms from './terminals'
import { registerFeatures } from './features'
import iconPath from './assets/icon.png?asset'
import { hasTray, onJobExit, setupTray, trackJob } from './tray'
import { setupUpdates } from './updates'

let win: BrowserWindow | null = null
/** Set once the app is really quitting, so closing the window stops hiding it to the tray. */
let quitting = false
const startHidden = process.argv.includes('--hidden')
let shownOnce = false

function createWindow(): void {
  win = new BrowserWindow({
    width: 1200,
    height: 780,
    minWidth: 820,
    minHeight: 560,
    title: 'Stackyard',
    icon: iconPath,
    show: !(startHidden && !shownOnce),
    webPreferences: { preload: join(__dirname, '../preload/index.js'), sandbox: false, contextIsolation: true }
  })
  win.setMenuBarVisibility(false)
  shownOnce = true
  win.on('close', (e) => {
    // Keep running in the tray instead of quitting (only when there is a tray to come back from).
    if (!quitting && hasTray() && loadSettings().closeToTray) {
      e.preventDefault()
      win?.hide()
    }
  })
  win.on('closed', () => {
    win = null
  })
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })
  if (process.env.ELECTRON_RENDERER_URL) void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else void win.loadFile(join(__dirname, '../renderer/index.html'))
}

/** Shows and focuses the main window (recreating it if it was closed). */
function showWindow(): void {
  if (!win || win.isDestroyed()) createWindow()
  win?.show()
  if (win?.isMinimized()) win.restore()
  win?.focus()
}

function applyTheme(): void {
  nativeTheme.themeSource = loadSettings().theme
}

function registerIpc(): void {
  terms.setEmitter((channel, id, payload) => {
    win?.webContents.send(`term:${channel}`, id, payload)
    if (channel === 'exit') onJobExit(id, Number(payload))
  })

  registerFeatures({ ipcMain, getWindow: () => win })

  ipcMain.handle('settings:get', () => loadSettings())
  ipcMain.handle('settings:set', (_e, patch) => {
    const next = saveSettings(patch)
    applyTheme()
    return next
  })

  ipcMain.handle('system:tools', () => ddev.tools())
  ipcMain.handle('system:locale', () => app.getLocale())
  ipcMain.handle('system:version', () => app.getVersion())
  ipcMain.handle('system:openDoc', async (_e, kind: 'license' | 'terms') => {
    const lang = loadSettings().language
    const spanish = lang === 'es' || (lang === 'auto' && app.getLocale().toLowerCase().startsWith('es'))
    const file = kind === 'license' ? 'LICENSE' : spanish ? 'TERMINOS.md' : 'TERMS.md'
    const dir = app.isPackaged ? join(process.resourcesPath, 'docs') : app.getAppPath()
    await shell.openPath(join(dir, file))
  })

  ipcMain.handle('projects:list', () => ddev.listProjects())
  ipcMain.handle('projects:action', (_e, name: string, approot: string, action: ProjectAction) =>
    trackJob(terms.runJob(`${action} ${name}`, actionSteps(approot, action), 'Done'), action, name)
  )
  ipcMain.handle('projects:create', async (_e, o: CreateOptions) => {
    const done = `Project ready: ${o.scheme}://${o.name}.${await ddev.projectTld()}`
    return trackJob(terms.runJob(`create ${o.name}`, createSteps(o), done), 'create', o.name)
  })
  ipcMain.handle('projects:detect', (_e, path: string) => ddev.detectType(path))
  ipcMain.handle('projects:ssh', (_e, approot: string, name: string) => terms.openShell(`ssh ${name}`, 'ddev ssh', approot))
  ipcMain.handle('projects:logs', (_e, approot: string, name: string) => terms.openShell(`logs ${name}`, 'ddev logs -f', approot))

  ipcMain.handle('shell:openUrl', (_e, url: string) => {
    if (/^https?:\/\//.test(url)) return shell.openExternal(url)
  })
  ipcMain.handle('shell:openPath', (_e, path: string) => shell.openPath(path).then(() => undefined))
  ipcMain.handle('shell:openEditor', (_e, path: string) => openEditor(path))
  ipcMain.handle('shell:pickDirectory', async () => {
    const res = await dialog.showOpenDialog(win!, { properties: ['openDirectory', 'createDirectory'] })
    return res.canceled ? null : res.filePaths[0]
  })

  ipcMain.handle('term:attach', (_e, id: string) => terms.attach(id))
  ipcMain.on('term:write', (_e, id: string, data: string) => terms.write(id, data))
  ipcMain.on('term:resize', (_e, id: string, cols: number, rows: number) => terms.resize(id, cols, rows))
  ipcMain.on('term:kill', (_e, id: string) => terms.kill(id))
}

/** Opens a folder in the first code editor found on the PATH. */
function openEditor(path: string): Promise<boolean> {
  const candidates = ['code', 'codium', 'phpstorm', 'subl', 'zed']
  return new Promise((resolve) => {
    const [file, args] = terms.shellArgv(
      process.platform === 'win32'
        ? `foreach ($e in ${candidates.map((c) => q(c)).join(',')}) { if (Get-Command $e -ErrorAction SilentlyContinue) { & $e ${q(path)}; exit 0 } }; exit 1`
        : `for e in ${candidates.join(' ')}; do command -v $e >/dev/null && exec $e ${q(path)}; done; exit 1`
    )
    const child = spawn(file, args, { stdio: 'ignore', windowsHide: true })
    child.on('exit', (code) => resolve(code === 0))
    child.on('error', () => resolve(false))
  })
}

const locked = app.requestSingleInstanceLock()
if (!locked) {
  app.quit()
} else {
  app.on('second-instance', () => showWindow())
  void app.whenReady().then(() => {
    app.setAppUserModelId('com.jaayala03.stackyard')
    applyTheme()
    registerIpc()
    createWindow()
    setupTray({ getWindow: () => win, showWindow })
    if (startHidden && !hasTray()) showWindow() // started hidden but there is no tray to reach the app
    setupUpdates(() => win)
    app.on('activate', () => showWindow())
  })
  app.on('before-quit', () => {
    quitting = true
    terms.killAll()
  })
  // With a tray the app keeps running without windows; otherwise closing the window quits.
  app.on('window-all-closed', () => {
    if (quitting || !hasTray()) app.quit()
  })
}
