import { css } from '@codemirror/lang-css'
import { html } from '@codemirror/lang-html'
import { javascript } from '@codemirror/lang-javascript'
import { json } from '@codemirror/lang-json'
import { markdown } from '@codemirror/lang-markdown'
import { php } from '@codemirror/lang-php'
import { sql } from '@codemirror/lang-sql'
import { yaml } from '@codemirror/lang-yaml'
import type { Extension } from '@codemirror/state'

/** Language support for a file name, or no extension for plain text. */
export function languageFor(name: string): Extension[] {
  const ext = name.toLowerCase().split('.').pop() ?? ''
  switch (ext) {
    case 'php':
    case 'phtml':
      return [php()]
    case 'js':
    case 'mjs':
    case 'cjs':
      return [javascript()]
    case 'jsx':
      return [javascript({ jsx: true })]
    case 'ts':
    case 'mts':
      return [javascript({ typescript: true })]
    case 'tsx':
      return [javascript({ typescript: true, jsx: true })]
    case 'json':
      return [json()]
    case 'css':
    case 'scss':
      return [css()]
    case 'html':
    case 'htm':
      return [html()]
    case 'vue':
      return [html()]
    case 'md':
    case 'markdown':
      return [markdown()]
    case 'yaml':
    case 'yml':
      return [yaml()]
    case 'sql':
      return [sql()]
    default:
      return []
  }
}
