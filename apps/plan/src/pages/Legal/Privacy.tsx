import styles from './Legal.module.css'

export default function Privacy() {
  return (
    <div className={styles.legal}>
      <header className={styles.header}>
        <h1 className={styles.title}>Privacy Policy</h1>
        <p className={styles.lastUpdated}>Last updated: January 16, 2026</p>
      </header>

      <div className={styles.content}>
        <div className={styles.highlight}>
          <p>
            <strong>Our Commitment:</strong> ESCAPE Suite is built with privacy at its core. Your video
            recordings and projects are processed entirely on your device and are never uploaded to our
            servers unless you explicitly choose to share them.
          </p>
        </div>

        <h2>1. Introduction</h2>
        <p>
          Bonham Technologies, LLC ("we," "our," or "us") operates the ESCAPE Suite of applications,
          including ESCAPEPLAN, ESCAPECRAFT, and ESCAPEARTIST. This Privacy Policy explains how we
          collect, use, and protect your information when you use our services.
        </p>

        <h2>2. Information We Collect</h2>

        <h3>2.1 Account Information</h3>
        <p>When you create an account, we collect:</p>
        <ul>
          <li>Email address</li>
          <li>Name (optional)</li>
          <li>Authentication credentials (managed by our authentication provider, Clerk)</li>
        </ul>

        <h3>2.2 Payment Information</h3>
        <p>When you subscribe or purchase a license, we collect:</p>
        <ul>
          <li>Billing name and email</li>
          <li>Payment method details (processed securely by Stripe; we never see your full card number)</li>
          <li>Transaction history</li>
        </ul>

        <h3>2.3 Usage Analytics</h3>
        <p>
          We use Vercel Analytics to understand how our applications are used. This includes:
        </p>
        <ul>
          <li>Feature usage events (e.g., "recording started," "export completed")</li>
          <li>Page views and navigation patterns</li>
          <li>Browser type and general device information</li>
        </ul>
        <p>
          Vercel Analytics does not use cookies and is designed to be privacy-friendly. We do not
          track your IP address or create detailed user profiles.
        </p>

        <h3>2.4 Information We Do NOT Collect</h3>
        <p>We want to be clear about what we don't collect:</p>
        <ul>
          <li><strong>Video recordings</strong> - Your screen recordings and webcam footage stay on your device</li>
          <li><strong>Project files</strong> - Your video editing projects are stored locally in your browser</li>
          <li><strong>Camera/microphone streams</strong> - Media streams are processed locally, never transmitted</li>
          <li><strong>Detailed location data</strong> - We don't track your geographic location</li>
          <li><strong>Browsing history</strong> - We don't track your activity outside our applications</li>
        </ul>

        <h2>3. How We Use Your Information</h2>
        <p>We use collected information to:</p>
        <ul>
          <li>Provide and maintain our services</li>
          <li>Process payments and manage subscriptions</li>
          <li>Send important service updates and notifications</li>
          <li>Improve our applications based on aggregated usage patterns</li>
          <li>Provide customer support</li>
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

        <h3>4.2 Cloud Storage (Our Servers)</h3>
        <p>Account and subscription data is stored securely using:</p>
        <ul>
          <li><strong>Supabase</strong> - For subscription and organization data (PostgreSQL with encryption at rest)</li>
          <li><strong>Clerk</strong> - For authentication and identity management</li>
          <li><strong>Stripe</strong> - For payment processing (PCI DSS compliant)</li>
        </ul>

        <h2>5. Third-Party Services</h2>
        <p>We use the following third-party services:</p>

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
              <td>Clerk</td>
              <td>Authentication</td>
              <td>Email, name, auth tokens</td>
            </tr>
            <tr>
              <td>Stripe</td>
              <td>Payments</td>
              <td>Billing details, payment method</td>
            </tr>
            <tr>
              <td>Supabase</td>
              <td>Database</td>
              <td>Account and subscription data</td>
            </tr>
            <tr>
              <td>Vercel</td>
              <td>Hosting & Analytics</td>
              <td>Usage events, page views</td>
            </tr>
          </tbody>
        </table>

        <p>
          Each service has their own privacy policy, and we encourage you to review them.
          We do not sell your data to third parties.
        </p>

        <h2>6. Standalone Mode</h2>
        <p>
          ESCAPECRAFT and ESCAPEARTIST can run in standalone mode (offline desktop versions). In this mode:
        </p>
        <ul>
          <li>No account is required</li>
          <li>No data is sent to our servers</li>
          <li>No analytics are collected</li>
          <li>The application works entirely offline</li>
          <li>Only your license key is stored locally for validation</li>
        </ul>

        <h2>7. Team and Enterprise Features</h2>
        <p>
          For team subscriptions, organization administrators can view:
        </p>
        <ul>
          <li>Team member email addresses and roles</li>
          <li>Membership status and join dates</li>
          <li>Audit logs of administrative actions (Enterprise only)</li>
        </ul>
        <p>
          Administrators cannot access your recordings, projects, or personal usage data.
        </p>

        <h2>8. Data Retention</h2>
        <ul>
          <li><strong>Account data:</strong> Retained while your account is active, deleted upon request</li>
          <li><strong>Subscription history:</strong> Retained for 7 years for tax/legal compliance</li>
          <li><strong>Analytics data:</strong> Retained for 90 days, then deleted</li>
          <li><strong>Local data:</strong> Controlled entirely by you; delete anytime via browser settings</li>
        </ul>

        <h2>9. Your Rights</h2>
        <p>You have the right to:</p>
        <ul>
          <li><strong>Access</strong> - Request a copy of your personal data</li>
          <li><strong>Correction</strong> - Update or correct your information</li>
          <li><strong>Deletion</strong> - Request deletion of your account and data</li>
          <li><strong>Portability</strong> - Export your data in a standard format</li>
          <li><strong>Objection</strong> - Opt out of certain data processing</li>
        </ul>
        <p>
          To exercise these rights, contact us at privacy@escapesuite.io.
        </p>

        <h2>10. Cookies</h2>
        <p>
          We use minimal cookies, primarily for authentication:
        </p>
        <ul>
          <li><strong>Authentication cookies</strong> - Required to keep you signed in (set by Clerk)</li>
          <li><strong>No tracking cookies</strong> - We don't use cookies for advertising or cross-site tracking</li>
        </ul>

        <h2>11. Children's Privacy</h2>
        <p>
          Our services are not directed to children under 13. We do not knowingly collect personal
          information from children. If you believe we have collected information from a child,
          please contact us immediately.
        </p>

        <h2>12. International Data Transfers</h2>
        <p>
          Your data may be processed in the United States and other countries where our service
          providers operate. We ensure appropriate safeguards are in place for international transfers.
        </p>

        <h2>13. Changes to This Policy</h2>
        <p>
          We may update this Privacy Policy from time to time. We will notify you of significant
          changes by email or through our applications. Your continued use after changes constitutes
          acceptance of the updated policy.
        </p>

        <h2>14. Contact Us</h2>
        <div className={styles.contactInfo}>
          <h3>Bonham Technologies, LLC</h3>
          <p>Email: privacy@escapesuite.io</p>
          <p>For data requests: privacy@escapesuite.io</p>
          <p>For general inquiries: support@escapesuite.io</p>
        </div>
      </div>
    </div>
  )
}
