import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { applyPlan } from '../src/main/features/node-apply'
import { setEnvValue, setupEnv } from '../src/main/features/node-env'
import { ddevConfigFlags, ddevYaml, fallbackConfigFlags, prepareScript, serviceUrl, viteWrapper } from '../src/main/features/node-gen'
import {
  analyze,
  assignPorts,
  classify,
  isNodeProject,
  loadOverrides,
  parseEnvPairs,
  sanitizeOverrides,
  saveOverrides,
  serverPortFromSource,
  vitePortFromConfig
} from '../src/main/features/node-plan'
import { configureSteps } from '../src/main/features/node-steps'
import { configureVite, patchConfig, serverBlock } from '../src/main/features/node-vite'
import { nodeEn, nodeEs } from '../src/renderer/src/locales/node'
import type { NodeService } from '../src/shared/node'
import type { CreateOptions } from '../src/shared/types'

let root: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'stackyard-node-'))
})
afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

async function put(path: string, content: string): Promise<void> {
  const full = join(root, path)
  await mkdir(join(full, '..'), { recursive: true })
  await writeFile(full, content)
}
const pkg = (o: object): string => JSON.stringify(o)

/** backend/ (Express + mysql2 + bcrypt) and frontend/ (Vite). */
async function monorepo(): Promise<void> {
  await put('backend/package.json', pkg({ main: 'server.js', scripts: { dev: 'nodemon server.js' }, dependencies: { express: '4', mysql2: '3', bcrypt: '5' } }))
  await put('backend/.env.example', 'PORT=3001\nJWT_SECRET=changeme\nBASE_URL=http://localhost:3001\nFRONTEND_URL=http://localhost:5173\nSTRIPE_API_KEY=your_key_here\n')
  await put('frontend/package.json', pkg({ devDependencies: { vite: '5' }, scripts: { dev: 'vite' } }))
  await put('frontend/vite.config.js', 'import { defineConfig } from "vite"\nexport default defineConfig({\n  plugins: [],\n})\n')
  await put('frontend/.env.example', 'VITE_API_URL=http://localhost:3001\nVITE_NAME=app\n')
}

describe('parsing helpers', () => {
  it('parses env pairs with export, quotes and BOM', () => {
    expect(parseEnvPairs('﻿A=1\nexport B="two"\n# c\nC = \'3\'\nbad line')).toEqual({ A: '1', B: 'two', C: '3' })
  })
  it('finds the port in source and in a vite config', () => {
    expect(serverPortFromSource('const port = process.env.PORT || 4000')).toBe(4000)
    expect(serverPortFromSource("process.env.PORT ?? '8080'")).toBe(8080)
    expect(serverPortFromSource('listen(3000)')).toBeNull()
    expect(vitePortFromConfig('export default { server: { host: true, port: 3000 } }')).toBe(3000)
    expect(vitePortFromConfig('export default {}')).toBe(5173)
  })
  it('classifies package.json files', () => {
    expect(classify({ devDependencies: { vite: '5' } }, false)).toBe('vite')
    expect(classify({ dependencies: { fastify: '4' } }, false)).toBe('server')
    expect(classify({ scripts: { dev: 'cd backend && npm run dev' } }, true)).toBeNull()
    expect(classify({ scripts: { start: 'node app.js' } }, false)).toBe('server')
    expect(classify({ scripts: { test: 'jest' } }, false)).toBeNull()
  })
  it('replaces one env value keeping the rest of the file', () => {
    expect(setEnvValue('A=1\nexport B=old\nC=3\n', 'B', 'new')).toBe('A=1\nexport B=new\nC=3\n')
  })
})

describe('analyze', () => {
  it('detects a backend/frontend monorepo', async () => {
    await monorepo()
    expect(await isNodeProject(root)).toBe(true)
    const plan = (await analyze(root))!
    expect(plan.services.map((s) => [s.name, s.kind, s.dir, s.port])).toEqual([
      ['backend', 'server', 'backend', 3001],
      ['frontend', 'vite', 'frontend', 5173]
    ])
    expect(plan.services[0].command).toBe('npm run dev')
    expect(plan.services[1].primary).toBe(true)
    expect(plan.services[1]).toMatchObject({ httpsPort: 443, httpPort: 80, publicPort: 443 })
    expect(plan.services[0]).toMatchObject({ httpsPort: 3001, httpPort: 3002, publicPort: 3001 })
    expect(plan.database).toBe('mariadb:11.8')
    expect(plan.native).toEqual(['bcrypt'])
    expect(plan.node).toBe('24')
  })

  it('uses the other port as public one with http', async () => {
    await monorepo()
    const plan = (await analyze(root, 'http'))!
    expect(plan.services[0]).toMatchObject({ httpsPort: 3002, httpPort: 3001, publicPort: 3001 })
  })

  it('is not a Node project when it has PHP', async () => {
    await put('package.json', pkg({ devDependencies: { vite: '5' } }))
    await put('composer.json', '{}')
    expect(await isNodeProject(root)).toBe(false)
    expect(await analyze(root)).toBeNull()
  })

  it('names a single root service app, or frontend for Vite, and reads the Node version', async () => {
    await put('package.json', pkg({ dependencies: { koa: '2' }, engines: { node: '^20.1.0' }, scripts: { start: 'node index.js' } }))
    const plan = (await analyze(root))!
    expect(plan.services[0]).toMatchObject({ name: 'app', dir: '.', port: 3000, command: 'npm run start', primary: true })
    expect(plan.node).toBe('20')
  })

  it('ignores ">=" engines and prefers .nvmrc', async () => {
    await put('package.json', pkg({ dependencies: { express: '4' }, engines: { node: '>=18' } }))
    expect((await analyze(root))!.node).toBe('24')
    await put('.nvmrc', 'v22.3.0\n')
    expect((await analyze(root))!.node).toBe('22')
  })

  it('detects pnpm and apps/* workspaces', async () => {
    await put('apps/web/package.json', pkg({ devDependencies: { vite: '5' } }))
    await put('apps/api/package.json', pkg({ dependencies: { '@nestjs/core': '10' } }))
    await put('apps/api/pnpm-lock.yaml', '')
    const plan = (await analyze(root))!
    expect(plan.services.map((s) => s.name)).toEqual(['api', 'web'])
    expect(plan.services[0].pm).toBe('pnpm')
    expect(plan.yarnOrPnpm).toBe(true)
    expect(ddevConfigFlags(plan)).toContain('--corepack-enable')
  })

  it('moves a backend port that collides with a reserved one', () => {
    const svc = (name: string, kind: NodeService['kind'], port: number): NodeService => ({
      name, dir: name, kind, port, pm: 'npm', native: [], primary: false, httpsPort: null, httpPort: null, publicPort: null
    })
    const list = [svc('a', 'vite', 5173), svc('b', 'server', 8025), svc('c', 'server', 8025)]
    assignPorts(list, 'https')
    // 8025 is reserved, and so is 8036 (the +1 of 8035): the first free pair is 8045/8046, then 8055/8056
    expect(list[1].httpsPort).toBe(8045)
    expect(list[2].httpsPort).toBe(8055)
  })

  it('applies user overrides for command and port', async () => {
    await monorepo()
    const plan = (await analyze(root, 'https', { services: { backend: { command: 'node server.js', port: 4000 }, frontend: { port: 5200 } } }))!
    expect(plan.services[0]).toMatchObject({ command: 'node server.js', port: 4000, httpsPort: 4000 })
    expect(plan.services[1].port).toBe(5200)
  })
})

describe('overrides', () => {
  it('sanitizes and round-trips through .ddev/stackyard-node.json', async () => {
    expect(sanitizeOverrides({ services: { 'Bad Name': { port: 1 }, api: { port: 99999, command: 'a\nb' }, web: { port: 3000, command: ' npm start ' } } })).toEqual({
      services: { web: { port: 3000, command: 'npm start' } }
    })
    await saveOverrides(root, { services: { api: { port: 4000 } } })
    expect(await loadOverrides(root)).toEqual({ services: { api: { port: 4000 } } })
    expect(await loadOverrides(join(root, 'nope'))).toEqual({})
  })
})

describe('generators', () => {
  it('builds ddev config flags', async () => {
    await monorepo()
    const plan = (await analyze(root))!
    expect(ddevConfigFlags(plan)).toBe('--project-type=generic --webserver-type=generic --docroot= --nodejs-version=24 --database=mariadb:11.8')
    expect(ddevConfigFlags(plan, '22')).toContain('--nodejs-version=22')
    expect(fallbackConfigFlags('20')).toContain('--omit-containers=db')
    expect(serviceUrl('x', 'ddev.site', 443)).toBe('https://x.ddev.site')
    expect(serviceUrl('x', 'ddev.site', 3001)).toBe('https://x.ddev.site:3001')
    expect(serviceUrl('x', 'ddev.site', 80, 'http')).toBe('http://x.ddev.site')
  })

  it('writes daemons and exposed ports with the primary service first', async () => {
    await monorepo()
    const yaml = ddevYaml((await analyze(root))!)
    expect(yaml).toContain('  - name: backend\n    command: "npm run dev"\n    directory: /var/www/html/backend')
    expect(yaml).toContain('npx vite --config /var/www/html/.ddev/vite.frontend.ddev.config.mjs --port 5173 --strictPort')
    expect(yaml.indexOf('web_extra_exposed_ports')).toBeLessThan(yaml.indexOf('container_port: 5173'))
    expect(yaml.indexOf('container_port: 5173')).toBeLessThan(yaml.indexOf('container_port: 3001'))
    expect(yaml).toContain('https_port: 443')
    expect(yaml).toContain('stackyard-node-prepare.sh')
  })

  it('adds Chromium for Puppeteer projects', async () => {
    await put('package.json', pkg({ dependencies: { express: '4', puppeteer: '22' } }))
    const yaml = ddevYaml((await analyze(root))!)
    expect(yaml).toContain('webimage_extra_packages: [chromium, fonts-noto-color-emoji]')
    expect(yaml).toContain('PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium')
  })

  it('builds the prepare script with native module checks and LF endings only', async () => {
    await monorepo()
    const script = prepareScript((await analyze(root))!)
    expect(script.startsWith('#!/bin/bash\n')).toBe(true)
    expect(script).not.toContain('\r')
    expect(script).toContain('cd /var/www/html/backend || exit 0')
    expect(script).toContain("require('bcrypt')")
    expect(script).toContain('supervisorctl restart')
  })

  it('wraps the Vite config with the DDEV host and hot reload settings', async () => {
    await monorepo()
    const plan = (await analyze(root))!
    const wrapper = viteWrapper(plan.services[1], plan, 'ddev.site')
    expect(wrapper).toContain("import base from '../frontend/vite.config.js'")
    expect(wrapper).toContain("allowedHosts: ['.ddev.site', 'localhost']")
    expect(wrapper).toContain("protocol: 'wss'")
    expect(wrapper).toContain('clientPort: 443')
    const http = (await analyze(root, 'http'))!
    expect(viteWrapper(http.services[1], http, 'ddev.site')).toContain("protocol: 'ws'")
  })
})

describe('setupEnv', () => {
  it('creates .env files with DDEV URLs and generated secrets', async () => {
    await monorepo()
    const plan = (await analyze(root))!
    const { notes, missing } = await setupEnv(plan, 'shop', 'ddev.site')
    const env = await readFile(join(root, 'backend/.env'), 'utf8')
    expect(env).toContain('BASE_URL=https://shop.ddev.site:3001')
    expect(env).toContain('FRONTEND_URL=https://shop.ddev.site')
    expect(env).toContain('PORT=3001')
    expect(env).toMatch(/^JWT_SECRET=[0-9a-f]{64}$/m)
    expect(env).toContain('STRIPE_API_KEY=your_key_here')
    expect(missing).toEqual(['backend/.env: STRIPE_API_KEY'])
    expect(notes).toContain('backend/.env ← .env.example')
    expect(notes).toContain('backend/.env: JWT_SECRET generated')
    const local = await readFile(join(root, 'frontend/.env.development.local'), 'utf8')
    expect(local).toContain('# Generated by Stackyard')
    expect(local).toContain('VITE_API_URL=https://shop.ddev.site:3001')
    expect(local).not.toContain('VITE_NAME')
  })

  it('maps URLs of the other scheme back and keeps real secrets', async () => {
    await monorepo()
    await put('backend/.env', 'PORT=3001\nJWT_SECRET=already-a-real-secret\nBASE_URL=https://shop.ddev.site:3002\nFRONT=http://shop.ddev.site\n')
    const plan = (await analyze(root))!
    await setupEnv(plan, 'shop', 'ddev.site')
    const env = await readFile(join(root, 'backend/.env'), 'utf8')
    expect(env).toContain('JWT_SECRET=already-a-real-secret')
    expect(env).toContain('BASE_URL=https://shop.ddev.site:3001')
    expect(env).toContain('FRONT=https://shop.ddev.site')
  })

  it('never touches a Vite .env.development.local written by the user', async () => {
    await monorepo()
    await put('frontend/.env.development.local', 'VITE_API_URL=mine\n')
    await setupEnv((await analyze(root))!, 'shop', 'ddev.site')
    expect(await readFile(join(root, 'frontend/.env.development.local'), 'utf8')).toBe('VITE_API_URL=mine\n')
  })

  it('generates secrets for names used in code', async () => {
    await put('package.json', pkg({ dependencies: { express: '4' } }))
    await put('.env.example', 'PORT=3000\n')
    await put('src/auth.js', 'const s = process.env.SESSION_KEY; const k = process.env.STRIPE_SECRET_KEY')
    await setupEnv((await analyze(root))!, 'app', 'ddev.site')
    const env = await readFile(join(root, '.env'), 'utf8')
    expect(env).toMatch(/^SESSION_KEY=[0-9a-f]{64}$/m)
    expect(env).not.toContain('STRIPE_SECRET_KEY') // external secrets are never invented
  })
})

describe('applyPlan', () => {
  it('writes the DDEV files and a report', async () => {
    await monorepo()
    const plan = (await analyze(root))!
    const report = await applyPlan(plan, 'shop', 'ddev.site')
    expect(await readFile(join(root, '.ddev/config.stackyard.yaml'), 'utf8')).toContain('web_extra_daemons:')
    expect(await readFile(join(root, '.ddev/stackyard-node-prepare.sh'), 'utf8')).toContain('#!/bin/bash')
    expect(await readFile(join(root, '.ddev/vite.frontend.ddev.config.mjs'), 'utf8')).toContain('Generated by Stackyard')
    expect(report[0]).toBe('Services:')
    expect(report.join('\n')).toContain('→ https://shop.ddev.site:3001')
    expect(report.join('\n')).toContain('Node 24 · database: mariadb:11.8 · native modules: bcrypt')
  })
})

describe('Vite setup', () => {
  it('patches defineConfig and keeps a .bak copy', async () => {
    await put('vite.config.js', 'import { defineConfig } from "vite"\nexport default defineConfig({\n  plugins: [],\n})\n')
    const res = await configureVite(root)
    expect(res).toEqual({ changed: true, snippet: null })
    const text = await readFile(join(root, 'vite.config.js'), 'utf8')
    expect(text).toContain('DDEV_PRIMARY_URL_WITHOUT_PORT')
    expect(text).toContain('plugins: []')
    expect(await readFile(join(root, 'vite.config.js.bak'), 'utf8')).not.toContain('DDEV_PRIMARY_URL')
    expect(await readFile(join(root, '.ddev/config.vite.yaml'), 'utf8')).toContain('container_port: 5173')
    expect((await configureVite(root)).changed).toBe(false) // already set up
  })

  it('returns the snippet when the config has its own server block or no config exists', async () => {
    await put('vite.config.js', 'export default defineConfig({\n  server: { port: 1 },\n})\n')
    expect((await configureVite(root)).snippet).toContain('server: {')
    expect(patchConfig('export default {}', serverBlock('ddev.site'))).toBeNull()
    await rm(join(root, 'vite.config.js'))
    expect((await configureVite(root)).snippet).toContain('DDEV_PRIMARY_URL_WITHOUT_PORT')
  })

  it('escapes the TLD in the CORS regex and keeps CRLF files consistent', () => {
    expect(serverBlock('my-tld.dev')).toContain('(\\.my\\-tld\\.dev)')
    const out = patchConfig('export default defineConfig({\r\n  a: 1,\r\n})\r\n', 'x\ny\n')!
    expect(out).toContain('x\r\ny\r\n')
  })
})

describe('creation steps', () => {
  const opts = (over: Partial<CreateOptions>): CreateOptions => ({
    mode: 'existing', name: 'shop', path: root, type: '', docroot: '', php: '8.4', node: '22', webserver: 'apache-fpm', db: 'mariadb:11.8',
    scheme: 'https', scaffold: false, deps: false, phpmyadmin: false, launch: false, ...over
  })
  const run = async (steps: ReturnType<typeof configureSteps>): Promise<Array<string | undefined>> => {
    const ran: Array<string | undefined> = []
    for (const s of steps) {
      if (s.when && !(await s.when())) continue
      if (s.run) await s.run()
      if (s.command) ran.push(s.command)
    }
    return ran
  }

  it('uses the plain ddev config for a typed non-Node project', async () => {
    const steps = configureSteps(opts({ type: 'laravel' }), '--flags')
    expect(steps).toHaveLength(1)
    expect(await run(steps)).toEqual(['ddev config --flags'])
  })

  it('auto-detects a Node project and uses the dialog Node version', async () => {
    await monorepo()
    const ran = await run(configureSteps(opts({}), '--plain'))
    expect(ran).toEqual(["ddev config --project-name='shop' --project-type=generic --webserver-type=generic --docroot= --nodejs-version=22 --database=mariadb:11.8"])
    expect(await readFile(join(root, '.ddev/config.stackyard.yaml'), 'utf8')).toContain('web_extra_daemons:')
  })

  it('falls back to the plain config when auto detection finds no Node project', async () => {
    await put('index.php', '<?php')
    const ran = await run(configureSteps(opts({}), '--plain'))
    expect(ran).toEqual(['ddev config --plain'])
  })

  it('configures an explicit Node type even without detectable services', async () => {
    const ran = await run(configureSteps(opts({ type: 'node' }), '--plain'))
    expect(ran).toHaveLength(1)
    expect(ran[0]).toContain('--omit-containers=db')
    expect(ran[0]).toContain('--nodejs-version=22')
  })
})

describe('locale', () => {
  it('has the same keys in English and Spanish, all prefixed node.', () => {
    expect(Object.keys(nodeEs).sort()).toEqual(Object.keys(nodeEn).sort())
    expect(Object.keys(nodeEn).every((k) => k.startsWith('node.'))).toBe(true)
    for (const [k, v] of Object.entries(nodeEn)) {
      const vars = (s: string): string[] => (s.match(/\{\w+\}/g) ?? []).sort()
      expect(vars(nodeEs[k as keyof typeof nodeEs]), k).toEqual(vars(v))
    }
  })
})
