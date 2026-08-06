import { createClient } from 'https://esm.sh/@supabase/supabase-js@2?bundle';

const SUPABASE_URL =
  'https://suwlxuwhkoilesdlyqll.supabase.co';

const SUPABASE_ANON_KEY =
  'sb_publishable_z2QOcUx2s3otTuOMNo0VoQ_9wz-yQAt';

export const supabase = createClient(
  SUPABASE_URL,
  SUPABASE_ANON_KEY,
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      storageKey: 'echo-arena-auth'
    }
  }
);