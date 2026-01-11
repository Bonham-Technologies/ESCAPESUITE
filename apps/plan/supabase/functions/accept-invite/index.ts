import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface AcceptInviteRequest {
  clerkUserId: string
  email: string
  token: string
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

    const body: AcceptInviteRequest = await req.json()
    const { clerkUserId, email, token } = body

    if (!clerkUserId || !email || !token) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields: clerkUserId, email, token' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
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
      return new Response(
        JSON.stringify({ error: 'Invite not found or already used' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Check if invite has expired
    if (new Date(invite.expires_at) < new Date()) {
      return new Response(
        JSON.stringify({ error: 'Invite has expired' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Verify email matches
    if (invite.email.toLowerCase() !== email.toLowerCase()) {
      return new Response(
        JSON.stringify({ error: 'Email does not match invite' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const organization = invite.organizations

    // Check available seats again (in case they ran out since invite was sent)
    const { count: memberCount } = await supabase
      .from('organization_members')
      .select('*', { count: 'exact', head: true })
      .eq('organization_id', organization.id)
      .not('joined_at', 'is', null)

    if ((memberCount || 0) >= organization.seat_count) {
      return new Response(
        JSON.stringify({ error: 'No available seats in this organization' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Check if user is already a member of another organization
    // (for now, allow users to be in multiple orgs - uncomment to restrict)
    // const { data: existingMembership } = await supabase
    //   .from('organization_members')
    //   .select('organization_id')
    //   .eq('user_id', clerkUserId)
    //   .not('joined_at', 'is', null)
    //   .single()
    //
    // if (existingMembership) {
    //   return new Response(
    //     JSON.stringify({ error: 'User is already a member of another organization' }),
    //     { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    //   )
    // }

    // Add user as member
    const { data: member, error: memberError } = await supabase
      .from('organization_members')
      .insert({
        organization_id: organization.id,
        user_id: clerkUserId,
        email: email.toLowerCase(),
        role: invite.role,
        invited_at: invite.created_at,
        joined_at: new Date().toISOString(),
      })
      .select()
      .single()

    if (memberError) {
      // Check if user is already a member (race condition)
      if (memberError.code === '23505') { // unique_violation
        return new Response(
          JSON.stringify({ error: 'Already a member of this organization' }),
          { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }
      console.error('Add member error:', memberError)
      throw memberError
    }

    // Mark invite as accepted
    await supabase
      .from('organization_invites')
      .update({ accepted_at: new Date().toISOString() })
      .eq('id', invite.id)

    // Log the action (if audit logging enabled)
    if (organization.settings?.audit_logging) {
      await supabase.from('audit_logs').insert({
        organization_id: organization.id,
        user_id: clerkUserId,
        action: 'member.joined',
        resource_type: 'member',
        resource_id: member.id,
        metadata: { email: email.toLowerCase(), role: invite.role, inviteId: invite.id },
      })
    }

    return new Response(
      JSON.stringify({
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
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (error) {
    console.error('Accept invite error:', error)
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
