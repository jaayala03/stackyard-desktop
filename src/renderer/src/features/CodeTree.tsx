import { useCallback, useEffect, useRef, useState } from 'react'
import { useT } from '../i18n'

export interface CodeEntry {
  name: string
  path: string
  dir: boolean
}

interface Props {
  root: string
  showHidden: boolean
  /** Bump to reload every expanded folder. */
  version: number
  selectedDir: string
  activeFile: string | null
  onSelectDir: (path: string) => void
  onOpen: (entry: CodeEntry) => void
  onRename: (entry: CodeEntry) => void
  onDelete: (entry: CodeEntry) => void
  onError: (message: string) => void
}

export const cleanError = (e: unknown): string =>
  String((e as Error)?.message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

export function CodeTree(props: Props): React.JSX.Element {
  const { root, showHidden, version, selectedDir, activeFile, onSelectDir, onOpen, onRename, onDelete, onError } = props
  const t = useT()
  const [children, setChildren] = useState<Record<string, CodeEntry[]>>({})
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const expandedRef = useRef(expanded)
  expandedRef.current = expanded
  const errorRef = useRef(onError)
  errorRef.current = onError

  const load = useCallback(
    async (dir: string): Promise<void> => {
      try {
        const list = await window.api.invoke<CodeEntry[]>('code:list', root, dir || '.', showHidden)
        setChildren((c) => ({ ...c, [dir]: list }))
      } catch (e) {
        errorRef.current(cleanError(e))
      }
    },
    [root, showHidden]
  )

  useEffect(() => {
    void load('')
    for (const dir of expandedRef.current) void load(dir)
  }, [load, version])

  const toggle = (entry: CodeEntry): void => {
    onSelectDir(entry.path)
    const next = new Set(expanded)
    if (next.has(entry.path)) next.delete(entry.path)
    else {
      next.add(entry.path)
      if (!children[entry.path]) void load(entry.path)
    }
    setExpanded(next)
  }

  const renderList = (dir: string, depth: number): React.JSX.Element | null => {
    const list = children[dir]
    if (!list) return depth === 0 ? <p className="muted code-note">{t('code.loading')}</p> : null
    if (list.length === 0) return <p className="muted code-note" style={{ paddingLeft: 12 + depth * 14 }}>{t('code.emptyFolder')}</p>
    return (
      <ul className="code-tree-list" role={depth === 0 ? 'tree' : 'group'}>
        {list.map((entry) => {
          const open = entry.dir && expanded.has(entry.path)
          const selected = entry.dir ? selectedDir === entry.path : activeFile === entry.path
          return (
            <li key={entry.path} role="treeitem" aria-expanded={entry.dir ? open : undefined} aria-selected={selected}>
              <div className={`code-row${selected ? ' selected' : ''}`} style={{ paddingLeft: 6 + depth * 14 }}>
                <button type="button" className="code-row-main" onClick={() => (entry.dir ? toggle(entry) : onOpen(entry))}>
                  <span className="code-twist" aria-hidden="true">
                    {entry.dir ? (open ? '▾' : '▸') : ''}
                  </span>
                  <span className="code-name">{entry.name}</span>
                </button>
                <span className="code-row-actions">
                  <button type="button" className="btn ghost small icon" title={t('code.rename')} aria-label={`${t('code.rename')} ${entry.name}`} onClick={() => onRename(entry)}>
                    ✎
                  </button>
                  <button type="button" className="btn ghost small icon" title={t('code.delete')} aria-label={`${t('code.delete')} ${entry.name}`} onClick={() => onDelete(entry)}>
                    ✕
                  </button>
                </span>
              </div>
              {open && renderList(entry.path, depth + 1)}
            </li>
          )
        })}
      </ul>
    )
  }

  return <div className="code-tree">{renderList('', 0)}</div>
}
