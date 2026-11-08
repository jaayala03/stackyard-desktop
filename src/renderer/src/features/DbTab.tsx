import { useCallback, useEffect, useState } from 'react'
import type { Project } from '@shared/types'
import type { DbOverview, DbResult } from '../../../main/features/db'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { useT } from '../i18n'
import './db.css'

const invoke = <T,>(channel: string, ...args: unknown[]): Promise<T> => window.api.invoke<T>(channel, ...args)

type Pending = { kind: 'import'; path: string } | { kind: 'pma' } | null

export function DbTab({ project }: { project: Project }): React.JSX.Element {
  const t = useT()
  const root = project.approot
  const [data, setData] = useState<DbOverview | null>(null)
  const [loadError, setLoadError] = useState('')
  const [target, setTarget] = useState('')
  const [pending, setPending] = useState<Pending>(null)
  const [busy, setBusy] = useState(false)
  const [output, setOutput] = useState('')
  const [failed, setFailed] = useState(false)
  const [copied, setCopied] = useState('')

  const refresh = useCallback(async (): Promise<void> => {
    try {
      setData(await invoke<DbOverview>('db:overview', root))
      setLoadError('')
    } catch (e) {
      setLoadError(String((e as Error).message ?? e).replace(/^Error invoking remote method '[^']*': (Error: )?/, ''))
    }
  }, [root])

  useEffect(() => {
    void refresh()
  }, [refresh, project.status])

  const run = async (work: () => Promise<DbResult>, done: string): Promise<void> => {
    setBusy(true)
    setOutput('')
    setFailed(false)
    try {
      const res = await work()
      setFailed(!res.ok)
      setOutput(res.ok ? `${done}\n\n${res.output}`.trim() : res.output)
    } catch (e) {
      setFailed(true)
      setOutput(String((e as Error).message ?? e))
    } finally {
      setBusy(false)
      void refresh()
    }
  }

  const chooseImport = async (): Promise<void> => {
    const path = await invoke<string | null>('db:pickImport')
    if (path) setPending({ kind: 'import', path })
  }

  const doExport = async (): Promise<void> => {
    const path = await invoke<string | null>('db:pickExport', project.name)
    if (path) await run(() => invoke<DbResult>('db:export', root, path), t('db.export.done', { path }))
  }

  const copy = (key: string, value: string): void => {
    void navigator.clipboard.writeText(value).then(() => {
      setCopied(key)
      window.setTimeout(() => setCopied((c) => (c === key ? '' : c)), 1500)
    })
  }

  const running = data?.running ?? false
  const info = data?.info
  const rows: Array<[string, string, string]> = info
    ? [
        ['engine', t('db.engine'), `${info.engine} ${info.version}`.trim()],
        ['host', t('db.host'), info.host],
        ['port', t('db.port'), info.port],
        ...(info.publishedPort ? ([['pport', t('db.hostPort'), `127.0.0.1:${info.publishedPort}`]] as Array<[string, string, string]>) : []),
        ['database', t('db.database'), info.database],
        ['user', t('db.user'), info.username],
        ['password', t('db.password'), info.password]
      ]
    : []

  return (
    <div className="db-tab">
      {loadError && (
        <p className="error-text" role="alert">
          {t('db.loadError', { error: loadError })}
        </p>
      )}
      {data && !running && <p className="muted">{t('db.notRunning')}</p>}

      {info && (
        <section className="db-section" aria-label={t('db.connection')}>
          <h2>{t('db.connection')}</h2>
          <dl className="db-conn">
            {rows.map(([key, label, value]) => (
              <div key={key} className="db-row">
                <dt>{label}</dt>
                <dd className="mono">{value}</dd>
                {key !== 'engine' && (
                  <button type="button" className="btn small" onClick={() => copy(key, key === 'pport' ? value.replace(/^127\.0\.0\.1:/, '') : value)}>
                    {copied === key ? t('db.copied') : t('db.copy')}
                  </button>
                )}
              </div>
            ))}
          </dl>
        </section>
      )}

      <section className="db-section">
        <h2>{t('db.import')}</h2>
        <p className="muted">{t('db.import.help')}</p>
        <div className="db-inline">
          <label>
            {t('db.import.target')}
            <input className="db-input" value={target} onChange={(e) => setTarget(e.target.value)} placeholder="db" spellCheck={false} />
          </label>
          <button type="button" className="btn" disabled={!running || busy} onClick={() => void chooseImport()}>
            {t('db.import.choose')}
          </button>
        </div>
      </section>

      <section className="db-section">
        <h2>{t('db.export')}</h2>
        <p className="muted">{t('db.export.help')}</p>
        <button type="button" className="btn" disabled={!running || busy} onClick={() => void doExport()}>
          {t('db.export.choose')}
        </button>
      </section>

      <section className="db-section">
        <h2>{t('db.pma')}</h2>
        {data?.hasPhpmyadmin ? (
          <button
            type="button"
            className="btn"
            disabled={!running || !data.phpmyadminUrl}
            onClick={() => void window.api.shell.openUrl(data.phpmyadminUrl)}
          >
            {t('db.pma.open')}
          </button>
        ) : (
          <>
            <p className="muted">{t('db.pma.missing')}</p>
            <button type="button" className="btn" disabled={busy} onClick={() => setPending({ kind: 'pma' })}>
              {t('db.pma.install')}
            </button>
          </>
        )}
      </section>

      {busy && <p className="muted" role="status">{t('db.running')}</p>}
      {output && (
        <section className="db-section">
          <h2>{failed ? t('db.failed') : t('db.output')}</h2>
          <pre className={`db-output${failed ? ' failed' : ''}`}>{output}</pre>
        </section>
      )}

      {pending?.kind === 'import' && (
        <ConfirmDialog
          title={t('db.import.confirmTitle')}
          text={t('db.import.confirmText', { name: project.name, path: pending.path })}
          confirmLabel={t('db.import')}
          destructive
          onCancel={() => setPending(null)}
          onConfirm={() => {
            const path = pending.path
            setPending(null)
            void run(() => invoke<DbResult>('db:import', root, path, target), t('db.import.done'))
          }}
        />
      )}
      {pending?.kind === 'pma' && (
        <ConfirmDialog
          title={t('db.pma.confirmTitle')}
          text={t('db.pma.confirmText')}
          confirmLabel={t('db.pma.install')}
          onCancel={() => setPending(null)}
          onConfirm={() => {
            setPending(null)
            void run(() => invoke<DbResult>('db:addPhpmyadmin', root), t('db.pma.done'))
          }}
        />
      )}
    </div>
  )
}
