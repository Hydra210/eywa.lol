const { createClient } = require('@supabase/supabase-js');

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
  console.warn('[supabase] SUPABASE_URL or SUPABASE_SERVICE_KEY is not set — uploads will fail.');
}

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
  { auth: { persistSession: false } }
);

const BUCKET = process.env.SUPABASE_BUCKET || 'eywa-uploads';

module.exports = { supabase, BUCKET };
