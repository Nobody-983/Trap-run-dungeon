import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { isSupabaseConfigured, checkSupabaseConnectivity } from '../src/services/supabase/client'

void describe('Supabase Connectivity & Client Validation', () => {
  void it('validates configuration presence from environment', () => {
    assert.equal(typeof isSupabaseConfigured, 'boolean')
    assert.equal(isSupabaseConfigured, true, 'Supabase should be configured via .env credentials')
  })

  void it('performs live network check and returns structured connectivity report', async () => {
    const result = await checkSupabaseConnectivity()
    assert.equal(result.configured, true)
    assert.equal(typeof result.url, 'string')
    assert.ok(result.url.startsWith('https://cjfammcpgqnidbvuggii.supabase.co'))
    assert.equal(typeof result.latencyMs, 'number')
    // HTTP communication succeeds
    assert.equal(result.ok, true, `Connectivity should succeed, got error: ${result.error}`)
    console.log(`[Supabase Connectivity Report] URL: ${result.url} | Status: ${result.status} | Latency: ${result.latencyMs}ms | Schema Ready: ${result.schemaReady} | Message: ${result.error ?? 'Ready'}`)
  })
})
