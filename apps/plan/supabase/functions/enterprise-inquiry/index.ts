import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const SALES_EMAIL = 'sales@escapesuite.io'

interface EnterpriseInquiry {
  name: string
  email: string
  company: string
  message: string
}

async function sendNotificationEmail(inquiry: EnterpriseInquiry): Promise<void> {
  const resendApiKey = Deno.env.get('RESEND_API_KEY')
  if (!resendApiKey) {
    console.warn('RESEND_API_KEY not configured, skipping email notification')
    return
  }

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${resendApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: 'ESCAPE Suite <noreply@escapesuite.io>',
      to: [SALES_EMAIL],
      reply_to: inquiry.email,
      subject: `New Enterprise Inquiry - ${inquiry.company}`,
      html: `
        <h2>New Enterprise Inquiry</h2>
        <p>A new enterprise inquiry has been submitted:</p>
        <table style="border-collapse: collapse; width: 100%; max-width: 600px;">
          <tr>
            <td style="padding: 8px; border: 1px solid #ddd; font-weight: bold;">Name</td>
            <td style="padding: 8px; border: 1px solid #ddd;">${escapeHtml(inquiry.name)}</td>
          </tr>
          <tr>
            <td style="padding: 8px; border: 1px solid #ddd; font-weight: bold;">Email</td>
            <td style="padding: 8px; border: 1px solid #ddd;"><a href="mailto:${escapeHtml(inquiry.email)}">${escapeHtml(inquiry.email)}</a></td>
          </tr>
          <tr>
            <td style="padding: 8px; border: 1px solid #ddd; font-weight: bold;">Company</td>
            <td style="padding: 8px; border: 1px solid #ddd;">${escapeHtml(inquiry.company)}</td>
          </tr>
          <tr>
            <td style="padding: 8px; border: 1px solid #ddd; font-weight: bold;">Message</td>
            <td style="padding: 8px; border: 1px solid #ddd;">${inquiry.message ? escapeHtml(inquiry.message) : '<em>No message provided</em>'}</td>
          </tr>
        </table>
        <p style="margin-top: 20px; color: #666;">
          Reply directly to this email to respond to the customer.
        </p>
      `,
    }),
  })

  if (!response.ok) {
    const error = await response.text()
    console.error('Failed to send notification email:', error)
  } else {
    console.log('Notification email sent to', SALES_EMAIL)
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
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    const { name, email, company, message }: EnterpriseInquiry = await req.json()

    // Validate required fields
    if (!name || !email || !company) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields: name, email, and company are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(email)) {
      return new Response(
        JSON.stringify({ error: 'Invalid email format' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Store the inquiry in the database
    const { data, error } = await supabase
      .from('enterprise_inquiries')
      .insert({
        name,
        email,
        company,
        message: message || null,
        created_at: new Date().toISOString(),
      })
      .select()
      .single()

    if (error) {
      console.error('Database error:', error)
      return new Response(
        JSON.stringify({ error: 'Failed to submit inquiry. Please try again.' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Send notification email to sales
    await sendNotificationEmail({ name, email, company, message })

    return new Response(
      JSON.stringify({
        success: true,
        message: 'Thank you for your inquiry. We will be in touch within 1-2 business days.',
        id: data.id
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (error) {
    console.error('Enterprise inquiry error:', error)
    return new Response(
      JSON.stringify({ error: error.message || 'An unexpected error occurred' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
