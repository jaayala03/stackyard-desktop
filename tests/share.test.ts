import { describe, expect, it } from 'vitest'
import { shareEn, shareEs } from '../src/renderer/src/locales/share'
import {
  appendLog,
  findUrl,
  installHint,
  isProvider,
  pickProvider,
  redactSecrets,
  shareArgs,
  stripAnsi,
  toLines,
  tokenArgs,
  validToken
} from '../src/main/features/share-parse'

describe('findUrl', () => {
  it('finds a cloudflared quick tunnel URL in its box output', () => {
    const out = '|  Your quick Tunnel has been created! Visit it at:  |\n|  https://random-words-here.trycloudflare.com  |'
    expect(findUrl(out)).toBe('https://random-words-here.trycloudflare.com')
  })
  it('finds ngrok URLs (free and classic domains)', () => {
    expect(findUrl('Forwarding https://abcd-12-34.ngrok-free.app -> http://localhost')).toBe('https://abcd-12-34.ngrok-free.app')
    expect(findUrl('url=https://x1.ngrok.io/')).toBe('https://x1.ngrok.io')
    expect(findUrl('https://a-b.ngrok-free.dev')).toBe('https://a-b.ngrok-free.dev')
  })
  it('ignores local and unrelated URLs and ANSI colour codes', () => {
    expect(findUrl('Local: https://my-app.ddev.site and https://example.com')).toBeNull()
    expect(findUrl('\x1b[32mhttps://good.trycloudflare.com\x1b[0m')).toBe('https://good.trycloudflare.com')
    expect(findUrl('')).toBeNull()
  })
})

describe('log helpers', () => {
  it('strips ANSI sequences', () => {
    expect(stripAnsi('\x1b[1;36m==> hi\x1b[0m')).toBe('==> hi')
  })
  it('splits chunks on CR/LF and drops blank lines', () => {
    expect(toLines('a\r\n\r\nb\rc\n')).toEqual(['a', 'b', 'c'])
  })
  it('hides authtokens', () => {
    expect(redactSecrets('NGROK_AUTHTOKEN=2abcDEF123456789ghijkl')).toBe('NGROK_AUTHTOKEN=[hidden]')
    expect(redactSecrets('ngrok --authtoken 2abcDEF123456789ghijkl http 80')).toBe('ngrok --authtoken [hidden] http 80')
    expect(redactSecrets('plain line')).toBe('plain line')
  })
  it('keeps only the newest lines', () => {
    expect(appendLog(['1', '2', '3'], ['4', '5'], 3)).toEqual(['3', '4', '5'])
  })
})

describe('providers', () => {
  it('prefers cloudflared, then ngrok', () => {
    expect(pickProvider({ cloudflared: true, ngrok: true })).toBe('cloudflared')
    expect(pickProvider({ cloudflared: false, ngrok: true })).toBe('ngrok')
    expect(pickProvider({ cloudflared: false, ngrok: false })).toBeNull()
  })
  it('validates provider names', () => {
    expect(isProvider('ngrok')).toBe(true)
    expect(isProvider('localtunnel')).toBe(false)
    expect(isProvider(undefined)).toBe(false)
  })
  it('builds ddev share arguments', () => {
    expect(shareArgs('cloudflared')).toEqual(['share', '--provider=cloudflared'])
  })
  it('offers an install command where one exists', () => {
    expect(installHint('win32').command).toContain('winget')
    expect(installHint('linux').command).toBeNull()
    expect(installHint('linux').url).toMatch(/^https:/)
  })
})

describe('authtoken', () => {
  it('accepts plausible tokens only', () => {
    expect(validToken('2abcDEF123456789_ghi-jkl')).toBe(true)
    expect(validToken('short')).toBe(false)
    expect(validToken('bad token with spaces 123456')).toBe(false)
    expect(validToken('x;rm -rf /;1234567890123456')).toBe(false)
    expect(validToken(42)).toBe(false)
  })
  it('passes the token as a single argument', () => {
    const args = tokenArgs('2abcDEF123456789_ghi-jkl')
    expect(args).toEqual(['config', 'global', '--web-environment-add=NGROK_AUTHTOKEN=2abcDEF123456789_ghi-jkl'])
  })
})

describe('locales', () => {
  it('have the same keys and placeholders in English and Spanish', () => {
    expect(Object.keys(shareEs).sort()).toEqual(Object.keys(shareEn).sort())
    const holders = (s: string): string[] => (s.match(/\{\w+\}/g) ?? []).sort()
    for (const key of Object.keys(shareEn) as Array<keyof typeof shareEn>) {
      expect(holders(shareEs[key]), key).toEqual(holders(shareEn[key]))
    }
  })
})
