import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { jsonResponse, handleOptions } from '../_shared/cors.ts'
import { requireUser, serviceClient, assertOrgRole, AuthError } from '../_shared/auth.ts'

interface RemoveMemberRequest {
  organizationId: string
  memberId: string
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return handleOptions()

  try {
    const user = await requireUser(req)
    const supabase = serviceClient()

    const body: RemoveMemberRequest = await req.json()
    const { organizationId, memberId } = body

    if (!organizationId || !memberId) {
      return jsonResponse({ error: 'Missing required fields' }, 400)
    }

    // Get requester's membership (verifies they are a joined member and gives us their role)
    const requesterMembership = await assertOrgRole(
      supabase,
      organizationId,
      user.id,
      ['owner', 'admin', 'member']
    )

    // Get the target member
    const { data: targetMember, error: memberError } = await supabase
      .from('organization_members')
      .select('*')
      .eq('id', memberId)
      .eq('organization_id', organizationId)
      .single()

    if (memberError || !targetMember) {
      return jsonResponse({ error: 'Member not found' }, 404)
    }

    // Check permissions
    const isSelfRemove = targetMember.user_id === user.id
    const isOwner = requesterMembership.role === 'owner'
    const isAdmin = requesterMembership.role === 'admin'

    // Users can remove themselves (leave org)
    // Owners can remove anyone except themselves
    // Admins can remove members (not other admins or owner)

    if (targetMember.role === 'owner') {
      return jsonResponse(
        { error: 'Cannot remove the owner. Transfer ownership first.' },
        400
      )
    }

    if (!isSelfRemove) {
      if (!isOwner && !isAdmin) {
        return jsonResponse({ error: 'Only owners and admins can remove members' }, 403)
      }

      // Admins can only remove members, not other admins
      if (isAdmin && targetMember.role === 'admin') {
        return jsonResponse({ error: 'Admins cannot remove other admins' }, 403)
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
        user_id: user.id,
        action: isSelfRemove ? 'member.left' : 'member.removed',
        resource_type: 'member',
        resource_id: memberId,
        metadata: {
          targetUserId: targetMember.user_id,
          email: targetMember.email,
          role: targetMember.role,
          removedBy: isSelfRemove ? 'self' : user.id,
        },
      })
    }

    return jsonResponse({
      message: isSelfRemove
        ? 'You have left the organization'
        : `${targetMember.email} has been removed`,
      removedMember: {
        id: memberId,
        email: targetMember.email,
      },
    })
  } catch (error) {
    if (error instanceof AuthError) return jsonResponse({ error: error.message }, error.status)
    console.error('Remove member error:', error)
    return jsonResponse({ error: error.message }, 500)
  }
})
