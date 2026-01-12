import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface AuditLogFilters {
  action?: string
  userId?: string
  resourceType?: string
  startDate?: string
  endDate?: string
  page?: number
  limit?: number
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
    let filters: AuditLogFilters = {}

    if (req.method === 'GET') {
      const url = new URL(req.url)
      clerkUserId = url.searchParams.get('clerkUserId')
      organizationId = url.searchParams.get('organizationId')
      filters = {
        action: url.searchParams.get('action') || undefined,
        userId: url.searchParams.get('userId') || undefined,
        resourceType: url.searchParams.get('resourceType') || undefined,
        startDate: url.searchParams.get('startDate') || undefined,
        endDate: url.searchParams.get('endDate') || undefined,
        page: url.searchParams.get('page') ? parseInt(url.searchParams.get('page')!) : 1,
        limit: url.searchParams.get('limit') ? parseInt(url.searchParams.get('limit')!) : 50,
      }
    } else {
      const body = await req.json()
      clerkUserId = body.clerkUserId
      organizationId = body.organizationId
      filters = {
        action: body.action,
        userId: body.userId,
        resourceType: body.resourceType,
        startDate: body.startDate,
        endDate: body.endDate,
        page: body.page || 1,
        limit: body.limit || 50,
      }
    }

    if (!clerkUserId || !organizationId) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields: clerkUserId, organizationId' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Check if user is an admin or owner of the organization
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

    // Only admins and owners can view audit logs
    if (membership.role !== 'admin' && membership.role !== 'owner') {
      return new Response(
        JSON.stringify({ error: 'Only admins and owners can view audit logs' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Check if organization has audit logging enabled
    const { data: organization } = await supabase
      .from('organizations')
      .select('settings, plan')
      .eq('id', organizationId)
      .single()

    if (!organization) {
      return new Response(
        JSON.stringify({ error: 'Organization not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const auditLoggingEnabled = organization.settings?.audit_logging === true

    if (!auditLoggingEnabled) {
      return new Response(
        JSON.stringify({
          error: 'Audit logging is not enabled for this organization',
          auditLoggingEnabled: false,
          isEnterprise: organization.plan === 'enterprise',
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Build the query
    const page = filters.page || 1
    const limit = Math.min(filters.limit || 50, 100) // Max 100 per page
    const offset = (page - 1) * limit

    let query = supabase
      .from('audit_logs')
      .select('*', { count: 'exact' })
      .eq('organization_id', organizationId)
      .order('created_at', { ascending: false })

    // Apply filters
    if (filters.action) {
      query = query.eq('action', filters.action)
    }

    if (filters.userId) {
      query = query.eq('user_id', filters.userId)
    }

    if (filters.resourceType) {
      query = query.eq('resource_type', filters.resourceType)
    }

    if (filters.startDate) {
      query = query.gte('created_at', filters.startDate)
    }

    if (filters.endDate) {
      query = query.lte('created_at', filters.endDate)
    }

    // Apply pagination
    query = query.range(offset, offset + limit - 1)

    const { data: logs, error: logsError, count } = await query

    if (logsError) {
      throw logsError
    }

    // Get unique user IDs from logs to fetch user info
    const userIds = [...new Set((logs || []).map((log: any) => log.user_id).filter(Boolean))]

    // Get member info for user IDs
    let userMap: Record<string, { email: string }> = {}
    if (userIds.length > 0) {
      const { data: members } = await supabase
        .from('organization_members')
        .select('user_id, email')
        .eq('organization_id', organizationId)
        .in('user_id', userIds)

      if (members) {
        userMap = members.reduce((acc: Record<string, { email: string }>, m: any) => {
          acc[m.user_id] = { email: m.email }
          return acc
        }, {})
      }
    }

    // Get available actions and resource types for filters
    const { data: actionTypes } = await supabase
      .from('audit_logs')
      .select('action')
      .eq('organization_id', organizationId)
      .limit(100)

    const uniqueActions = [...new Set((actionTypes || []).map((a: any) => a.action))]

    const { data: resourceTypes } = await supabase
      .from('audit_logs')
      .select('resource_type')
      .eq('organization_id', organizationId)
      .limit(100)

    const uniqueResourceTypes = [...new Set((resourceTypes || []).map((r: any) => r.resource_type).filter(Boolean))]

    return new Response(
      JSON.stringify({
        logs: (logs || []).map((log: any) => ({
          id: log.id,
          action: log.action,
          userId: log.user_id,
          userEmail: userMap[log.user_id]?.email || null,
          resourceType: log.resource_type,
          resourceId: log.resource_id,
          metadata: log.metadata,
          ipAddress: log.ip_address,
          userAgent: log.user_agent,
          createdAt: log.created_at,
        })),
        pagination: {
          page,
          limit,
          total: count || 0,
          totalPages: Math.ceil((count || 0) / limit),
        },
        filters: {
          availableActions: uniqueActions,
          availableResourceTypes: uniqueResourceTypes,
        },
        auditLoggingEnabled: true,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (error) {
    console.error('Get audit logs error:', error)
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
