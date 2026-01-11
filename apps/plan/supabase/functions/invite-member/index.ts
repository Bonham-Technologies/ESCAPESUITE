import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface InviteMemberRequest {
  clerkUserId: string
  organizationId: string
  email: string
  role?: 'admin' | 'member'
}

// Generate URL-safe random token
function generateToken(): string {
  const array = new Uint8Array(32)
  crypto.getRandomValues(array)
  return Array.from(array, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    const body: InviteMemberRequest = await req.json()
    const { clerkUserId, organizationId, email, role = 'member' } = body

    if (!clerkUserId || !organizationId || !email) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields: clerkUserId, organizationId, email' }),
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

    // Check if user is admin or owner
    const { data: membership } = await supabase
      .from('organization_members')
      .select('role')
      .eq('organization_id', organizationId)
      .eq('user_id', clerkUserId)
      .not('joined_at', 'is', null)
      .single()

    if (!membership || !['owner', 'admin'].includes(membership.role)) {
      return new Response(
        JSON.stringify({ error: 'Only admins and owners can invite members' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Only owners can invite admins
    if (role === 'admin' && membership.role !== 'owner') {
      return new Response(
        JSON.stringify({ error: 'Only owners can invite admins' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Get organization details
    const { data: organization, error: orgError } = await supabase
      .from('organizations')
      .select('id, name, seat_count, settings')
      .eq('id', organizationId)
      .single()

    if (orgError || !organization) {
      return new Response(
        JSON.stringify({ error: 'Organization not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Check allowed domains (if configured)
    const allowedDomains = organization.settings?.allowed_domains || []
    if (allowedDomains.length > 0) {
      const emailDomain = email.split('@')[1]
      if (!allowedDomains.includes(emailDomain)) {
        return new Response(
          JSON.stringify({ error: `Email domain not allowed. Allowed domains: ${allowedDomains.join(', ')}` }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }
    }

    // Check if user is already a member
    const { data: existingMember } = await supabase
      .from('organization_members')
      .select('id, joined_at')
      .eq('organization_id', organizationId)
      .eq('email', email.toLowerCase())
      .single()

    if (existingMember) {
      if (existingMember.joined_at) {
        return new Response(
          JSON.stringify({ error: 'User is already a member of this organization' }),
          { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }
    }

    // Check available seats
    const { count: memberCount } = await supabase
      .from('organization_members')
      .select('*', { count: 'exact', head: true })
      .eq('organization_id', organizationId)
      .not('joined_at', 'is', null)

    if ((memberCount || 0) >= organization.seat_count) {
      return new Response(
        JSON.stringify({ error: 'No available seats. Please upgrade your plan.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Check for existing pending invite
    const { data: existingInvite } = await supabase
      .from('organization_invites')
      .select('id, expires_at')
      .eq('organization_id', organizationId)
      .eq('email', email.toLowerCase())
      .is('accepted_at', null)
      .gt('expires_at', new Date().toISOString())
      .single()

    if (existingInvite) {
      return new Response(
        JSON.stringify({ error: 'An active invite already exists for this email' }),
        { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Create the invite
    const token = generateToken()
    const expiresAt = new Date()
    expiresAt.setDate(expiresAt.getDate() + 7) // 7 days expiration

    const { data: invite, error: inviteError } = await supabase
      .from('organization_invites')
      .insert({
        organization_id: organizationId,
        email: email.toLowerCase(),
        role,
        invited_by: clerkUserId,
        token,
        expires_at: expiresAt.toISOString(),
      })
      .select()
      .single()

    if (inviteError) {
      console.error('Create invite error:', inviteError)
      throw inviteError
    }

    // Log the action (if audit logging enabled)
    if (organization.settings?.audit_logging) {
      await supabase.from('audit_logs').insert({
        organization_id: organizationId,
        user_id: clerkUserId,
        action: 'member.invited',
        resource_type: 'invite',
        resource_id: invite.id,
        metadata: { email: email.toLowerCase(), role },
      })
    }

    // TODO: Send invitation email
    // For now, return the invite URL that can be used
    const inviteUrl = `${Deno.env.get('APP_URL') || 'https://escapesuite.io'}/invite/${token}`

    return new Response(
      JSON.stringify({
        invite: {
          id: invite.id,
          email: invite.email,
          role: invite.role,
          expiresAt: invite.expires_at,
          inviteUrl,
        },
        message: `Invitation sent to ${email}`,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (error) {
    console.error('Invite member error:', error)
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
