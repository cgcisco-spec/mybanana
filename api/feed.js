// /api/feed.js
// Banana Radar Feed API (Zone-first)
// - Uses SUPABASE_SERVICE_ROLE_KEY (bypasses RLS)
// - Queries CORE / STABLE / EARLY separately so each zone always has the right tokens
// - Stable definition: stable_confirmed=true AND core_confirmed!=true
// - Early definition: neither stable nor core (both not true)
// - Keeps status=passed filter by default (can disable via ?no_status_filter=1)

export default async function handler(req, res) {
  try {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "s-maxage=20, stale-while-revalidate=120");

    const SUPABASE_URL = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "").replace(/\/+$/, "");
    const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!SUPABASE_URL || !SERVICE_KEY) {
      return res.status(500).json({
        ok: false,
        error: "Missing env vars. Need SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.",
        details: { hasUrl: !!SUPABASE_URL, hasServiceRole: !!SERVICE_KEY },
      });
    }

    const url = new URL(req.url, `https://${req.headers.host}`);

    // Per-zone limit; total payload size stays reasonable
    const perZone = Math.min(Math.max(parseInt(url.searchParams.get("per_zone") || "30", 10), 1), 200);
    const noStatusFilter = url.searchParams.get("no_status_filter") === "1";

    // Shared select list: keep it aligned with your table columns
    // (From your API response, these columns exist.)
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
      "status",
    ].join(",");

    const base = `${SUPABASE_URL}/rest/v1/pending_pool`;

    async function sbSelect(whereParams, limit) {
      const params = new URLSearchParams();
      params.set("select", selectFields);
      params.set("order", "banana_score.desc");
      params.set("limit", String(limit));

      if (!noStatusFilter) params.set("status", "eq.passed");

      // apply where params (Supabase REST filters)
      for (const [k, v] of Object.entries(whereParams)) params.set(k, v);

      const endpoint = `${base}?${params.toString()}`;

      const r = await fetch(endpoint, {
        method: "GET",
        headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
      });

      const text = await r.text();
      if (!r.ok) {
        throw new Error(`Supabase ${r.status}: ${text.slice(0, 800)}`);
      }
      return text ? JSON.parse(text) : [];
    }

    // ---------------------------
    // Zone-first queries
    // ---------------------------
    // CORE: core_confirmed = true
    const corePromise = sbSelect({ core_confirmed: "eq.true" }, perZone);

    // STABLE: stable_confirmed = true AND core_confirmed != true
    // Use "not.is.true" to include false and null values.
    const stablePromise = sbSelect(
      { stable_confirmed: "eq.true", core_confirmed: "not.is.true" },
      perZone
    );

    // EARLY: stable_confirmed != true AND core_confirmed != true
    const earlyPromise = sbSelect(
      { stable_confirmed: "not.is.true", core_confirmed: "not.is.true" },
      perZone
    );

    const [core, stable, early] = await Promise.all([corePromise, stablePromise, earlyPromise]);

    return res.status(200).json({
      ok: true,
      counts: {
        core: core.length,
        stable: stable.length,
        early: early.length,
        total: core.length + stable.length + early.length,
      },
      zones: { core, stable, early },
      meta: {
        per_zone: perZone,
        status_filter_applied: !noStatusFilter,
        order: "banana_score.desc",
      },
      ts: new Date().toISOString(),
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e) });
  }
}
