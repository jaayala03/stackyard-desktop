import { useEffect, useMemo, useState } from 'react'
import type { CreateMode, CreateOptions, Settings, TermSession } from '@shared/types'
import { DATABASES, DEFAULTS, NAME_RE, NODE_VERSIONS, PHP_VERSIONS, PROJECT_TYPES, WEBSERVERS } from '@shared/catalog'
import { useT } from '../i18n'
import { Dialog } from './Dialog'

interface Props {
  mode: CreateMode
  settings: Settings
  onClose: () => void
  onStarted: (session: TermSession) => void
}

const sep = (): string => (window.api.platform === 'win32' ? '\\' : '/')
const join = (dir: string, name: string): string => (dir.endsWith('/') || dir.endsWith('\\') ? dir + name : dir + sep() + name)

/** Folder name → a valid DDEV project name. */
export function slug(text: string): string {
  return text
    .toLowerCase()
    .replace(/\.git$/, '')
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

const baseName = (path: string): string => path.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? ''
const repoName = (url: string): string => slug(url.replace(/\/+$/, '').split(/[/:]/).pop() ?? '')

export function ProjectDialog({ mode, settings, onClose, onStarted }: Props): React.JSX.Element {
  const t = useT()
  const [name, setName] = useState('')
  const [touchedName, setTouchedName] = useState(false)
  const [parent, setParent] = useState(settings.projectsDir)
  const [existingPath, setExistingPath] = useState('')
  const [repo, setRepo] = useState('')
  const [branch, setBranch] = useState('')
  const [type, setType] = useState(mode === 'new' ? 'php' : '')
  const [docroot, setDocroot] = useState('')
  const [php, setPhp] = useState(DEFAULTS.php)
  const [node, setNode] = useState(DEFAULTS.node)
  const [webserver, setWebserver] = useState(DEFAULTS.webserver)
  const [db, setDb] = useState(DEFAULTS.db)
  const [scheme, setScheme] = useState<'https' | 'http'>('https')
  const [scaffold, setScaffold] = useState(true)
  const [deps, setDeps] = useState(true)
  const [phpmyadmin, setPhpmyadmin] = useState(false)
  const [launch, setLaunch] = useState(true)
  const [submitted, setSubmitted] = useState(false)
  const [busy, setBusy] = useState(false)

  const title = t(mode === 'new' ? 'dialog.new.title' : mode === 'clone' ? 'dialog.clone.title' : 'dialog.existing.title')
  const path = mode === 'existing' ? existingPath : name ? join(parent, name) : ''
  const typeInfo = PROJECT_TYPES.find((x) => x.value === type)
  const nameValid = NAME_RE.test(name)
  // Node projects run their backend/frontend as DDEV services: no PHP, web server, database or docroot to pick
  const isNode = type === 'node'

  // Auto type: re-detect when the folder of an existing project changes.
  useEffect(() => {
    if (mode !== 'existing' || !existingPath) return
    let stale = false
    void window.api.projects.detectType(existingPath).then((r) => {
      if (stale) return
      setType(r.type)
      setDocroot(r.docroot)
    })
    return () => {
      stale = true
    }
  }, [mode, existingPath])

  // Keep the name in sync with the repo URL / folder until the user edits it.
  useEffect(() => {
    if (touchedName) return
    if (mode === 'clone') setName(repoName(repo))
    else if (mode === 'existing') setName(slug(baseName(existingPath)))
  }, [mode, repo, existingPath, touchedName])

  const errors = useMemo(() => {
    const e: Record<string, string> = {}
    if (!nameValid) e.name = name ? t('field.nameInvalid') : t('field.required')
    if (mode === 'clone' && !repo.trim()) e.repo = t('field.required')
    if (mode === 'existing' && !existingPath) e.path = t('field.required')
    if (mode !== 'existing' && !parent) e.path = t('field.required')
    return e
  }, [nameValid, name, mode, repo, existingPath, parent, t])

  const pickFolder = async (apply: (dir: string) => void): Promise<void> => {
    const dir = await window.api.shell.pickDirectory()
    if (dir) apply(dir)
  }

  const onTypeChange = (value: string): void => {
    setType(value)
    setDocroot(PROJECT_TYPES.find((x) => x.value === value)?.docroot ?? '')
  }

  const submit = async (): Promise<void> => {
    setSubmitted(true)
    if (Object.keys(errors).length > 0 || busy) return
    setBusy(true)
    const options: CreateOptions = {
      mode,
      name,
      path,
      repo: mode === 'clone' ? repo.trim() : undefined,
      branch: mode === 'clone' && branch.trim() ? branch.trim() : undefined,
      type,
      docroot,
      php,
      node,
      webserver,
      db,
      scheme,
      scaffold: mode === 'new' && scaffold && !!typeInfo?.scaffold,
      deps: mode !== 'new' && deps,
      phpmyadmin: phpmyadmin && !isNode,
      launch
    }
    try {
      onStarted(await window.api.projects.create(options))
      onClose()
    } finally {
      setBusy(false)
    }
  }

  const err = (key: string): React.JSX.Element | null =>
    submitted && errors[key] ? (
      <span className="field-error" role="alert">
        {errors[key]}
      </span>
    ) : null

  return (
    <Dialog
      title={title}
      wide
      onClose={onClose}
      onSubmit={() => void submit()}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="submit" className="btn primary" disabled={busy}>
            {t('common.create')}
          </button>
        </>
      }
    >
      <div className="form-grid">
        {mode === 'clone' && (
          <>
            <label className="field span2">
              <span>{t('field.repo')}</span>
              <input value={repo} onChange={(e) => setRepo(e.target.value)} placeholder="https://github.com/user/repo.git" autoFocus aria-invalid={submitted && !!errors.repo} />
              {err('repo')}
            </label>
            <label className="field span2">
              <span>{t('field.branch')}</span>
              <input value={branch} onChange={(e) => setBranch(e.target.value)} />
            </label>
          </>
        )}

        {mode === 'existing' && (
          <div className="field span2">
            <span>{t('field.folder')}</span>
            <div className="input-row">
              <input value={existingPath} onChange={(e) => setExistingPath(e.target.value)} aria-label={t('field.folder')} aria-invalid={submitted && !!errors.path} />
              <button type="button" className="btn" onClick={() => void pickFolder(setExistingPath)}>
                {t('common.browse')}
              </button>
            </div>
            {err('path')}
          </div>
        )}

        <label className="field span2">
          <span>{t('field.name')}</span>
          <input
            value={name}
            onChange={(e) => {
              setTouchedName(true)
              setName(e.target.value)
            }}
            autoFocus={mode === 'new'}
            autoComplete="off"
            spellCheck={false}
            aria-invalid={submitted && !!errors.name}
          />
          {submitted && errors.name ? err('name') : <small className="muted">{t('field.nameHelp')}</small>}
        </label>

        {mode !== 'existing' && (
          <div className="field span2">
            <span>{t('field.path')}</span>
            <div className="input-row">
              <input value={parent} onChange={(e) => setParent(e.target.value)} aria-label={t('field.path')} />
              <button type="button" className="btn" onClick={() => void pickFolder(setParent)}>
                {t('common.browse')}
              </button>
            </div>
            {path && <small className="muted mono">{path}</small>}
            {err('path')}
          </div>
        )}

        <label className="field">
          <span>{t('field.type')}</span>
          <select value={type} onChange={(e) => onTypeChange(e.target.value)}>
            {mode !== 'new' && <option value="">{t('common.auto')}</option>}
            {PROJECT_TYPES.map((x) => (
              <option key={x.value} value={x.value}>
                {x.label}
              </option>
            ))}
          </select>
        </label>
        {!isNode && (
          <label className="field">
            <span>{t('field.docroot')}</span>
            <input value={docroot} onChange={(e) => setDocroot(e.target.value)} placeholder="public" />
          </label>
        )}

        {!isNode && (
          <label className="field">
            <span>{t('field.php')}</span>
            <select value={php} onChange={(e) => setPhp(e.target.value)}>
              {PHP_VERSIONS.map((v) => (
                <option key={v}>{v}</option>
              ))}
            </select>
          </label>
        )}
        <label className="field">
          <span>{t('field.node')}</span>
          <select value={node} onChange={(e) => setNode(e.target.value)}>
            {NODE_VERSIONS.map((v) => (
              <option key={v}>{v}</option>
            ))}
          </select>
        </label>
        {!isNode && (
          <>
            <label className="field">
              <span>{t('field.webserver')}</span>
              <select value={webserver} onChange={(e) => setWebserver(e.target.value)}>
                {WEBSERVERS.map((w) => (
                  <option key={w.value} value={w.value}>
                    {w.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>{t('field.db')}</span>
              <select value={db} onChange={(e) => setDb(e.target.value)}>
                {DATABASES.map((d) => (
                  <option key={d.value} value={d.value}>
                    {d.label}
                  </option>
                ))}
              </select>
            </label>
          </>
        )}
        <label className="field span2">
          <span>{t('field.scheme')}</span>
          <select value={scheme} onChange={(e) => setScheme(e.target.value as 'https' | 'http')}>
            <option value="https">{t('scheme.https')}</option>
            <option value="http">{t('scheme.http')}</option>
          </select>
        </label>

        <fieldset className="checks span2">
          {mode === 'new' && typeInfo?.scaffold && (
            <label className="check">
              <input type="checkbox" checked={scaffold} onChange={(e) => setScaffold(e.target.checked)} />
              {t('field.scaffold')}
            </label>
          )}
          {mode !== 'new' && (
            <label className="check">
              <input type="checkbox" checked={deps} onChange={(e) => setDeps(e.target.checked)} />
              {t('field.deps')}
            </label>
          )}
          {!isNode && (
            <label className="check">
              <input type="checkbox" checked={phpmyadmin} onChange={(e) => setPhpmyadmin(e.target.checked)} />
              {t('field.phpmyadmin')}
            </label>
          )}
          <label className="check">
            <input type="checkbox" checked={launch} onChange={(e) => setLaunch(e.target.checked)} />
            {t('field.launch')}
          </label>
        </fieldset>
      </div>
    </Dialog>
  )
}
