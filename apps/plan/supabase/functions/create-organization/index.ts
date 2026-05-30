import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { jsonResponse, handleOptions } from '../_shared/cors.ts'
import { requireUser, serviceClient, AuthError } from '../_shared/auth.ts'

interface CreateOrgRequest {
  name: string
  slug?: string
  plan?: 'team' | 'enterprise'
  seatCount?: number
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return handleOptions()

  try {
    const user = await requireUser(req)
    const supabase = serviceClient()

    const body: CreateOrgRequest = await req.json()
    const { name, plan = 'team', seatCount = 5 } = body

    if (!name) {
      return jsonResponse({ error: 'Missing required field: name' }, 400)
    }

    const email = user.email
    if (!email) {
      return jsonResponse({ error: 'Your account has no email address' }, 400)
    }

    // Generate slug from name if not provided
    const slug = body.slug || name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .substring(0, 50)

    // Check if slug is already taken
    const { data: existingOrg } = await supabase
      .from('organizations')
      .select('id')
      .eq('slug', slug)
      .single()

    if (existingOrg) {
      return jsonResponse({ error: 'Organization slug already taken' }, 409)
    }

    // Check if user already owns an organization
    const { data: existingMembership } = await supabase
      .from('organization_members')
      .select('organization_id')
      .eq('user_id', user.id)
      .eq('role', 'owner')
      .single()

    if (existingMembership) {
      return jsonResponse({ error: 'User already owns an organization' }, 409)
    }

    // Create the organization
    const { data: organization, error: orgError } = await supabase
      .from('organizations')
      .insert({
        name,
        slug,
        plan,
        seat_count: seatCount,
        settings: {
          sso_enabled: false,
          require_2fa: false,
          audit_logging: plan === 'enterprise',
          allowed_domains: [],
        },
      })
      .select()
      .single()

    if (orgError) {
      console.error('Create organization error:', orgError)
      throw orgError
    }

    // Add the creator as owner
    const { error: memberError } = await supabase
      .from('organization_members')
      .insert({
        organization_id: organization.id,
        user_id: user.id,
        email,
        role: 'owner',
        joined_at: new Date().toISOString(),
      })

    if (memberError) {
      // Rollback organization creation
      await supabase.from('organizations').delete().eq('id', organization.id)
      console.error('Add owner error:', memberError)
      throw memberError
    }

    // Log the action (if audit logging enabled)
    if (organization.settings.audit_logging) {
      await supabase.from('audit_logs').insert({
        organization_id: organization.id,
        user_id: user.id,
        action: 'organization.created',
        resource_type: 'organization',
        resource_id: organization.id,
        metadata: { name, plan, seat_count: seatCount },
      })
    }

    return jsonResponse({
      organization: {
        id: organization.id,
        name: organization.name,
        slug: organization.slug,
        plan: organization.plan,
        seatCount: organization.seat_count,
        settings: organization.settings,
        createdAt: organization.created_at,
      },
    })
  } catch (error) {
    if (error instanceof AuthError) return jsonResponse({ error: error.message }, error.status)
    console.error('Create organization error:', error)
    return jsonResponse({ error: error.message }, 500)
  }
})
