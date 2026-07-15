const { createClient } = require('@supabase/supabase-js');

const configured = !!(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY);

if (!configured) {
  console.warn('[supabase] SUPABASE_URL or SUPABASE_SERVICE_KEY is not set — uploads will fail.');
}

const supabase = configured
  ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } })
  : null;

const BUCKET = process.env.SUPABASE_BUCKET || 'eywa-uploads';

module.exports = { supabase, BUCKET };
