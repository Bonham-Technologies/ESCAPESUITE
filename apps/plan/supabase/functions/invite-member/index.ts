import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { jsonResponse, handleOptions } from '../_shared/cors.ts'
import { requireUser, serviceClient, assertOrgRole, AuthError } from '../_shared/auth.ts'

interface InviteMemberRequest {
  organizationId: string
  email: string
  role?: 'admin' | 'member'
}

// Generate URL-safe random token (256-bit)
function generateToken(): string {
  const array = new Uint8Array(32)
  crypto.getRandomValues(array)
  return Array.from(array, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return handleOptions()

  try {
    const user = await requireUser(req)
    const supabase = serviceClient()

    const body: InviteMemberRequest = await req.json()
    const { organizationId, email, role = 'member' } = body

    if (!organizationId || !email) {
      return jsonResponse({ error: 'Missing required fields: organizationId, email' }, 400)
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(email)) {
      return jsonResponse({ error: 'Invalid email format' }, 400)
    }

    // Authorize: caller must be an admin/owner of this org (verified identity).
    const membership = await assertOrgRole(supabase, organizationId, user.id, ['owner', 'admin'])

    // Only owners can invite admins
    if (role === 'admin' && membership.role !== 'owner') {
      return jsonResponse({ error: 'Only owners can invite admins' }, 403)
    }

    const { data: organization, error: orgError } = await supabase
      .from('organizations')
      .select('id, name, seat_count, settings')
      .eq('id', organizationId)
      .single()

    if (orgError || !organization) {
      return jsonResponse({ error: 'Organization not found' }, 404)
    }

    // Check allowed domains (if configured)
    const allowedDomains = organization.settings?.allowed_domains || []
    if (allowedDomains.length > 0) {
      const emailDomain = email.split('@')[1]
      if (!allowedDomains.includes(emailDomain)) {
        return jsonResponse(
          { error: `Email domain not allowed. Allowed domains: ${allowedDomains.join(', ')}` },
          400
        )
      }
    }

    // Already a member?
    const { data: existingMember } = await supabase
      .from('organization_members')
      .select('id, joined_at')
      .eq('organization_id', organizationId)
      .eq('email', email.toLowerCase())
      .maybeSingle()

    if (existingMember?.joined_at) {
      return jsonResponse({ error: 'User is already a member of this organization' }, 409)
    }

    // Seat check
    const { count: memberCount } = await supabase
      .from('organization_members')
      .select('*', { count: 'exact', head: true })
      .eq('organization_id', organizationId)
      .not('joined_at', 'is', null)

    if ((memberCount || 0) >= organization.seat_count) {
      return jsonResponse({ error: 'No available seats. Please upgrade your plan.' }, 400)
    }

    // Existing pending invite?
    const { data: existingInvite } = await supabase
      .from('organization_invites')
      .select('id, expires_at')
      .eq('organization_id', organizationId)
      .eq('email', email.toLowerCase())
      .is('accepted_at', null)
      .gt('expires_at', new Date().toISOString())
      .maybeSingle()

    if (existingInvite) {
      return jsonResponse({ error: 'An active invite already exists for this email' }, 409)
    }

    // Create the invite token row (carries role / seat / expiry).
    const token = generateToken()
    const expiresAt = new Date()
    expiresAt.setDate(expiresAt.getDate() + 7)

    const { data: invite, error: inviteError } = await supabase
      .from('organization_invites')
      .insert({
        organization_id: organizationId,
        email: email.toLowerCase(),
        role,
        invited_by: user.id,
        token,
        expires_at: expiresAt.toISOString(),
      })
      .select()
      .single()

    if (inviteError) {
      console.error('Create invite error:', inviteError)
      throw inviteError
    }

    const inviteUrl = `${Deno.env.get('APP_URL') || 'https://escapesuite.io'}/invite/${token}`

    // Pre-create the invitee + email them a one-click link via Supabase Auth.
    // Existing users won't be re-created — they can accept via the invite URL
    // while signed in, so a "already registered" error is non-fatal.
    const { error: inviteEmailError } = await supabase.auth.admin.inviteUserByEmail(
      email.toLowerCase(),
      { redirectTo: inviteUrl }
    )
    if (inviteEmailError && !/already.*registered|already.*exist/i.test(inviteEmailError.message)) {
      console.error('inviteUserByEmail error (non-fatal):', inviteEmailError.message)
    }

    // Audit log (if enabled)
    if (organization.settings?.audit_logging) {
      await supabase.from('audit_logs').insert({
        organization_id: organizationId,
        user_id: user.id,
        action: 'member.invited',
        resource_type: 'invite',
        resource_id: invite.id,
        metadata: { email: email.toLowerCase(), role },
      })
    }

    return jsonResponse({
      invite: {
        id: invite.id,
        email: invite.email,
        role: invite.role,
        expiresAt: invite.expires_at,
      },
      inviteUrl,
      message: `Invitation sent to ${email}`,
    })
  } catch (error) {
    if (error instanceof AuthError) return jsonResponse({ error: error.message }, error.status)
    console.error('Invite member error:', error)
    return jsonResponse({ error: error.message }, 500)
  }
})
