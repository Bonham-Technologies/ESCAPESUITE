/**
 * ESCSUITE-458: each hub route is served its own copy of the hub's page, which
 * differs from `/`'s only in the route's title, description, canonical and the
 * og:/twitter: title, description and url. This blanks exactly those values, so
 * two routes' HTML can be compared whole: the script and stylesheet tags Vite
 * puts in `<head>` must still match byte for byte.
 */
export function withoutRouteHead(html: string): string {
  const blank = (source: string, pattern: RegExp) => source.replace(pattern, '$1$2')
  const meta = (attr: 'name' | 'property', key: string) =>
    new RegExp(`(<meta\\s+${attr}="${key}"\\s+content=")[^"]*(")`, 'g')

  let out = blank(html, /(<title>)[\s\S]*?(<\/title>)/g)
  out = blank(out, meta('name', 'description'))
  out = blank(out, /(<link\s+rel="canonical"\s+href=")[^"]*(")/g)
  for (const key of ['og:title', 'og:description', 'og:url']) out = blank(out, meta('property', key))
  for (const key of ['twitter:title', 'twitter:description']) out = blank(out, meta('name', key))
  return out
}
