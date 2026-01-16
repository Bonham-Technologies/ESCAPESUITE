import styles from './Legal.module.css'

export default function Terms() {
  return (
    <div className={styles.legal}>
      <header className={styles.header}>
        <h1 className={styles.title}>Terms of Service</h1>
        <p className={styles.lastUpdated}>Last updated: January 16, 2026</p>
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
        <p>ESCAPE Suite provides browser-based and standalone video creation tools:</p>
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

        <h3>4.1 Subscription Plans</h3>
        <p>We offer the following subscription options:</p>
        <ul>
          <li><strong>Free Plan</strong> - Basic access with watermarked exports</li>
          <li><strong>Pro Plan</strong> - Full access to all features, no watermarks</li>
          <li><strong>Team Plan</strong> - Pro features for organizations with team management</li>
          <li><strong>Founding Member</strong> - Lifetime access for early supporters</li>
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

        <h2>5. Standalone Licenses</h2>

        <h3>5.1 License Grant</h3>
        <p>
          Standalone licenses provide offline access to ESCAPECRAFT and ESCAPEARTIST without
          requiring an internet connection or subscription. Upon purchase, you receive a
          perpetual, non-transferable license to use the software.
        </p>

        <h3>5.2 License Restrictions</h3>
        <p>You may not:</p>
        <ul>
          <li>Share, sell, or transfer your license key to others</li>
          <li>Use a single license on more devices than permitted by your license type</li>
          <li>Reverse engineer, decompile, or disassemble the software</li>
          <li>Remove or modify any proprietary notices or labels</li>
        </ul>

        <h3>5.3 License Verification</h3>
        <p>
          Standalone software may periodically verify license validity. Licenses obtained through
          fraud or violation of these Terms may be revoked.
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

        <h2>8. Team and Organization Accounts</h2>

        <h3>8.1 Administrator Responsibilities</h3>
        <p>
          Organization administrators are responsible for managing team members, ensuring compliance
          with these Terms, and handling billing for their organization.
        </p>

        <h3>8.2 Member Access</h3>
        <p>
          Team members receive access based on their organization's subscription and administrator
          settings. Access may be revoked by the administrator or if the organization's subscription
          ends.
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
          United States and the State of Ohio, without regard to its conflict of law provisions.
          Any disputes arising from these Terms shall be resolved in the courts located in Ohio.
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
          <h3>Bonham Technologies, LLC</h3>
          <p>Email: legal@escapesuite.io</p>
          <p>For support inquiries: support@escapesuite.io</p>
          <p>For privacy-related requests: privacy@escapesuite.io</p>
        </div>
      </div>
    </div>
  )
}
