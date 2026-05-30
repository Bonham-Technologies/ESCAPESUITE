import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { jsonResponse, handleOptions } from '../_shared/cors.ts'
import { requireUser, serviceClient, assertOrgRole, AuthError } from '../_shared/auth.ts'

interface UpdateMemberRoleRequest {
  organizationId: string
  memberId: string
  newRole: 'admin' | 'member'
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return handleOptions()

  try {
    const user = await requireUser(req)
    const supabase = serviceClient()

    const body: UpdateMemberRoleRequest = await req.json()
    const { organizationId, memberId, newRole } = body

    if (!organizationId || !memberId || !newRole) {
      return jsonResponse({ error: 'Missing required fields' }, 400)
    }

    if (!['admin', 'member'].includes(newRole)) {
      return jsonResponse({ error: 'Invalid role. Must be "admin" or "member"' }, 400)
    }

    // Only owners can change member roles
    await assertOrgRole(supabase, organizationId, user.id, ['owner'])

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

    // Cannot change owner's role
    if (targetMember.role === 'owner') {
      return jsonResponse(
        { error: 'Cannot change owner role. Use transfer ownership instead.' },
        400
      )
    }

    // Cannot change your own role
    if (targetMember.user_id === user.id) {
      return jsonResponse({ error: 'Cannot change your own role' }, 400)
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
        user_id: user.id,
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

    return jsonResponse({
      member: {
        id: memberId,
        role: newRole,
        email: targetMember.email,
      },
      message: `Role updated to ${newRole}`,
    })
  } catch (error) {
    if (error instanceof AuthError) {
      return jsonResponse({ error: error.message }, error.status)
    }
    console.error('Update member role error:', error)
    return jsonResponse({ error: error.message }, 500)
  }
})
