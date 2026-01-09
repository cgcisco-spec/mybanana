// /api/feed.js
// Banana Radar Feed API (RLS-safe)
// - Reads from Supabase REST using SUPABASE_SERVICE_ROLE_KEY (bypasses RLS)
// - Splits tokens into CORE / STABLE / EARLY zones
// - Compatible with both boolean flags (core_confirmed) and timestamp milestones (core_confirmed_at)

export default async function handler(req, res) {
  try {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    // Cache at edge a bit; you can tighten/loosen later
    res.setHeader("Cache-Control", "s-maxage=20, stale-while-revalidate=120");

    const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
    const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!SUPABASE_URL || !SERVICE_KEY) {
      return res.status(500).json({
        ok: false,
        error: "Missing env vars. Need SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.",
        details: { hasUrl: !!SUPABASE_URL, hasServiceRole: !!SERVICE_KEY },
      });
    }

    const url = new URL(req.url, `https://${req.headers.host}`);
    const limit = Math.min(Math.max(parseInt(url.searchParams.get("limit") || "80", 10), 1), 200);

    // If you want to temporarily widen results for debugging, set ?no_status_filter=1
    const noStatusFilter = url.searchParams.get("no_status_filter") === "1";

    // --- Select fields (be tolerant to schema drift) ---
    // Add/Remove fields as needed; unknown columns in select will error.
    // If your schema doesn't have some of these, remove them.
    const selectFields = [
      "ca",
      "symbol",
      "liq",
      "banana_score",
      "smart_money_count",
      "narrative_log",
      "created_at",
      "first_passed_at",

      // bool flags (your earlier design)
      "forming_confirmed",
      "stable_confirmed",
      "core_confirmed",

      // timestamp milestones (common alternative)
      "forming_confirmed_at",
      "stable_confirmed_at",
      "core_confirmed_at",

      // optional but often present
      "status",
    ].join(",");

    // Build Supabase REST query
    const base = `${SUPABASE_URL.replace(/\/+$/, "")}/rest/v1/pending_pool`;
    const params = new URLSearchParams();
    params.set("select", selectFields);
    params.set("order", "banana_score.desc");
    params.set("limit", String(limit));

    // Keep your previous behavior by default: only "passed"
    // If your CORE/STABLE rows are not "passed", use ?no_status_filter=1 to verify quickly,
    // then adjust status filter accordingly.
    if (!noStatusFilter) {
      params.set("status", "eq.passed");
    }

    const endpoint = `${base}?${params.toString()}`;

    const r = await fetch(endpoint, {
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
        error: `Supabase query failed (${r.status})`,
        details: text.slice(0, 1200),
      });
    }

    const rows = text ? JSON.parse(text) : [];

    // --- Zone split helpers ---
    const truthy = (v) => {
      if (v === true) return true;
      if (v === 1) return true;
      if (typeof v === "string") {
        const s = v.trim().toLowerCase();
        if (s === "true" || s === "1") return true;
        // timestamps / non-empty strings should count as truthy for *_at fields
        if (s.length > 0 && s !== "false" && s !== "0") return true;
      }
      // numbers > 0 could be used; be conservative
      return false;
    };

    const isCore = (it) => truthy(it.core_confirmed) || truthy(it.core_confirmed_at);
    const isStable = (it) => truthy(it.stable_confirmed) || truthy(it.stable_confirmed_at);
    const isForming = (it) => truthy(it.forming_confirmed) || truthy(it.forming_confirmed_at);

    const core = [];
    const stable = [];
    const early = [];

    for (const it of rows) {
      if (isCore(it)) core.push(it);
      else if (isStable(it)) stable.push(it);
      else early.push(it);
    }

    // Optional: ensure deterministic ordering per zone (already ordered globally by score,
    // but filtering can preserve order; we keep it as-is).

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
