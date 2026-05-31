import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { jsonResponse, handleOptions } from '../_shared/cors.ts'
import {
  requireUser,
  serviceClient,
  assertOrgRole,
  AuthError,
} from '../_shared/auth.ts'

interface UpdateOrganizationRequest {
  organizationId: string
  name?: string
  settings?: {
    sso_enabled?: boolean
    require_2fa?: boolean
    audit_logging?: boolean
    allowed_domains?: string[]
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return handleOptions()

  try {
    const user = await requireUser(req)
    const supabase = serviceClient()

    const body: UpdateOrganizationRequest = await req.json()
    const { organizationId, name, settings } = body

    if (!organizationId) {
      return jsonResponse(
        { error: 'Missing required fields: organizationId' },
        400
      )
    }

    // Admins may rename the org, but only owners may change security-sensitive
    // settings (SSO, 2FA, audit logging, allowed domains). Previously any admin
    // could flip these — including disabling the audit trail and org-wide 2FA. (audit M5)
    await assertOrgRole(supabase, organizationId, user.id, ['owner', 'admin'])
    if (settings && Object.keys(settings).length > 0) {
      await assertOrgRole(supabase, organizationId, user.id, ['owner'])
    }

    // Get current organization
    const { data: organization, error: orgError } = await supabase
      .from('organizations')
      .select('*')
      .eq('id', organizationId)
      .single()

    if (orgError || !organization) {
      return jsonResponse({ error: 'Organization not found' }, 404)
    }

    // Build update object
    const updates: any = {}
    const changes: any = {}

    if (name && name !== organization.name) {
      updates.name = name
      changes.name = { old: organization.name, new: name }
    }

    if (settings) {
      // Some settings are enterprise-only
      if (organization.plan !== 'enterprise') {
        if (settings.sso_enabled) {
          return jsonResponse(
            { error: 'SSO is only available on Enterprise plan' },
            400
          )
        }
      }

      const newSettings = {
        ...organization.settings,
        ...settings,
      }
      updates.settings = newSettings
      changes.settings = settings
    }

    if (Object.keys(updates).length === 0) {
      return jsonResponse({ error: 'No changes provided' }, 400)
    }

    // Update the organization
    const { data: updated, error: updateError } = await supabase
      .from('organizations')
      .update(updates)
      .eq('id', organizationId)
      .select()
      .single()

    if (updateError) {
      throw updateError
    }

    // Log the action. Check both old and new audit_logging so that *disabling*
    // audit logging is itself recorded. (audit M5)
    if (organization.settings?.audit_logging || updated.settings?.audit_logging) {
      await supabase.from('audit_logs').insert({
        organization_id: organizationId,
        user_id: user.id,
        action: 'organization.updated',
        resource_type: 'organization',
        resource_id: organizationId,
        metadata: { changes },
      })
    }

    return jsonResponse({
      organization: {
        id: updated.id,
        name: updated.name,
        slug: updated.slug,
        plan: updated.plan,
        seatCount: updated.seat_count,
        settings: updated.settings,
        updatedAt: updated.updated_at,
      },
      message: 'Organization updated successfully',
    })
  } catch (error) {
    if (error instanceof AuthError) {
      return jsonResponse({ error: error.message }, error.status)
    }
    console.error('Update organization error:', error)
    return jsonResponse({ error: error.message }, 500)
  }
})
