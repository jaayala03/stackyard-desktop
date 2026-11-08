import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CreateMode, Project, ProjectAction, Settings, TermSession, ToolStatus } from '@shared/types'
import { I18nProvider, makeT, resolveLang, type Lang } from './i18n'
import { ProjectList } from './components/ProjectList'
import { ProjectDetail } from './components/ProjectDetail'
import { TerminalPane } from './components/TerminalPane'
import { ProjectDialog } from './components/ProjectDialog'
import { SettingsDialog } from './components/SettingsDialog'
import { UpdateBanner } from './components/UpdateBanner'

const REFRESH_MS = 5000

export function App(): React.JSX.Element {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [systemLocale, setSystemLocale] = useState('en')
  const [tools, setTools] = useState<ToolStatus | null>(null)
  const [projects, setProjects] = useState<Project[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [sessions, setSessions] = useState<TermSession[]>([])
  const [activeTab, setActiveTab] = useState<string | null>(null)
  const [collapsed, setCollapsed] = useState(true)
  const [dialog, setDialog] = useState<CreateMode | 'settings' | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    void window.api.settings.get().then(setSettings)
    void window.api.system.systemLocale().then(setSystemLocale)
    void window.api.system.tools().then(setTools)
  }, [])

  // Theme: `system` follows prefers-color-scheme (CSS); light/dark override it.
  useEffect(() => {
    const root = document.documentElement
    if (!settings || settings.theme === 'system') root.removeAttribute('data-theme')
    else root.setAttribute('data-theme', settings.theme)
  }, [settings])

  const lang: Lang = resolveLang(settings?.language ?? 'auto', systemLocale)
  useEffect(() => {
    document.documentElement.lang = lang
  }, [lang])
  const t = useMemo(() => makeT(lang), [lang])

  const sessionsRef = useRef<TermSession[]>([])
  const activeTabRef = useRef<string | null>(null)
  useEffect(() => {
    sessionsRef.current = sessions
    activeTabRef.current = activeTab
  }, [sessions, activeTab])

  const refresh = useCallback(async () => {
    try {
      setProjects(await window.api.projects.list())
      setLoadError(null)
    } catch (e) {
      setLoadError(e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e))
    }
  }, [])

  useEffect(() => {
    void refresh()
    const timer = setInterval(() => {
      if (!document.hidden) void refresh()
    }, REFRESH_MS)
    return () => clearInterval(timer)
  }, [refresh])

  // Mark terminal sessions as finished and refresh the list right after a job ends.
  useEffect(
    () =>
      window.api.term.onExit((id, code) => {
        setSessions((list) => list.map((s) => (s.id === id ? { ...s, running: false } : s)))
        void refresh()
        if (code === 0 && sessionsRef.current.find((s) => s.id === id)?.kind === 'job') {
          // Success: give a moment to read the result, then give the space back. Errors stay open.
          setTimeout(() => {
            if (activeTabRef.current === id) setCollapsed(true)
          }, 4000)
        }
      }),
    [refresh]
  )

  useEffect(() => {
    if (!menuOpen) return
    const close = (e: MouseEvent): void => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false)
    }
    const esc = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setMenuOpen(false)
    }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', esc)
    }
  }, [menuOpen])

  const openSession = useCallback((session: TermSession) => {
    setSessions((list) => [...list, session])
    setActiveTab(session.id)
    setCollapsed(false)
  }, [])

  const closeSession = (id: string): void => {
    window.api.term.kill(id)
    setSessions((list) => {
      const next = list.filter((s) => s.id !== id)
      if (activeTab === id) setActiveTab(next.length ? next[next.length - 1].id : null)
      return next
    })
  }

  const project = projects.find((p) => p.name === selected) ?? null
  const activeJobRunning = sessions.some((s) => s.kind === 'job' && s.running)

  const runAction = async (p: Project, action: ProjectAction): Promise<void> => {
    openSession(await window.api.projects.action(p.name, p.approot, action))
    if (action === 'delete') setSelected(null)
  }

  const saveSettings = async (patch: Partial<Settings>): Promise<void> => setSettings(await window.api.settings.set(patch))

  const missing = tools ? [!tools.ddev && 'DDEV', !tools.docker && 'Docker'].filter(Boolean).join(', ') : ''
  const choose = (mode: CreateMode | 'settings'): void => {
    setMenuOpen(false)
    setDialog(mode)
  }

  if (!settings) return <div className="splash" aria-busy="true" />

  return (
    <I18nProvider lang={lang}>
      <div className="app">
        <UpdateBanner />
        {missing && (
          <div className="banner warn" role="alert">
            {t('tools.missing', { tools: missing })}
          </div>
        )}
        <div className="main">
          <aside className="sidebar">
            <header className="sidebar-header">
              <strong>{t('app.name')}</strong>
              <span className="spacer" />
              <div className="menu-wrap" ref={menuRef}>
                <button type="button" className="btn primary small" aria-haspopup="menu" aria-expanded={menuOpen} onClick={() => setMenuOpen((o) => !o)}>
                  + {t('menu.new')}
                </button>
                {menuOpen && (
                  <div className="menu" role="menu">
                    <button type="button" role="menuitem" onClick={() => choose('new')}>
                      {t('menu.new')}
                    </button>
                    <button type="button" role="menuitem" onClick={() => choose('clone')}>
                      {t('menu.clone')}
                    </button>
                    <button type="button" role="menuitem" onClick={() => choose('existing')}>
                      {t('menu.existing')}
                    </button>
                  </div>
                )}
              </div>
              <button type="button" className="btn ghost small icon" aria-label={t('menu.settings')} title={t('menu.settings')} onClick={() => choose('settings')}>
                ⚙
              </button>
            </header>
            <ProjectList projects={projects} selected={selected} error={loadError} onSelect={setSelected} />
          </aside>

          <main className="content">
            {project ? (
              <ProjectDetail
                key={project.name}
                project={project}
                busy={activeJobRunning}
                onAction={(a) => void runAction(project, a)}
                onSsh={() => void window.api.projects.ssh(project.approot, project.name).then(openSession)}
                onLogs={() => void window.api.projects.logs(project.approot, project.name).then(openSession)}
              />
            ) : (
              <p className="muted placeholder">{t('projects.select')}</p>
            )}
          </main>
        </div>

        <TerminalPane
          sessions={sessions}
          activeId={activeTab}
          collapsed={collapsed}
          onSelect={(id) => {
            setActiveTab(id)
            setCollapsed(false)
          }}
          onClose={closeSession}
          onToggle={() => setCollapsed((c) => !c)}
        />

        {(dialog === 'new' || dialog === 'clone' || dialog === 'existing') && (
          <ProjectDialog
            key={dialog}
            mode={dialog}
            settings={settings}
            onClose={() => setDialog(null)}
            onStarted={(s, name) => {
              openSession(s)
              setSelected(name)
            }}
          />
        )}
        {dialog === 'settings' && <SettingsDialog settings={settings} onSave={(p) => void saveSettings(p)} onClose={() => setDialog(null)} />}
      </div>
    </I18nProvider>
  )
}
