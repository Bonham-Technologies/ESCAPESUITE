// ESCSUITE-352 THROWAWAY: proves CI surfaces a pass-on-retry. Never merge.
import { test, expect } from '@playwright/test'

test.describe('ESCSUITE-352 probe', () => {
  test('default-project flaky probe', async ({ browserName }, testInfo) => {
    expect(browserName).toBe('chromium')
    expect(testInfo.retry, 'fails on the first attempt on purpose').toBeGreaterThan(0)
  })
})
