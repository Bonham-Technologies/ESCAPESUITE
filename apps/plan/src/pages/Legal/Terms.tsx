import styles from './Legal.module.css'

export default function Terms() {
  return (
    <div className={styles.legal}>
      <header className={styles.header}>
        <h1 className={styles.title}>Terms of Service</h1>
        <p className={styles.lastUpdated}>Last updated: August 18, 2026</p>
      </header>

      <div className={styles.content}>
        <div className={styles.highlight}>
          <p>
            <strong>Summary:</strong> ESCAPE Suite provides free, privacy-first video creation tools.
            You own your content. We provide the software. Be respectful and don't misuse our services.
          </p>
        </div>

        <h2>1. Agreement to Terms</h2>
        <p>
          By accessing or using ESCAPE Suite applications (ESCAPEPLAN, ESCAPECRAFT, and ESCAPEARTIST),
          operated by Bonham Technologies, LLC ("Company," "we," "us," or "our"), you agree to be bound
          by these Terms of Service ("Terms"). If you disagree with any part of these terms, you do not
          have permission to access our services.
        </p>
        <p>
          The ESCAPE Suite software is open source under the MIT License; these terms govern use of the
          hosted service at escapesuite.io.
        </p>

        <h2>2. Description of Services</h2>
        <p>
          ESCAPE Suite provides free, MIT-licensed, browser-based video creation tools, offered both as
          a hosted web application and as downloadable offline builds:
        </p>
        <ul>
          <li>
            <strong>ESCAPEPLAN</strong> - The hub for discovering and launching the ESCAPE Suite
            applications, and for downloading the offline build
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
          You can use ESCAPE Suite at escapesuite.io, or download a single-file offline build (available
          from our GitHub Releases) to run entirely on your own device without an internet connection.
          Either way, our applications process video content locally on your device. We do not upload,
          store, or process your video recordings on our servers.
        </p>

        <h2>3. Content Ownership</h2>

        <h3>3.1 Your Content</h3>
        <p>
          You retain full ownership of all video recordings, projects, and exported content you
          create using our applications. We claim no intellectual property rights over your content.
        </p>

        <h3>3.2 Our Content</h3>
        <p>
          The ESCAPE Suite applications, including all software, design, logos, and documentation,
          are owned by Bonham Technologies, LLC and made available under the MIT License. You may
          copy, modify, and distribute our software in accordance with that license.
        </p>

        <h2>4. Acceptable Use</h2>
        <p>You agree not to use our services to:</p>
        <ul>
          <li>Violate any applicable laws or regulations</li>
          <li>Record or distribute content without proper consent from all parties</li>
          <li>Create, store, or distribute illegal, harmful, or objectionable content</li>
          <li>Infringe on the intellectual property rights of others</li>
          <li>Attempt to gain unauthorized access to our systems</li>
          <li>Interfere with or disrupt the integrity or performance of our services</li>
          <li>Use automated systems or bots to access our services without permission</li>
          <li>Circumvent any access restrictions or usage limits</li>
        </ul>

        <h2>5. Privacy</h2>
        <p>
          Your use of our services is also governed by our <a href="/privacy">Privacy Policy</a>,
          which explains how we collect, use, and protect your information. By using our services,
          you consent to our privacy practices.
        </p>

        <h2>6. Disclaimers</h2>

        <h3>6.1 Service Availability</h3>
        <p>
          We strive to provide reliable services but do not guarantee uninterrupted access. Services
          may be temporarily unavailable due to maintenance, updates, or circumstances beyond our
          control.
        </p>

        <h3>6.2 "As Is" Provision</h3>
        <p>
          Our services are provided "as is" and "as available" without warranties of any kind,
          either express or implied, including but not limited to implied warranties of
          merchantability, fitness for a particular purpose, or non-infringement.
        </p>

        <h3>6.3 Data Loss</h3>
        <p>
          Since your content is stored locally on your device, we are not responsible for data
          loss due to browser data clearing, device failure, or other local storage issues. We
          recommend regularly exporting important projects.
        </p>

        <h2>7. Limitation of Liability</h2>
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
          Our services are provided free of charge. To the maximum extent permitted by law, our total
          liability for any claims arising from these Terms or your use of our services shall not
          exceed one hundred U.S. dollars (US$100).
        </p>

        <h2>8. Indemnification</h2>
        <p>
          You agree to indemnify, defend, and hold harmless Bonham Technologies, LLC, its officers,
          directors, employees, and agents from any claims, damages, losses, liabilities, and
          expenses (including legal fees) arising from your use of our services, violation of
          these Terms, or infringement of any rights of another party.
        </p>

        <h2>9. Governing Law</h2>
        <p>
          These Terms shall be governed by and construed in accordance with the laws of the
          United States and the State of Utah, without regard to its conflict of law provisions.
          Any disputes arising from these Terms shall be resolved in the courts located in Utah.
        </p>

        <h2>10. Changes to Terms</h2>
        <p>
          We reserve the right to modify these Terms at any time. We will notify you of significant
          changes by posting the updated Terms on this site at least 30 days before they take effect.
          Your continued use of our services after changes become effective constitutes acceptance
          of the revised Terms.
        </p>

        <h2>11. Severability</h2>
        <p>
          If any provision of these Terms is found to be unenforceable or invalid, that provision
          shall be limited or eliminated to the minimum extent necessary so that these Terms shall
          otherwise remain in full force and effect.
        </p>

        <h2>12. Entire Agreement</h2>
        <p>
          These Terms, together with our Privacy Policy, constitute the entire agreement between
          you and Bonham Technologies, LLC regarding your use of our services and supersede any
          prior agreements.
        </p>

        <h2>13. Contact Us</h2>
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
