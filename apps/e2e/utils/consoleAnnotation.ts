import type { ConsoleMessage, Page, TestInfo } from '@playwright/test'

/**
 * Turn a page's console lines into test annotations, without failing the test
 * (ESCSUITE-450).
 *
 * Some app behaviour is only visible as a console line, such as ARTIST's
 * `stopped completing seeks; reloaded it from …` warning when an export has to
 * reload a wedged video (ESCSUITE-412). A spec that wants to know how often that
 * happens, rather than fail on it, watches for the line here: every console
 * message containing `contains` is pushed onto `testInfo.annotations` as
 * `{ type, description: <the message text> }`. Annotations land in the HTML and
 * JSON reports, and `scripts/report-flaky.mjs` lists the reported types (see
 * `REPORTED_ANNOTATION_TYPES` there) in the CI job summary and the `e2e-flaky`
 * artifact.
 *
 * Watches one page; call it again for each page that can log the line. Returns
 * a function that stops watching. Tests: `scripts/console-annotation.test.mjs`.
 */
export interface ConsoleAnnotationOptions {
  /** Substring a console message must contain to be recorded. */
  contains: string
  /** The annotation's type, e.g. `reload-fired`. */
  type: string
}

export function watchConsoleForAnnotation(
  page: Pick<Page, 'on' | 'off'>,
  testInfo: Pick<TestInfo, 'annotations'>,
  { contains, type }: ConsoleAnnotationOptions
): () => void {
  const onConsole = (message: ConsoleMessage) => {
    const text = message.text()
    if (text.includes(contains)) testInfo.annotations.push({ type, description: text })
  }
  page.on('console', onConsole)
  return () => {
    page.off('console', onConsole)
  }
}
