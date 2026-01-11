import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface UpdateMemberRoleRequest {
  clerkUserId: string
  organizationId: string
  memberId: string
  newRole: 'admin' | 'member'
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

    const body: UpdateMemberRoleRequest = await req.json()
    const { clerkUserId, organizationId, memberId, newRole } = body

    if (!clerkUserId || !organizationId || !memberId || !newRole) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    if (!['admin', 'member'].includes(newRole)) {
      return new Response(
        JSON.stringify({ error: 'Invalid role. Must be "admin" or "member"' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Check if requester is owner
    const { data: requesterMembership } = await supabase
      .from('organization_members')
      .select('role')
      .eq('organization_id', organizationId)
      .eq('user_id', clerkUserId)
      .not('joined_at', 'is', null)
      .single()

    if (!requesterMembership || requesterMembership.role !== 'owner') {
      return new Response(
        JSON.stringify({ error: 'Only owners can change member roles' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Get the target member
    const { data: targetMember, error: memberError } = await supabase
      .from('organization_members')
      .select('*')
      .eq('id', memberId)
      .eq('organization_id', organizationId)
      .single()

    if (memberError || !targetMember) {
      return new Response(
        JSON.stringify({ error: 'Member not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Cannot change owner's role
    if (targetMember.role === 'owner') {
      return new Response(
        JSON.stringify({ error: 'Cannot change owner role. Use transfer ownership instead.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Cannot change your own role
    if (targetMember.user_id === clerkUserId) {
      return new Response(
        JSON.stringify({ error: 'Cannot change your own role' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const oldRole = targetMember.role

    // Update the role
    const { error: updateError } = await supabase
      .from('organization_members')
      .update({ role: newRole })
      .eq('id', memberId)

    if (updateError) {
      throw updateError
    }

    // Get organization for audit logging
    const { data: organization } = await supabase
      .from('organizations')
      .select('settings')
      .eq('id', organizationId)
      .single()

    // Log the action
    if (organization?.settings?.audit_logging) {
      await supabase.from('audit_logs').insert({
        organization_id: organizationId,
        user_id: clerkUserId,
        action: 'member.role_changed',
        resource_type: 'member',
        resource_id: memberId,
        metadata: {
          targetUserId: targetMember.user_id,
          email: targetMember.email,
          oldRole,
          newRole,
        },
      })
    }

    return new Response(
      JSON.stringify({
        member: {
          id: memberId,
          role: newRole,
          email: targetMember.email,
        },
        message: `Role updated to ${newRole}`,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (error) {
    console.error('Update member role error:', error)
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
