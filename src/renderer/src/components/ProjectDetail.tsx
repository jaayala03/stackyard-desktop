import { useState } from 'react'
import type { Project, ProjectAction } from '@shared/types'
import { PROJECT_TYPES, WEBSERVERS, DATABASES } from '@shared/catalog'
import { useT } from '../i18n'
import { ConfirmDialog } from './ConfirmDialog'
import { statusClass } from './ProjectList'
import { CodeTab } from '../features/CodeTab'
import { EnvTab } from '../features/EnvTab'
import { GitTab } from '../features/GitTab'
import { SnapTab } from '../features/SnapTab'
import { DbTab } from '../features/DbTab'

type Tab = 'overview' | 'git' | 'code' | 'env' | 'snap' | 'db'
const TABS: Tab[] = ['overview', 'git', 'code', 'env', 'db', 'snap']

interface Props {
  project: Project
  busy: boolean
  onAction: (action: ProjectAction) => void
  onSsh: () => void
  onLogs: () => void
}

export function ProjectDetail({ project: p, busy, onAction, onSsh, onLogs }: Props): React.JSX.Element {
  const t = useT()
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [editorMissing, setEditorMissing] = useState(false)
  const [tab, setTab] = useState<Tab>('overview')
  const running = p.status === 'running'
  const state = statusClass(p.status)

  const typeLabel = PROJECT_TYPES.find((x) => x.value === p.type)?.label ?? (p.type || '—')
  const webserver = WEBSERVERS.find((x) => x.value === p.webserver)?.label ?? p.webserver
  const db = DATABASES.find((x) => x.value === p.db)?.label ?? (p.db || '—')

  const openEditor = async (): Promise<void> => {
    setEditorMissing(!(await window.api.shell.openEditor(p.approot)))
  }

  const fields: Array<[string, string]> = [
    [t('detail.type'), typeLabel],
    [t('detail.php'), p.php || '—'],
    [t('detail.node'), p.node || '—'],
    [t('detail.webserver'), webserver || '—'],
    [t('detail.db'), db],
    [t('detail.docroot'), p.docroot || '.']
  ]

  return (
    <section className="detail" aria-label={p.name}>
      <header className="detail-header">
        <div>
          <h1>{p.name}</h1>
          <p className="status-line">
            <span className={`dot ${state}`} aria-hidden="true" />
            {t(`status.${state}` as 'status.running')}
          </p>
        </div>
        <div className="actions">
          {running ? (
            <button type="button" className="btn" disabled={busy} onClick={() => onAction('stop')}>
              {t('action.stop')}
            </button>
          ) : (
            <button type="button" className="btn primary" disabled={busy} onClick={() => onAction('start')}>
              {t('action.start')}
            </button>
          )}
          <button type="button" className="btn" disabled={busy} onClick={() => onAction('restart')}>
            {t('action.restart')}
          </button>
          <button type="button" className="btn danger-outline" disabled={busy} onClick={() => setConfirmDelete(true)}>
            {t('action.delete')}
          </button>
        </div>
      </header>

      <div className="tabs" role="tablist">
        {TABS.map((id) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} className={`tab${tab === id ? ' active' : ''}`} onClick={() => setTab(id)}>
            {t(`tab.${id}` as 'tab.git')}
          </button>
        ))}
      </div>

      {tab === 'git' && <GitTab project={p} />}
      {tab === 'code' && <CodeTab project={p} />}
      {tab === 'env' && <EnvTab project={p} />}
      {tab === 'snap' && <SnapTab project={p} />}
      {tab === 'db' && <DbTab project={p} />}

      {tab === 'overview' && (
        <>
      <dl className="facts">
        {fields.map(([k, v]) => (
          <div key={k} className="fact">
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
        <div className="fact wide">
          <dt>{t('detail.folder')}</dt>
          <dd className="mono">{p.approot}</dd>
        </div>
      </dl>

      <div className="button-row">
        {p.primaryUrl && (
          <button type="button" className="btn primary-outline" disabled={!running} onClick={() => void window.api.shell.openUrl(p.primaryUrl)}>
            {t('detail.openSite')} <span className="mono small">{p.primaryUrl.replace(/^https?:\/\//, '')}</span>
          </button>
        )}
        <button type="button" className="btn" onClick={() => void window.api.shell.openPath(p.approot)}>
          {t('detail.openFolder')}
        </button>
        <button type="button" className="btn" onClick={() => void openEditor()}>
          {t('detail.openEditor')}
        </button>
        <button type="button" className="btn" disabled={!running} onClick={onSsh}>
          {t('action.ssh')}
        </button>
        <button type="button" className="btn" disabled={!running} onClick={onLogs}>
          {t('action.logs')}
        </button>
      </div>
      {editorMissing && (
        <p className="error-text" role="alert">
          {t('detail.noEditor')}
        </p>
      )}
        </>
      )}

      {confirmDelete && (
        <ConfirmDialog
          title={t('confirm.delete.title', { name: p.name })}
          text={t('confirm.delete.text')}
          confirmLabel={t('action.delete')}
          destructive
          onCancel={() => setConfirmDelete(false)}
          onConfirm={() => {
            setConfirmDelete(false)
            onAction('delete')
          }}
        />
      )}
    </section>
  )
}
