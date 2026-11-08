import { describe, expect, it } from 'vitest'
import { isNewer, isReleaseUrl, NO_UPDATE, parseVersion, releaseToInfo } from '../src/main/updates-core'
import { updateEn, updateEs } from '../src/renderer/src/locales/update'

describe('parseVersion', () => {
  it('accepts a leading v, partial versions and pre-release tags', () => {
    expect(parseVersion('v1.2.3')?.nums).toEqual([1, 2, 3])
    expect(parseVersion('2')?.nums).toEqual([2, 0, 0])
    expect(parseVersion('1.4-beta.2+build5')).toEqual({ nums: [1, 4, 0], pre: ['beta', '2'] })
  })
  it('rejects garbage', () => {
    expect(parseVersion('latest')).toBeNull()
    expect(parseVersion('')).toBeNull()
  })
})

describe('isNewer', () => {
  it('compares numerically, not lexically', () => {
    expect(isNewer('0.10.0', '0.9.0')).toBe(true)
    expect(isNewer('1.0.0', 'v1.0.0')).toBe(false)
    expect(isNewer('0.1.0', '0.1.1')).toBe(false)
  })
  it('ranks a release above its pre-releases', () => {
    expect(isNewer('1.0.0', '1.0.0-rc.1')).toBe(true)
    expect(isNewer('1.0.0-rc.1', '1.0.0')).toBe(false)
    expect(isNewer('1.0.0-rc.2', '1.0.0-rc.10')).toBe(false)
    expect(isNewer('1.0.0-rc.10', '1.0.0-rc.2')).toBe(true)
    expect(isNewer('1.0.0-beta', '1.0.0-alpha')).toBe(true)
  })
  it('never reports unparseable versions as newer', () => {
    expect(isNewer('nope', '1.0.0')).toBe(false)
    expect(isNewer('1.0.0', 'nope')).toBe(false)
  })
})

describe('releaseToInfo', () => {
  const release = { tag_name: 'v0.2.0', html_url: 'https://github.com/jaayala03/stackyard-desktop/releases/tag/v0.2.0', body: 'Notes' }

  it('reports a newer release', () => {
    expect(releaseToInfo(release, '0.1.0')).toEqual({ available: true, version: '0.2.0', url: release.html_url, notes: 'Notes' })
  })
  it('reports nothing for the same or an older version', () => {
    expect(releaseToInfo(release, '0.2.0')).toEqual(NO_UPDATE)
    expect(releaseToInfo(release, '1.0.0')).toEqual(NO_UPDATE)
  })
  it('skips the dismissed version but not a later one', () => {
    expect(releaseToInfo(release, '0.1.0', '0.2.0')).toEqual(NO_UPDATE)
    expect(releaseToInfo({ ...release, tag_name: 'v0.3.0' }, '0.1.0', '0.2.0').version).toBe('0.3.0')
  })
  it('ignores drafts, pre-releases and malformed payloads', () => {
    expect(releaseToInfo({ ...release, draft: true }, '0.1.0')).toEqual(NO_UPDATE)
    expect(releaseToInfo({ ...release, prerelease: true }, '0.1.0')).toEqual(NO_UPDATE)
    expect(releaseToInfo(null, '0.1.0')).toEqual(NO_UPDATE)
    expect(releaseToInfo({ message: 'Not Found' }, '0.1.0')).toEqual(NO_UPDATE)
    expect(releaseToInfo({ tag_name: 7 }, '0.1.0')).toEqual(NO_UPDATE)
  })
  it('never exposes a link outside the repository', () => {
    const info = releaseToInfo({ ...release, html_url: 'https://evil.example/x' }, '0.1.0')
    expect(info.available).toBe(true)
    expect(isReleaseUrl(info.url)).toBe(true)
    expect(info.url.startsWith('https://github.com/jaayala03/stackyard-desktop/')).toBe(true)
  })
})

describe('isReleaseUrl', () => {
  it('only allows the project repository', () => {
    expect(isReleaseUrl('https://github.com/jaayala03/stackyard-desktop/releases')).toBe(true)
    expect(isReleaseUrl('https://github.com/jaayala03/stackyard-desktop-evil/releases')).toBe(false)
    expect(isReleaseUrl('https://github.com/other/repo/')).toBe(false)
    expect(isReleaseUrl('javascript:alert(1)')).toBe(false)
    expect(isReleaseUrl(undefined)).toBe(false)
  })
})

describe('locales', () => {
  it('have identical keys and the same placeholders', () => {
    expect(Object.keys(updateEs).sort()).toEqual(Object.keys(updateEn).sort())
    expect(updateEs['update.available']).toContain('{version}')
  })
})
