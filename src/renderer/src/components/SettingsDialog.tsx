import { useState } from 'react'
import type { Language, NotifyMode, Settings, Theme } from '@shared/types'
import { useT } from '../i18n'
import { Dialog } from './Dialog'

interface Props {
  settings: Settings
  onSave: (patch: Partial<Settings>) => void
  onClose: () => void
}

export function SettingsDialog({ settings, onSave, onClose }: Props): React.JSX.Element {
  const t = useT()
  const [language, setLanguage] = useState<Language>(settings.language)
  const [theme, setTheme] = useState<Theme>(settings.theme)
  const [projectsDir, setProjectsDir] = useState(settings.projectsDir)
  const [closeToTray, setCloseToTray] = useState(settings.closeToTray)
  const [notifications, setNotifications] = useState<NotifyMode>(settings.notifications)
  const [autoStopMinutes, setAutoStopMinutes] = useState(settings.autoStopMinutes)
  const [checkUpdates, setCheckUpdates] = useState(settings.checkUpdates)
  const autoStopOptions = [0, 30, 60, 120]
  if (!autoStopOptions.includes(autoStopMinutes)) autoStopOptions.push(autoStopMinutes)

  const browse = async (): Promise<void> => {
    const dir = await window.api.shell.pickDirectory()
    if (dir) setProjectsDir(dir)
  }

  return (
    <Dialog
      title={t('settings.title')}
      onClose={onClose}
      onSubmit={() => {
        onSave({ language, theme, projectsDir, closeToTray, notifications, autoStopMinutes, checkUpdates })
        onClose()
      }}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="submit" className="btn primary">
            {t('common.save')}
          </button>
        </>
      }
    >
      <div className="form-grid single">
        <label className="field">
          <span>{t('settings.language')}</span>
          <select value={language} onChange={(e) => setLanguage(e.target.value as Language)}>
            <option value="auto">{t('lang.auto')}</option>
            <option value="en">English</option>
            <option value="es">Español</option>
          </select>
        </label>
        <label className="field">
          <span>{t('settings.theme')}</span>
          <select value={theme} onChange={(e) => setTheme(e.target.value as Theme)}>
            <option value="system">{t('theme.system')}</option>
            <option value="light">{t('theme.light')}</option>
            <option value="dark">{t('theme.dark')}</option>
          </select>
        </label>
        <div className="field">
          <span>{t('settings.projectsDir')}</span>
          <div className="input-row">
            <input value={projectsDir} onChange={(e) => setProjectsDir(e.target.value)} aria-label={t('settings.projectsDir')} />
            <button type="button" className="btn" onClick={() => void browse()}>
              {t('common.browse')}
            </button>
          </div>
        </div>
        <label className="check">
          <input type="checkbox" checked={closeToTray} onChange={(e) => setCloseToTray(e.target.checked)} />
          {t('tray.settings.closeToTray')}
        </label>
        <label className="field">
          <span>{t('tray.settings.notifications')}</span>
          <select value={notifications} onChange={(e) => setNotifications(e.target.value as NotifyMode)}>
            <option value="background">{t('tray.settings.notify.background')}</option>
            <option value="always">{t('tray.settings.notify.always')}</option>
            <option value="never">{t('tray.settings.notify.never')}</option>
          </select>
        </label>
        <label className="field">
          <span>{t('tray.settings.autoStop')}</span>
          <select value={autoStopMinutes} onChange={(e) => setAutoStopMinutes(Number(e.target.value))}>
            {autoStopOptions.map((m) => (
              <option key={m} value={m}>
                {m === 0
                  ? t('tray.settings.autoStop.never')
                  : m === 30 || m === 60 || m === 120
                    ? t(`tray.settings.autoStop.${m}` as 'tray.settings.autoStop.30')
                    : t('tray.settings.autoStop.other', { minutes: m })}
              </option>
            ))}
          </select>
        </label>
        <label className="check">
          <input type="checkbox" checked={checkUpdates} onChange={(e) => setCheckUpdates(e.target.checked)} />
          {t('tray.settings.checkUpdates')}
        </label>
      </div>
    </Dialog>
  )
}
