import { useCallback, useEffect, useRef, useState } from 'react'
import type { Project } from '@shared/types'
import {
  installHint,
  NGROK_DOCS_URL,
  pickProvider,
  validToken,
  type ShareProvider,
  type ShareProviders,
  type ShareStatus
} from '../../../main/features/share-parse'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { useT } from '../i18n'
import './share.css'

const invoke = <T,>(channel: string, ...args: unknown[]): Promise<T> => window.api.invoke<T>(channel, ...args)
const cleanError = (e: unknown): string => String((e as Error)?.message ?? e).replace(/^Error invoking remote method '[^']*': (Error: )?/, '')

const EMPTY: ShareStatus = { running: false, provider: null, url: null, log: [], exitCode: null }

export function ShareTab({ project }: { project: Project }): React.JSX.Element {
  const t = useT()
  const root = project.approot
  const running = project.status === 'running'
  const [providers, setProviders] = useState<ShareProviders | null>(null)
  const [provider, setProvider] = useState<ShareProvider>('cloudflared')
  const [status, setStatus] = useState<ShareStatus>(EMPTY)
  const [confirm, setConfirm] = useState(false)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState('')
  const [token, setToken] = useState('')
  const [tokenMsg, setTokenMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const logRef = useRef<HTMLPreElement>(null)

  useEffect(() => {
    let alive = true
    void invoke<ShareProviders>('share:providers').then((p) => {
      if (!alive) return
      setProviders(p)
      const best = pickProvider(p)
      if (best) setProvider(best)
    })
    return () => {
      alive = false
    }
  }, [])

  // The preload only exposes invoke(), so the tab polls the main process while it is open.
  useEffect(() => {
    let alive = true
    const poll = (): void => {
      invoke<ShareStatus>('share:status', root)
        .then((s) => alive && setStatus(s))
        .catch(() => undefined)
    }
    poll()
    const timer = window.setInterval(poll, 1000)
    return () => {
      alive = false
      window.clearInterval(timer)
    }
  }, [root])

  useEffect(() => {
    const el = logRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [status.log.length])

  const act = useCallback(async (channel: string, ...args: unknown[]): Promise<void> => {
    setError('')
    try {
      setStatus(await invoke<ShareStatus>(channel, ...args))
    } catch (e) {
      setError(cleanError(e))
    }
  }, [])

  const copy = async (key: string, text: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(key)
      window.setTimeout(() => setCopied((c) => (c === key ? '' : c)), 2000)
    } catch {
      /* clipboard unavailable */
    }
  }

  const saveToken = async (): Promise<void> => {
    setTokenMsg(null)
    if (!validToken(token.trim())) return setTokenMsg({ ok: false, text: t('share.ngrok.invalid') })
    try {
      const res = await invoke<{ ok: boolean }>('share:saveToken', token.trim())
      setTokenMsg({ ok: res.ok, text: res.ok ? t('share.ngrok.saved') : t('share.ngrok.failed') })
      if (res.ok) setToken('')
    } catch {
      setTokenMsg({ ok: false, text: t('share.ngrok.failed') })
    }
  }

  const noProvider = providers !== null && !providers.cloudflared && !providers.ngrok
  const hint = installHint(window.api.platform)
  const installed = (p: ShareProvider): boolean => providers?.[p] ?? false
  const providerLabel = (p: ShareProvider): string => {
    const name = t(`share.provider.${p}` as 'share.provider.ngrok')
    return installed(p) ? name : t('share.provider.missing', { name })
  }
  const failed = !status.running && status.exitCode !== null && status.exitCode !== 0
  const canStart = running && !status.running && installed(provider)

  return (
    <div className="share-tab">
      <section className="share-section">
        <p>{t('share.intro')}</p>
        <p className="share-warning" role="note">
          {t('share.warning')}
        </p>
      </section>

      {!running && !status.running && <p className="muted">{t('share.notRunning')}</p>}

      {noProvider && (
        <section className="share-section">
          <p className="error-text" role="alert">
            {t('share.noProvider')}
          </p>
          {hint.command && (
            <div className="share-inline">
              <span>{t('share.installCommand')}</span>
              <code className="mono">{hint.command}</code>
              <button type="button" className="btn small" onClick={() => void copy('cmd', hint.command ?? '')}>
                {copied === 'cmd' ? t('share.copied') : t('share.copyCommand')}
              </button>
            </div>
          )}
          <button type="button" className="btn" onClick={() => void window.api.shell.openUrl(hint.url)}>
            {t('share.installDocs')}
          </button>
        </section>
      )}

      <section className="share-section">
        <div className="share-inline">
          <label className="share-field">
            <span>{t('share.provider')}</span>
            <select className="share-input" value={provider} disabled={status.running} onChange={(e) => setProvider(e.target.value as ShareProvider)}>
              {(['cloudflared', 'ngrok'] as const).map((p) => (
                <option key={p} value={p} disabled={providers !== null && !installed(p)}>
                  {providerLabel(p)}
                </option>
              ))}
            </select>
          </label>
          {status.running ? (
            <button type="button" className="btn danger-outline" onClick={() => void act('share:stop', root)}>
              {t('share.stop')}
            </button>
          ) : (
            <button type="button" className="btn primary" disabled={!canStart} onClick={() => setConfirm(true)}>
              {t('share.start')}
            </button>
          )}
        </div>
      </section>

      {status.running && !status.url && (
        <p className="muted" role="status">
          {t('share.starting')}
        </p>
      )}

      {status.running && status.url && (
        <section className="share-section">
          <p>{t('share.publicUrl')}</p>
          <div className="share-inline">
            <input className="share-input share-url mono" readOnly value={status.url} aria-label={t('share.publicUrl')} onFocus={(e) => e.currentTarget.select()} />
            <button type="button" className="btn" onClick={() => void copy('url', status.url ?? '')}>
              {copied === 'url' ? t('share.copied') : t('share.copy')}
            </button>
            <button type="button" className="btn primary-outline" onClick={() => void window.api.shell.openUrl(status.url ?? '')}>
              {t('share.open')}
            </button>
          </div>
          <p className="muted small">{t('share.linkNote')}</p>
        </section>
      )}

      {failed && (
        <p className="error-text" role="alert">
          {t('share.failed', { code: status.exitCode ?? 1 })}
        </p>
      )}
      {!status.running && status.exitCode === 0 && <p className="muted">{t('share.stopped')}</p>}
      {error && (
        <p className="error-text" role="alert">
          {t('share.error', { error })}
        </p>
      )}

      <section className="share-section">
        <h2>{t('share.log')}</h2>
        <pre className="share-log" ref={logRef} aria-live="off">
          {status.log.length ? status.log.join('\n') : t('share.logEmpty')}
        </pre>
      </section>

      <section className="share-section">
        <h2>{t('share.ngrok.title')}</h2>
        <p>{t('share.ngrok.hint')}</p>
        <div className="share-inline">
          <label className="share-field">
            <span>{t('share.ngrok.token')}</span>
            <input
              className="share-input"
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={token}
              onChange={(e) => setToken(e.target.value)}
            />
          </label>
          <button type="button" className="btn" disabled={!token.trim()} onClick={() => void saveToken()}>
            {t('share.ngrok.save')}
          </button>
          <button type="button" className="btn ghost" onClick={() => void window.api.shell.openUrl(NGROK_DOCS_URL)}>
            {t('share.ngrok.docs')}
          </button>
        </div>
        {tokenMsg && (
          <p className={tokenMsg.ok ? 'muted' : 'error-text'} role="status">
            {tokenMsg.text}
          </p>
        )}
      </section>

      {confirm && (
        <ConfirmDialog
          title={t('share.confirm.title', { name: project.name })}
          text={t('share.confirm.text')}
          confirmLabel={t('share.confirm.ok')}
          onCancel={() => setConfirm(false)}
          onConfirm={() => {
            setConfirm(false)
            void act('share:start', root, provider)
          }}
        />
      )}
    </div>
  )
}
