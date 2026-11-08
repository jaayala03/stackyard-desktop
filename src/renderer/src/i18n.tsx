import { createContext, useContext, useMemo, type ReactNode } from 'react'
import { en, type MessageKey, type Messages } from './locales/en'
import { es } from './locales/es'

export type Lang = 'en' | 'es'
export type T = (key: MessageKey, vars?: Record<string, string | number>) => string

const catalogs: Record<Lang, Messages> = { en, es }

/** Resolves the `auto` setting from the system locale (es-*, es → Spanish; anything else → English). */
export function resolveLang(setting: string, systemLocale: string): Lang {
  if (setting === 'en' || setting === 'es') return setting
  return systemLocale.toLowerCase().startsWith('es') ? 'es' : 'en'
}

export function makeT(lang: Lang): T {
  const messages = catalogs[lang]
  return (key, vars) => {
    let text: string = messages[key] ?? en[key] ?? key
    if (vars) for (const [k, v] of Object.entries(vars)) text = text.split(`{${k}}`).join(String(v))
    return text
  }
}

const I18nContext = createContext<T>(makeT('en'))

export function I18nProvider({ lang, children }: { lang: Lang; children: ReactNode }): React.JSX.Element {
  const t = useMemo(() => makeT(lang), [lang])
  return <I18nContext.Provider value={t}>{children}</I18nContext.Provider>
}

export function useT(): T {
  return useContext(I18nContext)
}
