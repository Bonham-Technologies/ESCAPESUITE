import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Cache-Control': 'public, max-age=300', // Cache for 5 minutes
}

interface ProductVersion {
  version: string | null
  file: string
  latestFile: string
  downloadUrl?: string
}

interface VersionManifest {
  generated: string
  products: {
    craft: ProductVersion
    artist: ProductVersion
  }
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    // Get product from query params
    const url = new URL(req.url)
    const product = url.searchParams.get('product') // 'craft', 'artist', or null for all
    const currentVersion = url.searchParams.get('current') // Optional: client's current version

    // Fetch version.json from storage
    const { data, error } = await supabase.storage
      .from('downloads')
      .download('version.json')

    if (error) {
      // If no version.json exists yet, return empty response
      if (error.message.includes('Object not found')) {
        return new Response(
          JSON.stringify({
            error: 'No releases available yet',
            products: {},
          }),
          {
            status: 200,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          }
        )
      }
      throw error
    }

    // Parse version manifest
    const text = await data.text()
    const manifest: VersionManifest = JSON.parse(text)

    // Build download URLs
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const buildDownloadUrl = (file: string) =>
      `${supabaseUrl}/storage/v1/object/public/downloads/${file}`

    // Add download URLs to manifest
    const response: {
      generated: string
      products: Record<string, ProductVersion & { updateAvailable?: boolean }>
    } = {
      generated: manifest.generated,
      products: {},
    }

    if (!product || product === 'craft') {
      const craft = manifest.products.craft
      response.products.craft = {
        ...craft,
        downloadUrl: buildDownloadUrl(craft.latestFile),
        updateAvailable: currentVersion && craft.version
          ? isNewerVersion(craft.version, currentVersion)
          : undefined,
      }
    }

    if (!product || product === 'artist') {
      const artist = manifest.products.artist
      response.products.artist = {
        ...artist,
        downloadUrl: buildDownloadUrl(artist.latestFile),
        updateAvailable: currentVersion && artist.version
          ? isNewerVersion(artist.version, currentVersion)
          : undefined,
      }
    }

    return new Response(JSON.stringify(response), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (error) {
    console.error('Get version error:', error)
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    )
  }
})

/**
 * Compare semantic versions to check if newVersion is newer than currentVersion
 */
function isNewerVersion(newVersion: string, currentVersion: string): boolean {
  const parseVersion = (v: string) => {
    const parts = v.replace(/^v/, '').split('.')
    return {
      major: parseInt(parts[0] || '0', 10),
      minor: parseInt(parts[1] || '0', 10),
      patch: parseInt(parts[2] || '0', 10),
    }
  }

  const newV = parseVersion(newVersion)
  const currV = parseVersion(currentVersion)

  if (newV.major !== currV.major) return newV.major > currV.major
  if (newV.minor !== currV.minor) return newV.minor > currV.minor
  return newV.patch > currV.patch
}
