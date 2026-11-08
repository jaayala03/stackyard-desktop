// Analysis of Node.js projects (Express/Fastify/… backends, Vite frontends, monorepos with
// backend/ and frontend/ folders). Port of the analysis half of stackyard/nodeproj.py.
import { access, mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'
import type { NodeOverrides, NodePlan, NodeService, PackageManager } from '../../shared/node'

export const SKIP_DIRS = new Set(['node_modules', '.git', '.ddev', 'vendor', 'dist', 'build', '.next', '.nuxt', 'coverage', '.cache'])
export const SERVER_DEPS = ['express', 'fastify', 'koa', 'hono', '@nestjs/core', '@hapi/hapi', 'restify', '@adonisjs/core', 'polka']
export const FRONTEND_DEPS = ['vite']
export const DB_DEPS: Record<string, string> = {
  mysql2: 'mariadb:11.8',
  mysql: 'mariadb:11.8',
  mariadb: 'mariadb:11.8',
  pg: 'postgres:17',
  postgres: 'postgres:17'
}
export const NATIVE_DEPS = ['bcrypt', 'sqlite3', 'better-sqlite3', 'sharp', 'canvas', 'argon2', 'node-sass', 'bufferutil', 'utf-8-validate']
export const PUPPETEER_DEPS = ['puppeteer', 'puppeteer-core']
export const RESERVED_PORTS = new Set([80, 443, 8025, 8026, 8036, 8037, 8142, 8143])
export const OVERRIDES_FILE = join('.ddev', 'stackyard-node.json')

export interface PackageJson {
  main?: unknown
  scripts?: Record<string, unknown>
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  engines?: { node?: unknown }
}

// ------------------------------------------------------------------ file helpers
export async function exists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

/** Reads a text file without its UTF-8 BOM (saved by some Windows editors); null if unreadable. */
export async function readText(path: string): Promise<string | null> {
  try {
    return (await readFile(path, 'utf8')).replace(/^﻿/, '')
  } catch {
    return null
  }
}

async function readJson(path: string): Promise<PackageJson> {
  const text = await readText(path)
  if (text === null) return {}
  try {
    const data = JSON.parse(text)
    return data && typeof data === 'object' ? data : {}
  } catch {
    return {}
  }
}

async function isDir(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory()
  } catch {
    return false
  }
}

async function subdirs(dir: string): Promise<string[]> {
  try {
    const names = (await readdir(dir)).sort()
    const out: string[] = []
    for (const name of names) if (await isDir(join(dir, name))) out.push(name)
    return out
  } catch {
    return []
  }
}

async function filesMatching(dir: string, re: RegExp, limit: number): Promise<string[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true })
    return entries
      .filter((e) => e.isFile() && re.test(e.name))
      .map((e) => join(dir, e.name))
      .sort()
      .slice(0, limit)
  } catch {
    return []
  }
}

/** KEY=value pairs of a .env file text (export prefix and surrounding quotes handled). */
export function parseEnvPairs(text: string): Record<string, string> {
  const pairs: Record<string, string> = {}
  for (const line of text.replace(/^﻿/, '').split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line)
    if (m) pairs[m[1]] = m[2].trim().replace(/^['"]+|['"]+$/g, '')
  }
  return pairs
}

export async function envPairs(path: string): Promise<Record<string, string>> {
  const text = await readText(path)
  return text === null ? {} : parseEnvPairs(text)
}

// ------------------------------------------------------------------ classification
export const depsOf = (pkg: PackageJson): Record<string, string> => ({ ...pkg.dependencies, ...pkg.devDependencies })

/** 'vite' for frontends, 'server' for backends/scripts, null when the folder is not a service. */
export function classify(pkg: PackageJson, isRoot: boolean): 'vite' | 'server' | null {
  const deps = depsOf(pkg)
  const scripts = Object.values(pkg.scripts ?? {}).map(String)
  if (FRONTEND_DEPS.some((d) => d in deps)) return 'vite'
  if (SERVER_DEPS.some((d) => d in deps)) return 'server'
  // an orchestrating root ("cd backend && …", concurrently) is not a service
  if (isRoot && scripts.some((v) => v.includes('cd ') || v.includes('concurrently'))) return null
  if (pkg.scripts && ('dev' in pkg.scripts || 'start' in pkg.scripts)) return 'server'
  return null
}

async function packageManager(folder: string, root: string): Promise<PackageManager> {
  for (const d of [folder, root]) {
    if (await exists(join(d, 'pnpm-lock.yaml'))) return 'pnpm'
    if (await exists(join(d, 'yarn.lock'))) return 'yarn'
  }
  return 'npm'
}

export function serverPortFromSource(text: string): number | null {
  const m = /process\.env\.PORT\s*(?:\|\||\?\?)\s*['"]?(\d{2,5})/.exec(text)
  return m ? Number(m[1]) : null
}

async function serverPort(folder: string, pkg: PackageJson): Promise<number> {
  for (const name of ['.env', '.env.example', '.env.local', '.env.development']) {
    const port = (await envPairs(join(folder, name))).PORT
    if (port && /^\d+$/.test(port)) return Number(port)
  }
  // process.env.PORT || 3001 in the entry point or src/
  const main = typeof pkg.main === 'string' ? pkg.main : 'index.js'
  const candidates = [
    join(folder, main),
    ...(await filesMatching(join(folder, 'src'), /\.[jt]s$/, 20)),
    ...(await filesMatching(folder, /\.[jt]s$/, 10))
  ]
  for (const file of candidates) {
    const text = await readText(file)
    const port = text === null ? null : serverPortFromSource(text)
    if (port !== null) return port
  }
  return 3000
}

const VITE_CONFIGS = ['vite.config.js', 'vite.config.mjs', 'vite.config.ts', 'vite.config.mts', 'vite.config.cjs']

export function vitePortFromConfig(text: string): number {
  const m = /server\s*:\s*\{[^}]*?port\s*:\s*(\d{2,5})/.exec(text)
  return m ? Number(m[1]) : 5173
}

async function vitePort(folder: string): Promise<{ port: number; config: string | null }> {
  for (const name of VITE_CONFIGS) {
    const text = await readText(join(folder, name))
    if (text !== null) return { port: vitePortFromConfig(text), config: name }
  }
  return { port: 5173, config: null }
}

/** Major Node version from .nvmrc / package.json engines of the folders; defaults to the newest LTS. */
export async function nodeMajor(folders: string[]): Promise<string> {
  for (const folder of folders) {
    const nvmrc = await readText(join(folder, '.nvmrc'))
    if (nvmrc !== null) {
      const m = /(\d+)/.exec(nvmrc)
      if (m) return m[1]
    }
    const engines = (await readJson(join(folder, 'package.json'))).engines
    const spec = String(engines && typeof engines === 'object' ? (engines.node ?? '') : '').trim()
    const m = /(\d+)/.exec(spec)
    // ">=18" is a minimum: the newest LTS satisfies it; "18.x", "^20", "~22" pin a major
    if (m && !spec.startsWith('>') && Number(m[1]) >= 18) return m[1]
  }
  return '24'
}

/** The root plus first- and second-level folders with a package.json (backend/, frontend/, apps/web/). */
export async function packageDirs(root: string): Promise<string[]> {
  const dirs: string[] = []
  if (await exists(join(root, 'package.json'))) dirs.push(root)
  for (const name of await subdirs(root)) {
    if (SKIP_DIRS.has(name) || name.startsWith('.')) continue
    const child = join(root, name)
    if (await exists(join(child, 'package.json'))) dirs.push(child)
    else if (['apps', 'packages', 'services'].includes(name)) {
      for (const g of await subdirs(child)) if (await exists(join(child, g, 'package.json'))) dirs.push(join(child, g))
    }
  }
  return dirs
}

export async function isNodeProject(root: string): Promise<boolean> {
  if ((await exists(join(root, 'composer.json'))) || (await exists(join(root, 'artisan')))) return false
  try {
    if ((await readdir(root)).some((n) => n.endsWith('.php'))) return false
  } catch {
    return false
  }
  for (const dir of await packageDirs(root)) {
    if (classify(await readJson(join(dir, 'package.json')), dir === root)) return true
  }
  return false
}

// ------------------------------------------------------------------ ports
/**
 * Gives every service its public ports. The frontend (or the only service) takes the main URL on
 * 80/443; the others keep their own port for the chosen scheme and port+1 for the other one.
 */
export function assignPorts(services: NodeService[], scheme: 'https' | 'http'): void {
  const primary = services.find((s) => s.kind === 'vite') ?? services[0]
  const taken = new Set(RESERVED_PORTS)
  for (const s of services) {
    s.primary = s === primary
    if (s.kind === 'worker') {
      s.httpsPort = s.httpPort = s.publicPort = null
      continue
    }
    if (s.primary) {
      s.httpsPort = 443
      s.httpPort = 80
    } else {
      let port = s.port
      while (taken.has(port) || taken.has(port + 1)) port += 10
      if (scheme === 'https') [s.httpsPort, s.httpPort] = [port, port + 1]
      else [s.httpsPort, s.httpPort] = [port + 1, port]
      taken.add(port)
      taken.add(port + 1)
    }
    s.publicPort = scheme === 'https' ? s.httpsPort : s.httpPort
  }
}

// ------------------------------------------------------------------ overrides
export function sanitizeOverrides(input: unknown): NodeOverrides {
  const out: NodeOverrides = {}
  const services = (input as NodeOverrides | null)?.services
  if (!services || typeof services !== 'object') return out
  const clean: NonNullable<NodeOverrides['services']> = {}
  for (const [name, v] of Object.entries(services)) {
    if (!/^[a-z0-9][a-z0-9-]*$/.test(name) || !v || typeof v !== 'object') continue
    const item: { command?: string; port?: number } = {}
    if (typeof v.command === 'string' && v.command.trim() && !/[\r\n]/.test(v.command)) item.command = v.command.trim()
    if (Number.isInteger(v.port) && (v.port as number) >= 1 && (v.port as number) <= 65535) item.port = v.port
    if (item.command !== undefined || item.port !== undefined) clean[name] = item
  }
  if (Object.keys(clean).length) out.services = clean
  return out
}

export async function loadOverrides(root: string): Promise<NodeOverrides> {
  const text = await readText(join(root, OVERRIDES_FILE))
  if (text === null) return {}
  try {
    return sanitizeOverrides(JSON.parse(text))
  } catch {
    return {}
  }
}

export async function saveOverrides(root: string, overrides: unknown): Promise<NodeOverrides> {
  const clean = sanitizeOverrides(overrides)
  await mkdir(join(root, '.ddev'), { recursive: true })
  await writeFile(join(root, OVERRIDES_FILE), JSON.stringify(clean, null, 2) + '\n')
  return clean
}

// ------------------------------------------------------------------ analysis
const slugName = (text: string): string => text.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '')

/** The plan for the project at `root`, or null when it is not a Node project. */
export async function analyze(root: string, scheme: 'https' | 'http' = 'https', overrides: NodeOverrides = {}): Promise<NodePlan | null> {
  if (!(await isNodeProject(root))) return null
  const services: NodeService[] = []
  const used = new Set<string>()
  const allDeps: Record<string, string> = {}
  const folders = await packageDirs(root)

  for (const folder of folders) {
    const pkg = await readJson(join(folder, 'package.json'))
    const kind = classify(pkg, folder === root)
    if (!kind) continue
    const deps = depsOf(pkg)
    Object.assign(allDeps, deps)
    const dir = folder === root ? '.' : relative(root, folder).split(sep).join('/')
    const folderName = folder.split(/[\\/]/).pop() ?? ''
    let name = slugName(folder === root ? (kind === 'vite' ? 'frontend' : 'app') : folderName) || 'app'
    while (used.has(name)) name += '-2'
    used.add(name)
    const pm = await packageManager(folder, root)
    const native = NATIVE_DEPS.filter((d) => d in deps)
    const base = { name, dir, pm, native, primary: false, httpsPort: null, httpPort: null, publicPort: null }
    if (kind === 'vite') {
      const { port, config } = await vitePort(folder)
      services.push({ ...base, kind, port, viteConfig: config })
    } else {
      const scripts = pkg.scripts ?? {}
      const script = 'dev' in scripts ? 'dev' : 'start' in scripts ? 'start' : null
      const main = typeof pkg.main === 'string' ? pkg.main : 'index.js'
      services.push({ ...base, kind, port: await serverPort(folder, pkg), command: script ? `${pm} run ${script}` : `node ${main}` })
    }
  }
  if (!services.length) return null

  for (const s of services) {
    const o = overrides.services?.[s.name]
    if (!o) continue
    if (o.command && s.kind !== 'vite') s.command = o.command
    if (o.port) s.port = o.port
  }
  assignPorts(services, scheme)

  const database = Object.entries(DB_DEPS).find(([dep]) => dep in allDeps)?.[1] ?? null
  return {
    root,
    scheme,
    services,
    node: await nodeMajor([root, ...services.map((s) => join(root, s.dir))]),
    database,
    puppeteer: PUPPETEER_DEPS.some((d) => d in allDeps),
    native: NATIVE_DEPS.filter((d) => d in allDeps).sort(),
    yarnOrPnpm: services.some((s) => s.pm !== 'npm')
  }
}
