/**
 * TRAP//RUN Application Configuration
 * Native NEAR Protocol & Supabase
 */

import { NEAR_CONFIG } from './services/chain/nearConfig'
import { isSupabaseConfigured } from './services/supabase/client'

export const APP_CONFIG = {
  name: 'TRAP//RUN',
  version: '1.0.0',
  near: NEAR_CONFIG,
  supabaseConfigured: isSupabaseConfigured,
}
