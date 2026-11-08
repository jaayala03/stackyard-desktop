import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Project } from '@shared/types'
import type { GitOverview, GitResult } from '../../../main/features/git'
import { classifyDiff, type GitBranches, type GitChange, type GitCommit } from '../../../main/features/git-parse'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { useT } from '../i18n'
import './git.css'

interface Selection {
  path: string
  staged: boolean
  untracked: boolean
}

const invoke = <T,>(channel: string, ...args: unknown[]): Promise<T> => window.api.invoke<T>(channel, ...args)

function letter(change: GitChange, staged: boolean): string {
  if (change.untracked) return '?'
  if (change.conflicted) return 'U'
  const l = staged ? change.index : change.worktree
  return l === '.' ? '' : l
}

export function GitTab({ project }: { project: Project }): React.JSX.Element {
  const t = useT()
  const root = project.approot
  const [overview, setOverview] = useState<GitOverview | null>(null)
  const [branches, setBranches] = useState<GitBranches | null>(null)
  const [log, setLog] = useState<GitCommit[]>([])
  const [selected, setSelected] = useState<Selection | null>(null)
  const [diff, setDiff] = useState<string | null>(null)
  const [message, setMessage] = useState('')
  const [stageAll, setStageAll] = useState(false)
  const [newBranch, setNewBranch] = useState('')
  const [output, setOutput] = useState('')
  const [failed, setFailed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [discard, setDiscard] = useState<Selection | null>(null)

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const o = await invoke<GitOverview>('git:status', root)
      setOverview(o)
      if (o.isRepo) {
        const [b, l] = await Promise.all([invoke<GitBranches>('git:branches', root), invoke<GitCommit[]>('git:log', root, 30)])
        setBranches(b)
        setLog(l)
      }
    } catch (e) {
      setFailed(true)
      setOutput(String((e as Error).message ?? e))
    }
  }, [root])

  useEffect(() => {
    void refresh()
  }, [refresh])

  // Keep the selected file's diff in sync with the selection and the working tree.
  useEffect(() => {
    if (!selected) {
      setDiff(null)
      return
    }
    let stale = false
    setDiff(null)
    invoke<string>('git:diff', root, selected.path, selected.staged, selected.untracked)
      .then((d) => !stale && setDiff(d))
      .catch((e: Error) => !stale && setDiff(e.message))
    return () => {
      stale = true
    }
  }, [root, selected, overview])

  /** Runs a git action, shows its output and refreshes the view. */
  const run = async (action: () => Promise<GitResult>): Promise<boolean> => {
    setBusy(true)
    setFailed(false)
    let ok = false
    try {
      const res = await action()
      ok = res.ok
      setFailed(!res.ok)
      setOutput(res.output.trim())
    } catch (e) {
      setFailed(true)
      setOutput(String((e as Error).message ?? e))
    }
    await refresh()
    setBusy(false)
    return ok
  }

  const groups = useMemo(() => {
    const changes = overview?.status?.changes ?? []
    return {
      conflicts: changes.filter((c) => c.conflicted),
      staged: changes.filter((c) => !c.untracked && !c.conflicted && c.index !== '.'),
      unstaged: changes.filter((c) => !c.untracked && !c.conflicted && c.worktree !== '.'),
      untracked: changes.filter((c) => c.untracked)
    }
  }, [overview])

  const status = overview?.status
  const select = (c: GitChange, staged: boolean): void => setSelected({ path: c.path, staged, untracked: !!c.untracked })
  const isSelected = (c: GitChange, staged: boolean): boolean => selected?.path === c.path && selected.staged === staged

  const commit = async (): Promise<void> => {
    if (await run(() => invoke<GitResult>('git:commit', root, message, stageAll))) {
      setMessage('')
      setSelected(null)
    }
  }

  const row = (c: GitChange, staged: boolean): React.JSX.Element => {
    const l = letter(c, staged)
    return (
      <li key={`${staged}:${c.path}`} className={`git-file${isSelected(c, staged) ? ' selected' : ''}`}>
        <button type="button" className="git-file-main" onClick={() => select(c, staged)} title={c.path}>
          <span className={`git-badge s-${l === '?' ? 'q' : l}`} title={l ? t(`git.status.${l}` as 'git.status.M') : undefined}>
            {l || '·'}
          </span>
          <span className="git-path mono">{c.path}</span>
          {c.origPath && <span className="muted small">{t('git.renamedFrom', { path: c.origPath })}</span>}
        </button>
        <span className="git-file-actions">
          {staged ? (
            <button type="button" className="btn small" disabled={busy} onClick={() => void run(() => invoke<GitResult>('git:unstage', root, [c.path]))}>
              {t('git.unstage')}
            </button>
          ) : (
            <>
              <button type="button" className="btn small" disabled={busy} onClick={() => void run(() => invoke<GitResult>('git:stage', root, [c.path]))}>
                {t('git.stage')}
              </button>
              {!c.conflicted && (
                <button type="button" className="btn small danger-outline" disabled={busy} onClick={() => setDiscard({ path: c.path, staged: false, untracked: !!c.untracked })}>
                  {t('git.discard')}
                </button>
              )}
            </>
          )}
        </span>
      </li>
    )
  }

  const section = (title: string, list: GitChange[], staged: boolean, extra?: React.ReactNode): React.JSX.Element | null =>
    list.length === 0 ? null : (
      <div className="git-group">
        <h3>
          {title} <span className="muted">({list.length})</span>
          {extra}
        </h3>
        <ul>{list.map((c) => row(c, staged))}</ul>
      </div>
    )

  if (!overview) return <p className="muted">{t('git.diff.loading')}</p>

  if (!overview.isRepo) {
    return (
      <div className="git-empty">
        <p>{t('git.notRepo')}</p>
        <button type="button" className="btn primary" disabled={busy} onClick={() => void run(() => invoke<GitResult>('git:init', root))}>
          {t('git.init')}
        </button>
        {output && <pre className={`git-output${failed ? ' error' : ''}`}>{output}</pre>}
      </div>
    )
  }

  const clean = groups.staged.length + groups.unstaged.length + groups.untracked.length + groups.conflicts.length === 0
  const canCommit = !busy && message.trim() !== '' && (groups.staged.length > 0 || stageAll)

  return (
    <div className="git">
      <div className="git-toolbar">
        <strong className="mono">{status?.detached ? t('git.detached') : status?.branch}</strong>
        <span className="muted small">
          {status?.upstream ? status.upstream : t('git.noUpstream')}
          {status && status.ahead > 0 && ` · ↑ ${t('git.ahead', { n: status.ahead })}`}
          {status && status.behind > 0 && ` · ↓ ${t('git.behind', { n: status.behind })}`}
        </span>
        <span className="git-spacer" />
        {busy && <span className="muted small">{t('git.running')}</span>}
        <button type="button" className="btn small" disabled={busy} onClick={() => void run(() => invoke<GitResult>('git:fetch', root))}>
          {t('git.fetch')}
        </button>
        <button type="button" className="btn small" disabled={busy} onClick={() => void run(() => invoke<GitResult>('git:pull', root))}>
          {t('git.pull')}
        </button>
        <button type="button" className="btn small" disabled={busy} onClick={() => void run(() => invoke<GitResult>('git:push', root))}>
          {t('git.push')}
        </button>
        <button type="button" className="btn small" disabled={busy} onClick={() => void refresh()} aria-label={t('git.refresh')} title={t('git.refresh')}>
          ⟳
        </button>
      </div>

      <div className="git-branches">
        <label>
          <span className="muted small">{t('git.branch.switch')}</span>
          <select
            value={status?.branch ?? ''}
            disabled={busy}
            onChange={(e) => {
              const name = e.target.value
              const remote = branches?.remote.includes(name) ?? false
              void run(() => invoke<GitResult>('git:checkout', root, name, remote))
            }}
          >
            {status?.detached && <option value="">{t('git.detached')}</option>}
            <optgroup label={t('git.branch.local')}>
              {branches?.local.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </optgroup>
            {branches && branches.remote.length > 0 && (
              <optgroup label={t('git.branch.remote')}>
                {branches.remote.map((b) => (
                  <option key={b} value={b}>
                    {b}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
        </label>
        <form
          className="git-newbranch"
          onSubmit={(e) => {
            e.preventDefault()
            const name = newBranch.trim()
            if (name) void run(() => invoke<GitResult>('git:createBranch', root, name)).then((ok) => ok && setNewBranch(''))
          }}
        >
          <input value={newBranch} onChange={(e) => setNewBranch(e.target.value)} placeholder={t('git.branch.newPlaceholder')} aria-label={t('git.branch.new')} disabled={busy} />
          <button type="submit" className="btn small" disabled={busy || !newBranch.trim()}>
            {t('git.branch.create')}
          </button>
        </form>
      </div>

      <div className="git-columns">
        <div className="git-left">
          {clean && <p className="muted">{t('git.clean')}</p>}
          {section(t('git.conflicts'), groups.conflicts, false)}
          {section(t('git.staged'), groups.staged, true)}
          {section(
            t('git.unstaged'),
            groups.unstaged,
            false
          )}
          {section(
            t('git.untracked'),
            groups.untracked,
            false,
            <button type="button" className="btn small git-h-action" disabled={busy} onClick={() => void run(() => invoke<GitResult>('git:stageAll', root))}>
              {t('git.stageAll')}
            </button>
          )}
        </div>
        <div className="git-right">
          <h3>{t('git.diff')}</h3>
          {!selected ? (
            <p className="muted">{t('git.diff.select')}</p>
          ) : diff === null ? (
            <p className="muted">{t('git.diff.loading')}</p>
          ) : diff.trim() === '' ? (
            <p className="muted">{t('git.diff.empty')}</p>
          ) : (
            <pre className="git-diff mono" aria-label={selected.path}>
              {classifyDiff(diff).map((l, i) => (
                <span key={i} className={`dl ${l.kind}`}>
                  {l.text + '\n'}
                </span>
              ))}
            </pre>
          )}
        </div>
      </div>

      <form
        className="git-commit"
        onSubmit={(e) => {
          e.preventDefault()
          if (canCommit) void commit()
        }}
      >
        <h3>{t('git.commit')}</h3>
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder={t('git.commit.placeholder')}
          aria-label={t('git.commit.message')}
          rows={3}
          disabled={busy}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && canCommit) {
              e.preventDefault()
              void commit()
            }
          }}
        />
        <div className="git-commit-row">
          <label className="check">
            <input type="checkbox" checked={stageAll} onChange={(e) => setStageAll(e.target.checked)} /> {t('git.commit.stageAll')}
          </label>
          <span className="git-spacer" />
          {groups.staged.length === 0 && !stageAll && !clean && <span className="muted small">{t('git.commit.nothing')}</span>}
          <button type="submit" className="btn primary" disabled={!canCommit}>
            {t('git.commit')}
          </button>
        </div>
      </form>

      {output && (
        <div>
          <h3>{t('git.output')}</h3>
          <pre className={`git-output mono${failed ? ' error' : ''}`}>{output}</pre>
        </div>
      )}

      <div className="git-log">
        <h3>{t('git.log')}</h3>
        {log.length === 0 ? (
          <p className="muted">{t('git.log.empty')}</p>
        ) : (
          <ul>
            {log.map((c) => (
              <li key={c.hash}>
                <span className="mono muted">{c.short}</span>
                <span className="git-subject">{c.subject}</span>
                <span className="muted small">
                  {c.author} · {new Date(c.date).toLocaleDateString()}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {discard && (
        <ConfirmDialog
          title={t('git.discard.title', { file: discard.path })}
          text={discard.untracked ? t('git.discard.textUntracked') : t('git.discard.text')}
          confirmLabel={t('git.discard')}
          destructive
          onCancel={() => setDiscard(null)}
          onConfirm={() => {
            const d = discard
            setDiscard(null)
            setSelected((s) => (s?.path === d.path ? null : s))
            void run(() => invoke<GitResult>('git:discard', root, [d.path], d.untracked))
          }}
        />
      )}
    </div>
  )
}
