import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Project } from '@shared/types'
import type { NodeOverrides, NodeResult, NodeStatus } from '@shared/node'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { useT } from '../i18n'
import './node.css'

const invoke = <T,>(channel: string, ...args: unknown[]): Promise<T> => window.api.invoke<T>(channel, ...args)

type Pending = 'apply' | 'install' | 'vite' | null
interface Row {
  command: string
  port: string
}

const cleanError = (e: unknown): string => String((e as Error).message ?? e).replace(/^Error invoking remote method '[^']*': (Error: )?/, '')

export function NodeTab({ project }: { project: Project }): React.JSX.Element {
  const t = useT()
  const root = project.approot
  const running = project.status === 'running'
  const scheme = project.primaryUrl.startsWith('http:') ? 'http' : 'https'
  const [data, setData] = useState<NodeStatus | null>(null)
  const [loadError, setLoadError] = useState('')
  const [rows, setRows] = useState<Record<string, Row>>({})
  const [pending, setPending] = useState<Pending>(null)
  const [busy, setBusy] = useState(false)
  const [output, setOutput] = useState('')
  const [failed, setFailed] = useState(false)
  const [snippet, setSnippet] = useState('')
  const [copied, setCopied] = useState(false)

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const status = await invoke<NodeStatus>('node:status', root, project.name, scheme)
      setData(status)
      setRows(Object.fromEntries((status.plan?.services ?? []).map((s) => [s.name, { command: s.command ?? '', port: String(s.port) }])))
      setLoadError('')
    } catch (e) {
      setLoadError(cleanError(e))
    }
  }, [root, project.name, scheme])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const plan = data?.plan ?? null
  const services = plan?.services ?? []

  const dirty = useMemo(
    () => services.some((s) => rows[s.name] && (rows[s.name].port !== String(s.port) || (s.kind !== 'vite' && rows[s.name].command !== (s.command ?? '')))),
    [services, rows]
  )

  const problem = useMemo((): string => {
    for (const s of services) {
      const r = rows[s.name]
      if (!r) continue
      const port = Number(r.port)
      if (!/^\d+$/.test(r.port) || port < 1 || port > 65535) return t('node.invalidPort', { name: s.name })
      if (s.kind !== 'vite' && !r.command.trim()) return t('node.emptyCommand', { name: s.name })
    }
    return ''
  }, [services, rows, t])

  const edit = (name: string, patch: Partial<Row>): void => setRows((r) => ({ ...r, [name]: { ...r[name], ...patch } }))

  /** Existing overrides plus the edits that differ from what was detected. */
  const buildOverrides = (): NodeOverrides => {
    const merged: NonNullable<NodeOverrides['services']> = { ...data?.overrides.services }
    for (const s of services) {
      const r = rows[s.name]
      if (!r) continue
      const item = { ...merged[s.name] }
      if (r.port !== String(s.port)) item.port = Number(r.port)
      if (s.kind !== 'vite' && r.command.trim() !== (s.command ?? '')) item.command = r.command.trim()
      if (item.port !== undefined || item.command !== undefined) merged[s.name] = item
    }
    return { services: merged }
  }

  const run = async (work: () => Promise<NodeResult>): Promise<void> => {
    setBusy(true)
    setOutput('')
    setFailed(false)
    setSnippet('')
    try {
      const res = await work()
      setFailed(!res.ok)
      setOutput(res.output.trim() || (res.ok ? t('node.done') : t('node.failed')))
      if (res.snippet) setSnippet(res.snippet)
    } catch (e) {
      setFailed(true)
      setOutput(cleanError(e))
    } finally {
      setBusy(false)
      void refresh()
    }
  }

  const confirm = (): void => {
    const kind = pending
    setPending(null)
    if (kind === 'apply') void run(() => invoke<NodeResult>('node:apply', root, project.name, scheme, project.node || '24', buildOverrides()))
    else if (kind === 'install') void run(() => invoke<NodeResult>('node:install', root))
    else if (kind === 'vite') void run(() => invoke<NodeResult>('node:vite', root))
  }

  const copySnippet = (): void => {
    void navigator.clipboard.writeText(snippet).then(() => {
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    })
  }

  const hasViteService = services.some((s) => s.kind === 'vite')
  const vite = data?.vite
  const pending_ = {
    apply: [t('node.confirm.title', { name: project.name }), t('node.confirm.text'), t(dirty ? 'node.apply' : 'node.applyClean')],
    install: [t('node.install.title', { name: project.name }), t('node.install.text'), t('node.install')],
    vite: [t('node.vite.confirm.title'), t('node.vite.text'), t('node.vite.setup')]
  }

  return (
    <div className="node-tab">
      {loadError && (
        <p className="error-text" role="alert">
          {t('node.loadError', { error: loadError })}
        </p>
      )}

      <section className="node-section" aria-label={t('node.services')}>
        <h2>{t('node.services')}</h2>
        {data && <p className="muted">{data.configured ? t('node.configured') : t('node.notConfigured')}</p>}
        {data && !plan && <p className="muted">{t('node.noServices')}</p>}

        {plan && (
          <div className="node-table-wrap">
            <table className="node-table">
              <thead>
                <tr>
                  <th>{t('node.col.service')}</th>
                  <th>{t('node.col.type')}</th>
                  <th>{t('node.col.folder')}</th>
                  <th>{t('node.col.command')}</th>
                  <th>{t('node.col.port')}</th>
                  <th>{t('node.col.url')}</th>
                </tr>
              </thead>
              <tbody>
                {services.map((s) => {
                  const r = rows[s.name] ?? { command: '', port: '' }
                  const url = data?.urls[s.name] ?? ''
                  return (
                    <tr key={s.name}>
                      <th scope="row">
                        {s.name}
                        {s.primary && <span className="node-badge">{t('node.primary')}</span>}
                      </th>
                      <td>{t(`node.kind.${s.kind}` as 'node.kind.server')}</td>
                      <td className="mono">{s.dir}</td>
                      <td>
                        {s.kind === 'vite' ? (
                          <span className="mono muted">vite</span>
                        ) : (
                          <input
                            className="node-input mono"
                            value={r.command}
                            onChange={(e) => edit(s.name, { command: e.target.value })}
                            aria-label={`${t('node.col.command')} ${s.name}`}
                            spellCheck={false}
                            disabled={busy}
                          />
                        )}
                      </td>
                      <td>
                        {s.kind === 'worker' ? (
                          '—'
                        ) : (
                          <input
                            className="node-input node-port mono"
                            value={r.port}
                            inputMode="numeric"
                            onChange={(e) => edit(s.name, { port: e.target.value.trim() })}
                            aria-label={`${t('node.col.port')} ${s.name}`}
                            disabled={busy}
                          />
                        )}
                      </td>
                      <td>
                        {url ? (
                          <button type="button" className="btn small" disabled={!running} onClick={() => void window.api.shell.openUrl(url)} title={url}>
                            {t('node.open')} <span className="mono small">{url.replace(/^https?:\/\//, '')}</span>
                          </button>
                        ) : (
                          <span className="muted">{t('node.background')}</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        {plan && (
          <p className="muted node-info">
            {t('node.info', { node: project.node || plan.node, db: plan.database ?? t('node.dbNone'), pm: [...new Set(services.map((s) => s.pm))].join(', ') })}
            {plan.puppeteer && ` · ${t('node.puppeteer')}`}
            {plan.native.length > 0 && ` · ${t('node.native', { list: plan.native.join(', ') })}`}
          </p>
        )}
        {problem && (
          <p className="error-text" role="alert">
            {problem}
          </p>
        )}

        <div className="node-actions">
          <button type="button" className="btn primary" disabled={busy || !plan || !!problem} onClick={() => setPending('apply')}>
            {t(dirty ? 'node.apply' : 'node.applyClean')}
          </button>
          <button type="button" className="btn" disabled={busy || !running || !data?.configured} onClick={() => setPending('install')} title={running ? undefined : t('node.notRunning')}>
            {t('node.install')}
          </button>
          <button type="button" className="btn" disabled={busy} onClick={() => void refresh()}>
            {t('node.refresh')}
          </button>
        </div>
      </section>

      <section className="node-section" aria-label={t('node.vite.title')}>
        <h2>{t('node.vite.title')}</h2>
        <p className="muted">{t('node.vite.text')}</p>
        {vite && !vite.config && <p className="muted">{t('node.vite.none')}</p>}
        {vite?.config && vite.viteReady && <p className="muted">{t('node.vite.ready')}</p>}
        {vite?.config && hasViteService && <p className="muted">{t('node.vite.viaService')}</p>}
        <button
          type="button"
          className="btn"
          disabled={busy || !vite?.config || vite.viteReady || hasViteService}
          onClick={() => setPending('vite')}
        >
          {t('node.vite.setup')}
        </button>
      </section>

      {busy && <p className="muted" role="status">{t('node.working')}</p>}
      {output && (
        <pre className={`node-output${failed ? ' failed' : ''}`} role={failed ? 'alert' : 'status'}>
          {output}
        </pre>
      )}
      {snippet && (
        <section className="node-section" aria-label={t('node.vite.snippet')}>
          <h2>{t('node.vite.snippet')}</h2>
          <p className="muted">{t('node.vite.snippetText')}</p>
          <pre className="node-output">{snippet}</pre>
          <button type="button" className="btn small" onClick={copySnippet}>
            {copied ? t('node.copied') : t('node.copy')}
          </button>
        </section>
      )}

      {pending && (
        <ConfirmDialog
          title={pending_[pending][0]}
          text={pending_[pending][1]}
          confirmLabel={pending_[pending][2]}
          onCancel={() => setPending(null)}
          onConfirm={confirm}
        />
      )}
    </div>
  )
}
