import { launchTool, GITHUB_URL, RELEASES_URL } from '../lib/launch'
import styles from './Home.module.css'

export default function Home() {
  return (
    <div className={styles.home}>
      {/* Hero Section */}
      <section className={styles.hero}>
        <div className={styles.heroContent}>
          <h1 className={styles.heroTitle}>
            How-to videos for networks<br />
            <span className={styles.gradient}>the cloud can't reach.</span>
          </h1>
          <p className={styles.heroSubtitle}>
            ESCAPE Suite records and edits screencasts entirely in the browser — free and
            open source. Capture a walkthrough, trim the mistakes, blur anything sensitive,
            and share it with shift workers and remote sites — without a single byte
            leaving the building.
          </p>
          <div className={styles.heroCta}>
            <button className="primary" onClick={() => launchTool('craft')}>
              Start recording
            </button>
            <button onClick={() => launchTool('artist')}>Open the editor</button>
          </div>
          <p className={styles.heroLinks}>
            <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer">View on GitHub</a>
            {' · '}
            <a href={RELEASES_URL} target="_blank" rel="noopener noreferrer">
              Download the offline build
            </a>
          </p>
        </div>
      </section>

      {/* Tools Section */}
      <section className={styles.tools}>
        <h2 className={styles.sectionTitle}>Capture it, clean it up, send it out</h2>
        <div className={styles.toolsGrid}>
          <div className={styles.toolCard}>
            <div className={styles.toolIcon}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" />
                <circle cx="12" cy="12" r="4" fill="currentColor" />
              </svg>
            </div>
            <h3>ESCAPECRAFT</h3>
            <p>
              One-shot a how-to: record your screen, webcam, and audio — picture-in-picture included.
              Built for tutorials, SOPs, and handoffs between shifts.
            </p>
            <ul className={styles.featureList}>
              <li>Screen &amp; webcam capture</li>
              <li>System &amp; microphone audio</li>
              <li>Picture-in-Picture mode</li>
              <li>Saves locally, instantly</li>
            </ul>
            <button className="primary" onClick={() => launchTool('craft')}>
              Use ESCAPECRAFT
            </button>
          </div>

          <div className={styles.toolCard}>
            <div className={styles.toolIcon}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 20h9" />
                <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
              </svg>
            </div>
            <h3>ESCAPEARTIST</h3>
            <p>
              Cut the fumbles, blur a password or PII, add a caption — then export. A real timeline
              editor, no cloud render farm required.
            </p>
            <ul className={styles.featureList}>
              <li>Multi-track timeline</li>
              <li>Blur &amp; redaction overlays</li>
              <li>Keyframe animations</li>
              <li>MP4 &amp; WebM export</li>
            </ul>
            <button className="primary" onClick={() => launchTool('artist')}>
              Use ESCAPEARTIST
            </button>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section className={styles.features}>
        <h2 className={styles.sectionTitle}>Why teams behind a firewall choose ESCAPE</h2>
        <div className={styles.featuresGrid}>
          <div className={styles.feature}>
            <div className={styles.featureIcon}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                <path d="M7 11V7a5 5 0 0 1 10 0v4" />
              </svg>
            </div>
            <h3>Runs air-gapped</h3>
            <p>The offline build is 100% in-browser and fully offline. Drop the single HTML file onto your isolated network — no internet, ever.</p>
          </div>

          <div className={styles.feature}>
            <div className={styles.featureIcon}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                <circle cx="9" cy="7" r="4" />
                <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                <path d="M16 3.13a4 4 0 0 1 0 7.75" />
              </svg>
            </div>
            <h3>One copy, whole org</h3>
            <p>Host a single file internally; everyone on your network just opens it and works.</p>
          </div>

          <div className={styles.feature}>
            <div className={styles.featureIcon}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M9 12l2 2 4-4" />
                <path d="M21 12c0 4.97-4.03 9-9 9s-9-4.03-9-9 4.03-9 9-9c1.66 0 3.21.45 4.54 1.23" />
              </svg>
            </div>
            <h3>Nothing leaves the building</h3>
            <p>No uploads, no accounts, no telemetry in the offline build — your footage stays on the device.</p>
          </div>

          <div className={styles.feature}>
            <div className={styles.featureIcon}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
              </svg>
            </div>
            <h3>No installers</h3>
            <p>A single HTML file — no plugins, no admin rights, no deployment headaches.</p>
          </div>
        </div>
      </section>

      {/* Open Source Section */}
      <section className={styles.cta}>
        <h2>Free &amp; open source</h2>
        <p>
          ESCAPE Suite is MIT-licensed. Use the hosted apps right here, self-host the
          static build, or grab the offline single-file build for air-gapped networks.
        </p>
        <div className={styles.heroCta}>
          <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer">
            <button className="primary">View on GitHub</button>
          </a>
          <a href={RELEASES_URL} target="_blank" rel="noopener noreferrer">
            <button>Download offline build</button>
          </a>
        </div>
      </section>
    </div>
  )
}
