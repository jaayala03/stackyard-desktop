import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Project } from '@shared/types'
import { useT } from '../i18n'
import { ConfirmDialog } from '../components/ConfirmDialog'
import {
  KEY_RE,
  fillDdevDb,
  hasDbVars,
  isSecretKey,
  parseEnv,
  removeAt,
  serializeEnv,
  setValueAt,
  setVar,
  syncFromExample,
  type EnvDoc
} from '../../../main/features/env-parser'
import './env.css'

interface Listing {
  files: string[]
  creatable: Array<{ example: string; target: string }>
}

type Mode = 'vars' | 'raw'
type Message = { kind: 'ok' | 'error'; text: string } | null

const EXAMPLE_SUFFIXES = ['.example', '.sample', '.dist', '.template']
const baseName = (rel: string): string => rel.slice(rel.lastIndexOf('/') + 1)
const dirName = (rel: string): string => (rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/') + 1) : '')

function errorText(e: unknown): string {
  const text = e instanceof Error ? e.message : String(e)
  return text.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
}

export function EnvTab({ project }: { project: Project }): React.JSX.Element {
  const t = useT()
  const approot = project.approot
  const [listing, setListing] = useState<Listing | null>(null)
  const [current, setCurrent] = useState<string | null>(null)
  const [text, setText] = useState('')
  const [saved, setSaved] = useState('')
  const [mode, setMode] = useState<Mode>('vars')
  const [revealed, setRevealed] = useState<Set<number>>(new Set())
  const [message, setMessage] = useState<Message>(null)
  const [pending, setPending] = useState<(() => void) | null>(null)
  const [clearCache, setClearCache] = useState(true)
  const [newKey, setNewKey] = useState('')
  const [newValue, setNewValue] = useState('')

  const dirty = text !== saved
  const doc = useMemo(() => parseEnv(text), [text])
  const isLaravel = project.type === 'laravel'
  const isMainEnv = current !== null && baseName(current) === '.env'

  const loadFile = useCallback(
    async (rel: string): Promise<void> => {
      try {
        const content = await window.api.invoke<string>('env:read', approot, rel)
        setCurrent(rel)
        setText(content)
        setSaved(content)
        setRevealed(new Set())
        setMessage(null)
      } catch (e) {
        setCurrent(rel)
        setText('')
        setSaved('')
        setMessage({ kind: 'error', text: t('env.loadError', { error: errorText(e) }) })
      }
    },
    [approot, t]
  )

  const refresh = useCallback(
    async (select?: string): Promise<void> => {
      try {
        const res = await window.api.invoke<Listing>('env:list', approot)
        setListing(res)
        const target = select && res.files.includes(select) ? select : res.files[0]
        if (target) await loadFile(target)
        else {
          setCurrent(null)
          setText('')
          setSaved('')
        }
      } catch (e) {
        setMessage({ kind: 'error', text: t('env.loadError', { error: errorText(e) }) })
      }
    },
    [approot, loadFile, t]
  )

  useEffect(() => {
    void refresh()
    // Only when the project changes; the tab is re-mounted per project.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [approot])

  /** Runs `action` now, or after the user confirms discarding unsaved edits. */
  const guard = (action: () => void): void => {
    if (dirty) setPending(() => action)
    else action()
  }

  const edit = (fn: (d: EnvDoc) => EnvDoc): void => setText(serializeEnv(fn(doc)))

  const save = useCallback(async (): Promise<void> => {
    if (!current) return
    try {
      await window.api.invoke('env:write', approot, current, text)
      setSaved(text)
      setMessage({ kind: 'ok', text: t('env.saved', { name: baseName(current) }) })
      if (clearCache && isLaravel && isMainEnv && project.status === 'running') {
        const ok = await window.api.invoke<boolean>('env:clearCache', approot)
        setMessage(ok ? { kind: 'ok', text: t('env.clearCache.done') } : { kind: 'error', text: t('env.clearCache.failed') })
      }
      void window.api.invoke<Listing>('env:list', approot).then(setListing)
    } catch (e) {
      setMessage({ kind: 'error', text: t('env.saveError', { error: errorText(e) }) })
    }
  }, [approot, clearCache, current, isLaravel, isMainEnv, project.status, t, text])

  const example = useMemo(() => {
    if (!current || !listing) return null
    const name = baseName(current)
    if (EXAMPLE_SUFFIXES.some((s) => name.endsWith(s))) return null
    return EXAMPLE_SUFFIXES.map((s) => dirName(current) + name + s).find((rel) => listing.files.includes(rel)) ?? null
  }, [current, listing])

  const sync = async (): Promise<void> => {
    if (!example) return
    try {
      const exampleDoc = parseEnv(await window.api.invoke<string>('env:read', approot, example))
      const res = syncFromExample(doc, exampleDoc)
      const name = baseName(example)
      if (res.added.length === 0) setMessage({ kind: 'ok', text: t('env.sync.none', { example: name }) })
      else {
        setText(serializeEnv(res.doc))
        setMessage({ kind: 'ok', text: t('env.sync.added', { example: name, keys: res.added.join(', ') }) })
      }
    } catch (e) {
      setMessage({ kind: 'error', text: t('env.loadError', { error: errorText(e) }) })
    }
  }

  const fillDb = (): void => {
    const res = fillDdevDb(doc, project.db)
    if (res.changed.length === 0) setMessage({ kind: 'ok', text: t('env.fillDb.none') })
    else {
      setText(serializeEnv(res.doc))
      setMessage({ kind: 'ok', text: t('env.fillDb.done', { keys: res.changed.join(', ') }) })
    }
  }

  const createFromExample = async (example: string, target: string): Promise<void> => {
    try {
      await window.api.invoke('env:create', approot, example, target)
      await refresh(target)
    } catch (e) {
      setMessage({ kind: 'error', text: t('env.saveError', { error: errorText(e) }) })
    }
  }

  const addVar = (): void => {
    if (!KEY_RE.test(newKey)) return
    edit((d) => setVar(d, newKey, newValue))
    setNewKey('')
    setNewValue('')
  }

  const toggleReveal = (i: number): void =>
    setRevealed((prev) => {
      const next = new Set(prev)
      if (next.has(i)) next.delete(i)
      else next.add(i)
      return next
    })

  const keyInvalid = newKey !== '' && !KEY_RE.test(newKey)
  const showFillDb = isLaravel && isMainEnv && hasDbVars(doc)
  const varCount = doc.lines.filter((l) => l.kind === 'var').length

  return (
    <section
      className="env"
      onKeyDown={(e) => {
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
          e.preventDefault()
          void save()
        }
      }}
    >
      {listing && listing.files.length === 0 && <p className="muted">{t('env.noFiles')}</p>}

      <div className="env-toolbar">
        {listing && listing.files.length > 0 && (
          <label className="env-file">
            <span>{t('env.file')}</span>
            <select
              value={current ?? ''}
              onChange={(e) => {
                const rel = e.target.value
                guard(() => void loadFile(rel))
              }}
            >
              {listing.files.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
          </label>
        )}

        <div className="env-modes" role="group">
          {(['vars', 'raw'] as const).map((m) => (
            <button key={m} type="button" className={`btn small${mode === m ? ' primary-outline' : ''}`} aria-pressed={mode === m} onClick={() => setMode(m)}>
              {t(`env.mode.${m}` as 'env.mode.vars')}
            </button>
          ))}
        </div>

        <button type="button" className="btn small" disabled={!current} onClick={() => current && guard(() => void loadFile(current))}>
          {t('env.reload')}
        </button>
        <button type="button" className="btn small primary" disabled={!current || !dirty} onClick={() => void save()}>
          {t('env.save')}
        </button>
        {dirty && <span className="env-dirty small">{t('env.unsaved')}</span>}
      </div>

      <div className="env-actions">
        {listing?.creatable.map((c) => (
          <button key={c.target} type="button" className="btn small" onClick={() => guard(() => void createFromExample(c.example, c.target))}>
            {t('env.createFrom', { target: c.target, example: baseName(c.example) })}
          </button>
        ))}
        {example && (
          <button type="button" className="btn small" onClick={() => void sync()}>
            {t('env.sync', { example: baseName(example) })}
          </button>
        )}
        {showFillDb && (
          <button type="button" className="btn small" title={t('env.fillDb.hint')} onClick={fillDb}>
            {t('env.fillDb')}
          </button>
        )}
        {isLaravel && isMainEnv && (
          <label className="env-check small">
            <input type="checkbox" checked={clearCache} disabled={project.status !== 'running'} onChange={(e) => setClearCache(e.target.checked)} />
            {t('env.clearCache')}
          </label>
        )}
      </div>

      {message && (
        <p className={message.kind === 'error' ? 'error-text' : 'env-ok small'} role={message.kind === 'error' ? 'alert' : 'status'}>
          {message.text}
        </p>
      )}

      {current && mode === 'raw' && (
        <textarea className="env-raw mono" aria-label={current} spellCheck={false} wrap="off" value={text} onChange={(e) => setText(e.target.value)} />
      )}

      {current && mode === 'vars' && (
        <div className="env-vars">
          {varCount === 0 && <p className="muted small">{t('env.empty')}</p>}
          {doc.lines.map((line, i) => {
            if (line.kind === 'comment') {
              return (
                <p key={i} className="env-comment mono small">
                  {line.raw.trim()}
                </p>
              )
            }
            if (line.kind !== 'var') return null
            const secret = isSecretKey(line.key)
            const hidden = secret && !revealed.has(i)
            return (
              <div key={i} className="env-row">
                <span className="env-key mono" title={line.key}>
                  {line.key}
                </span>
                <input
                  className="env-value mono"
                  aria-label={line.key}
                  type={hidden ? 'password' : 'text'}
                  autoComplete="off"
                  spellCheck={false}
                  value={line.value}
                  onChange={(e) => edit((d) => setValueAt(d, i, e.target.value))}
                />
                {secret ? (
                  <button type="button" className="btn small ghost" aria-label={hidden ? t('env.reveal') : t('env.hide')} title={hidden ? t('env.reveal') : t('env.hide')} onClick={() => toggleReveal(i)}>
                    {hidden ? '👁' : '🙈'}
                  </button>
                ) : (
                  <span />
                )}
                <button type="button" className="btn small ghost" aria-label={t('env.remove', { key: line.key })} title={t('env.remove', { key: line.key })} onClick={() => edit((d) => removeAt(d, i))}>
                  ✕
                </button>
              </div>
            )
          })}

          <form
            className="env-row env-add"
            onSubmit={(e) => {
              e.preventDefault()
              addVar()
            }}
          >
            <input className="env-key-input mono" aria-label={t('env.key')} placeholder={t('env.key')} aria-invalid={keyInvalid} spellCheck={false} value={newKey} onChange={(e) => setNewKey(e.target.value)} />
            <input className="env-value mono" aria-label={t('env.value')} placeholder={t('env.value')} spellCheck={false} value={newValue} onChange={(e) => setNewValue(e.target.value)} />
            <button type="submit" className="btn small" disabled={!KEY_RE.test(newKey)}>
              {t('env.add')}
            </button>
            <span />
          </form>
          {keyInvalid && <p className="field-error small">{t('env.addKeyInvalid')}</p>}
        </div>
      )}

      <p className="muted small">{t('env.hint')}</p>

      {pending && (
        <ConfirmDialog
          title={t('env.discard.title')}
          text={t('env.discard.text')}
          confirmLabel={t('env.discard.confirm')}
          destructive
          onCancel={() => setPending(null)}
          onConfirm={() => {
            const action = pending
            setPending(null)
            action()
          }}
        />
      )}
    </section>
  )
}
