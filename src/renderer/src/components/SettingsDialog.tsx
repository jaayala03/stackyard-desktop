import { useState } from 'react'
import type { Language, Settings, Theme } from '@shared/types'
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

  const browse = async (): Promise<void> => {
    const dir = await window.api.shell.pickDirectory()
    if (dir) setProjectsDir(dir)
  }

  return (
    <Dialog
      title={t('settings.title')}
      onClose={onClose}
      onSubmit={() => {
        onSave({ language, theme, projectsDir })
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
      </div>
    </Dialog>
  )
}
