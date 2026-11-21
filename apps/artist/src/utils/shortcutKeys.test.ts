import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  chordLabel,
  chordSpoken,
  currentShortcutPlatform,
  modifierKey,
  modifierKeyName,
  shortcutPlatform,
} from './shortcutKeys'

// ESCSUITE-491: the chords answer Ctrl or Cmd, so a hint names the platform's
// own modifier. These pin the detection and both spellings.

const UA = {
  mac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15',
  // iPadOS 13+ asks for the desktop site and says it is a Mac.
  ipad: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1',
  iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1',
  windows: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  linux: 'Mozilla/5.0 (X11; Linux x86_64; rv:133.0) Gecko/20100101 Firefox/133.0',
  android: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36',
}

describe('shortcutPlatform', () => {
  it('reads userAgentData.platform first (Chromium)', () => {
    expect(shortcutPlatform({ userAgentData: { platform: 'macOS' }, platform: 'MacIntel', userAgent: UA.mac })).toBe('apple')
    expect(shortcutPlatform({ userAgentData: { platform: 'Windows' }, platform: 'Win32', userAgent: UA.windows })).toBe('other')
    expect(shortcutPlatform({ userAgentData: { platform: 'Linux' }, platform: 'Linux x86_64' })).toBe('other')
    expect(shortcutPlatform({ userAgentData: { platform: 'Chrome OS' } })).toBe('other')
    // It wins over a disagreeing platform string.
    expect(shortcutPlatform({ userAgentData: { platform: 'Windows' }, platform: 'MacIntel' })).toBe('other')
  })

  it('falls back to navigator.platform where there is no userAgentData (Firefox, Safari)', () => {
    expect(shortcutPlatform({ platform: 'MacIntel', userAgent: UA.mac })).toBe('apple')
    expect(shortcutPlatform({ platform: 'iPhone', userAgent: UA.iphone })).toBe('apple')
    expect(shortcutPlatform({ platform: 'Win32', userAgent: UA.windows })).toBe('other')
    expect(shortcutPlatform({ platform: 'Linux x86_64', userAgent: UA.linux })).toBe('other')
  })

  it('falls back past an empty userAgentData.platform', () => {
    expect(shortcutPlatform({ userAgentData: { platform: '' }, platform: 'MacIntel' })).toBe('apple')
  })

  it('treats an iPad, which reports itself as a Mac, as Apple', () => {
    expect(shortcutPlatform({ platform: 'MacIntel', userAgent: UA.ipad })).toBe('apple')
    expect(shortcutPlatform({ platform: 'iPad' })).toBe('apple')
  })

  it('reads the user agent last', () => {
    expect(shortcutPlatform({ userAgent: UA.mac })).toBe('apple')
    expect(shortcutPlatform({ userAgent: UA.iphone })).toBe('apple')
    expect(shortcutPlatform({ userAgent: UA.android })).toBe('other')
    expect(shortcutPlatform({ userAgent: UA.windows })).toBe('other')
  })

  it('is "other" with nothing to read', () => {
    expect(shortcutPlatform(undefined)).toBe('other')
    expect(shortcutPlatform({})).toBe('other')
  })
})

describe('currentShortcutPlatform', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('reads the live navigator', () => {
    vi.stubGlobal('navigator', { platform: 'MacIntel', userAgent: UA.mac })
    expect(currentShortcutPlatform()).toBe('apple')
    vi.stubGlobal('navigator', { platform: 'Win32', userAgent: UA.windows })
    expect(currentShortcutPlatform()).toBe('other')
  })

  it('is "other" where there is no navigator', () => {
    vi.stubGlobal('navigator', undefined)
    expect(currentShortcutPlatform()).toBe('other')
  })
})

describe('the spellings', () => {
  it('shows ⌘ on Apple platforms and Ctrl elsewhere', () => {
    expect(modifierKey('apple')).toBe('⌘')
    expect(modifierKey('other')).toBe('Ctrl')
  })

  it('spells the key out for a screen reader', () => {
    expect(modifierKeyName('apple')).toBe('Command')
    expect(modifierKeyName('other')).toBe('Control')
  })

  it('writes a chord the way each platform does', () => {
    expect(chordLabel('Z', 'apple')).toBe('⌘Z')
    expect(chordLabel('Z', 'other')).toBe('Ctrl+Z')
  })

  it('spells a chord out', () => {
    expect(chordSpoken('Z', 'apple')).toBe('Command+Z')
    expect(chordSpoken('Z', 'other')).toBe('Control+Z')
  })
})
