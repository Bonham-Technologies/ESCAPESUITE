import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface CreateOrgRequest {
  clerkUserId: string
  email: string
  name: string
  slug?: string
  plan?: 'team' | 'enterprise'
  seatCount?: number
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

    const body: CreateOrgRequest = await req.json()
    const { clerkUserId, email, name, plan = 'team', seatCount = 5 } = body

    if (!clerkUserId || !email || !name) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields: clerkUserId, email, name' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
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
      return new Response(
        JSON.stringify({ error: 'Organization slug already taken' }),
        { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Check if user already owns an organization
    const { data: existingMembership } = await supabase
      .from('organization_members')
      .select('organization_id')
      .eq('user_id', clerkUserId)
      .eq('role', 'owner')
      .single()

    if (existingMembership) {
      return new Response(
        JSON.stringify({ error: 'User already owns an organization' }),
        { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
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
        user_id: clerkUserId,
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
        user_id: clerkUserId,
        action: 'organization.created',
        resource_type: 'organization',
        resource_id: organization.id,
        metadata: { name, plan, seat_count: seatCount },
      })
    }

    return new Response(
      JSON.stringify({
        organization: {
          id: organization.id,
          name: organization.name,
          slug: organization.slug,
          plan: organization.plan,
          seatCount: organization.seat_count,
          settings: organization.settings,
          createdAt: organization.created_at,
        },
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (error) {
    console.error('Create organization error:', error)
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
