export default async function handler(req, res) {
  try {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=300");

    const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
    const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!SUPABASE_URL || !SERVICE_KEY) {
      return res.status(500).json({
        ok: false,
        error: "Missing Supabase env vars (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY).",
      });
    }

    const url = new URL(req.url, `https://${req.headers.host}`);
    const limit = Math.min(parseInt(url.searchParams.get("limit") || "50", 10), 200);

    const selectFields = [
      "ca",
      "symbol",
      "liq",
      "banana_score",
      "smart_money_count",
      "narrative_log",
      "created_at",
      "first_passed_at",
      "forming_confirmed",
      "stable_confirmed",
      "core_confirmed",
    ].join(",");

    const query =
      `${SUPABASE_URL}/rest/v1/pending_pool` +
      `?select=${encodeURIComponent(selectFields)}` +
      `&status=eq.passed` +
      `&order=banana_score.desc` +
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

    const core = [];
    const stable = [];
    const early = [];
    for (const item of rows) {
      if (item.core_confirmed) core.push(item);
      else if (item.stable_confirmed) stable.push(item);
      else early.push(item);
    }

    return res.status(200).json({
      ok: true,
      counts: {
        core: core.length,
        stable: stable.length,
        early: early.length,
        total: rows.length,
      },
      zones: { core, stable, early },
      ts: new Date().toISOString(),
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e) });
  }
}
