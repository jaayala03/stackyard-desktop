// Pure helpers of the Deploy tab (no Node or Electron imports: the renderer imports this file too).
// Port of stackyard/pm2.py: ecosystem-file discovery, summary without secrets and command building.

// pm2 accepts any of these (https://pm2.keymetrics.io/docs/usage/application-declaration/)
export const ECOSYSTEM_CANDIDATES = [
  'ecosystem.config.js',
  'ecosystem.config.cjs',
  'ecosystem.config.mjs',
  'ecosystem.config.ts',
  'ecosystem.config.json',
  'ecosystem.config.json5',
  'ecosystem.config.yaml',
  'ecosystem.config.yml',
  'ecosystem.json',
  'ecosystem.yaml',
  'ecosystem.yml',
  'ecosystem.js',
  'ecosystem.cjs',
  'ecosystem.mjs',
  'pm2.config.js',
  'pm2.config.cjs',
  'pm2.config.mjs',
  'pm2.json',
  'process.json',
  'process.yml',
  'process.yaml'
]
export const SCRIPT_EXTS = ['.js', '.cjs', '.mjs', '.ts']
const DATA_EXTS = ['.json', '.yaml', '.yml', '.json5']

export type DeployAction = 'deploy' | 'revert' | 'setup' | 'status' | 'test' | 'reload' | 'logs' | 'auth'
export const DEPLOY_ACTIONS: DeployAction[] = ['deploy', 'revert', 'setup', 'status', 'test', 'reload', 'logs', 'auth']

export interface DeployApp {
  name: string
  script: string
  args: string
  interpreter: string | null
  port: number | null
  instances: number | string
}

export interface DeployEnv {
  user: string
  hosts: string[]
  port: number | null
  ref: string
  repo: string
  path: string
  postDeploy: string
}

/** What the tab shows: never contains `env*` blocks, only names, scripts, ports and the deploy section. */
export interface DeploySummary {
  /** File name (not a path) of the ecosystem file. */
  file: string
  apps: DeployApp[]
  deploy: Record<string, DeployEnv>
  error?: string
}

/** The ecosystem file of a project from the names in its root: exact pm2 names first, then any `ecosystem*.<ext>`. */
export function findEcosystem(names: string[]): string | null {
  for (const candidate of ECOSYSTEM_CANDIDATES) if (names.includes(candidate)) return candidate
  const extOf = (n: string): string => {
    const i = n.lastIndexOf('.')
    return i < 0 ? '' : n.slice(i)
  }
  const extra = names
    .filter((n) => n.startsWith('ecosystem') && [...SCRIPT_EXTS, ...DATA_EXTS].includes(extOf(n)))
    .sort()
  return extra[0] ?? null
}

export function isScriptFile(name: string): boolean {
  return SCRIPT_EXTS.some((e) => name.endsWith(e))
}

/** Good enough for comments and trailing commas (JSON5 files are rare). Strings are respected. */
export function stripJson5(text: string): string {
  let out = ''
  let i = 0
  while (i < text.length) {
    const c = text[i]
    if (c === '"' || c === "'") {
      let j = i + 1
      while (j < text.length && text[j] !== c) j += text[j] === '\\' ? 2 : 1
      out += text.slice(i, j + 1)
      i = j + 1
    } else if (c === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++
    } else if (c === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2)
      i = end < 0 ? text.length : end + 2
    } else {
      out += c
      i++
    }
  }
  return out.replace(/,(\s*[}\]])/g, '$1')
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** Summary of an evaluated ecosystem object (`{apps: [...], deploy: {...}}`), without secrets. */
export function summarize(file: string, raw: unknown): DeploySummary {
  const data: Record<string, unknown> = isRecord(raw) ? raw : { apps: Array.isArray(raw) ? raw : [] }
  const apps: DeployApp[] = []
  for (const a of Array.isArray(data.apps) ? data.apps : []) {
    if (!isRecord(a) || !a.script) continue
    let port: number | null = null
    for (const block of ['env', 'env_development', 'env_production']) {
      const env = a[block]
      if (isRecord(env) && /^\d+$/.test(String(env.PORT ?? ''))) {
        port = Number(env.PORT)
        break
      }
    }
    const script = String(a.script)
    const args = typeof a.args === 'string' ? a.args : Array.isArray(a.args) ? a.args.map(String).join(' ') : ''
    apps.push({
      name: String(a.name || script.replace(/^.*[\\/]/, '').replace(/\.[^.]*$/, '')),
      script,
      args,
      interpreter: typeof a.interpreter === 'string' ? a.interpreter : null,
      port,
      instances: typeof a.instances === 'number' || typeof a.instances === 'string' ? a.instances : 1
    })
  }
  const deploy: Record<string, DeployEnv> = {}
  if (isRecord(data.deploy)) {
    for (const [name, d] of Object.entries(data.deploy)) {
      if (!isRecord(d)) continue
      const host = d.host
      const hosts = Array.isArray(host) ? host : host ? [host] : []
      deploy[name] = {
        user: String(d.user ?? ''),
        hosts: hosts.map(String),
        port: /^\d+$/.test(String(d.port ?? '')) ? Number(d.port) : null,
        ref: String(d.ref ?? ''),
        repo: String(d.repo ?? ''),
        path: String(d.path ?? ''),
        postDeploy: typeof d['post-deploy'] === 'string' ? d['post-deploy'] : ''
      }
    }
  }
  return { file, apps, deploy }
}

// ------------------------------------------------------------------ quoting

/** POSIX single-quote quoting: for text that a bash inside the container will parse. */
export function shq(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

/** Quotes one argument for the shell that runs host commands (PowerShell on Windows, a POSIX shell elsewhere). */
export function hostQuote(value: string, win: boolean): string {
  return win ? `'${value.replace(/'/g, "''")}'` : shq(value)
}

// ------------------------------------------------------------------ commands

/** pm2 comes from npm inside the web container; the npm cache keeps it after the first run. */
const PM2 = 'npx --yes pm2@latest'

const SAFE_TARGET = /^[A-Za-z0-9._%:[\]@-]+$/

/** `user@host` of an environment. Throws on values that could be read as ssh options or shell syntax. */
export function sshTarget(d: DeployEnv): string {
  const host = d.hosts[0] ?? ''
  const target = d.user ? `${d.user}@${host}` : host
  if (!host || target.startsWith('-') || !SAFE_TARGET.test(target)) throw new Error('Invalid server in the deploy section')
  return target
}

/** `pm2 deploy <file> <env> [setup|revert 1]`, run in the project folder inside the container. */
export function deployCmd(file: string, env: string, action?: 'setup' | 'revert 1'): string {
  return `cd /var/www/html && ${PM2} deploy ${shq(file)} ${shq(env)}${action ? ` ${action}` : ''}`
}

/** Runs `command` on the deploy server with a login shell (so pm2 is on PATH). */
export function remoteCmd(d: DeployEnv, command: string, tty = false): string {
  const opts = ['-o', 'StrictHostKeyChecking=accept-new']
  if (d.port) opts.push('-p', String(d.port))
  if (tty) opts.push('-t')
  return `ssh ${opts.join(' ')} -- ${shq(sshTarget(d))} ${shq('bash -lc ' + shq(command))}`
}

export const inContainer = (command: string, win: boolean): string => `ddev exec ${hostQuote(command, win)}`
export const inContainerTty = (command: string, win: boolean): string =>
  `ddev exec -s web --raw -- bash -c ${hostQuote(command, win)}`

export interface ActionPlan {
  /** Short English label, used as the terminal session title. */
  title: string
  /** Command line for the host shell (starts with `ddev`). */
  command: string
  /** True when the action may ask for input (passphrases, host keys) or streams until stopped. */
  interactive: boolean
}

/** Builds the command of an action from the already validated environment data. */
export function planAction(action: DeployAction, s: DeploySummary, env: string | null, win: boolean): ActionPlan {
  if (action === 'auth') return { title: 'ddev auth ssh', command: 'ddev auth ssh', interactive: true }
  if (!env || !Object.prototype.hasOwnProperty.call(s.deploy, env)) throw new Error('Unknown environment')
  const d = s.deploy[env]
  switch (action) {
    case 'deploy':
      return { title: `Deploying to ${env}`, command: inContainer(deployCmd(s.file, env), win), interactive: true }
    case 'revert':
      return { title: `Rolling back ${env}`, command: inContainer(deployCmd(s.file, env, 'revert 1'), win), interactive: true }
    case 'setup':
      return { title: `Setting up ${env}`, command: inContainer(deployCmd(s.file, env, 'setup'), win), interactive: true }
    case 'status':
      return { title: 'Status on the server', command: inContainer(remoteCmd(d, 'pm2 ls'), win), interactive: true }
    case 'test':
      return {
        title: 'Testing the SSH connection',
        command: inContainer(remoteCmd(d, 'echo connected to $(hostname) && command -v pm2'), win),
        interactive: true
      }
    case 'logs':
      return { title: 'Server logs', command: inContainerTty(remoteCmd(d, 'pm2 logs --lines 100', true), win), interactive: true }
    case 'reload': {
      const names = s.apps.map((a) => shq(a.name)).join(' ') || 'all'
      return { title: 'Reloading on the server', command: inContainer(remoteCmd(d, `pm2 reload ${names}`), win), interactive: true }
    }
    default:
      throw new Error('Unknown action')
  }
}

// ------------------------------------------------------------------ reading the ecosystem file

/** Node one-liner that prints the evaluated config as JSON (ESM or CommonJS, sync or async). */
export const EVAL_SCRIPT =
  "const {pathToFileURL}=require('url');" +
  '(async()=>{const f=process.argv[1];' +
  "let m;try{m=require(f)}catch(e){m=await import(pathToFileURL(f).href)}" +
  "let c=(m&&m.default!==undefined)?m.default:m;if(typeof c==='function')c=await c();" +
  'process.stdout.write(JSON.stringify(c))})().catch(e=>{console.error(e.message);process.exit(1)})'

/** First `vX.Y.Z` in `ddev --version` output → the web image tag; `latest` when unknown. */
export function ddevImage(versionOutput: string): string {
  const m = /v\d+\.\d+\.\d+/.exec(versionOutput)
  return `ddev/ddev-webserver:${m ? m[0] : 'latest'}`
}

/**
 * `docker` arguments that run the file with the Node of the DDEV web image: no network, project mounted
 * read-only. Used with execFile (an argument array), so the host shell never sees any of it.
 */
export function evalDockerArgs(root: string, file: string, image: string, win: boolean): string[] {
  const mount = win ? root.replace(/\\/g, '/') : root
  const flag = file.endsWith('.ts') ? 'node --experimental-strip-types -e' : 'node -e'
  const node = `${flag} ${shq(EVAL_SCRIPT)} ${shq('/app/' + file)}`
  return ['run', '--rm', '--network', 'none', '-v', `${mount}:/app:ro`, '-w', '/app', '--entrypoint', 'bash', image, '-c', node]
}

/** Last non-empty line of an error output (what node printed last), or a fallback. */
export function lastLine(text: string, fallback = 'node failed'): string {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  return lines[lines.length - 1] ?? fallback
}

/** Number of keys in DDEV's SSH agent from `ssh-add -l`, or null when it cannot be read. */
export function parseSshAdd(stdout: string, stderr: string, ok: boolean): number | null {
  if ((stdout + stderr).includes('no identities')) return 0
  if (!ok) return null
  return stdout.split(/\r?\n/).filter((l) => l.trim()).length
}
