// /api/feed.js
// Banana Radar Feed API (zone-first, mutual-exclusive)
// - No dependencies (no supabase-js) -> avoids ESM/CJS runtime issues on Vercel
// - Uses SUPABASE_SERVICE_ROLE_KEY (bypasses RLS)
// - Sorting: banana_score desc, created_at desc, first_passed_at desc (keeps "strongest on top" but moves more)

export default async function handler(req, res) {
  // Always return JSON (even when error)
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");

  try {
    const SUPABASE_URL = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "").replace(/\/+$/, "");
    const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!SUPABASE_URL || !SERVICE_KEY) {
      return res.status(500).json({
        ok: false,
        stage: "env",
        error: "Missing env vars: SUPABASE_URL (or VITE_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY",
        has_SUPABASE_URL: !!SUPABASE_URL,
        has_SERVICE_ROLE: !!SERVICE_KEY,
      });
    }

    const url = new URL(req.url, `https://${req.headers.host}`);
    const limit = Math.min(Math.max(parseInt(url.searchParams.get("limit") || "80", 10), 1), 300);
    const perZone = Math.max(1, Math.floor(limit / 3));

    // Columns (keep aligned with pending_pool)
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
      "source",
    ].join(",");

    const base = `${SUPABASE_URL}/rest/v1/pending_pool`;

    async function sbSelect(whereParams, lim) {
      const params = new URLSearchParams();
      params.set("select", selectFields);
      params.set("status", "eq.passed");
      params.set("limit", String(lim));

      // Multi-order (append, not set)
      params.append("order", "banana_score.desc");
      params.append("order", "created_at.desc");
      params.append("order", "first_passed_at.desc");

      for (const [k, v] of Object.entries(whereParams)) params.set(k, v);

      const endpoint = `${base}?${params.toString()}`;

      const r = await fetch(endpoint, {
        method: "GET",
        headers: {
          apikey: SERVICE_KEY,
          Authorization: `Bearer ${SERVICE_KEY}`,
        },
      });

      const text = await r.text();

      // Supabase REST returns JSON on success; on error returns JSON too but keep it safe
      if (!r.ok) {
        return { __error: { status: r.status, body: text.slice(0, 1200), endpoint } };
      }

      try {
        return text ? JSON.parse(text) : [];
      } catch (e) {
        return { __error: { status: r.status, body: text.slice(0, 1200), endpoint, parse_error: String(e) } };
      }
    }

    // Mutual-exclusive zones (Brain-aligned)
    // CORE: core_confirmed=true
    const corePromise = sbSelect({ core_confirmed: "eq.true" }, perZone);

    // STABLE: stable_confirmed=true AND core_confirmed=false
    // (After你做过 backfill，这里应该是明确 false，不需要把 null 也算进来)
    const stablePromise = sbSelect(
      { stable_confirmed: "eq.true", core_confirmed: "eq.false" },
      perZone
    );

    // EARLY: forming_confirmed=true AND stable_confirmed=false AND core_confirmed=false
    const earlyPromise = sbSelect(
      { forming_confirmed: "eq.true", stable_confirmed: "eq.false", core_confirmed: "eq.false" },
      perZone
    );

    const [core, stable, early] = await Promise.all([corePromise, stablePromise, earlyPromise]);

    // If any zone returned error object, surface it clearly
    const zoneErr = [core, stable, early].find((x) => x && x.__error);
    if (zoneErr) {
      return res.status(500).json({
        ok: false,
        stage: "supabase",
        error: "Supabase REST query failed",
        details: zoneErr.__error,
      });
    }

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
        filter: {
          status: "passed",
          core: "core_confirmed=true",
          stable: "stable_confirmed=true AND core_confirmed=false",
          early: "forming_confirmed=true AND stable_confirmed=false AND core_confirmed=false",
        },
        sort: ["banana_score desc", "created_at desc", "first_passed_at desc"],
      },
      ts: new Date().toISOString(),
    });
  } catch (e) {
    // Catch runtime errors (syntax/import errors won't reach here, but normal runtime will)
    return res.status(500).json({ ok: false, stage: "exception", error: String(e?.message || e) });
  }
}
