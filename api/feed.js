// /api/feed.js
import { createClient } from "@supabase/supabase-js";

function intParam(v, defVal) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : defVal;
}

export default async function handler(req, res) {
  // Make feed move (avoid Vercel / browser cache)
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");

  try {
    const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
    const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!SUPABASE_URL || !SERVICE_ROLE) {
      return res.status(500).json({
        ok: false,
        error: "Missing env SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY",
        has_url: !!SUPABASE_URL,
        has_service_role: !!SERVICE_ROLE,
      });
    }

    const sb = createClient(SUPABASE_URL, SERVICE_ROLE, {
      auth: { persistSession: false },
    });

    const limit = intParam(req.query.limit, 80);
    const perZone = Math.max(1, Math.floor(limit / 3));

    const selectCols = [
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

    // Base: only what Brain already marked as passed
    const base = () =>
      sb.from("pending_pool").select(selectCols).eq("status", "passed");

    // Sorting policy (方案 B):
    // 1) banana_score desc (强者在上)
    // 2) created_at desc (轻微滚动，让新token在同分/相近分更靠前)
    // 3) first_passed_at desc (兜底)
    const applySort = (q) =>
      q
        .order("banana_score", { ascending: false, nullsFirst: false })
        .order("created_at", { ascending: false, nullsFirst: false })
        .order("first_passed_at", { ascending: false, nullsFirst: false });

    // Mutual-exclusive zones aligned to Brain meaning
    const qCore = applySort(base().eq("core_confirmed", true)).limit(perZone);

    const qStable = applySort(
      base()
        .eq("stable_confirmed", true)
        .eq("core_confirmed", false)
    ).limit(perZone);

    const qEarly = applySort(
      base()
        .eq("forming_confirmed", true)
        .eq("stable_confirmed", false)
        .eq("core_confirmed", false)
    ).limit(perZone);

    const [coreRes, stableRes, earlyRes] = await Promise.all([qCore, qStable, qEarly]);

    const err = coreRes.error || stableRes.error || earlyRes.error;
    if (err) {
      return res.status(500).json({
        ok: false,
        stage: "query",
        error: err.message,
        details: err,
      });
    }

    const core = coreRes.data || [];
    const stable = stableRes.data || [];
    const early = earlyRes.data || [];

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
        used_select: selectCols.split(","),
        filter: {
          status: "passed",
          core: "core_confirmed = true",
          stable: "stable_confirmed = true AND core_confirmed = false",
          early: "forming_confirmed = true AND stable_confirmed = false AND core_confirmed = false",
          source_filter: "NONE (allow NULL)",
        },
        sort: ["banana_score desc", "created_at desc", "first_passed_at desc"],
      },
      ts: new Date().toISOString(),
    });
  } catch (e) {
    return res.status(500).json({
      ok: false,
      stage: "exception",
      error: String(e?.message || e),
    });
  }
}
