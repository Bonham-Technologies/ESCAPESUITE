import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface RemoveMemberRequest {
  clerkUserId: string
  organizationId: string
  memberId: string
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

    const body: RemoveMemberRequest = await req.json()
    const { clerkUserId, organizationId, memberId } = body

    if (!clerkUserId || !organizationId || !memberId) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Get requester's membership
    const { data: requesterMembership } = await supabase
      .from('organization_members')
      .select('role')
      .eq('organization_id', organizationId)
      .eq('user_id', clerkUserId)
      .not('joined_at', 'is', null)
      .single()

    if (!requesterMembership) {
      return new Response(
        JSON.stringify({ error: 'Not a member of this organization' }),
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

    // Check permissions
    const isSelfRemove = targetMember.user_id === clerkUserId
    const isOwner = requesterMembership.role === 'owner'
    const isAdmin = requesterMembership.role === 'admin'

    // Users can remove themselves (leave org)
    // Owners can remove anyone except themselves
    // Admins can remove members (not other admins or owner)

    if (targetMember.role === 'owner') {
      return new Response(
        JSON.stringify({ error: 'Cannot remove the owner. Transfer ownership first.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    if (!isSelfRemove) {
      if (!isOwner && !isAdmin) {
        return new Response(
          JSON.stringify({ error: 'Only owners and admins can remove members' }),
          { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      // Admins can only remove members, not other admins
      if (isAdmin && targetMember.role === 'admin') {
        return new Response(
          JSON.stringify({ error: 'Admins cannot remove other admins' }),
          { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }
    }

    // Get organization for audit logging
    const { data: organization } = await supabase
      .from('organizations')
      .select('settings')
      .eq('id', organizationId)
      .single()

    // Remove the member
    const { error: deleteError } = await supabase
      .from('organization_members')
      .delete()
      .eq('id', memberId)

    if (deleteError) {
      throw deleteError
    }

    // Log the action
    if (organization?.settings?.audit_logging) {
      await supabase.from('audit_logs').insert({
        organization_id: organizationId,
        user_id: clerkUserId,
        action: isSelfRemove ? 'member.left' : 'member.removed',
        resource_type: 'member',
        resource_id: memberId,
        metadata: {
          targetUserId: targetMember.user_id,
          email: targetMember.email,
          role: targetMember.role,
          removedBy: isSelfRemove ? 'self' : clerkUserId,
        },
      })
    }

    return new Response(
      JSON.stringify({
        message: isSelfRemove
          ? 'You have left the organization'
          : `${targetMember.email} has been removed`,
        removedMember: {
          id: memberId,
          email: targetMember.email,
        },
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (error) {
    console.error('Remove member error:', error)
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
