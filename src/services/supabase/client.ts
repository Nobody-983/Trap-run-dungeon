import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Database } from './types'

const SUPABASE_URL = String(import.meta.env.VITE_SUPABASE_URL ?? '').trim()
const SUPABASE_KEY = String(
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ??
  import.meta.env.VITE_SUPABASE_ANON_KEY ??
  '',
).trim()

export const isSupabaseConfigured = Boolean(
  SUPABASE_URL &&
  SUPABASE_KEY &&
  (SUPABASE_URL.startsWith('http://') || SUPABASE_URL.startsWith('https://')) &&
  !SUPABASE_URL.includes('your-project') &&
  !SUPABASE_KEY.includes('your-anon-key') &&
  !SUPABASE_KEY.includes('your-publishable-key'),
)

let clientInstance: SupabaseClient<Database> | null = null

export function getSupabaseClient(): SupabaseClient<Database> | null {
  if (!isSupabaseConfigured) return null
  if (!clientInstance) {
    clientInstance = createClient<Database>(SUPABASE_URL, SUPABASE_KEY, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
      },
    })
  }
  return clientInstance
}

export interface ConnectivityResult {
  ok: boolean
  configured: boolean
  url: string
  status?: number
  latencyMs?: number
  error?: string
  schemaReady?: boolean
}

/**
 * Performs an actual network connectivity check against the configured Supabase instance.
 * Returns structured metadata distinguishing network connectivity from missing database tables.
 */
export async function checkSupabaseConnectivity(): Promise<ConnectivityResult> {
  if (!isSupabaseConfigured) {
    return {
      ok: false,
      configured: false,
      url: SUPABASE_URL || 'Not configured',
      error: 'Supabase credentials are missing or unconfigured in .env',
    }
  }

  const startTime = Date.now()
  try {
    const client = getSupabaseClient()
    if (!client) {
      return {
        ok: false,
        configured: false,
        url: SUPABASE_URL,
        error: 'Failed to initialize Supabase client instance',
      }
    }

    // Ping PostgREST with a limit 1 query on dungeons
    const { status, error } = await client
      .from('dungeons')
      .select('id')
      .limit(1)

    const latencyMs = Date.now() - startTime

    // PostgREST code PGRST205 means server responded and authenticated, but table is not yet created
    if (error && error.code === 'PGRST205') {
      return {
        ok: true,
        configured: true,
        url: SUPABASE_URL,
        status: status || 404,
        latencyMs,
        schemaReady: false,
        error: 'Connected to Supabase successfully, but database schema/tables have not yet been migrated.',
      }
    }

    if (error && status >= 400 && status !== 404) {
      return {
        ok: false,
        configured: true,
        url: SUPABASE_URL,
        status,
        latencyMs,
        schemaReady: false,
        error: `Supabase query error (${error.code ?? 'UNKNOWN'}): ${error.message}`,
      }
    }

    return {
      ok: true,
      configured: true,
      url: SUPABASE_URL,
      status: status || 200,
      latencyMs,
      schemaReady: true,
    }
  } catch (err) {
    const latencyMs = Date.now() - startTime
    return {
      ok: false,
      configured: true,
      url: SUPABASE_URL,
      latencyMs,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

