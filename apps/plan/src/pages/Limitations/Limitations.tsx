import { Fragment } from 'react'
import { Link } from 'react-router-dom'
import { useSeo } from '../../lib/seo'
import legal from '../Legal/Legal.module.css'
import styles from './Limitations.module.css'
import { LIMITATIONS, NETWORK_SILENCE_SPEC_URL, type LimitationSource } from './limitations'

function SourceRef({ source }: { source: LimitationSource }) {
  if (source.href === undefined) return <span>{source.label}</span>
  if (source.href.startsWith('/')) return <Link to={source.href}>{source.label}</Link>
  return (
    <a href={source.href} target="_blank" rel="noopener noreferrer">
      {source.label}
    </a>
  )
}

export default function Limitations() {
  useSeo({
    title: 'Known limitations — ESCAPE Suite',
    description:
      'What ESCAPE Suite cannot do yet, browser by browser, what the hosted site sends, and how to check for yourself that your recordings never leave your device.',
    canonicalPath: '/limitations',
  })

  return (
    <div className={legal.legal}>
      <header className={legal.header}>
        <h1 className={legal.title}>Known limitations, and how to check nothing leaves</h1>
      </header>

      <div className={`${legal.content} ${styles.content}`}>
        <div className={legal.highlight}>
          <p>
            ESCAPE Suite records, edits and exports entirely in your browser. Here is what it cannot
            do yet, and what the hosted site does send. Each point names the document, source file or
            ticket it comes from.
          </p>
        </div>

        <section aria-labelledby="known-limitations">
          <h2 id="known-limitations">Known limitations</h2>
          {LIMITATIONS.map((limitation) => (
            <section key={limitation.id} id={limitation.id} aria-labelledby={`${limitation.id}-title`}>
              <h3 id={`${limitation.id}-title`}>{limitation.title}</h3>
              {limitation.body.map((paragraph) => (
                <p key={paragraph}>{paragraph}</p>
              ))}
              <p className={styles.sources}>
                {limitation.sources.length === 1 ? 'Source: ' : 'Sources: '}
                {limitation.sources.map((source, index) => (
                  <Fragment key={source.label}>
                    {index > 0 && ', '}
                    <SourceRef source={source} />
                  </Fragment>
                ))}
              </p>
            </section>
          ))}
        </section>

        <section aria-labelledby="check-it-yourself">
          <h2 id="check-it-yourself">Check it yourself</h2>
          <p>You don’t have to take our word for it.</p>

          <h3>In your browser</h3>
          <ol>
            <li>Open your browser’s developer tools (F12, or Cmd+Option+I on a Mac).</li>
            <li>Go to the Network panel and turn on “Preserve log”.</li>
            <li>
              Record, edit and export as you normally would. “Open in Editor” opens a new window, so
              open the developer tools there too.
            </li>
          </ol>
          <p>
            On www.escapesuite.io, every request should go to www.escapesuite.io itself: the apps’ own
            files, and the analytics page views and events under /_vercel/insights/. The offline build
            should make no requests at all. If you see anything else, please report it on GitHub.
          </p>

          <h3>From the source code</h3>
          <p>
            Clone the repository. <code>pnpm build:standalone</code> then{' '}
            <code>pnpm test:e2e:standalone</code> records and exports in the offline files and fails
            if they make any request at all.
          </p>
          <p>
            For the hosted build, <code>pnpm build:deploy</code> then{' '}
            <code>pnpm test:e2e:production</code> runs{' '}
            <a href={NETWORK_SILENCE_SPEC_URL} target="_blank" rel="noopener noreferrer">
              network-silence.spec.ts
            </a>
            . It records in ESCAPECRAFT, edits and exports in ESCAPEARTIST, and fails if any request
            goes anywhere but the site’s own address and the analytics allow-list. Both suites run on
            every pull request.
          </p>
        </section>
      </div>
    </div>
  )
}
