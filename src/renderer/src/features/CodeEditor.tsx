import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { bracketMatching, defaultHighlightStyle, HighlightStyle, indentOnInput, syntaxHighlighting } from '@codemirror/language'
import { Compartment, EditorState } from '@codemirror/state'
import { drawSelection, EditorView, highlightActiveLine, highlightActiveLineGutter, keymap, lineNumbers } from '@codemirror/view'
import { tags as t } from '@lezer/highlight'
import { useEffect, useRef } from 'react'
import { languageFor } from './codeLang'

const darkHighlight = HighlightStyle.define([
  { tag: [t.keyword, t.operatorKeyword, t.modifier], color: '#c792ea' },
  { tag: [t.string, t.special(t.string)], color: '#c3e88d' },
  { tag: [t.number, t.bool, t.null], color: '#f78c6c' },
  { tag: [t.comment, t.lineComment, t.blockComment], color: '#7f8aa3', fontStyle: 'italic' },
  { tag: [t.function(t.variableName), t.propertyName], color: '#82aaff' },
  { tag: [t.typeName, t.className, t.tagName], color: '#ffcb6b' },
  { tag: [t.attributeName, t.variableName], color: '#e6e8ee' },
  { tag: [t.operator, t.punctuation], color: '#89ddff' }
])

const isDark = (): boolean => {
  const attr = document.documentElement.dataset.theme
  return attr === 'dark' || (attr !== 'light' && window.matchMedia('(prefers-color-scheme: dark)').matches)
}

const theme = EditorView.theme({
  '&': { height: '100%', backgroundColor: 'var(--surface)', color: 'var(--text)' },
  '.cm-content': { fontFamily: 'var(--mono, ui-monospace, Consolas, monospace)', fontSize: '13px' },
  '.cm-gutters': { backgroundColor: 'var(--surface-2)', color: 'var(--muted)', border: 'none' },
  '.cm-activeLine, .cm-activeLineGutter': { backgroundColor: 'rgba(127,127,127,0.12)' },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': { overflow: 'auto' }
})

interface Props {
  /** Path of the file to show; its state (text, undo history) is kept while the tab stays open. */
  path: string
  /** Text used the first time `path` is shown. */
  initial: string
  onDirty: (path: string) => void
  onSave: (path: string) => void
  /** Gives the parent a way to read the current text of any open file. */
  bind: (api: { getText: (path: string) => string | null; forget: (path: string) => void }) => void
}

export function CodeEditor({ path, initial, onDirty, onSave, bind }: Props): React.JSX.Element {
  const host = useRef<HTMLDivElement>(null)
  const view = useRef<EditorView | null>(null)
  const states = useRef(new Map<string, EditorState>())
  const current = useRef<string | null>(null)
  const highlight = useRef(new Compartment())
  const cb = useRef({ onDirty, onSave })
  cb.current = { onDirty, onSave }

  const makeState = (file: string, doc: string): EditorState =>
    EditorState.create({
      doc,
      extensions: [
        lineNumbers(),
        highlightActiveLineGutter(),
        history(),
        drawSelection(),
        indentOnInput(),
        bracketMatching(),
        highlightActiveLine(),
        highlight.current.of(syntaxHighlighting(isDark() ? darkHighlight : defaultHighlightStyle)),
        keymap.of([
          { key: 'Mod-s', preventDefault: true, run: () => (cb.current.onSave(file), true) },
          indentWithTab,
          ...defaultKeymap,
          ...historyKeymap
        ]),
        ...languageFor(file),
        theme,
        EditorView.updateListener.of((u) => {
          if (u.docChanged) cb.current.onDirty(file)
        })
      ]
    })

  // One view for the whole tab strip; switching files swaps the EditorState.
  useEffect(() => {
    const v = new EditorView({ parent: host.current! })
    view.current = v
    bind({
      getText: (file) => {
        if (file === current.current) return v.state.doc.toString()
        return states.current.get(file)?.doc.toString() ?? null
      },
      forget: (file) => {
        if (file === current.current) current.current = null
        states.current.delete(file)
      }
    })
    const restyle = (): void =>
      v.dispatch({ effects: highlight.current.reconfigure(syntaxHighlighting(isDark() ? darkHighlight : defaultHighlightStyle)) })
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    media.addEventListener('change', restyle)
    const observer = new MutationObserver(restyle)
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    return () => {
      media.removeEventListener('change', restyle)
      observer.disconnect()
      v.destroy()
      view.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const v = view.current
    if (!v) return
    if (current.current) states.current.set(current.current, v.state)
    current.current = path
    v.setState(states.current.get(path) ?? makeState(path, initial))
    v.focus()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path])

  return <div className="code-editor" ref={host} />
}
