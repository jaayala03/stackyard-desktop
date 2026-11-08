import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { app, Menu, nativeImage, Notification, shell, Tray, type BrowserWindow, type MenuItemConstructorOptions } from 'electron'
import type { Project, TermSession } from '../shared/types'
import iconPath from './assets/icon.png?asset'
import * as ddev from './ddev'
import { loadSettings } from './settings'
import { actionSteps } from './steps'
import * as terms from './terminals'
import { IdleTracker, parseOwners, parseStats, projectMark, shouldNotify, type JobKind, type Usage } from './tray-logic'
import { tt } from './tray-i18n'

const run = promisify(execFile)

export interface TrayContext {
  getWindow: () => BrowserWindow | null
  showWindow: () => void
}

const PROJECTS_EVERY_MS = 10_000
const STATS_EVERY_MS = 30_000

let tray: Tray | null = null
let ctx: TrayContext
let projects: Project[] = []
let signature = ''
const busy = new Set<string>()
const jobs = new Map<string, { kind: JobKind; project: string }>()
const idle = new IdleTracker()

/** True when the tray icon exists, so closing the window can keep the app running. */
export function hasTray(): boolean {
  return tray !== null && !tray.isDestroyed()
}

function windowFocused(): boolean {
  const win = ctx?.getWindow()
  return !!win && !win.isDestroyed() && win.isVisible() && win.isFocused()
}

/** Desktop notification, respecting the "notifications" setting. */
export function notify(title: string, body: string, ok = true): void {
  if (!shouldNotify(loadSettings().notifications, windowFocused()) || !Notification.isSupported()) return
  const n = new Notification({ title: (ok ? '✔ ' : '✘ ') + title, body, urgency: ok ? 'normal' : 'critical' })
  n.on('click', () => ctx.showWindow())
  n.show()
}

/** Registers a start/stop/… job so the tray shows it as busy and notifies when it ends. */
export function trackJob(session: TermSession, kind: JobKind, project = ''): TermSession {
  jobs.set(session.id, { kind, project })
  if (project) busy.add(project)
  rebuildMenu()
  return session
}

/** Called for every terminal session that exits. */
export function onJobExit(id: string, code: number): void {
  const job = jobs.get(id)
  if (!job) return
  jobs.delete(id)
  if (job.project) {
    busy.delete(job.project)
    idle.reset(job.project, Date.now())
  }
  notify(tt(`tray.notify.job.${job.kind}`, { name: job.project }), tt(code === 0 ? 'tray.notify.ok' : 'tray.notify.fail'), code === 0)
  void refreshProjects()
}

function startJob(kind: JobKind, project: Project): void {
  const steps = actionSteps(project.approot, kind as 'start' | 'stop' | 'restart')
  trackJob(terms.runJob(`${kind} ${project.name}`, steps, 'Done'), kind, project.name)
}

function stopAll(): void {
  trackJob(terms.runJob('poweroff', [{ title: 'ddev poweroff', command: 'ddev poweroff' }], 'Done'), 'poweroff')
}

function projectMenu(p: Project): MenuItemConstructorOptions {
  const running = p.status === 'running'
  const isBusy = busy.has(p.name)
  const submenu: MenuItemConstructorOptions[] = [
    { label: tt('tray.menu.openBrowser'), enabled: running && !!p.primaryUrl, click: () => void shell.openExternal(p.primaryUrl) }
  ]
  if (running) {
    submenu.push(
      { label: tt('tray.menu.stop'), enabled: !isBusy, click: () => startJob('stop', p) },
      { label: tt('tray.menu.restart'), enabled: !isBusy, click: () => startJob('restart', p) }
    )
  } else {
    submenu.push({ label: tt('tray.menu.start'), enabled: !isBusy, click: () => startJob('start', p) })
  }
  submenu.push({ label: tt('tray.menu.openFolder'), click: () => void shell.openPath(p.approot) })
  return { label: `${projectMark(p.status, isBusy)}  ${p.name}`, submenu }
}

function buildMenu(): Menu {
  const items: MenuItemConstructorOptions[] = [{ label: tt('tray.menu.open'), click: () => ctx.showWindow() }, { type: 'separator' }]
  if (projects.length === 0) items.push({ label: tt('tray.menu.noProjects'), enabled: false })
  else items.push(...projects.map(projectMenu))
  items.push(
    { type: 'separator' },
    { label: tt('tray.menu.stopAll'), enabled: projects.some((p) => p.status === 'running'), click: stopAll }
  )
  // Login items are only supported on Windows and macOS.
  if (process.platform === 'win32' || process.platform === 'darwin') {
    items.push({
      label: tt('tray.menu.openAtLogin'),
      type: 'checkbox',
      checked: app.getLoginItemSettings().openAtLogin,
      click: (item) => app.setLoginItemSettings({ openAtLogin: item.checked, args: ['--hidden'] })
    })
  }
  items.push({ type: 'separator' }, { label: tt('tray.menu.quit'), click: () => app.quit() })
  return Menu.buildFromTemplate(items)
}

function rebuildMenu(): void {
  if (hasTray()) tray!.setContextMenu(buildMenu())
}

async function refreshProjects(): Promise<void> {
  try {
    projects = await ddev.listProjects()
  } catch {
    projects = [] // ddev missing or failing: keep the tray usable
  }
  const next = JSON.stringify([projects.map((p) => [p.name, p.status, p.primaryUrl]), [...busy].sort(), loadSettings().language])
  if (next !== signature) {
    signature = next
    rebuildMenu()
  }
}

async function sampleStats(): Promise<Record<string, Usage>> {
  const format = async (args: string[]): Promise<string> => {
    try {
      return (await run('docker', args, { timeout: 30_000, windowsHide: true })).stdout
    } catch {
      return ''
    }
  }
  const owners = parseOwners(
    await format(['ps', '--format', '{{.Names}}|{{.Label "com.ddev.site-name"}}|{{.Label "com.docker.compose.service"}}'])
  )
  if (owners.size === 0) return {}
  return parseStats(await format(['stats', '--no-stream', '--format', '{{json .}}']), owners)
}

async function checkIdle(): Promise<void> {
  const minutes = loadSettings().autoStopMinutes
  if (!(minutes > 0)) return
  const running = projects.filter((p) => p.status === 'running' && !busy.has(p.name))
  idle.update(await sampleStats(), running.map((p) => p.name), Date.now())
  for (const name of idle.idleProjects(minutes, Date.now())) {
    const p = running.find((x) => x.name === name)
    if (!p || busy.has(name)) continue
    idle.reset(name, Date.now())
    startJob('stop', p)
    notify(tt('tray.notify.idleStopped', { name, minutes }), tt('tray.notify.ok'))
  }
}

/** Creates the tray icon/menu and background notifications. Called once after the window exists. */
export function setupTray(context: TrayContext): void {
  ctx = context
  const size = process.platform === 'win32' ? 16 : process.platform === 'darwin' ? 18 : 22
  const image = nativeImage.createFromPath(iconPath).resize({ width: size, height: size })
  if (image.isEmpty()) return
  try {
    tray = new Tray(image)
  } catch {
    tray = null // no tray support on this desktop
    return
  }
  tray.setToolTip('Stackyard')
  tray.on('click', () => {
    const win = ctx.getWindow()
    if (win && !win.isDestroyed() && win.isVisible() && win.isFocused()) win.hide()
    else ctx.showWindow()
  })
  rebuildMenu()
  void refreshProjects()
  setInterval(() => void refreshProjects(), PROJECTS_EVERY_MS).unref()
  setInterval(() => void checkIdle().catch(() => undefined), STATS_EVERY_MS).unref()
}
