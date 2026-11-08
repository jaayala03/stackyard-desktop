import { app } from 'electron'
import { trayEn, trayEs } from '../renderer/src/locales/tray'
import { loadSettings } from './settings'

export type TrayKey = keyof typeof trayEn

export function trayLang(): 'en' | 'es' {
  const setting = loadSettings().language
  if (setting === 'en' || setting === 'es') return setting
  return app.getLocale().toLowerCase().startsWith('es') ? 'es' : 'en'
}

/** Translates a tray/notification message in the language chosen in Settings. */
export function tt(key: TrayKey, vars?: Record<string, string | number>): string {
  let text: string = (trayLang() === 'es' ? trayEs : trayEn)[key] ?? trayEn[key]
  if (vars) for (const [k, v] of Object.entries(vars)) text = text.split(`{${k}}`).join(String(v))
  return text
}
