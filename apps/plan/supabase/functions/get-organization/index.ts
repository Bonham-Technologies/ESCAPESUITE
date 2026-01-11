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

    // Get parameters from query string or body
    let clerkUserId: string | null = null
    let organizationId: string | null = null
    let slug: string | null = null

    if (req.method === 'GET') {
      const url = new URL(req.url)
      clerkUserId = url.searchParams.get('clerkUserId')
      organizationId = url.searchParams.get('organizationId')
      slug = url.searchParams.get('slug')
    } else {
      const body = await req.json()
      clerkUserId = body.clerkUserId
      organizationId = body.organizationId
      slug = body.slug
    }

    if (!clerkUserId) {
      return new Response(
        JSON.stringify({ error: 'Missing clerkUserId' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // If organizationId or slug provided, get that specific org
    // Otherwise, get all orgs the user is a member of
    if (organizationId || slug) {
      // Get specific organization
      let query = supabase.from('organizations').select('*')

      if (organizationId) {
        query = query.eq('id', organizationId)
      } else if (slug) {
        query = query.eq('slug', slug)
      }

      const { data: organization, error: orgError } = await query.single()

      if (orgError || !organization) {
        return new Response(
          JSON.stringify({ error: 'Organization not found' }),
          { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      // Check if user is a member
      const { data: membership } = await supabase
        .from('organization_members')
        .select('role, joined_at')
        .eq('organization_id', organization.id)
        .eq('user_id', clerkUserId)
        .single()

      if (!membership || !membership.joined_at) {
        return new Response(
          JSON.stringify({ error: 'Not a member of this organization' }),
          { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      // Get member count
      const { count: memberCount } = await supabase
        .from('organization_members')
        .select('*', { count: 'exact', head: true })
        .eq('organization_id', organization.id)
        .not('joined_at', 'is', null)

      // Get pending invite count
      const { count: pendingInvites } = await supabase
        .from('organization_invites')
        .select('*', { count: 'exact', head: true })
        .eq('organization_id', organization.id)
        .is('accepted_at', null)
        .gt('expires_at', new Date().toISOString())

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
            memberCount: memberCount || 0,
            pendingInvites: pendingInvites || 0,
            availableSeats: organization.seat_count - (memberCount || 0),
          },
          membership: {
            role: membership.role,
            joinedAt: membership.joined_at,
          },
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    } else {
      // Get all organizations the user is a member of
      const { data: memberships, error: memberError } = await supabase
        .from('organization_members')
        .select(`
          role,
          joined_at,
          organizations (
            id,
            name,
            slug,
            plan,
            seat_count,
            settings,
            created_at
          )
        `)
        .eq('user_id', clerkUserId)
        .not('joined_at', 'is', null)

      if (memberError) {
        throw memberError
      }

      const organizations = (memberships || []).map((m: any) => ({
        id: m.organizations.id,
        name: m.organizations.name,
        slug: m.organizations.slug,
        plan: m.organizations.plan,
        seatCount: m.organizations.seat_count,
        settings: m.organizations.settings,
        createdAt: m.organizations.created_at,
        role: m.role,
        joinedAt: m.joined_at,
      }))

      return new Response(
        JSON.stringify({ organizations }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }
  } catch (error) {
    console.error('Get organization error:', error)
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
