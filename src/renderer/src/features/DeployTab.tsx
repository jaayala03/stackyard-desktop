import { useCallback, useEffect, useRef, useState } from 'react'
import type { Project, TermSession } from '@shared/types'
import { sshTarget, type DeployAction, type DeploySummary } from '../../../main/features/deploy-parse'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { useT, type T } from '../i18n'
import { DeployTerminal } from './DeployTerminal'
import './deploy.css'

const invoke = <T,>(channel: string, ...args: unknown[]): Promise<T> => window.api.invoke<T>(channel, ...args)
const clean = (e: unknown): string => String((e as Error)?.message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

type Key = 'deploy' | 'revert' | 'setup' | 'status' | 'logs' | 'reload' | 'test'
const ACTIONS: Array<{ key: Key; primary?: boolean; confirm?: boolean }> = [
  { key: 'deploy', primary: true, confirm: true },
  { key: 'revert', confirm: true },
  { key: 'status' },
  { key: 'logs' },
  { key: 'reload', confirm: true },
  { key: 'test' },
  { key: 'setup', confirm: true }
]

interface Run {
  id: string
  label: string
  running: boolean
  code?: number
}

function safeTarget(d: DeploySummary['deploy'][string]): string {
  try {
    return sshTarget(d)
  } catch {
    return d.hosts[0] ?? '—'
  }
}

export function DeployTab({ project }: { project: Project }): React.JSX.Element {
  const t = useT()
  const root = project.approot
  const running = project.status === 'running'
  const [summary, setSummary] = useState<DeploySummary | null | undefined>(undefined)
  const [loadError, setLoadError] = useState('')
  const [keys, setKeys] = useState<number | null | undefined>(undefined)
  const [env, setEnv] = useState('')
  const [run, setRun] = useState<Run | null>(null)
  const [startError, setStartError] = useState('')
  const [pending, setPending] = useState<Key | null>(null)
  const loading = useRef(false)
  const current = useRef<string | null>(null)
  const exited = useRef(new Map<string, number>())

  const refresh = useCallback(async (): Promise<void> => {
    if (loading.current) return
    loading.current = true
    try {
      const s = await invoke<DeploySummary | null>('deploy:summary', root)
      setSummary(s)
      setLoadError('')
      setEnv((prev) => (s && prev in s.deploy ? prev : (Object.keys(s?.deploy ?? {})[0] ?? '')))
      setKeys(running && s && !s.error && Object.keys(s.deploy).length ? await invoke<number | null>('deploy:ssh-keys', root) : undefined)
    } catch (e) {
      setSummary(null)
      setLoadError(clean(e))
    } finally {
      loading.current = false
    }
  }, [root, running])

  useEffect(() => {
    void refresh()
  }, [refresh])

  // Mark the session as finished as soon as it exits. Exits that arrive before the session is
  // registered here are remembered so the race is closed in `start`.
  const refreshRef = useRef(refresh)
  refreshRef.current = refresh
  useEffect(
    () =>
      window.api.term.onExit((id, code) => {
        exited.current.set(id, code)
        if (id === current.current) {
          setRun((r) => (r && r.id === id ? { ...r, running: false, code } : r))
          void refreshRef.current()
        }
      }),
    []
  )

  const start = async (action: DeployAction, label: string): Promise<void> => {
    setStartError('')
    try {
      const s = await invoke<TermSession>('deploy:run', root, action, action === 'auth' ? null : env)
      current.current = s.id
      const code = exited.current.get(s.id)
      setRun({ id: s.id, label, running: code === undefined, code })
      if (code !== undefined) void refresh()
    } catch (e) {
      setStartError(clean(e))
    }
  }

  if (summary === undefined) return <p className="muted deploy-msg">{t('deploy.loading')}</p>
  if (loadError) return <p className="deploy-msg error-text">{t('deploy.readError', { file: '', error: loadError })}</p>
  if (summary === null) return <p className="muted deploy-msg">{t('deploy.noFile')}</p>
  if (summary.error) return <p className="muted deploy-msg">{t('deploy.readError', { file: summary.file, error: summary.error })}</p>
  const envNames = Object.keys(summary.deploy)
  if (envNames.length === 0) return <p className="muted deploy-msg">{t('deploy.noDeploy', { file: summary.file })}</p>

  const d = summary.deploy[env] ?? summary.deploy[envNames[0]]
  const apps = summary.apps.map((a) => a.name)
  const busy = !!run?.running
  const canAct = running && !busy
  const server = safeTarget(d) + (d.port ? `:${d.port}` : '')
  const rows: Array<[string, string]> = [
    [t('deploy.server'), server],
    [t('deploy.folder'), d.path || '—'],
    [t('deploy.branch'), d.ref || '—'],
    [t('deploy.repo'), d.repo || '—'],
    [t('deploy.postDeploy'), d.postDeploy || '—']
  ]

  let keysText: string
  if (!running) keysText = t('deploy.notRunning')
  else if (keys === undefined || keys === null) keysText = t('deploy.keysUnknown')
  else if (keys === 0) keysText = t('deploy.keysNone')
  else keysText = t('deploy.keysLoaded', { n: keys })

  const go = (key: Key): void => {
    if (ACTIONS.find((a) => a.key === key)?.confirm) setPending(key)
    else void start(key, t(`deploy.act.${key}`))
  }

  return (
    <div className="deploy">
      <div className="deploy-top">
        <label className="deploy-env">
          <span>{t('deploy.environment')}</span>
          <select value={env} onChange={(e) => setEnv(e.target.value)} disabled={busy}>
            {envNames.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <span className="deploy-file mono small muted">{summary.file}</span>
        <button type="button" className="btn small ghost" onClick={() => void refresh()}>
          {t('deploy.refresh')}
        </button>
      </div>

      <dl className="deploy-facts">
        {rows.map(([k, v]) => (
          <div key={k} className="deploy-fact">
            <dt>{k}</dt>
            <dd className="mono">{v}</dd>
          </div>
        ))}
      </dl>

      <div className="deploy-keys">
        <span className="muted" role="status">
          {keysText}
        </span>
        <button type="button" className="btn" title={t('deploy.loadKeysTip')} disabled={!canAct} onClick={() => void start('auth', t('deploy.loadKeys'))}>
          {t('deploy.loadKeys')}
        </button>
      </div>

      <div className="deploy-actions">
        {ACTIONS.map((a) => (
          <button key={a.key} type="button" className={a.primary ? 'btn primary' : 'btn'} title={t(`deploy.tip.${a.key}`)} disabled={!canAct} onClick={() => go(a.key)}>
            {t(`deploy.act.${a.key}`)}
          </button>
        ))}
      </div>

      <p className="muted small">{t('deploy.apps', { apps: apps.join(', ') || '—' })}</p>
      {startError && (
        <p className="error-text" role="alert">
          {t('deploy.startError', { error: startError })}
        </p>
      )}

      {run && (
        <section className="deploy-output" aria-label={t('deploy.output')}>
          <header>
            <strong>{run.label}</strong>
            <span className={run.running ? 'dot running pulse' : run.code === 0 ? 'dot running' : 'dot stopped'} aria-hidden="true" />
            <span className="muted small" role="status">
              {run.running ? t('deploy.running') : `${t('deploy.finished')} (${run.code ?? 0})`}
            </span>
            <span className="deploy-spacer" />
            {run.running ? (
              <button type="button" className="btn small" onClick={() => window.api.term.kill(run.id)}>
                {t('deploy.stop')}
              </button>
            ) : (
              <button type="button" className="btn small ghost" onClick={() => setRun(null)}>
                {t('deploy.clear')}
              </button>
            )}
          </header>
          <DeployTerminal key={run.id} id={run.id} />
        </section>
      )}

      {pending && <ConfirmPrompt kind={pending} t={t} env={env} d={d} apps={apps} onCancel={() => setPending(null)} onConfirm={() => {
        const key = pending
        setPending(null)
        void start(key, t(`deploy.act.${key}`))
      }} />}
    </div>
  )
}

function ConfirmPrompt(props: {
  kind: Key
  t: T
  env: string
  d: DeploySummary['deploy'][string]
  apps: string[]
  onCancel: () => void
  onConfirm: () => void
}): React.JSX.Element {
  const { kind, t, env, d, apps } = props
  let vars: Record<string, string> = { env }
  if (kind === 'deploy') vars = { env, ref: d.ref, target: safeTarget(d), path: d.path, post: d.postDeploy || '—' }
  if (kind === 'reload') vars = { env, apps: apps.join(' ') || 'all' }
  const base = `deploy.confirm.${kind === 'deploy' || kind === 'revert' || kind === 'setup' || kind === 'reload' ? kind : 'deploy'}`
  return (
    <ConfirmDialog
      title={t(`${base}.title` as 'deploy.confirm.deploy.title', vars)}
      text={t(`${base}.text` as 'deploy.confirm.deploy.text', vars)}
      confirmLabel={t(`deploy.act.${kind}`)}
      destructive
      onCancel={props.onCancel}
      onConfirm={props.onConfirm}
    />
  )
}
