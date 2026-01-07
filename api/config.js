export default function handler(req, res) {
  // 允许同源请求（你的网站本身）
  // 如果你未来要给多个域名用，可以改成白名单
  res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=300");

  const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return res.status(500).json({
      ok: false,
      error: "Missing SUPABASE_URL / SUPABASE_ANON_KEY in Vercel env."
    });
  }

  // 注意：anon key 本来就是公开的。这里返回它只是为了避免你每次改 HTML 手填。
  return res.status(200).json({
    ok: true,
    supabaseUrl: SUPABASE_URL,
    supabaseAnonKey: SUPABASE_ANON_KEY
  });
}
