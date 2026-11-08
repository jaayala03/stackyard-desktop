// Pure helpers for the share tab. No Node or Electron imports: the renderer uses them too.

export type ShareProvider = 'cloudflared' | 'ngrok'

export const PROVIDERS: ShareProvider[] = ['cloudflared', 'ngrok']

export interface ShareStatus {
  running: boolean
  provider: ShareProvider | null
  url: string | null
  /** Last output lines (ANSI stripped, tokens redacted). */
  log: string[]
  /** Exit code of the last finished run, or null while running / never run. */
  exitCode: number | null
}

export interface ShareProviders {
  cloudflared: boolean
  ngrok: boolean
}

export const MAX_LOG_LINES = 300

/** Public tunnel hosts printed by `ddev share` (cloudflared quick tunnels and ngrok). */
const URL_RE = /https:\/\/[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.(?:trycloudflare\.com|ngrok(?:-free)?\.(?:app|dev|io)|ngrok\.io)\b/i

// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g

export function stripAnsi(text: string): string {
  return text.replace(ANSI_RE, '')
}

/** First public tunnel URL found in `text`, or null. */
export function findUrl(text: string): string | null {
  const m = URL_RE.exec(stripAnsi(text ?? ''))
  return m ? m[0] : null
}

/** Hides anything that looks like an ngrok authtoken so it never reaches the log view. */
export function redactSecrets(line: string): string {
  return line
    .replace(/(NGROK_AUTHTOKEN\s*[=:]\s*)\S+/gi, '$1[hidden]')
    .replace(/(--authtoken[= ])\S+/gi, '$1[hidden]')
    .replace(/(authtoken["']?\s*[=:]\s*["']?)[A-Za-z0-9_-]{16,}/gi, '$1[hidden]')
}

/** Splits a chunk of process output into clean lines (carriage returns count as breaks). */
export function toLines(chunk: string): string[] {
  return stripAnsi(chunk)
    .split(/\r\n|\r|\n/)
    .map((l) => redactSecrets(l.trimEnd()))
    .filter((l) => l.trim() !== '')
}

/** Appends lines to the log keeping only the newest `max`. */
export function appendLog(log: string[], lines: string[], max = MAX_LOG_LINES): string[] {
  const next = log.concat(lines)
  return next.length > max ? next.slice(next.length - max) : next
}

export function isProvider(value: unknown): value is ShareProvider {
  return value === 'cloudflared' || value === 'ngrok'
}

/** cloudflared quick tunnels need no account, so they win when both are installed. */
export function pickProvider(available: ShareProviders): ShareProvider | null {
  if (available.cloudflared) return 'cloudflared'
  if (available.ngrok) return 'ngrok'
  return null
}

export function shareArgs(provider: ShareProvider): string[] {
  return ['share', `--provider=${provider}`]
}

/** ngrok authtokens are alphanumeric with underscores/dashes; reject anything else (it goes into an argument). */
export function validToken(token: unknown): token is string {
  return typeof token === 'string' && /^[A-Za-z0-9_-]{16,200}$/.test(token)
}

export function tokenArgs(token: string): string[] {
  return ['config', 'global', `--web-environment-add=NGROK_AUTHTOKEN=${token}`]
}

/** How to get cloudflared on this platform: a command to copy when there is a one-liner, else a docs link. */
export function installHint(platform: string): { command: string | null; url: string } {
  const url = 'https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/'
  if (platform === 'win32') return { command: 'winget install --id Cloudflare.cloudflared', url }
  if (platform === 'darwin') return { command: 'brew install cloudflared', url }
  return { command: null, url }
}

export const NGROK_DOCS_URL = 'https://ddev.readthedocs.io/en/stable/users/topics/sharing/'
