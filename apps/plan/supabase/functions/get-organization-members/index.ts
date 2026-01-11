import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
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

    let clerkUserId: string | null = null
    let organizationId: string | null = null

    if (req.method === 'GET') {
      const url = new URL(req.url)
      clerkUserId = url.searchParams.get('clerkUserId')
      organizationId = url.searchParams.get('organizationId')
    } else {
      const body = await req.json()
      clerkUserId = body.clerkUserId
      organizationId = body.organizationId
    }

    if (!clerkUserId || !organizationId) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields: clerkUserId, organizationId' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Check if user is a member of the organization
    const { data: membership } = await supabase
      .from('organization_members')
      .select('role')
      .eq('organization_id', organizationId)
      .eq('user_id', clerkUserId)
      .not('joined_at', 'is', null)
      .single()

    if (!membership) {
      return new Response(
        JSON.stringify({ error: 'Not a member of this organization' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Get all members
    const { data: members, error: membersError } = await supabase
      .from('organization_members')
      .select('*')
      .eq('organization_id', organizationId)
      .order('role', { ascending: true }) // owner first, then admin, then member
      .order('joined_at', { ascending: true })

    if (membersError) {
      throw membersError
    }

    // Get pending invites (only if user is admin or owner)
    let pendingInvites: any[] = []
    if (membership.role === 'owner' || membership.role === 'admin') {
      const { data: invites } = await supabase
        .from('organization_invites')
        .select('*')
        .eq('organization_id', organizationId)
        .is('accepted_at', null)
        .gt('expires_at', new Date().toISOString())
        .order('created_at', { ascending: false })

      pendingInvites = (invites || []).map((invite: any) => ({
        id: invite.id,
        email: invite.email,
        role: invite.role,
        invitedBy: invite.invited_by,
        expiresAt: invite.expires_at,
        createdAt: invite.created_at,
      }))
    }

    // Get organization info for seat count
    const { data: organization } = await supabase
      .from('organizations')
      .select('seat_count')
      .eq('id', organizationId)
      .single()

    const activeMembers = (members || []).filter((m: any) => m.joined_at)
    const usedSeats = activeMembers.length
    const totalSeats = organization?.seat_count || 0
    const availableSeats = totalSeats - usedSeats

    return new Response(
      JSON.stringify({
        members: (members || []).map((member: any) => ({
          id: member.id,
          userId: member.user_id,
          email: member.email,
          role: member.role,
          invitedAt: member.invited_at,
          joinedAt: member.joined_at,
          status: member.joined_at ? 'active' : 'invited',
        })),
        pendingInvites,
        seats: {
          total: totalSeats,
          used: usedSeats,
          available: availableSeats,
        },
        currentUserRole: membership.role,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (error) {
    console.error('Get organization members error:', error)
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
