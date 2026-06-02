import { createClient } from '@supabase/supabase-js'

// Server-only — uses service role key, NEVER import this in client components
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

export default supabaseAdmin
