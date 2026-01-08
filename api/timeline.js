export default async function handler(req, res) {
  try {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    // timeline 更适合短缓存
    res.setHeader("Cache-Control", "s-maxage=20, stale-while-revalidate=120");

    const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
    const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;

    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
      return res.status(500).json({ ok: false, error: "Missing Supabase env vars." });
    }

    const url = new URL(req.url, `https://${req.headers.host}`);
    const ca = (url.searchParams.get("ca") || "").trim();
    const limit = Math.min(parseInt(url.searchParams.get("limit") || "50", 10), 200);

    if (!ca) {
      return res.status(400).json({ ok: false, error: "Missing query param: ca" });
    }

    const selectFields = ["event", "payload", "created_at"].join(",");

    // created_at desc（最新在前）
    const query =
      `${SUPABASE_URL}/rest/v1/token_timeline` +
      `?select=${encodeURIComponent(selectFields)}` +
      `&ca=eq.${encodeURIComponent(ca)}` +
      `&order=created_at.desc` +
      `&limit=${limit}`;

    const r = await fetch(query, {
      method: "GET",
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      },
    });

    if (!r.ok) {
      const text = await r.text();
      return res.status(500).json({
        ok: false,
        error: `Supabase query failed: ${r.status}`,
        details: text.slice(0, 500),
      });
    }

    const rows = await r.json();

    return res.status(200).json({
      ok: true,
      ca,
      timeline: rows || [],
      ts: new Date().toISOString(),
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e) });
  }
}
