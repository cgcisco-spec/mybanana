export default async function handler(req, res) {
  try {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "s-maxage=20, stale-while-revalidate=120");

    const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
    const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!SUPABASE_URL || !SERVICE_KEY) {
      return res.status(500).json({
        ok: false,
        error: "Missing Supabase env vars (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY).",
      });
    }

    const url = new URL(req.url, `https://${req.headers.host}`);
    const ca = (url.searchParams.get("ca") || "").trim();
    const limit = Math.min(parseInt(url.searchParams.get("limit") || "50", 10), 200);

    if (!ca) return res.status(400).json({ ok: false, error: "Missing query param: ca" });

    const selectFields = ["event", "payload", "created_at"].join(",");

    const query =
      `${SUPABASE_URL}/rest/v1/token_timeline` +
      `?select=${encodeURIComponent(selectFields)}` +
      `&ca=eq.${encodeURIComponent(ca)}` +
      `&order=created_at.desc` +
      `&limit=${limit}`;

    const r = await fetch(query, {
      method: "GET",
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
      },
    });

    const text = await r.text();
    if (!r.ok) {
      return res.status(500).json({
        ok: false,
        error: `Supabase query failed: ${r.status}`,
        details: text.slice(0, 800),
      });
    }

    const rows = text ? JSON.parse(text) : [];
    return res.status(200).json({ ok: true, ca, timeline: rows, ts: new Date().toISOString() });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e) });
  }
}
