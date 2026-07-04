import { Link } from 'react-router-dom'
import { useSeo } from '../lib/seo'

export default function NotFound() {
  useSeo({
    title: 'Page not found — ESCAPE Suite',
    description: 'The page you are looking for does not exist.',
    canonicalPath: '/404',
    noindex: true,
  })

  return (
    <div style={{ maxWidth: 680, margin: '10vh auto', padding: '0 24px', textAlign: 'center' }}>
      <h1>Page not found</h1>
      <p>The page you're looking for doesn't exist or has moved.</p>
      <p>
        <Link to="/">Back to the homepage</Link> &nbsp;&middot;&nbsp; <Link to="/pricing">View pricing</Link>
      </p>
    </div>
  )
}
