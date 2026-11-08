// "Set up Vite" for DDEV: exposes port 5173 and adds a server block to vite.config. Port of stackyard/vite.py.
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parse } from 'yaml'
import type { ViteStatus } from '../../shared/node'
import { projectTld } from '../ddev'
import { exists, readText } from './node-plan'

export const CONFIG_NAMES = ['vite.config.js', 'vite.config.ts', 'vite.config.mjs', 'vite.config.mts', 'vite.config.cjs']
export const DDEV_FILE = 'config.vite.yaml'
export const PORT = 5173

export const DDEV_YAML = `# Added by Stackyard: exposes the Vite dev server (HMR) through DDEV.
web_extra_exposed_ports:
  - name: vite
    container_port: ${PORT}
    http_port: ${PORT - 1}
    https_port: ${PORT}
`

export function serverBlock(tld: string): string {
  const tldRe = tld.replace(/[.*+?^${}()|[\]\\/-]/g, '\\$&')
  return (
    '    server: {\n' +
    '        // Added by Stackyard: serve HMR through the DDEV URL\n' +
    "        host: '0.0.0.0',\n" +
    `        port: ${PORT},\n` +
    '        strictPort: true,\n' +
    '        origin: `${process.env.DDEV_PRIMARY_URL_WITHOUT_PORT}:' +
    PORT +
    '`,\n' +
    `        cors: { origin: /https?:\\/\\/([A-Za-z0-9\\-\\.]+)?(\\.${tldRe})(?::\\d+)?$/ },\n` +
    '    },\n'
  )
}

async function projectTldOf(root: string): Promise<string> {
  try {
    const cfg = parse((await readText(join(root, '.ddev', 'config.yaml'))) ?? '') ?? {}
    if (cfg.project_tld) return String(cfg.project_tld)
  } catch {
    /* use the global one */
  }
  return projectTld()
}

export async function findConfig(root: string): Promise<string | null> {
  for (const name of CONFIG_NAMES) if (await exists(join(root, name))) return name
  return null
}

export async function viteStatus(root: string): Promise<ViteStatus> {
  const config = await findConfig(root)
  const text = config ? await readText(join(root, config)) : null
  return {
    config,
    ddevReady: await exists(join(root, '.ddev', DDEV_FILE)),
    viteReady: !!text && text.includes('DDEV_PRIMARY_URL')
  }
}

/** Inserts the server block after `defineConfig({`; null when that is not possible safely. */
export function patchConfig(text: string, block: string): string | null {
  if (text.includes('DDEV_PRIMARY_URL')) return text
  if (/^\s*server\s*:/m.test(text)) return null // the project already has a server block
  const m = /defineConfig\(\s*(?:\([^)]*\)\s*=>\s*\(?\s*)?\{\s*\n/.exec(text)
  if (!m) return null
  const eol = text.includes('\r\n') ? block.replace(/\n/g, '\r\n') : block
  return text.slice(0, m.index + m[0].length) + eol + text.slice(m.index + m[0].length)
}

/** Applies both changes. `snippet` is set when vite.config has to be edited by hand. */
export async function configureVite(root: string): Promise<{ changed: boolean; snippet: string | null }> {
  await mkdir(join(root, '.ddev'), { recursive: true })
  await writeFile(join(root, '.ddev', DDEV_FILE), DDEV_YAML)

  const config = await findConfig(root)
  const block = serverBlock(await projectTldOf(root))
  if (!config) return { changed: false, snippet: block }
  const path = join(root, config)
  const text = (await readText(path)) ?? ''
  if (text.includes('DDEV_PRIMARY_URL')) return { changed: false, snippet: null }
  const patched = patchConfig(text, block)
  if (patched === null) return { changed: false, snippet: block }
  await writeFile(path + '.bak', text)
  await writeFile(path, patched)
  return { changed: true, snippet: null }
}
