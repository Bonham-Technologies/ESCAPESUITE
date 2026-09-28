import { vi } from 'vitest'

/**
 * Helpers for asserting on the object URLs the test stub mints.
 *
 * `src/test/setup.ts` hands every `URL.createObjectURL` call a DISTINCT
 * `blob:mock-url-<n>`, so a test can tell "freed the handle it was given" from
 * "freed some handle a previous test leaked". The price is that no test can
 * hard-code the string it expects: it reads the handle back from the mock
 * instead, with these.
 */

/** Matches any handle minted by the stub. Use where only the shape matters. */
export const OBJECT_URL_PATTERN = /^blob:mock-url-\d+$/

/** Every handle `URL.createObjectURL` has minted so far, in call order. */
export function createdObjectUrls(): string[] {
  return vi.mocked(URL.createObjectURL).mock.results
    .filter((result) => result.type === 'return')
    .map((result) => result.value as string)
}

/**
 * The handle `URL.createObjectURL` minted most recently — i.e. the one the code
 * under test was just handed.
 */
export function lastObjectUrl(): string {
  const urls = createdObjectUrls()
  if (urls.length === 0) {
    throw new Error('lastObjectUrl(): URL.createObjectURL has not been called')
  }
  return urls[urls.length - 1]
}

