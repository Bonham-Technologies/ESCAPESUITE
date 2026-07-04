import { useSeo } from '../../lib/seo'
import styles from './Legal.module.css'

export default function Terms() {
  useSeo({
    title: 'Terms of Service — ESCAPE Suite',
    description:
      'ESCAPE Suite terms of service, including Site License terms for air-gapped organizational deployments.',
    canonicalPath: '/terms',
  })

  return (
    <div className={styles.legal}>
      <header className={styles.header}>
        <h1 className={styles.title}>Terms of Service</h1>
        <p className={styles.lastUpdated}>Last updated: May 31, 2026</p>
      </header>

      <div className={styles.content}>
        <div className={styles.highlight}>
          <p>
            <strong>Summary:</strong> ESCAPE Suite provides privacy-first video creation tools. You own
            your content. We provide the software. Be respectful and don't misuse our services.
          </p>
        </div>

        <h2>1. Agreement to Terms</h2>
        <p>
          By accessing or using ESCAPE Suite applications (ESCAPEPLAN, ESCAPECRAFT, and ESCAPEARTIST),
          operated by Bonham Technologies, LLC ("Company," "we," "us," or "our"), you agree to be bound
          by these Terms of Service ("Terms"). If you disagree with any part of these terms, you do not
          have permission to access our services.
        </p>

        <h2>2. Description of Services</h2>
        <p>ESCAPE Suite provides browser-based video creation tools, available both as connected applications and as a self-contained, air-gapped Site License bundle:</p>
        <ul>
          <li>
            <strong>ESCAPEPLAN</strong> - Central hub for account management, subscriptions, and
            accessing other ESCAPE Suite applications
          </li>
          <li>
            <strong>ESCAPECRAFT</strong> - Screen and webcam recording application with picture-in-picture
            capabilities
          </li>
          <li>
            <strong>ESCAPEARTIST</strong> - Video editing application with timeline, effects, and
            export functionality
          </li>
        </ul>
        <p>
          Our applications process video content locally on your device. We do not upload, store, or
          process your video recordings on our servers unless you explicitly choose to share them.
        </p>

        <h2>3. User Accounts</h2>

        <h3>3.1 Account Creation</h3>
        <p>
          To access certain features, you must create an account. You agree to provide accurate,
          current, and complete information during registration and to update such information to
          keep it accurate, current, and complete.
        </p>

        <h3>3.2 Account Security</h3>
        <p>
          You are responsible for safeguarding your account credentials and for all activities that
          occur under your account. You must notify us immediately of any unauthorized use of your
          account.
        </p>

        <h3>3.3 Account Termination</h3>
        <p>
          We reserve the right to suspend or terminate your account if you violate these Terms or
          engage in any activity that may harm the Company, our users, or third parties.
        </p>

        <h2>4. Subscriptions and Payments</h2>

        <h3>4.1 Plans and Offerings</h3>
        <p>We currently offer the following options:</p>
        <ul>
          <li><strong>Free Trial</strong> - A 7-day trial providing access to evaluate the connected applications</li>
          <li><strong>Individual Pro</strong> - Full access to all features for a single user, with no watermarks, at $9 per month or $89 per year (billed through our connected services)</li>
          <li><strong>Site License</strong> - An annual, organization-wide license for the air-gapped ESCAPE Suite bundle, as described in Section 5</li>
        </ul>

        <h3>4.2 Billing</h3>
        <p>
          Subscription fees are billed in advance on a monthly or annual basis depending on your
          chosen plan. All payments are processed securely through Stripe. You authorize us to
          charge your payment method for the subscription fee.
        </p>

        <h3>4.3 Cancellation and Refunds</h3>
        <p>
          You may cancel your subscription at any time through your account settings. Cancellation
          takes effect at the end of the current billing period. We do not provide prorated refunds
          for partial billing periods. Refund requests for exceptional circumstances may be
          submitted to support@escapesuite.io within 14 days of purchase.
        </p>

        <h3>4.4 Price Changes</h3>
        <p>
          We reserve the right to modify subscription prices. Price changes will be communicated
          at least 30 days in advance and will apply to the next billing cycle after the notice
          period.
        </p>

        <h2>5. Site License</h2>
        <p>
          The ESCAPE Suite Site License is an annual, organization-wide license for the self-contained
          ESCAPE Suite bundle (ESCAPECRAFT and ESCAPEARTIST), delivered as a single signed file with your
          license embedded. The Software runs entirely on your organization's own network and may be
          operated fully offline, including on air-gapped networks. These terms apply in addition to the
          rest of these Terms.
        </p>

        <h3>5.1 License Grant</h3>
        <p>
          Subject to payment of fees and compliance with these Terms, we grant your organization a
          non-exclusive, non-transferable, non-sublicensable, limited license, for the duration of the
          Term, to host one (1) instance of the Software on your authorized network and to permit your
          authorized users (up to the limit of your purchased band) to run that instance for your
          organization's internal business purposes. The license is granted <strong>per-organization,
          not per-seat or per-device</strong> — one hosted copy may serve all authorized users within
          your band. You retain all content (recordings, edits, exports) you create, royalty-free.
        </p>

        <h3>5.2 Organization-Size Bands and Self-Certification</h3>
        <p>
          Your license is scoped to the organization-size band you purchase, which sets the maximum
          number of authorized users:
        </p>
        <ul>
          <li><strong>Team</strong> - up to approximately 25 authorized users ($2,400 per year)</li>
          <li><strong>Organization</strong> - up to approximately 250 authorized users ($9,600 per year)</li>
          <li><strong>Enterprise / Site</strong> - as specified on your order; contact sales@escapesuite.io</li>
        </ul>
        <p>
          Because the Software runs offline and we do not monitor your usage, at purchase and at each
          renewal you certify that your organization's number of authorized users is within the
          purchased band. If your organization grows beyond your band, you agree to upgrade to the
          appropriate band at the next renewal or sooner. Exceeding your band's user limit is a material
          breach of these Terms.
        </p>

        <h3>5.3 Annual Term, Renewal, and Expiration</h3>
        <p>
          The Site License is an annual subscription. Your license carries an embedded expiration date.
          Unless cancelled, the subscription <strong>automatically renews annually</strong> at the
          then-current price; you may cancel renewal at any time, with cancellation taking effect at the
          end of the current Term. When the Term ends and the license is not renewed, the Software's
          functionality will become restricted or disabled until a renewed, valid license is installed.
          Renewal entitles you to download a refreshed signed bundle containing the latest version and
          continued support for the renewed Term.
        </p>

        <h3>5.4 Delivery, Updates, and Restrictions</h3>
        <p>
          Upon purchase you may download your signed Software bundle from your account portal under
          Downloads. During an active Term you may re-download and re-deploy the latest released bundle
          (the offline Software does not auto-update). You may not distribute, publish, resell,
          sublicense, rent, lease, or otherwise make the Software or your license available outside your
          organization; host or use it for the benefit of any other organization (no service-bureau,
          time-sharing, or hosting-for-others arrangement); permit more authorized users than your band
          allows; circumvent, disable, or tamper with the embedded license or its expiration date;
          reverse engineer, decompile, or disassemble the Software; or remove or alter any proprietary
          notice. The Software is licensed, not sold, and we retain all intellectual property rights in
          it.
        </p>

        <h2>6. Content Ownership</h2>

        <h3>6.1 Your Content</h3>
        <p>
          You retain full ownership of all video recordings, projects, and exported content you
          create using our applications. We claim no intellectual property rights over your content.
        </p>

        <h3>6.2 Our Content</h3>
        <p>
          The ESCAPE Suite applications, including all software, design, logos, and documentation,
          are owned by Bonham Technologies, LLC and protected by intellectual property laws. You
          may not copy, modify, or distribute our software except as expressly permitted.
        </p>

        <h2>7. Acceptable Use</h2>
        <p>You agree not to use our services to:</p>
        <ul>
          <li>Violate any applicable laws or regulations</li>
          <li>Record or distribute content without proper consent from all parties</li>
          <li>Create, store, or distribute illegal, harmful, or objectionable content</li>
          <li>Infringe on the intellectual property rights of others</li>
          <li>Attempt to gain unauthorized access to our systems or other users' accounts</li>
          <li>Interfere with or disrupt the integrity or performance of our services</li>
          <li>Use automated systems or bots to access our services without permission</li>
          <li>Circumvent any access restrictions or usage limits</li>
        </ul>

        <h2>8. Organization Use</h2>
        <p>
          Organization-wide use of ESCAPE Suite is provided exclusively through the per-organization
          Site License described in Section 5. We do not offer per-seat team or enterprise accounts,
          member or administrator roles, or seat-based billing. The organization that purchases the Site
          License is responsible for ensuring its authorized users comply with these Terms, for keeping
          its license current, and for staying within its purchased organization-size band.
        </p>

        <h2>9. Privacy</h2>
        <p>
          Your use of our services is also governed by our <a href="/privacy">Privacy Policy</a>,
          which explains how we collect, use, and protect your information. By using our services,
          you consent to our privacy practices.
        </p>

        <h2>10. Disclaimers</h2>

        <h3>10.1 Service Availability</h3>
        <p>
          We strive to provide reliable services but do not guarantee uninterrupted access. Services
          may be temporarily unavailable due to maintenance, updates, or circumstances beyond our
          control.
        </p>

        <h3>10.2 "As Is" Provision</h3>
        <p>
          Our services are provided "as is" and "as available" without warranties of any kind,
          either express or implied, including but not limited to implied warranties of
          merchantability, fitness for a particular purpose, or non-infringement.
        </p>

        <h3>10.3 Data Loss</h3>
        <p>
          Since your content is stored locally on your device, we are not responsible for data
          loss due to browser data clearing, device failure, or other local storage issues. We
          recommend regularly exporting important projects.
        </p>

        <h2>11. Limitation of Liability</h2>
        <p>
          To the maximum extent permitted by law, Bonham Technologies, LLC shall not be liable for
          any indirect, incidental, special, consequential, or punitive damages, or any loss of
          profits or revenues, whether incurred directly or indirectly, or any loss of data, use,
          goodwill, or other intangible losses resulting from:
        </p>
        <ul>
          <li>Your use or inability to use our services</li>
          <li>Any unauthorized access to or use of our servers or your personal information</li>
          <li>Any interruption or cessation of transmission to or from our services</li>
          <li>Any bugs, viruses, or similar issues transmitted through our services</li>
          <li>Any errors or omissions in any content</li>
        </ul>
        <p>
          Our total liability for any claims arising from these Terms or your use of our services
          shall not exceed the amount you paid us in the 12 months preceding the claim.
        </p>

        <h2>12. Indemnification</h2>
        <p>
          You agree to indemnify, defend, and hold harmless Bonham Technologies, LLC, its officers,
          directors, employees, and agents from any claims, damages, losses, liabilities, and
          expenses (including legal fees) arising from your use of our services, violation of
          these Terms, or infringement of any rights of another party.
        </p>

        <h2>13. Governing Law</h2>
        <p>
          These Terms shall be governed by and construed in accordance with the laws of the
          United States and the State of Utah, without regard to its conflict of law provisions.
          Any disputes arising from these Terms shall be resolved in the courts located in Utah.
        </p>

        <h2>14. Changes to Terms</h2>
        <p>
          We reserve the right to modify these Terms at any time. We will notify you of significant
          changes by email or through our applications at least 30 days before they take effect.
          Your continued use of our services after changes become effective constitutes acceptance
          of the revised Terms.
        </p>

        <h2>15. Severability</h2>
        <p>
          If any provision of these Terms is found to be unenforceable or invalid, that provision
          shall be limited or eliminated to the minimum extent necessary so that these Terms shall
          otherwise remain in full force and effect.
        </p>

        <h2>16. Entire Agreement</h2>
        <p>
          These Terms, together with our Privacy Policy, constitute the entire agreement between
          you and Bonham Technologies, LLC regarding your use of our services and supersede any
          prior agreements.
        </p>

        <h2>17. Contact Us</h2>
        <div className={styles.contactInfo}>
          <h3><a href="https://www.bonham.tech" target="_blank" rel="noopener noreferrer">Bonham Technologies, LLC</a></h3>
          <p>Email: legal@escapesuite.io</p>
          <p>For support inquiries: support@escapesuite.io</p>
          <p>For privacy-related requests: privacy@escapesuite.io</p>
        </div>
      </div>
    </div>
  )
}
