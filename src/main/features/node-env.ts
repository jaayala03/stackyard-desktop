// .env handling for Node projects: creates the files from their examples, points local URLs to the
// DDEV ones and generates the secrets the app can create itself. Port of nodeproj.setup_env().
import { copyFile, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { NodePlan } from '../../shared/node'
import { exists, envPairs, parseEnvPairs, readText } from './node-plan'
import { GENERATED_MARK, serviceUrl } from './node-gen'
import { randomBytes } from 'node:crypto'

export const SECRET_NAME = /(SECRET|_SALT$|^SALT|SESSION_KEY|ENCRYPTION_KEY|SIGNING_KEY|COOKIE_KEY|APP_KEY)/
export const EXTERNAL_NAME = /(API_KEY|TOKEN|CLIENT_ID|CLIENT_SECRET|SITE_KEY|SECRET_KEY|DSN|WEBHOOK|PASSWORD|PRIVATE_KEY)/
export const PLACEHOLDER = /^$|^(your|change|replace|xxx|todo|example|<)|here$|_here|changeme/i
const LOCAL_URL_SRC = 'https?://(?:localhost|127\\.0\\.0\\.1|0\\.0\\.0\\.0):(\\d+)'
const CODE_EXTS = new Set(['.js', '.mjs', '.cjs', '.ts', '.mts', '.cts'])

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const ext = (name: string): string => (name.includes('.') ? name.slice(name.lastIndexOf('.')) : '')

async function walk(dir: string, out: string[], limit: number): Promise<void> {
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (out.length >= limit) return
    if (e.name === 'node_modules') continue
    const path = join(dir, e.name)
    if (e.isDirectory()) await walk(path, out, limit)
    else if (e.isFile() && CODE_EXTS.has(ext(e.name))) out.push(path)
  }
}

/** Names used as process.env.NAME in the service's source. */
export async function envNamesInCode(folder: string): Promise<Set<string>> {
  const files: string[] = []
  for (const sub of ['src', 'server', 'app', 'lib', 'config']) await walk(join(folder, sub), files, files.length + 400)
  try {
    for (const e of await readdir(folder, { withFileTypes: true })) if (e.isFile() && CODE_EXTS.has(ext(e.name))) files.push(join(folder, e.name))
  } catch {
    /* unreadable folder */
  }
  const names = new Set<string>()
  for (const f of files.slice(0, 600)) {
    const text = await readText(f)
    if (text !== null) for (const m of text.matchAll(/process\.env\.([A-Z][A-Z0-9_]+)/g)) names.add(m[1])
  }
  return names
}

/** Replaces the value of `key` in a .env text (first occurrence). */
export function setEnvValue(text: string, key: string, value: string): string {
  return text.replace(new RegExp(`^(\\s*(?:export\\s+)?${escapeRe(key)}\\s*=\\s*).*$`, 'm'), (_m, head: string) => head + value)
}

/** Creates/updates .env files. Returns the notes and the keys that need a real value. */
export async function setupEnv(plan: NodePlan, name: string, tld: string): Promise<{ notes: string[]; missing: string[] }> {
  const root = plan.root
  const notes: string[] = []
  const missing: string[] = []
  const scheme = plan.scheme
  const portUrls = new Map<number, string>()
  for (const s of plan.services) if (s.publicPort) portUrls.set(s.port, serviceUrl(name, tld, s.publicPort, scheme))
  // URLs this project already points to (previous run, maybe with the other scheme)
  const ownUrl = new RegExp(`https?://${escapeRe(name)}\\.${escapeRe(tld)}(?::(\\d+))?`, 'g')

  const toScheme = (match: string, portText?: string): string => {
    const port = portText ? Number(portText) : null
    if (port === null || port === 80 || port === 443) return serviceUrl(name, tld, scheme === 'https' ? 443 : 80, scheme)
    // 3001 <-> 3002 style pairs: map back to the service and use its public port
    for (const svc of plan.services) {
      if (svc.publicPort && (port === svc.httpsPort || port === svc.httpPort)) return serviceUrl(name, tld, svc.publicPort, scheme)
    }
    return match
  }
  const fixLocal = (value: string): string => value.replace(new RegExp(LOCAL_URL_SRC, 'g'), (m, p: string) => portUrls.get(Number(p)) ?? m)

  for (const s of plan.services) {
    if (s.kind === 'worker') continue
    const folder = join(root, s.dir)
    const dirLabel = s.dir

    if (s.kind === 'vite') {
      // Vite reads VITE_* at build time: point local URLs to DDEV in .env.development.local
      const local = join(folder, '.env.development.local')
      const current = await readText(local)
      if (current !== null && !current.startsWith(GENERATED_MARK)) continue // the user's own file
      const values: Record<string, string> = {}
      for (const src of ['.env.development', '.env', '.env.example']) {
        for (const [k, v] of Object.entries(await envPairs(join(folder, src)))) {
          const m = new RegExp(LOCAL_URL_SRC).exec(v)
          if (k.startsWith('VITE_') && m && portUrls.has(Number(m[1])) && !(k in values)) values[k] = fixLocal(v)
        }
      }
      if (Object.keys(values).length) {
        await writeFile(local, `${GENERATED_MARK}: DDEV URLs for local development\n` + Object.entries(values).map(([k, v]) => `${k}=${v}\n`).join(''))
        notes.push(`${dirLabel}/.env.development.local`)
      }
      continue
    }

    const envPath = join(folder, '.env')
    let example: string | null = null
    for (const n of ['.env.example', '.env.sample', '.env.dist']) {
      if (await exists(join(folder, n))) {
        example = n
        break
      }
    }
    if (!(await exists(envPath))) {
      if (!example) continue
      await copyFile(join(folder, example), envPath)
      notes.push(`${dirLabel}/.env ← ${example}`)
    }
    let text = (await readText(envPath)) ?? ''
    const pairs = parseEnvPairs(text)
    let changed = false

    // local URLs -> DDEV URLs (BASE_URL, FRONTEND_URL, CORS_ORIGIN…), except the service's own PORT
    for (const [key, value] of Object.entries(pairs)) {
      if (key === 'PORT') continue
      if (new RegExp(LOCAL_URL_SRC).test(value) || new RegExp(ownUrl.source).test(value)) {
        const next = fixLocal(value).replace(ownUrl, toScheme)
        if (next !== value) {
          text = setEnvValue(text, key, next)
          changed = true
        }
      }
    }

    // secrets: generate the ones the app can create itself
    const wanted = new Set([...Object.keys(pairs), ...(await envNamesInCode(folder))])
    for (const key of [...wanted].sort()) {
      const value = pairs[key]
      if (SECRET_NAME.test(key) && !EXTERNAL_NAME.test(key) && (value === undefined || PLACEHOLDER.test(value))) {
        const secret = randomBytes(32).toString('hex')
        text = value === undefined ? text.replace(/\n+$/, '') + `\n${key}=${secret}\n` : setEnvValue(text, key, secret)
        notes.push(`${dirLabel}/.env: ${key} generated`)
        changed = true
      } else if (key in pairs && EXTERNAL_NAME.test(key) && PLACEHOLDER.test(value ?? '')) {
        missing.push(`${dirLabel}/.env: ${key}`)
      }
    }
    if (changed) await writeFile(envPath, text)
  }
  return { notes, missing }
}
