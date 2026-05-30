import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { jsonResponse, handleOptions } from '../_shared/cors.ts'
import { AuthError } from '../_shared/auth.ts'

interface SendLicenseEmailRequest {
  licenseKey: string
  customerEmail: string
  customerName: string
  product: 'craft' | 'artist' | 'suite'
  tier: 'standard' | 'pro' | 'lifetime'
}

function getProductDisplayName(product: string): string {
  switch (product) {
    case 'craft':
      return 'ESCAPECRAFT'
    case 'artist':
      return 'ESCAPEARTIST'
    case 'suite':
      return 'ESCAPE Suite Bundle'
    default:
      return product
  }
}

function getTierDescription(tier: string): string {
  switch (tier) {
    case 'lifetime':
      return 'Lifetime License - Perpetual updates'
    case 'pro':
      return 'Pro License - 2 years of updates'
    case 'standard':
      return 'Standard License - 1 year of updates'
    default:
      return tier
  }
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') return handleOptions()

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405)
  }

  try {
    // Internal-only guard: this function is called server-to-server by the
    // webhook. Reject unless the bearer token is the service-role key.
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    const authHeader = req.headers.get('Authorization') ?? ''
    const token = authHeader.replace(/^Bearer\s+/i, '')
    if (!serviceRoleKey || token !== serviceRoleKey) {
      throw new AuthError('Forbidden', 403)
    }

    const {
      licenseKey,
      customerEmail,
      customerName,
      product,
      tier,
    }: SendLicenseEmailRequest = await req.json()

    // Validate required fields
    if (!licenseKey || !customerEmail || !product || !tier) {
      return jsonResponse({ error: 'Missing required fields' }, 400)
    }

    const resendApiKey = Deno.env.get('RESEND_API_KEY')
    if (!resendApiKey) {
      console.warn('RESEND_API_KEY not configured, skipping email')
      return jsonResponse({ success: true, message: 'Email skipped (no API key)' })
    }

    const productName = getProductDisplayName(product)
    const tierDescription = getTierDescription(tier)
    const displayName = customerName || 'Valued Customer'

    const emailHtml = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Your ESCAPE Suite License</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #0a0a0f; color: #e4e4e7;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #0a0a0f; padding: 40px 20px;">
    <tr>
      <td align="center">
        <table width="100%" style="max-width: 600px; background-color: #18181b; border-radius: 16px; overflow: hidden;">
          <!-- Header -->
          <tr>
            <td style="padding: 40px 40px 20px; text-align: center; background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%);">
              <h1 style="margin: 0; font-size: 28px; font-weight: 700; color: white;">
                🎉 Thank You for Your Purchase!
              </h1>
            </td>
          </tr>

          <!-- Content -->
          <tr>
            <td style="padding: 40px;">
              <p style="margin: 0 0 20px; font-size: 16px; line-height: 1.6;">
                Hi ${escapeHtml(displayName)},
              </p>
              <p style="margin: 0 0 30px; font-size: 16px; line-height: 1.6;">
                Your license for <strong>${escapeHtml(productName)}</strong> is ready! Here are your license details:
              </p>

              <!-- License Details Card -->
              <div style="background-color: #09090b; border: 1px solid #27272a; border-radius: 12px; padding: 24px; margin-bottom: 30px;">
                <p style="margin: 0 0 8px; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; color: #71717a;">
                  Product
                </p>
                <p style="margin: 0 0 20px; font-size: 18px; font-weight: 600; color: #e4e4e7;">
                  ${escapeHtml(productName)}
                </p>

                <p style="margin: 0 0 8px; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; color: #71717a;">
                  License Type
                </p>
                <p style="margin: 0 0 20px; font-size: 16px; color: #a1a1aa;">
                  ${escapeHtml(tierDescription)}
                </p>

                <p style="margin: 0 0 8px; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; color: #71717a;">
                  Your License Key
                </p>
                <div style="background-color: #18181b; border: 1px solid #27272a; border-radius: 8px; padding: 16px; overflow-x: auto;">
                  <code style="font-family: 'SF Mono', Monaco, Consolas, monospace; font-size: 12px; color: #6366f1; word-break: break-all;">
                    ${escapeHtml(licenseKey)}
                  </code>
                </div>
              </div>

              <!-- Getting Started -->
              <h2 style="margin: 0 0 20px; font-size: 20px; font-weight: 600;">
                Getting Started
              </h2>

              <div style="margin-bottom: 30px;">
                <div style="display: flex; margin-bottom: 16px;">
                  <div style="width: 32px; height: 32px; background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%); border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; color: white; font-weight: 700; font-size: 14px; margin-right: 16px; flex-shrink: 0;">1</div>
                  <div>
                    <strong style="color: #e4e4e7;">Download</strong>
                    <p style="margin: 4px 0 0; color: #a1a1aa; font-size: 14px;">
                      Visit the <a href="https://escapesuite.io/portal/downloads" style="color: #6366f1;">Downloads Portal</a> to get your standalone app.
                    </p>
                  </div>
                </div>

                <div style="display: flex; margin-bottom: 16px;">
                  <div style="width: 32px; height: 32px; background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%); border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; color: white; font-weight: 700; font-size: 14px; margin-right: 16px; flex-shrink: 0;">2</div>
                  <div>
                    <strong style="color: #e4e4e7;">Open the App</strong>
                    <p style="margin: 4px 0 0; color: #a1a1aa; font-size: 14px;">
                      Double-click the HTML file to open it in your browser.
                    </p>
                  </div>
                </div>

                <div style="display: flex;">
                  <div style="width: 32px; height: 32px; background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%); border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; color: white; font-weight: 700; font-size: 14px; margin-right: 16px; flex-shrink: 0;">3</div>
                  <div>
                    <strong style="color: #e4e4e7;">Activate</strong>
                    <p style="margin: 4px 0 0; color: #a1a1aa; font-size: 14px;">
                      Paste your license key when prompted. Works offline!
                    </p>
                  </div>
                </div>
              </div>

              <!-- CTA Button -->
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td align="center">
                    <a href="https://escapesuite.io/portal/downloads"
                       style="display: inline-block; padding: 14px 32px; background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%); color: white; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 16px;">
                      Go to Downloads Portal
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding: 30px 40px; background-color: #09090b; border-top: 1px solid #27272a;">
              <p style="margin: 0 0 10px; font-size: 14px; color: #71717a; text-align: center;">
                Need help? Contact us at <a href="mailto:support@escapesuite.io" style="color: #6366f1;">support@escapesuite.io</a>
              </p>
              <p style="margin: 0; font-size: 12px; color: #52525b; text-align: center;">
                © ${new Date().getFullYear()} ESCAPE Suite. All rights reserved.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
    `

    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${resendApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'ESCAPE Suite <noreply@escapesuite.io>',
        to: [customerEmail],
        subject: `Your ${productName} License Key`,
        html: emailHtml,
      }),
    })

    if (!response.ok) {
      const error = await response.text()
      console.error('Failed to send license email:', error)
      return jsonResponse({ error: 'Failed to send email', details: error }, 500)
    }

    const result = await response.json()
    console.log('License email sent to', customerEmail, 'Email ID:', result.id)

    return jsonResponse({
      success: true,
      message: 'License email sent successfully',
      emailId: result.id,
    })
  } catch (error) {
    if (error instanceof AuthError) return jsonResponse({ error: error.message }, error.status)
    console.error('Send license email error:', error)
    return jsonResponse({ error: error.message || 'An unexpected error occurred' }, 500)
  }
})
