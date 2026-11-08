import { useCallback, useEffect, useRef, useState } from 'react'
import type { Project } from '@shared/types'
import { Dialog } from '../components/Dialog'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { useT } from '../i18n'
import { CodeEditor } from './CodeEditor'
import { cleanError, CodeTree, type CodeEntry } from './CodeTree'
import './code.css'

type ReadResult = { ok: true; content: string; mtime: number } | { ok: false; reason: 'binary' | 'tooLarge' | 'notFile' }

interface OpenFile {
  path: string
  name: string
  dirty: boolean
}

type Prompt = { kind: 'file' | 'folder'; parent: string } | { kind: 'rename'; entry: CodeEntry }

const baseName = (p: string): string => p.split('/').pop() ?? p
const parentOf = (p: string): string => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '')
const join = (dir: string, name: string): string => (dir ? `${dir}/${name}` : name)
const isUnder = (path: string, base: string): boolean => path === base || path.startsWith(base + '/')

export function CodeTab({ project }: { project: Project }): React.JSX.Element {
  const t = useT()
  const root = project.approot
  const [files, setFiles] = useState<OpenFile[]>([])
  const [active, setActive] = useState<string | null>(null)
  const [showHidden, setShowHidden] = useState(false)
  const [version, setVersion] = useState(0)
  const [selectedDir, setSelectedDir] = useState('')
  const [notice, setNotice] = useState('')
  const [prompt, setPrompt] = useState<Prompt | null>(null)
  const [promptName, setPromptName] = useState('')
  const [toDelete, setToDelete] = useState<CodeEntry | null>(null)
  const [closing, setClosing] = useState<string | null>(null)
  const initials = useRef(new Map<string, string>())
  const api = useRef<{ getText: (p: string) => string | null; forget: (p: string) => void } | null>(null)

  const fail = useCallback((key: 'code.opFailed' | 'code.saveFailed' | 'code.readFailed', e: unknown) => setNotice(t(key, { error: cleanError(e) })), [t])

  const open = async (entry: CodeEntry): Promise<void> => {
    setNotice('')
    if (files.some((f) => f.path === entry.path)) return setActive(entry.path)
    try {
      const res = await window.api.invoke<ReadResult>('code:read', root, entry.path)
      if (!res.ok) return setNotice(t(`code.${res.reason}` as 'code.binary'))
      initials.current.set(entry.path, res.content)
      setFiles((f) => [...f, { path: entry.path, name: entry.name, dirty: false }])
      setActive(entry.path)
    } catch (e) {
      fail('code.readFailed', e)
    }
  }

  const markDirty = useCallback((path: string) => {
    setFiles((list) => (list.some((f) => f.path === path && !f.dirty) ? list.map((f) => (f.path === path ? { ...f, dirty: true } : f)) : list))
  }, [])

  const save = useCallback(
    async (path: string): Promise<boolean> => {
      const text = api.current?.getText(path)
      if (text == null) return true
      try {
        await window.api.invoke<number>('code:write', root, path, text)
        setFiles((list) => list.map((f) => (f.path === path ? { ...f, dirty: false } : f)))
        setNotice('')
        return true
      } catch (e) {
        fail('code.saveFailed', e)
        return false
      }
    },
    [root, fail]
  )

  const drop = (path: string): void => {
    api.current?.forget(path)
    initials.current.delete(path)
    setFiles((list) => {
      const next = list.filter((f) => f.path !== path)
      setActive((cur) => (cur === path ? (next[next.length - 1]?.path ?? null) : cur))
      return next
    })
  }

  const requestClose = (file: OpenFile): void => (file.dirty ? setClosing(file.path) : drop(file.path))

  const submitPrompt = async (): Promise<void> => {
    const name = promptName.trim()
    if (!prompt || !name || /[\\/]/.test(name)) return
    setNotice('')
    try {
      if (prompt.kind === 'rename') {
        const target = join(parentOf(prompt.entry.path), name)
        if (files.some((f) => isUnder(f.path, prompt.entry.path) && f.dirty)) throw new Error(t('code.unsaved'))
        await window.api.invoke('code:rename', root, prompt.entry.path, target)
        for (const f of files) if (isUnder(f.path, prompt.entry.path)) drop(f.path)
      } else {
        await window.api.invoke('code:create', root, join(prompt.parent, name), prompt.kind === 'folder')
      }
      setPrompt(null)
      setVersion((v) => v + 1)
    } catch (e) {
      setPrompt(null)
      fail('code.opFailed', e)
    }
  }

  const remove = async (entry: CodeEntry): Promise<void> => {
    setToDelete(null)
    try {
      await window.api.invoke('code:delete', root, entry.path)
      for (const f of files) if (isUnder(f.path, entry.path)) drop(f.path)
      setVersion((v) => v + 1)
    } catch (e) {
      fail('code.opFailed', e)
    }
  }

  // Warn before the window closes with unsaved work.
  const anyDirty = files.some((f) => f.dirty)
  useEffect(() => {
    if (!anyDirty) return
    const handler = (e: BeforeUnloadEvent): void => e.preventDefault()
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [anyDirty])

  const startPrompt = (p: Prompt): void => {
    setPrompt(p)
    setPromptName(p.kind === 'rename' ? p.entry.name : '')
  }

  const closingFile = files.find((f) => f.path === closing)
  const activeFile = files.find((f) => f.path === active)

  return (
    <div className="code-tab">
      <aside className="code-side" aria-label={t('code.files')}>
        <div className="code-toolbar">
          <button type="button" className="btn ghost small" onClick={() => startPrompt({ kind: 'file', parent: selectedDir })}>
            + {t('code.newFile')}
          </button>
          <button type="button" className="btn ghost small" onClick={() => startPrompt({ kind: 'folder', parent: selectedDir })}>
            + {t('code.newFolder')}
          </button>
          <button type="button" className="btn ghost small icon" title={t('code.refresh')} aria-label={t('code.refresh')} onClick={() => setVersion((v) => v + 1)}>
            ⟳
          </button>
        </div>
        <CodeTree
          root={root}
          showHidden={showHidden}
          version={version}
          selectedDir={selectedDir}
          activeFile={active}
          onSelectDir={setSelectedDir}
          onOpen={(e) => void open(e)}
          onRename={(e) => startPrompt({ kind: 'rename', entry: e })}
          onDelete={setToDelete}
          onError={setNotice}
        />
        <label className="code-hidden-toggle">
          <input type="checkbox" checked={showHidden} onChange={(e) => setShowHidden(e.target.checked)} /> {t('code.showHidden')}
        </label>
      </aside>

      <section className="code-main">
        {files.length > 0 && (
          <div className="code-tabs" role="tablist">
            {files.map((f) => (
              <div key={f.path} className={`code-file-tab${f.path === active ? ' active' : ''}`}>
                <button type="button" role="tab" aria-selected={f.path === active} className="code-file-name" title={f.path} onClick={() => setActive(f.path)}>
                  {f.name}
                  {f.dirty && <span className="code-dirty" title={t('code.unsaved')} aria-label={t('code.unsaved')}> ●</span>}
                </button>
                <button type="button" className="btn ghost small icon" aria-label={t('code.closeTab', { name: f.name })} onClick={() => requestClose(f)}>
                  ✕
                </button>
              </div>
            ))}
            <button type="button" className="btn small code-save" disabled={!activeFile?.dirty} onClick={() => active && void save(active)}>
              {t('code.save')}
            </button>
          </div>
        )}
        {notice && (
          <p className="error-text code-notice" role="alert">
            {notice}
          </p>
        )}
        {active ? (
          <CodeEditor
            path={active}
            initial={initials.current.get(active) ?? ''}
            onDirty={markDirty}
            onSave={(p) => void save(p)}
            bind={(a) => (api.current = a)}
          />
        ) : (
          <p className="muted code-empty">{t('code.empty')}</p>
        )}
      </section>

      {prompt && (
        <Dialog
          title={prompt.kind === 'rename' ? t('code.rename') : t(prompt.kind === 'file' ? 'code.newFile' : 'code.newFolder')}
          onClose={() => setPrompt(null)}
          onSubmit={() => void submitPrompt()}
          footer={
            <>
              <button type="button" className="btn" onClick={() => setPrompt(null)}>
                {t('common.cancel')}
              </button>
              <button type="submit" className="btn primary" disabled={!promptName.trim() || /[\\/]/.test(promptName)}>
                {prompt.kind === 'rename' ? t('code.rename') : t('common.create')}
              </button>
            </>
          }
        >
          <label className="field">
            <span>{t('code.name')}</span>
            <input autoFocus value={promptName} onChange={(e) => setPromptName(e.target.value)} />
          </label>
        </Dialog>
      )}

      {toDelete && (
        <ConfirmDialog
          title={t('code.deleteTitle', { name: toDelete.name })}
          text={t('code.deleteText')}
          confirmLabel={t('code.delete')}
          destructive
          onCancel={() => setToDelete(null)}
          onConfirm={() => void remove(toDelete)}
        />
      )}

      {closingFile && (
        <Dialog
          title={t('code.unsaved')}
          onClose={() => setClosing(null)}
          footer={
            <>
              <button type="button" className="btn" onClick={() => setClosing(null)}>
                {t('common.cancel')}
              </button>
              <button
                type="button"
                className="btn danger-outline"
                onClick={() => {
                  drop(closingFile.path)
                  setClosing(null)
                }}
              >
                {t('code.discard')}
              </button>
              <button
                type="button"
                className="btn primary"
                onClick={() =>
                  void save(closingFile.path).then((ok) => {
                    if (ok) drop(closingFile.path)
                    setClosing(null)
                  })
                }
              >
                {t('code.saveAndClose')}
              </button>
            </>
          }
        >
          <p>{t('code.unsavedText', { name: closingFile.name })}</p>
        </Dialog>
      )}
    </div>
  )
}
