import { app, ipcMain, shell, type BrowserWindow } from 'electron'
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { loadSettings } from './settings'
import { isReleaseUrl, NO_UPDATE, releaseToInfo, RELEASES_API, type UpdateInfo } from './updates-core'

const FIRST_CHECK_MS = 5_000
const CHECK_EVERY_MS = 6 * 3600 * 1000
const TIMEOUT_MS = 10_000

const stateFile = (): string => join(app.getPath('userData'), 'update-state.json')

function readDismissed(): string {
  try {
    const v = JSON.parse(readFileSync(stateFile(), 'utf8')).dismissedVersion
    return typeof v === 'string' ? v : ''
  } catch {
    return ''
  }
}

function writeDismissed(version: string): void {
  try {
    mkdirSync(dirname(stateFile()), { recursive: true })
    const tmp = stateFile() + '.tmp'
    writeFileSync(tmp, JSON.stringify({ dismissedVersion: version }))
    renameSync(tmp, stateFile())
  } catch {
    /* not being able to remember the dismissal is harmless */
  }
}

/** Latest release payload from GitHub, or null on any failure (offline, private repo → 404/403…). */
async function fetchLatest(): Promise<unknown | null> {
  try {
    const res = await fetch(RELEASES_API, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': `Stackyard/${app.getVersion()}` },
      signal: AbortSignal.timeout(TIMEOUT_MS)
    })
    if (!res.ok) return null
    return await res.json()
  } catch {
    return null
  }
}

let payload: unknown | null = null
let fetchedAt = 0
let inflight: Promise<void> | null = null

/** Refreshes the cached release if it is older than the check interval (or `force`). */
function refresh(force = false): Promise<void> {
  if (!loadSettings().checkUpdates) return Promise.resolve()
  if (!force && fetchedAt && Date.now() - fetchedAt < CHECK_EVERY_MS) return Promise.resolve()
  inflight ??= fetchLatest()
    .then((data) => {
      fetchedAt = Date.now()
      payload = data
    })
    .finally(() => {
      inflight = null
    })
  return inflight
}

async function check(): Promise<UpdateInfo> {
  if (!loadSettings().checkUpdates) return NO_UPDATE
  await refresh()
  return releaseToInfo(payload, app.getVersion(), readDismissed())
}

/** Update checks. Called once after the window exists; IPC channels start with 'update:'. */
export function setupUpdates(getWindow: () => BrowserWindow | null): void {
  void getWindow // the renderer pulls with update:check; nothing is pushed
  ipcMain.handle('update:check', () => check())
  ipcMain.handle('update:openRelease', async (_e, url: unknown) => {
    if (isReleaseUrl(url)) await shell.openExternal(url)
  })
  ipcMain.handle('update:dismiss', (_e, version: unknown) => {
    if (typeof version === 'string') writeDismissed(version)
  })

  setTimeout(() => void refresh(), FIRST_CHECK_MS).unref()
  setInterval(() => void refresh(true), CHECK_EVERY_MS).unref()
}
