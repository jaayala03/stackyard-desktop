// Pure .env parser/serializer. No Node or Electron imports: the renderer uses it too.
// Lines that are not modified are serialized byte-for-byte (comments, blanks, spacing, quotes).

export type Quote = '' | '"' | "'"

export type EnvLine =
  | { kind: 'blank'; raw: string }
  | { kind: 'comment'; raw: string }
  | { kind: 'raw'; raw: string }
  | {
      kind: 'var'
      raw: string
      indent: string
      exported: string // "export " prefix, or ''
      key: string
      eq: string // "=" with surrounding spaces
      value: string
      quote: Quote
      trailing: string // text after the value (spaces + inline comment)
      dirty: boolean
    }

export interface EnvDoc {
  lines: EnvLine[]
  eol: '\n' | '\r\n'
  finalNewline: boolean
  bom: boolean
}

export type VarLine = Extract<EnvLine, { kind: 'var' }>

export const KEY_RE = /^[A-Za-z_][A-Za-z0-9_.]*$/
const LINE_RE = /^(\s*)(export\s+)?([A-Za-z_][A-Za-z0-9_.]*)(\s*=\s*)(.*)$/
const COMMENTED_VAR_RE = /^\s*#\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_.]*)\s*=/
const SECRET_RE = /(PASSWORD|PASSWD|SECRET|KEY|TOKEN)/i
const PLAIN_RE = /^[A-Za-z0-9_./:@%+,-]*$/

export function isSecretKey(key: string): boolean {
  return SECRET_RE.test(key)
}

function parseValue(rest: string): { value: string; quote: Quote; trailing: string } {
  const first = rest[0]
  if (first === '"' || first === "'") {
    for (let i = 1; i < rest.length; i++) {
      if (first === '"' && rest[i] === '\\') {
        i++
        continue
      }
      if (rest[i] === first) {
        const inner = rest.slice(1, i)
        const value = first === '"' ? inner.replace(/\\(["\\n])/g, (_m, c: string) => (c === 'n' ? '\n' : c)) : inner
        return { value, quote: first, trailing: rest.slice(i + 1) }
      }
    }
    // unterminated quote: treat the whole thing as a plain value
  }
  const hash = rest.search(/\s#/)
  if (hash >= 0) {
    const value = rest.slice(0, hash).trimEnd()
    return { value, quote: '', trailing: rest.slice(value.length) }
  }
  const value = rest.trimEnd()
  return { value, quote: '', trailing: rest.slice(value.length) }
}

function parseLine(raw: string): EnvLine {
  if (raw.trim() === '') return { kind: 'blank', raw }
  if (raw.trimStart().startsWith('#')) return { kind: 'comment', raw }
  const m = LINE_RE.exec(raw)
  if (!m) return { kind: 'raw', raw }
  const { value, quote, trailing } = parseValue(m[5])
  return { kind: 'var', raw, indent: m[1], exported: m[2] ?? '', key: m[3], eq: m[4], value, quote, trailing, dirty: false }
}

export function parseEnv(text: string): EnvDoc {
  const bom = text.startsWith('\uFEFF')
  if (bom) text = text.slice(1)
  const eol = text.includes('\r\n') ? '\r\n' : '\n'
  if (text === '') return { lines: [], eol, finalNewline: false, bom }
  const parts = text.split(/\r?\n/)
  const finalNewline = parts[parts.length - 1] === ''
  if (finalNewline) parts.pop()
  return { lines: parts.map(parseLine), eol, finalNewline, bom }
}

/** Quote only when needed; keep the original quote style when it still works. */
export function formatValue(value: string, preferred: Quote = ''): { text: string; quote: Quote } {
  if (preferred === "'" && !value.includes("'") && !value.includes('\n')) return { text: `'${value}'`, quote: "'" }
  if (preferred === '' && PLAIN_RE.test(value)) return { text: value, quote: '' }
  if (preferred === '' && value === '') return { text: '', quote: '' }
  const escaped = value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')
  return { text: `"${escaped}"`, quote: '"' }
}

function lineText(l: EnvLine): string {
  if (l.kind !== 'var' || !l.dirty) return l.raw
  const { text } = formatValue(l.value, l.quote)
  return `${l.indent}${l.exported}${l.key}${l.eq}${text}${l.trailing}`
}

export function serializeEnv(doc: EnvDoc): string {
  if (doc.lines.length === 0) return doc.bom ? '\uFEFF' : ''
  const body = doc.lines.map(lineText).join(doc.eol) + (doc.finalNewline ? doc.eol : '')
  return (doc.bom ? '\uFEFF' : '') + body
}

export function getVars(doc: EnvDoc): VarLine[] {
  return doc.lines.filter((l): l is VarLine => l.kind === 'var')
}

export function findVar(doc: EnvDoc, key: string): VarLine | undefined {
  return getVars(doc).find((l) => l.key === key)
}

function newVar(key: string, value: string): VarLine {
  const { text, quote } = formatValue(value)
  return { kind: 'var', raw: `${key}=${text}`, indent: '', exported: '', key, eq: '=', value, quote, trailing: '', dirty: false }
}

function withLines(doc: EnvDoc, lines: EnvLine[]): EnvDoc {
  return { ...doc, lines, finalNewline: doc.finalNewline || lines.length > 0 }
}

/** Sets the value of the variable at line `index`. */
export function setValueAt(doc: EnvDoc, index: number, value: string): EnvDoc {
  const line = doc.lines[index]
  if (!line || line.kind !== 'var' || line.value === value) return doc
  const lines = doc.lines.slice()
  lines[index] = { ...line, value, dirty: true }
  return { ...doc, lines }
}

export function removeAt(doc: EnvDoc, index: number): EnvDoc {
  return { ...doc, lines: doc.lines.filter((_l, i) => i !== index) }
}

/**
 * Sets `key`: updates the first active definition, else replaces a commented-out
 * `# KEY=...` line, else appends at the end.
 */
export function setVar(doc: EnvDoc, key: string, value: string): EnvDoc {
  const idx = doc.lines.findIndex((l) => l.kind === 'var' && l.key === key)
  if (idx >= 0) return setValueAt(doc, idx, value)
  const commented = doc.lines.findIndex((l) => l.kind === 'comment' && COMMENTED_VAR_RE.exec(l.raw)?.[1] === key)
  if (commented >= 0) {
    const lines = doc.lines.slice()
    lines[commented] = newVar(key, value)
    return { ...doc, lines }
  }
  return withLines(doc, [...doc.lines, newVar(key, value)])
}

/** Adds the variables of `example` that `doc` lacks (copying the example's raw lines). */
export function syncFromExample(doc: EnvDoc, example: EnvDoc): { doc: EnvDoc; added: string[] } {
  const have = new Set(getVars(doc).map((l) => l.key))
  const missing = getVars(example).filter((l) => !have.has(l.key))
  if (missing.length === 0) return { doc, added: [] }
  const lines = doc.lines.slice()
  if (lines.length > 0 && lines[lines.length - 1].kind !== 'blank') lines.push({ kind: 'blank', raw: '' })
  for (const l of missing) lines.push({ ...l })
  return { doc: withLines(doc, lines), added: missing.map((l) => l.key) }
}

/** `mariadb:11.8` → port 3306 / mysql; `postgres:17` → 5432 / pgsql. */
export function ddevDbValues(dbSpec: string): Record<string, string> {
  const postgres = dbSpec.startsWith('postgres')
  return {
    DB_CONNECTION: postgres ? 'pgsql' : 'mysql',
    DB_HOST: 'db',
    DB_PORT: postgres ? '5432' : '3306',
    DB_DATABASE: 'db',
    DB_USERNAME: 'db',
    DB_PASSWORD: 'db'
  }
}

export function hasDbVars(doc: EnvDoc): boolean {
  return getVars(doc).some((l) => l.key.startsWith('DB_'))
}

export function fillDdevDb(doc: EnvDoc, dbSpec: string): { doc: EnvDoc; changed: string[] } {
  let next = doc
  const changed: string[] = []
  for (const [key, value] of Object.entries(ddevDbValues(dbSpec))) {
    const before = serializeEnv(next)
    next = setVar(next, key, value)
    if (serializeEnv(next) !== before) changed.push(key)
  }
  return { doc: next, changed }
}
