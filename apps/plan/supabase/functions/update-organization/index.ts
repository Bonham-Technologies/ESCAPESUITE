import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface UpdateOrganizationRequest {
  clerkUserId: string
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
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    const body: UpdateOrganizationRequest = await req.json()
    const { clerkUserId, organizationId, name, settings } = body

    if (!clerkUserId || !organizationId) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields: clerkUserId, organizationId' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Check if user is owner or admin
    const { data: membership } = await supabase
      .from('organization_members')
      .select('role')
      .eq('organization_id', organizationId)
      .eq('user_id', clerkUserId)
      .not('joined_at', 'is', null)
      .single()

    if (!membership || !['owner', 'admin'].includes(membership.role)) {
      return new Response(
        JSON.stringify({ error: 'Only owners and admins can update organization settings' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Get current organization
    const { data: organization, error: orgError } = await supabase
      .from('organizations')
      .select('*')
      .eq('id', organizationId)
      .single()

    if (orgError || !organization) {
      return new Response(
        JSON.stringify({ error: 'Organization not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
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
          return new Response(
            JSON.stringify({ error: 'SSO is only available on Enterprise plan' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
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
      return new Response(
        JSON.stringify({ error: 'No changes provided' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
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

    // Log the action (using updated settings in case audit_logging was just enabled)
    if (updated.settings?.audit_logging) {
      await supabase.from('audit_logs').insert({
        organization_id: organizationId,
        user_id: clerkUserId,
        action: 'organization.updated',
        resource_type: 'organization',
        resource_id: organizationId,
        metadata: { changes },
      })
    }

    return new Response(
      JSON.stringify({
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
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (error) {
    console.error('Update organization error:', error)
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
