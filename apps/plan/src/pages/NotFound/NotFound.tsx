import { Link } from 'react-router-dom'
import { toolUrl } from '../../lib/launch'
import { useSeo } from '../../lib/seo'
import legal from '../Legal/Legal.module.css'

/**
 * Shown for any path that is not a hub route (ESCSUITE-455). On the hosted site
 * such a path answers 404 with `dist/404.html`, a copy of the hub's own page, so
 * this is what a mistyped link shows there too.
 */
export default function NotFound() {
  useSeo({
    title: 'Page not found — ESCAPE Suite',
    description: 'This page does not exist. Go to the ESCAPE Suite home page, or open the recorder or the editor.',
    canonicalPath: '/',
  })

  return (
    <div className={legal.legal}>
      <header className={legal.header}>
        <h1 className={legal.title}>Page not found</h1>
      </header>

      <div className={legal.content}>
        <p>There is no page at this address. The link may be mistyped or out of date.</p>
        <ul>
          <li>
            <Link to="/">Go to the home page</Link>
          </li>
          <li>
            <a href={toolUrl('craft')}>Open ESCAPECRAFT</a>, the screen and webcam recorder
          </li>
          <li>
            <a href={toolUrl('artist')}>Open ESCAPEARTIST</a>, the video editor
          </li>
        </ul>
      </div>
    </div>
  )
}
