import { useCallback, useEffect, useState } from 'react'
import type { Project } from '@shared/types'
import type { SnapResult } from '../../../main/features/snap'
import { defaultSnapshotName, humanSize, isValidSnapshotName, shortWhen, type Snapshot } from '../../../main/features/snap-parse'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { useT } from '../i18n'
import './snap.css'

type Pending = { kind: 'restore' | 'delete'; name: string } | { kind: 'cleanup' }

const invoke = <T,>(channel: string, ...args: unknown[]): Promise<T> => window.api.invoke<T>(channel, ...args)

export function SnapTab({ project }: { project: Project }): React.JSX.Element {
  const t = useT()
  const root = project.approot
  const running = project.status === 'running'
  const [items, setItems] = useState<Snapshot[] | null>(null)
  const [error, setError] = useState('')
  const [name, setName] = useState(() => defaultSnapshotName(project.name))
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<SnapResult | null>(null)
  const [pending, setPending] = useState<Pending | null>(null)

  const refresh = useCallback(async (): Promise<void> => {
    try {
      setItems(await invoke<Snapshot[]>('snap:list', root, project.name))
      setError('')
    } catch (e) {
      setItems([])
      setError(String((e as Error).message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
    }
  }, [root, project.name])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const run = async (channel: string, ...args: unknown[]): Promise<void> => {
    setBusy(true)
    setResult(null)
    try {
      setResult(await invoke<SnapResult>(channel, root, ...args))
    } catch (e) {
      setResult({ ok: false, output: String((e as Error).message ?? e) })
    }
    setBusy(false)
    await refresh()
  }

  const trimmed = name.trim()
  const nameOk = isValidSnapshotName(trimmed)

  let confirm: { title: string; text: string; label: string } | null = null
  if (pending?.kind === 'cleanup') confirm = { title: t('snap.cleanup.title'), text: t('snap.cleanup.text'), label: t('snap.cleanup') }
  else if (pending?.kind === 'restore') confirm = { title: t('snap.restore.title', { name: pending.name }), text: t('snap.restore.text'), label: t('snap.restore') }
  else if (pending?.kind === 'delete') confirm = { title: t('snap.delete.title', { name: pending.name }), text: t('snap.delete.text'), label: t('snap.delete') }

  const accept = (): void => {
    const p = pending
    setPending(null)
    if (!p) return
    if (p.kind === 'cleanup') void run('snap:cleanup')
    else void run(p.kind === 'restore' ? 'snap:restore' : 'snap:delete', p.name)
  }

  return (
    <div className="snap">
      <p className="muted">{t('snap.intro')}</p>
      {!running && (
        <p className="muted" role="status">
          {t('snap.notRunning')}
        </p>
      )}

      <form
        className="snap-create"
        onSubmit={(e) => {
          e.preventDefault()
          if (nameOk && running && !busy) void run('snap:create', trimmed)
        }}
      >
        <label>
          <span>{t('snap.nameLabel')}</span>
          <input value={name} onChange={(e) => setName(e.target.value)} aria-invalid={!nameOk} spellCheck={false} />
        </label>
        <button type="submit" className="btn primary" disabled={!nameOk || !running || busy}>
          {t('snap.create')}
        </button>
      </form>
      {!nameOk && (
        <p className="error-text" role="alert">
          {t('snap.nameInvalid')}
        </p>
      )}

      <div className="snap-toolbar">
        {busy && (
          <span className="muted" role="status">
            {t('snap.working')}
          </span>
        )}
        <span className="snap-spacer" />
        <button type="button" className="btn" disabled={busy} onClick={() => void refresh()}>
          {t('snap.refresh')}
        </button>
        <button type="button" className="btn danger-outline" disabled={busy || !items?.length} onClick={() => setPending({ kind: 'cleanup' })}>
          {t('snap.cleanup')}
        </button>
      </div>

      {error && (
        <p className="error-text" role="alert">
          {t('snap.loadError', { error })}
        </p>
      )}
      {items === null ? (
        <p className="muted snap-empty">{t('snap.loading')}</p>
      ) : items.length === 0 ? (
        !error && <p className="muted snap-empty">{t('snap.empty')}</p>
      ) : (
        <ul className="snap-list">
          {items.map((s) => (
            <li key={s.name} className="snap-row">
              <div className="snap-info">
                <span className="snap-name">{s.name}</span>
                <span className="muted small">{[shortWhen(s.created), humanSize(s.size), s.dbVersion].filter(Boolean).join(' · ')}</span>
              </div>
              <button type="button" className="btn" disabled={busy || !running} onClick={() => setPending({ kind: 'restore', name: s.name })}>
                {t('snap.restore')}
              </button>
              <button type="button" className="btn danger-outline" disabled={busy} onClick={() => setPending({ kind: 'delete', name: s.name })}>
                {t('snap.delete')}
              </button>
            </li>
          ))}
        </ul>
      )}

      {result && (
        <section aria-label={t('snap.output')}>
          <p className={result.ok ? 'muted' : 'error-text'} role="status">
            {result.ok ? t('snap.done') : t('snap.failed')}
          </p>
          {result.output.trim() && <pre className={`snap-output${result.ok ? '' : ' error'}`}>{result.output.trim()}</pre>}
        </section>
      )}

      {confirm && (
        <ConfirmDialog title={confirm.title} text={confirm.text} confirmLabel={confirm.label} destructive onCancel={() => setPending(null)} onConfirm={accept} />
      )}
    </div>
  )
}
