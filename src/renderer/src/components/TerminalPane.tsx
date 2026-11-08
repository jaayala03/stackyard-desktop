import { useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import type { TermSession } from '@shared/types'
import { useT } from '../i18n'

interface PaneProps {
  sessions: TermSession[]
  activeId: string | null
  collapsed: boolean
  onSelect: (id: string) => void
  onClose: (id: string) => void
  onToggle: () => void
}

const MIN_HEIGHT = 120
const DEFAULT_HEIGHT = 220
const clampHeight = (h: number): number => Math.max(MIN_HEIGHT, Math.min(h, Math.round(window.innerHeight * 0.7)))

function loadHeight(): number {
  try {
    const saved = Number(localStorage.getItem('terminalHeight'))
    return saved ? clampHeight(saved) : DEFAULT_HEIGHT
  } catch {
    return DEFAULT_HEIGHT
  }
}

export function TerminalPane({ sessions, activeId, collapsed, onSelect, onClose, onToggle }: PaneProps): React.JSX.Element {
  const t = useT()
  const [height, setHeight] = useState(loadHeight)

  const commit = (h: number): void => {
    const next = clampHeight(h)
    setHeight(next)
    try {
      localStorage.setItem('terminalHeight', String(next))
    } catch {
      /* storage may be unavailable */
    }
  }

  const startDrag = (e: React.PointerEvent<HTMLDivElement>): void => {
    e.preventDefault()
    const startY = e.clientY
    const startHeight = height
    const move = (ev: PointerEvent): void => setHeight(clampHeight(startHeight + (startY - ev.clientY)))
    const up = (ev: PointerEvent): void => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      commit(startHeight + (startY - ev.clientY))
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  return (
    <div className={collapsed ? 'terminal-pane collapsed' : 'terminal-pane'} style={collapsed ? undefined : { height }}>
      {!collapsed && (
        <div
          className="terminal-resizer"
          role="separator"
          aria-orientation="horizontal"
          aria-label={t('terminal.resize')}
          aria-valuenow={height}
          aria-valuemin={MIN_HEIGHT}
          tabIndex={0}
          onPointerDown={startDrag}
          onKeyDown={(e) => {
            if (e.key === 'ArrowUp') commit(height + 24)
            if (e.key === 'ArrowDown') commit(height - 24)
          }}
        />
      )}
      <div className="terminal-tabs" role="tablist" aria-label={t('terminal.title')}>
        {sessions.map((s) => (
          <div key={s.id} className={s.id === activeId ? 'tab active' : 'tab'}>
            <button type="button" role="tab" aria-selected={s.id === activeId} className="tab-label" onClick={() => onSelect(s.id)}>
              <span className={s.running ? 'dot running pulse' : 'dot stopped'} aria-hidden="true" />
              {s.title}
            </button>
            <button type="button" className="tab-close" aria-label={`${t('terminal.close')}: ${s.title}`} onClick={() => onClose(s.id)}>
              ×
            </button>
          </div>
        ))}
        <span className="spacer" />
        <button type="button" className="btn small ghost" aria-expanded={!collapsed} onClick={onToggle}>
          {collapsed ? t('terminal.show') : t('terminal.hide')}
        </button>
      </div>
      <div className="terminal-body" hidden={collapsed}>
        {sessions.length === 0 && <p className="muted pad">{t('terminal.empty')}</p>}
        {sessions.map((s) => (
          <TerminalView key={s.id} id={s.id} visible={s.id === activeId && !collapsed} />
        ))}
      </div>
    </div>
  )
}

function TerminalView({ id, visible }: { id: string; visible: boolean }): React.JSX.Element {
  const host = useRef<HTMLDivElement>(null)
  const fit = useRef<FitAddon | null>(null)
  const term = useRef<Terminal | null>(null)

  useEffect(() => {
    const el = host.current
    if (!el) return
    const xterm = new Terminal({
      fontFamily: 'Consolas, "Cascadia Mono", Menlo, "DejaVu Sans Mono", monospace',
      fontSize: 13,
      cursorBlink: true,
      scrollback: 5000,
      convertEol: false,
      theme: { background: '#14161a', foreground: '#d8dce3', cursor: '#d8dce3', selectionBackground: '#3a4660' }
    })
    const addon = new FitAddon()
    xterm.loadAddon(addon)
    xterm.open(el)
    term.current = xterm
    fit.current = addon

    const input = xterm.onData((d) => window.api.term.write(id, d))
    const resize = xterm.onResize(({ cols, rows }) => window.api.term.resize(id, cols, rows))
    let offData: (() => void) | undefined
    let offExit: (() => void) | undefined
    let disposed = false

    // Replay what the session has printed so far, then follow live output. Subscribing in the same
    // continuation as the replay keeps both in order (IPC messages are separate tasks).
    void window.api.term.attach(id).then((buffer) => {
      if (disposed) return
      if (buffer) xterm.write(buffer)
      offData = window.api.term.onData((sid, data) => {
        if (sid === id) xterm.write(data)
      })
      offExit = window.api.term.onExit((sid) => {
        if (sid === id) xterm.options.cursorBlink = false
      })
      try {
        addon.fit()
      } catch {
        /* hidden element has no size yet */
      }
    })

    const observer = new ResizeObserver(() => {
      if (el.offsetParent === null) return
      try {
        addon.fit()
      } catch {
        /* ignore */
      }
    })
    observer.observe(el)

    return () => {
      disposed = true
      observer.disconnect()
      input.dispose()
      resize.dispose()
      offData?.()
      offExit?.()
      xterm.dispose()
    }
  }, [id])

  useEffect(() => {
    if (!visible) return
    const raf = requestAnimationFrame(() => {
      try {
        fit.current?.fit()
      } catch {
        /* ignore */
      }
      term.current?.focus()
    })
    return () => cancelAnimationFrame(raf)
  }, [visible])

  return <div ref={host} className="terminal-host" hidden={!visible} />
}
