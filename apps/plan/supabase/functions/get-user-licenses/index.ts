import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
)

interface GetUserLicensesRequest {
  clerkUserId: string
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return new Response(
      JSON.stringify({ error: 'Method not allowed' }),
      { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  try {
    const { clerkUserId }: GetUserLicensesRequest = await req.json()

    if (!clerkUserId) {
      return new Response(
        JSON.stringify({ error: 'Missing clerkUserId' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Fetch licenses for this user
    const { data: licenses, error: fetchError } = await supabase
      .from('licenses')
      .select('id, product, tier, seat_count, issued_at, expires_at, metadata')
      .eq('customer_id', clerkUserId)
      .is('revoked_at', null)
      .order('issued_at', { ascending: false })

    if (fetchError) {
      console.error('Failed to fetch licenses:', fetchError)
      return new Response(
        JSON.stringify({ error: 'Failed to fetch licenses' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    return new Response(
      JSON.stringify({ licenses: licenses || [] }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (error) {
    console.error('Get user licenses error:', error)
    return new Response(
      JSON.stringify({ error: error.message || 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
