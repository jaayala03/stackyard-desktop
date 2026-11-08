import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import type { Settings } from '../shared/types'

const file = (): string => join(app.getPath('userData'), 'settings.json')

/** Windows: D:\laragon\www when it exists (where the user's projects live); otherwise ~/projects. */
function defaultProjectsDir(): string {
  if (process.platform === 'win32' && existsSync('D:\\laragon\\www')) return 'D:\\laragon\\www'
  return join(homedir(), 'projects')
}

const defaults = (): Settings => ({ language: 'auto', theme: 'system', projectsDir: defaultProjectsDir() })

export function loadSettings(): Settings {
  try {
    return { ...defaults(), ...JSON.parse(readFileSync(file(), 'utf8')) }
  } catch {
    return defaults()
  }
}

export function saveSettings(patch: Partial<Settings>): Settings {
  const next = { ...loadSettings(), ...patch }
  mkdirSync(dirname(file()), { recursive: true })
  const tmp = file() + '.tmp'
  writeFileSync(tmp, JSON.stringify(next, null, 2))
  renameSync(tmp, file())
  return next
}
