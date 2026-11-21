import { render } from '@testing-library/react'
import {
  ROUTE_META,
  ROUTE_PATHS,
  SITE_URL,
  STRUCTURED_DATA_OPERATING_SYSTEM,
  SUPPORTED_BROWSERS,
  applyRouteHead,
  hubPathFor,
  routeHtmlFile,
} from './routeMeta'
import { useRouteSeo } from './seo'
import indexHtml from '../../index.html?raw'
import readme from '../../../../README.md?raw'

/**
 * ESCSUITE-458: the hosting served every hub route the one `index.html`, whose
 * head named the home page, so `/privacy`, `/terms` and `/limitations` were
 * duplicates of `/` until JavaScript ran. `routeMeta.ts` is now the one list of
 * route heads: the build writes each into that route's HTML, and `seo.ts` sets
 * the same values in the page.
 */

function headOf(html: string) {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const content = (selector: string) => doc.head.querySelector(selector)?.getAttribute('content')
  return {
    title: doc.title,
    description: content('meta[name="description"]'),
    canonicals: [...doc.head.querySelectorAll('link[rel="canonical"]')].map((el) => el.getAttribute('href')),
    ogTitle: content('meta[property="og:title"]'),
    ogDescription: content('meta[property="og:description"]'),
    ogUrl: content('meta[property="og:url"]'),
    twitterTitle: content('meta[name="twitter:title"]'),
    twitterDescription: content('meta[name="twitter:description"]'),
  }
}

describe('ROUTE_META (ESCSUITE-458)', () => {
  it.each(ROUTE_PATHS)('%s has a title of 60 characters or fewer and a description of 50 to 160', (path) => {
    const { title, description } = ROUTE_META[path]
    expect(title.length).toBeLessThanOrEqual(60)
    expect(description.length).toBeGreaterThanOrEqual(50)
    expect(description.length).toBeLessThanOrEqual(160)
  })

  it('gives every route its own title and description', () => {
    const metas = Object.values(ROUTE_META)
    expect(new Set(metas.map((m) => m.title)).size).toBe(metas.length)
    expect(new Set(metas.map((m) => m.description)).size).toBe(metas.length)
  })

  it('keeps index.html in step with the home page head', () => {
    expect(applyRouteHead(indexHtml, '/')).toBe(indexHtml)
  })
})

describe('applyRouteHead', () => {
  it.each(ROUTE_PATHS)('writes %s’s head into index.html', (path) => {
    const { title, description } = ROUTE_META[path]
    const url = `${SITE_URL}${path}`
    expect(headOf(applyRouteHead(indexHtml, path))).toEqual({
      title,
      description,
      canonicals: [url],
      ogTitle: title,
      ogDescription: description,
      ogUrl: url,
      twitterTitle: title,
      twitterDescription: description,
    })
  })

  it('changes nothing outside the head tags it sets', () => {
    const out = applyRouteHead(indexHtml, '/privacy')
    const body = (html: string) => html.slice(html.indexOf('<body>'))
    expect(body(out)).toBe(body(indexHtml))
    expect(out).toContain('<meta property="og:image" content="https://escapesuite.io/og.png" />')
  })

  it('escapes HTML in the values it writes', () => {
    const out = applyRouteHead(indexHtml, '/')
    expect(out).toContain('<title>ESCAPE Suite — Free browser screen recorder &amp; video editor</title>')
    expect(out).not.toMatch(/content="[^"]* & /)
  })

  it('leaves out social tags the page does not have', () => {
    const jsonLd = (os: string) => `<script type="application/ld+json">{"operatingSystem":"${os}"}</script>`
    const minimal =
      '<head><title>x</title><meta name="description" content="x" /><link rel="canonical" href="x" />' +
      `${jsonLd('x')}</head>`
    expect(applyRouteHead(minimal, '/terms')).toBe(
      '<head><title>Terms of Service — ESCAPE Suite</title>' +
        `<meta name="description" content="${ROUTE_META['/terms'].description}" />` +
        '<link rel="canonical" href="https://escapesuite.io/terms" />' +
        `${jsonLd(STRUCTURED_DATA_OPERATING_SYSTEM)}</head>`
    )
  })

  it.each([
    ['<title>', /<title>[\s\S]*?<\/title>/],
    ['meta description', /<meta name="description"[^>]*>/],
    ['canonical link', /<link rel="canonical"[^>]*>/],
    ['JSON-LD operatingSystem', /"operatingSystem"[^\n]*\n/],
  ])('fails, naming it, when index.html has no %s', (name, pattern) => {
    expect(() => applyRouteHead(indexHtml.replace(pattern, ''), '/privacy')).toThrow(
      `applyRouteHead: index.html has no ${name}`
    )
  })
})

/**
 * ESCSUITE-465: the JSON-LD on every hub page said `"operatingSystem": "Web
 * (Chrome, Edge)"`, though the README's "Browser support" section lists Firefox
 * 155+ and Safari 26.6+ as well. The expected value is read from that README
 * sentence, so the structured data and the README cannot drift apart.
 */
function readmeBrowsers(): string[] {
  const sentence = /requires the WebCodecs API, which (.+?) all provide/.exec(readme)
  if (!sentence) throw new Error('README.md "Browser support" no longer names the browsers that export video')
  return sentence[1].split(/, | and /)
}

function jsonLdOf(html: string): Record<string, unknown>[] {
  return [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map(
    (m) => JSON.parse(m[1]) as Record<string, unknown>
  )
}

describe('structured data (ESCSUITE-465)', () => {
  const operatingSystem = `Web (${readmeBrowsers().join(', ')})`

  it('reads the browsers from the README', () => {
    expect(readmeBrowsers()).toEqual(['Chrome', 'Edge', 'Firefox 155+', 'Safari 26.6+'])
  })

  it('names the README’s browsers in one constant', () => {
    expect(SUPPORTED_BROWSERS).toEqual(readmeBrowsers())
    expect(STRUCTURED_DATA_OPERATING_SYSTEM).toBe(operatingSystem)
  })

  it.each(ROUTE_PATHS)('%s serves one valid JSON-LD block naming those browsers', (path) => {
    const blocks = jsonLdOf(applyRouteHead(indexHtml, path))
    expect(blocks).toHaveLength(1)
    const [data] = blocks
    expect(data).toMatchObject({
      '@context': 'https://schema.org',
      '@type': 'SoftwareApplication',
      name: 'ESCAPE Suite',
      applicationCategory: 'MultimediaApplication',
      url: 'https://escapesuite.io/',
      isAccessibleForFree: true,
      offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
    })
    expect(data.operatingSystem).toBe(operatingSystem)
  })

  it('sets the value in a JSON-LD block written on one line', () => {
    const html = '<title>x</title><meta name="description" content="x" /><link rel="canonical" href="x" />'
    const jsonLd = '<script type="application/ld+json">{ "operatingSystem": "old" }</script>'
    const [data] = jsonLdOf(applyRouteHead(html + jsonLd, '/'))
    expect(data.operatingSystem).toBe(STRUCTURED_DATA_OPERATING_SYSTEM)
  })
})

describe('hubPathFor', () => {
  it.each([
    ['/privacy', '/privacy'],
    ['/terms?theme=dark', '/terms'],
    ['/limitations#network', '/limitations'],
    ['/', '/'],
    ['/no-such-page', '/'],
    ['/privacy/', '/'],
    [undefined, '/'],
  ])('%s → %s', (url, path) => {
    expect(hubPathFor(url)).toBe(path)
  })
})

describe('routeHtmlFile', () => {
  it('puts the home page at index.html and each other route in its own folder', () => {
    expect(ROUTE_PATHS.map(routeHtmlFile)).toEqual([
      'index.html',
      'privacy/index.html',
      'terms/index.html',
      'limitations/index.html',
    ])
  })
})

describe('useRouteSeo', () => {
  function Probe({ path }: { path: (typeof ROUTE_PATHS)[number] }) {
    useRouteSeo(path)
    return null
  }

  it.each(ROUTE_PATHS)('sets in the page the head %s is served with', (path) => {
    document.head.innerHTML = new DOMParser().parseFromString(indexHtml, 'text/html').head.innerHTML
    render(<Probe path={path} />)
    expect(headOf(document.documentElement.outerHTML)).toEqual(headOf(applyRouteHead(indexHtml, path)))
  })
})
