import { describe, expect, it } from 'vitest'
import {
  ddevImage,
  deployCmd,
  evalDockerArgs,
  findEcosystem,
  hostQuote,
  lastLine,
  parseSshAdd,
  planAction,
  remoteCmd,
  shq,
  sshTarget,
  stripJson5,
  summarize,
  type DeployEnv,
  type DeploySummary
} from '../src/main/features/deploy-parse'
import { deployEn, deployEs } from '../src/renderer/src/locales/deploy'

const env = (over: Partial<DeployEnv> = {}): DeployEnv => ({
  user: 'deploy',
  hosts: ['example.com'],
  port: null,
  ref: 'origin/main',
  repo: 'git@github.com:me/app.git',
  path: '/var/www/app',
  postDeploy: 'npm ci && pm2 reload ecosystem.config.js',
  ...over
})

const summary = (over: Partial<DeploySummary> = {}): DeploySummary => ({
  file: 'ecosystem.config.js',
  apps: [{ name: 'api', script: 'server.js', args: '', interpreter: null, port: 3000, instances: 1 }],
  deploy: { production: env(), staging: env({ hosts: ['stg.example.com'], port: 2222 }) },
  ...over
})

/** Minimal parsers of one quoted word, to check quoting by round trip. */
function unquotePosix(word: string): string {
  let out = ''
  for (let i = 0; i < word.length; ) {
    if (word[i] === "'") {
      const end = word.indexOf("'", i + 1)
      out += word.slice(i + 1, end)
      i = end + 1
    } else if (word[i] === '\\') {
      out += word[i + 1]
      i += 2
    } else throw new Error(`unquoted character ${word[i]}`)
  }
  return out
}
const unquotePowerShell = (word: string): string => word.slice(1, -1).replace(/''/g, "'")

describe('findEcosystem', () => {
  it('prefers the exact pm2 names, in pm2 priority order', () => {
    expect(findEcosystem(['package.json', 'ecosystem.json', 'ecosystem.config.cjs'])).toBe('ecosystem.config.cjs')
  })
  it('falls back to any ecosystem*.<known extension>', () => {
    expect(findEcosystem(['ecosystem.prod.js', 'readme.md'])).toBe('ecosystem.prod.js')
    expect(findEcosystem(['ecosystem.txt', 'ecosystem'])).toBeNull()
  })
  it('returns null when there is none', () => {
    expect(findEcosystem(['package.json', 'index.js'])).toBeNull()
  })
})

describe('stripJson5', () => {
  it('removes comments and trailing commas but keeps strings', () => {
    const text = '{\n // line\n "url": "http://x.com//a", /* block */ "list": [1, 2,],\n}'
    expect(JSON.parse(stripJson5(text))).toEqual({ url: 'http://x.com//a', list: [1, 2] })
  })
})

describe('summarize', () => {
  const raw = {
    apps: [
      { name: 'api', script: './server.js', args: ['--a', 'b'], env: { PORT: '3000', DB_PASSWORD: 'secret' }, instances: 'max' },
      { script: 'worker.js' },
      { name: 'no-script' },
      'junk'
    ],
    deploy: {
      production: { user: 'deploy', host: ['a.com', 'b.com'], port: '2200', ref: 'origin/main', repo: 'git@x:y.git', path: '/srv', 'post-deploy': 'npm ci' },
      broken: 'nope'
    }
  }
  it('extracts apps, ports and the deploy section', () => {
    const s = summarize('ecosystem.config.js', raw)
    expect(s.apps.map((a) => a.name)).toEqual(['api', 'worker'])
    expect(s.apps[0]).toMatchObject({ args: '--a b', port: 3000, instances: 'max' })
    expect(s.deploy.production).toMatchObject({ hosts: ['a.com', 'b.com'], port: 2200, postDeploy: 'npm ci' })
    expect(Object.keys(s.deploy)).toEqual(['production'])
  })
  it('never carries env values (secrets)', () => {
    expect(JSON.stringify(summarize('f', raw))).not.toContain('secret')
  })
  it('accepts a bare array of apps and a single host string', () => {
    expect(summarize('f', [{ script: 'a.js' }]).apps).toHaveLength(1)
    expect(summarize('f', { deploy: { p: { host: 'h.com' } } }).deploy.p.hosts).toEqual(['h.com'])
  })
  it('survives garbage', () => {
    expect(summarize('f', null)).toEqual({ file: 'f', apps: [], deploy: {} })
  })
})

describe('quoting', () => {
  it('quotes for POSIX and PowerShell', () => {
    expect(shq("it's")).toBe(`'it'\\''s'`)
    expect(hostQuote("it's", true)).toBe("'it''s'")
    expect(hostQuote("it's", false)).toBe(shq("it's"))
  })
})

describe('sshTarget', () => {
  it('joins user and first host', () => {
    expect(sshTarget(env())).toBe('deploy@example.com')
    expect(sshTarget(env({ user: '' }))).toBe('example.com')
  })
  it('rejects option-like and shell-like targets', () => {
    expect(() => sshTarget(env({ hosts: ['-oProxyCommand=evil'], user: '' }))).toThrow()
    expect(() => sshTarget(env({ user: '-x' }))).toThrow()
    expect(() => sshTarget(env({ hosts: ['a.com; rm -rf /'] }))).toThrow()
    expect(() => sshTarget(env({ hosts: [] }))).toThrow()
  })
})

describe('commands', () => {
  it('builds pm2 deploy for the container', () => {
    expect(deployCmd('ecosystem.config.js', 'production')).toBe(
      "cd /var/www/html && npx --yes pm2@latest deploy 'ecosystem.config.js' 'production'"
    )
    expect(deployCmd('e.js', 'staging', 'revert 1')).toMatch(/'staging' revert 1$/)
    expect(deployCmd('e.js', 'staging', 'setup')).toMatch(/'staging' setup$/)
  })
  it('wraps remote commands with ssh options, port, tty and `--`', () => {
    const cmd = remoteCmd(env({ port: 2222 }), 'pm2 ls', true)
    expect(cmd).toBe(`ssh -o StrictHostKeyChecking=accept-new -p 2222 -t -- 'deploy@example.com' ${shq('bash -lc ' + shq('pm2 ls'))}`)
    expect(remoteCmd(env(), 'pm2 ls')).not.toContain(' -t ')
  })
  it('quotes single quotes in the remote command', () => {
    expect(remoteCmd(env(), "echo 'hi'")).toContain(`'\\''hi'\\''`)
  })
})

describe('planAction', () => {
  it('runs deploy, revert and setup in the container', () => {
    expect(planAction('deploy', summary(), 'production', false).command).toMatch(/^ddev exec 'cd \/var\/www\/html && npx/)
    expect(planAction('revert', summary(), 'production', false).command).toContain('revert 1')
    expect(planAction('setup', summary(), 'production', false).command).toContain('setup')
  })
  it('uses the port of the chosen environment for remote actions', () => {
    expect(planAction('status', summary(), 'staging', false).command).toContain('-p 2222')
    expect(planAction('status', summary(), 'production', false).command).not.toContain('-p ')
  })
  it('streams logs with a raw tty session', () => {
    const plan = planAction('logs', summary(), 'production', false)
    expect(plan.command).toMatch(/^ddev exec -s web --raw -- bash -c /)
    expect(plan.command).toContain('-t')
  })
  it('reloads the apps of the ecosystem, or all', () => {
    expect(planAction('reload', summary(), 'production', false).command).toContain('pm2 reload')
    expect(planAction('reload', summary({ apps: [] }), 'production', false).command).toContain('pm2 reload all')
  })
  it('needs no environment for auth, and rejects unknown ones', () => {
    expect(planAction('auth', summary({ deploy: {} }), null, false).command).toBe('ddev auth ssh')
    expect(() => planAction('deploy', summary(), 'nope', false)).toThrow('Unknown environment')
    expect(() => planAction('deploy', summary(), '__proto__', false)).toThrow('Unknown environment')
    expect(() => planAction('deploy', summary(), null, false)).toThrow()
  })
  it('quotes for PowerShell on Windows', () => {
    const s = summary({ deploy: { "pro'd": env() } })
    const win = planAction('deploy', s, "pro'd", true).command
    const posix = planAction('deploy', s, "pro'd", false).command
    expect(win.startsWith("ddev exec 'cd /var/www/html")).toBe(true)
    // undoing the host quoting must give back exactly the container command
    const inner = unquotePosix(posix.slice('ddev exec '.length))
    expect(inner).toBe(deployCmd('ecosystem.config.js', "pro'd"))
    expect(unquotePowerShell(win.slice('ddev exec '.length))).toBe(inner)
  })
})

describe('reading the ecosystem file', () => {
  it('builds docker args without a host shell, no network and read-only', () => {
    const args = evalDockerArgs('D:\\laragon\\www\\app', 'ecosystem.config.js', 'ddev/ddev-webserver:v1.24.0', true)
    expect(args.slice(0, 5)).toEqual(['run', '--rm', '--network', 'none', '-v'])
    expect(args[5]).toBe('D:/laragon/www/app:/app:ro')
    expect(args).toContain('ddev/ddev-webserver:v1.24.0')
    expect(args[args.length - 1]).toContain("'/app/ecosystem.config.js'")
    expect(args[args.length - 1].startsWith('node -e ')).toBe(true)
  })
  it('strips types for .ts files', () => {
    const last = evalDockerArgs('/p', 'ecosystem.config.ts', 'img', false).at(-1)
    expect(last).toContain('--experimental-strip-types')
  })
  it('picks the ddev image from its version output', () => {
    expect(ddevImage('ddev version v1.24.3')).toBe('ddev/ddev-webserver:v1.24.3')
    expect(ddevImage('')).toBe('ddev/ddev-webserver:latest')
  })
  it('takes the last meaningful line of an error', () => {
    expect(lastLine('a\n\nCannot find module x\n')).toBe('Cannot find module x')
    expect(lastLine('  ')).toBe('node failed')
  })
})

describe('parseSshAdd', () => {
  it('counts keys, detects none, and gives up on errors', () => {
    expect(parseSshAdd('256 SHA256:abc me (ED25519)\n3072 SHA256:def x (RSA)\n', '', true)).toBe(2)
    expect(parseSshAdd('', 'The agent has no identities.', false)).toBe(0)
    expect(parseSshAdd('', 'Could not open a connection', false)).toBeNull()
  })
})

describe('messages', () => {
  it('has the same keys in English and Spanish', () => {
    expect(Object.keys(deployEs).sort()).toEqual(Object.keys(deployEn).sort())
  })
  it('keeps the same placeholders in both languages', () => {
    const vars = (s: string): string[] => (s.match(/\{\w+\}/g) ?? []).sort()
    for (const k of Object.keys(deployEn) as Array<keyof typeof deployEn>) expect(vars(deployEs[k])).toEqual(vars(deployEn[k]))
  })
})
