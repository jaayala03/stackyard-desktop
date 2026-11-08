import { useMemo, useState } from 'react'
import type { Project } from '@shared/types'
import { useT } from '../i18n'

interface Props {
  projects: Project[]
  selected: string | null
  error: string | null
  onSelect: (name: string) => void
}

export function statusClass(status: string): string {
  return status === 'running' ? 'running' : status === 'paused' ? 'paused' : 'stopped'
}

export function ProjectList({ projects, selected, error, onSelect }: Props): React.JSX.Element {
  const t = useT()
  const [query, setQuery] = useState('')

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return q ? projects.filter((p) => p.name.toLowerCase().includes(q) || p.type.toLowerCase().includes(q)) : projects
  }, [projects, query])

  return (
    <div className="project-list">
      <input
        type="search"
        className="search"
        placeholder={t('search.placeholder')}
        aria-label={t('search.placeholder')}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {error && (
        <p className="error-text" role="alert">
          {t('projects.loadError', { error })}
        </p>
      )}
      <ul role="listbox" aria-label="Projects">
        {shown.map((p) => (
          <li key={p.name} role="option" aria-selected={p.name === selected}>
            <button type="button" className={p.name === selected ? 'row selected' : 'row'} onClick={() => onSelect(p.name)}>
              <span className={`dot ${statusClass(p.status)}`} aria-hidden="true" />
              <span className="row-text">
                <span className="row-name">{p.name}</span>
                <span className="row-sub">{p.type || '—'}</span>
              </span>
              <span className="sr-only">{t(`status.${statusClass(p.status)}` as 'status.running')}</span>
            </button>
          </li>
        ))}
      </ul>
      {shown.length === 0 && !error && <p className="muted pad">{projects.length === 0 ? t('projects.empty') : t('projects.noMatch')}</p>}
    </div>
  )
}
