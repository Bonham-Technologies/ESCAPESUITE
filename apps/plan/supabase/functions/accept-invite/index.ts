import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { jsonResponse, handleOptions } from '../_shared/cors.ts'
import { requireUser, serviceClient, AuthError } from '../_shared/auth.ts'

interface AcceptInviteRequest {
  token: string
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return handleOptions()

  try {
    // The accepting user's identity + email come from the verified JWT.
    const user = await requireUser(req)
    const userEmail = (user.email ?? '').toLowerCase()
    const supabase = serviceClient()

    const body: AcceptInviteRequest = await req.json()
    const { token } = body

    if (!token) {
      return jsonResponse({ error: 'Missing required field: token' }, 400)
    }
    if (!userEmail) {
      return jsonResponse({ error: 'Your account has no email address' }, 400)
    }

    // Find the invite
    const { data: invite, error: inviteError } = await supabase
      .from('organization_invites')
      .select(`
        *,
        organizations (
          id,
          name,
          slug,
          plan,
          seat_count,
          settings
        )
      `)
      .eq('token', token)
      .is('accepted_at', null)
      .single()

    if (inviteError || !invite) {
      return jsonResponse({ error: 'Invite not found or already used' }, 404)
    }

    if (new Date(invite.expires_at) < new Date()) {
      return jsonResponse({ error: 'Invite has expired' }, 400)
    }

    // The invite is bound to a specific email; the verified session must match.
    if (invite.email.toLowerCase() !== userEmail) {
      return jsonResponse({ error: 'This invite was sent to a different email address' }, 403)
    }

    const organization = invite.organizations

    // Re-check seats (may have filled since the invite was sent).
    const { count: memberCount } = await supabase
      .from('organization_members')
      .select('*', { count: 'exact', head: true })
      .eq('organization_id', organization.id)
      .not('joined_at', 'is', null)

    if ((memberCount || 0) >= organization.seat_count) {
      return jsonResponse({ error: 'No available seats in this organization' }, 400)
    }

    // Add the verified user as a member.
    const { data: member, error: memberError } = await supabase
      .from('organization_members')
      .insert({
        organization_id: organization.id,
        user_id: user.id,
        email: userEmail,
        role: invite.role,
        invited_at: invite.created_at,
        joined_at: new Date().toISOString(),
      })
      .select()
      .single()

    if (memberError) {
      if (memberError.code === '23505') {
        return jsonResponse({ error: 'Already a member of this organization' }, 409)
      }
      console.error('Add member error:', memberError)
      throw memberError
    }

    await supabase
      .from('organization_invites')
      .update({ accepted_at: new Date().toISOString() })
      .eq('id', invite.id)

    if (organization.settings?.audit_logging) {
      await supabase.from('audit_logs').insert({
        organization_id: organization.id,
        user_id: user.id,
        action: 'member.joined',
        resource_type: 'member',
        resource_id: member.id,
        metadata: { email: userEmail, role: invite.role, inviteId: invite.id },
      })
    }

    return jsonResponse({
      organization: {
        id: organization.id,
        name: organization.name,
        slug: organization.slug,
        plan: organization.plan,
      },
      membership: {
        id: member.id,
        role: member.role,
        joinedAt: member.joined_at,
      },
      message: `Successfully joined ${organization.name}`,
    })
  } catch (error) {
    if (error instanceof AuthError) return jsonResponse({ error: error.message }, error.status)
    console.error('Accept invite error:', error)
    return jsonResponse({ error: error.message }, 500)
  }
})
