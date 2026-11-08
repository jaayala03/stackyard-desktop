import { useEffect, useState } from 'react'
import { useT } from '../i18n'
import './update.css'

interface UpdateInfo {
  available: boolean
  version: string
  url: string
  notes: string
}

const POLL_MS = 30 * 60 * 1000

export function UpdateBanner(): React.JSX.Element | null {
  const t = useT()
  const [info, setInfo] = useState<UpdateInfo | null>(null)

  useEffect(() => {
    let alive = true
    const check = (): void => {
      window.api
        .invoke<UpdateInfo>('update:check')
        .then((r) => alive && setInfo(r?.available ? r : null))
        .catch(() => alive && setInfo(null))
    }
    check()
    const timer = setInterval(check, POLL_MS)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [])

  if (!info) return null

  return (
    <div className="banner update-banner" role="status">
      <span>{t('update.available', { version: info.version })}</span>
      <span className="update-actions">
        <button type="button" className="btn small primary" onClick={() => void window.api.invoke('update:openRelease', info.url)}>
          {t('update.download')}
        </button>
        <button
          type="button"
          className="btn small ghost"
          onClick={() => {
            void window.api.invoke('update:dismiss', info.version)
            setInfo(null)
          }}
        >
          {t('update.dismiss')}
        </button>
      </span>
    </div>
  )
}
