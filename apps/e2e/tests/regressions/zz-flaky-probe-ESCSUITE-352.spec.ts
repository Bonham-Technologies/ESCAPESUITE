// ESCSUITE-352 THROWAWAY: proves the strict project turns a pass-on-retry red. Never merge.
import { test, expect } from '@playwright/test'

test('strict-project flaky probe', async ({ browserName }, testInfo) => {
    expect(browserName).toBe('chromium')
  expect(testInfo.retry, 'fails on the first attempt on purpose').toBeGreaterThan(0)
})
