import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'

/** One xterm bound to a terminal session of the main process (same wiring as components/TerminalPane). */
export function DeployTerminal({ id }: { id: string }): React.JSX.Element {
  const host = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = host.current
    if (!el) return
    const xterm = new Terminal({
      fontFamily: 'Consolas, "Cascadia Mono", Menlo, "DejaVu Sans Mono", monospace',
      fontSize: 13,
      cursorBlink: true,
      scrollback: 5000,
      theme: { background: '#14161a', foreground: '#d8dce3', cursor: '#d8dce3', selectionBackground: '#3a4660' }
    })
    const addon = new FitAddon()
    xterm.loadAddon(addon)
    xterm.open(el)

    const input = xterm.onData((d) => window.api.term.write(id, d))
    const resize = xterm.onResize(({ cols, rows }) => window.api.term.resize(id, cols, rows))
    let offData: (() => void) | undefined
    let offExit: (() => void) | undefined
    let disposed = false

    // Replay what the session printed so far, then follow live output (subscribing in the same
    // continuation as the replay keeps both in order).
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
        /* element has no size yet */
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

  return <div ref={host} className="deploy-term-host" />
}
