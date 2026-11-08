import { execFile } from 'node:child_process'
import { access, readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { parse } from 'yaml'
import type { Project, ToolStatus } from '../shared/types'

const run = promisify(execFile)

export class DdevError extends Error {}

interface RawProject {
  name?: string
  status?: string
  approot?: string
  type?: string
  primary_url?: string
  httpurl?: string
  httpsurl?: string
}

/** `ddev list -j` prints one JSON object per line; the projects are in its `raw` field. */
export function parseList(stdout: string): RawProject[] {
  for (const line of stdout.split(/\r?\n/)) {
    const text = line.trim()
    if (!text.startsWith('{')) continue
    try {
      const data = JSON.parse(text)
      if ('raw' in data) return Array.isArray(data.raw) ? data.raw : []
    } catch {
      /* not JSON, keep looking */
    }
  }
  throw new DdevError('ddev returned no data')
}

export interface ProjectConfig {
  type: string
  docroot: string
  php: string
  node: string
  webserver: string
  db: string
}

export function parseConfig(text: string): ProjectConfig {
  let cfg: Record<string, any> = {}
  try {
    cfg = parse(text) ?? {}
  } catch {
    /* keep defaults */
  }
  const db = cfg.database ?? {}
  return {
    type: cfg.type ?? '',
    docroot: cfg.docroot ?? '',
    php: String(cfg.php_version ?? ''),
    node: String(cfg.nodejs_version ?? ''),
    webserver: cfg.webserver_type ?? 'nginx-fpm',
    db: `${db.type ?? 'mariadb'}:${db.version ?? ''}`.replace(/:$/, '')
  }
}

async function readConfig(approot: string): Promise<ProjectConfig> {
  try {
    return parseConfig(await readFile(join(approot, '.ddev', 'config.yaml'), 'utf8'))
  } catch {
    return parseConfig('')
  }
}

export async function listProjects(): Promise<Project[]> {
  let stdout: string
  try {
    const res = await run('ddev', ['list', '-j'], { timeout: 60_000, windowsHide: true })
    stdout = res.stdout
  } catch (e: any) {
    throw new DdevError(e?.stderr || e?.message || 'ddev failed')
  }
  const projects = await Promise.all(
    parseList(stdout).map(async (p): Promise<Project> => {
      const cfg = await readConfig(p.approot ?? '')
      return {
        name: p.name ?? '',
        status: p.status ?? '',
        approot: p.approot ?? '',
        primaryUrl: p.primary_url ?? p.httpsurl ?? p.httpurl ?? '',
        httpUrl: p.httpurl ?? '',
        httpsUrl: p.httpsurl ?? '',
        ...cfg,
        type: cfg.type || p.type || ''
      }
    })
  )
  return projects.sort((a, b) => a.name.localeCompare(b.name))
}

export async function tools(): Promise<ToolStatus> {
  const probe = async (cmd: string, args: string[]): Promise<string | null> => {
    try {
      return (await run(cmd, args, { timeout: 15_000, windowsHide: true })).stdout.trim()
    } catch {
      return null
    }
  }
  const [ddev, docker] = await Promise.all([probe('ddev', ['--version']), probe('docker', ['--version'])])
  return { ddev: ddev !== null, docker: docker !== null, ddevVersion: ddev ?? '' }
}

const MARKERS: Array<[string[], string, string]> = [
  [['artisan'], 'laravel', 'public'],
  [['wp-config.php'], 'wordpress', ''],
  [['wp-content'], 'wordpress', ''],
  [['web/core'], 'drupal11', 'web'],
  [['symfony.lock'], 'symfony', 'public'],
  [['bin/console', 'public/index.php'], 'symfony', 'public'],
  [['spark'], 'codeigniter', 'public'],
  [['craft'], 'craftcms', 'web'],
  [['bin/cake'], 'cakephp', 'webroot'],
  [['bin/magento'], 'magento2', 'pub']
]

async function has(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

/** Best guess of (project type, docroot) from the files in `path`. */
export async function detectType(path: string): Promise<{ type: string; docroot: string }> {
  for (const [files, type, docroot] of MARKERS) {
    const found = await Promise.all(files.map((f) => has(join(path, f))))
    if (found.every(Boolean)) return { type, docroot }
  }
  if (await has(join(path, 'public', 'index.php'))) return { type: 'php', docroot: 'public' }
  return { type: '', docroot: '' }
}

export async function projectTld(): Promise<string> {
  try {
    const cfg = parse(await readFile(join(homedir(), '.ddev', 'global_config.yaml'), 'utf8')) ?? {}
    return cfg.project_tld || 'ddev.site'
  } catch {
    return 'ddev.site'
  }
}
