import styles from './Legal.module.css'

export default function Privacy() {
  return (
    <div className={styles.legal}>
      <header className={styles.header}>
        <h1 className={styles.title}>Privacy Policy</h1>
        <p className={styles.lastUpdated}>Last updated: August 18, 2026</p>
      </header>

      <div className={styles.content}>
        <div className={styles.highlight}>
          <p>
            <strong>Our Commitment:</strong> ESCAPE Suite is free, open source, and built with privacy
            at its core. Your video recordings and editing projects are always processed entirely on
            your device and are never uploaded to our servers.
          </p>
          <p>
            The hosted service at escapesuite.io requires no account and no sign-in. The only data we
            collect is anonymous usage analytics via Vercel, described below. The downloadable offline
            build makes no network requests at all and transmits nothing to us.
          </p>
        </div>

        <h2>1. Introduction</h2>
        <p>
          Bonham Technologies, LLC ("we," "our," or "us") operates the ESCAPE Suite of applications,
          including ESCAPEPLAN, ESCAPECRAFT, and ESCAPEARTIST. This Privacy Policy explains how we
          collect, use, and protect your information when you use our services.
        </p>

        <h2>2. Information We Collect</h2>
        <p>
          ESCAPE Suite requires no account, sign-in, or personal registration. We do not collect names,
          email addresses, or payment information.
        </p>

        <h3>2.1 Usage Analytics (Hosted Site Only)</h3>
        <p>
          The hosted site at escapesuite.io uses Vercel Analytics to understand how our applications
          are used. This includes:
        </p>
        <ul>
          <li>Feature usage events (e.g., "recording started," "export completed")</li>
          <li>Page views and navigation patterns</li>
          <li>Browser type and general device information</li>
        </ul>
        <p>
          Vercel Analytics does not use cookies and is designed to be privacy-friendly. We do not
          track your IP address or create detailed user profiles, and events are not tied to any
          account or identity, since none exist.
        </p>

        <h3>2.2 Information We Do NOT Collect</h3>
        <p>We want to be clear about what we don't collect:</p>
        <ul>
          <li><strong>Video recordings</strong> - Your screen recordings and webcam footage stay on your device</li>
          <li><strong>Project files</strong> - Your video editing projects are stored locally in your browser's IndexedDB</li>
          <li><strong>Camera/microphone streams</strong> - Media streams are processed locally, never transmitted</li>
          <li><strong>Account or payment information</strong> - There is no account to create, so we never collect names, emails, or payment details</li>
          <li><strong>Detailed location data</strong> - We don't track your geographic location</li>
          <li><strong>Browsing history</strong> - We don't track your activity outside our applications</li>
        </ul>

        <h2>3. How We Use Your Information</h2>
        <p>We use the limited information described above to:</p>
        <ul>
          <li>Operate and maintain the hosted service</li>
          <li>Understand aggregate, anonymous usage patterns to improve our applications</li>
          <li>Respond to support inquiries you send us</li>
          <li>Comply with legal obligations</li>
        </ul>

        <h2>4. Data Storage and Security</h2>

        <h3>4.1 Local Storage (Your Device)</h3>
        <p>
          ESCAPECRAFT and ESCAPEARTIST store your media and projects locally in your browser's
          IndexedDB storage. This data:
        </p>
        <ul>
          <li>Never leaves your device unless you export or share it</li>
          <li>Persists until you delete it or clear your browser data</li>
          <li>Is not accessible to us or any third party</li>
        </ul>

        <h3>4.2 Our Servers</h3>
        <p>
          We do not operate any account or media storage systems. The only data that reaches our
          infrastructure is the anonymous usage analytics described in Section 2, collected on our
          behalf by Vercel.
        </p>

        <h2>5. Third-Party Services</h2>
        <p>We use one third-party service:</p>

        <table className={styles.table}>
          <thead>
            <tr>
              <th>Service</th>
              <th>Purpose</th>
              <th>Data Shared</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Vercel</td>
              <td>Hosting &amp; Analytics</td>
              <td>Anonymous usage events, page views</td>
            </tr>
          </tbody>
        </table>

        <p>
          Vercel has its own privacy policy, which we encourage you to review. We do not sell your
          data to third parties.
        </p>

        <h2>6. Offline Build</h2>
        <p>
          ESCAPE Suite is also available as a downloadable, single-file offline build (attached to our
          GitHub Releases) that you can run entirely on your own device or network, including fully
          air-gapped environments. When you run the offline build:
        </p>
        <ul>
          <li>No account or sign-in is required</li>
          <li>No data is sent to our servers</li>
          <li>No analytics are collected</li>
          <li>The build makes no network requests at all — no telemetry of any kind</li>
          <li>The software works entirely offline</li>
        </ul>

        <h2>7. Data Retention</h2>
        <ul>
          <li><strong>Analytics data:</strong> Retained for 90 days, then deleted</li>
          <li><strong>Local data:</strong> Controlled entirely by you; delete anytime via your browser settings</li>
        </ul>

        <h2>8. Your Rights</h2>
        <p>You have the right to:</p>
        <ul>
          <li><strong>Access</strong> - Ask what data we hold about you</li>
          <li><strong>Correction</strong> - Update or correct your information</li>
          <li><strong>Deletion</strong> - Request deletion of any data we hold about you</li>
          <li><strong>Portability</strong> - Export your data in a standard format</li>
          <li><strong>Objection</strong> - Opt out of certain data processing</li>
        </ul>
        <p>
          To exercise these rights, contact us at privacy@escapesuite.io.
        </p>

        <h2>9. Cookies</h2>
        <p>
          ESCAPE Suite does not use cookies. There is no sign-in, so there are no authentication
          cookies, and we don't use cookies for advertising or cross-site tracking.
        </p>

        <h2>10. Children's Privacy</h2>
        <p>
          Our services are not directed to children under 13. We do not knowingly collect personal
          information from children. If you believe we have collected information from a child,
          please contact us immediately.
        </p>

        <h2>11. International Data Transfers</h2>
        <p>
          Your data may be processed in the United States and other countries where our service
          providers operate. We ensure appropriate safeguards are in place for international transfers.
        </p>

        <h2>12. Changes to This Policy</h2>
        <p>
          We may update this Privacy Policy from time to time. We will notify you of significant
          changes by posting the updated policy on this site. Your continued use after changes
          constitutes acceptance of the updated policy.
        </p>

        <h2>13. Contact Us</h2>
        <div className={styles.contactInfo}>
          <h3><a href="https://www.bonham.tech" target="_blank" rel="noopener noreferrer">Bonham Technologies, LLC</a></h3>
          <p>Email: privacy@escapesuite.io</p>
          <p>For data requests: privacy@escapesuite.io</p>
          <p>For general inquiries: support@escapesuite.io</p>
        </div>
      </div>
    </div>
  )
}
