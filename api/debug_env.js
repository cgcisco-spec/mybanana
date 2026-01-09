export default async function handler(req, res) {
  const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const ANON = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;

  res.setHeader("Content-Type", "application/json; charset=utf-8");
  return res.status(200).json({
    ok: true,
    has_SUPABASE_URL: !!SUPABASE_URL,
    has_SUPABASE_ANON_KEY: !!ANON,
    has_SERVICE_ROLE: !!SERVICE,
    supabase_url_prefix: SUPABASE_URL ? SUPABASE_URL.slice(0, 25) : null,
  });
}
