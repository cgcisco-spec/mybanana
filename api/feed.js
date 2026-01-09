// /api/feed.js
// Banana Radar Feed API (RLS-safe, schema-drift tolerant)
// - Uses SUPABASE_SERVICE_ROLE_KEY (bypasses RLS)
// - Tries multiple select field sets; if a column doesn't exist, falls back gracefully
// - Splits tokens into CORE / STABLE / EARLY zones

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
    const limit = Math.min(Math.max(parseInt(url.searchParams.get("limit") || "80", 10), 1), 200);
    const noStatusFilter = url.searchParams.get("no_status_filter") === "1";

    // Try from "rich" -> "minimal". If any column doesn't exist, Supabase returns error.
    const SELECT_CANDIDATES = [
      // Rich (may not exist in your schema)
      [
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
        "forming_confirmed_at",
        "stable_confirmed_at",
        "core_confirmed_at",
        "status",
      ],
      // Medium (drop *_at)
      [
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
      ],
      // Minimal (should match your original working feed)
      [
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
      ],
    ];

    async function fetchWithSelect(selectArr) {
      const base = `${SUPABASE_URL}/rest/v1/pending_pool`;
      const params = new URLSearchParams();
      params.set("select", selectArr.join(","));
      params.set("order", "banana_score.desc");
      params.set("limit", String(limit));

      // keep prior behavior by default
      if (!noStatusFilter) params.set("status", "eq.passed");

      const endpoint = `${base}?${params.toString()}`;

      const r = await fetch(endpoint, {
        method: "GET",
        headers: {
          apikey: SERVICE_KEY,
          Authorization: `Bearer ${SERVICE_KEY}`,
        },
      });

      const text = await r.text();
      return { ok: r.ok, status: r.status, text, endpoint, selectArr };
    }

    // Try candidates until success
    let lastErr = null;
    let rows = null;
    let usedSelect = null;

    for (const selectArr of SELECT_CANDIDATES) {
      const out = await fetchWithSelect(selectArr);
      if (out.ok) {
        rows = out.text ? JSON.parse(out.text) : [];
        usedSelect = selectArr;
        lastErr = null;
        break;
      } else {
        lastErr = out; // keep last failure
        // if status filter caused failure due to missing status column, try again without it
        // (only if failure mentions status)
        if (!noStatusFilter && out.text && out.text.toLowerCase().includes("column") && out.text.toLowerCase().includes("status")) {
          const out2 = await (async () => {
            const base = `${SUPABASE_URL}/rest/v1/pending_pool`;
            const params = new URLSearchParams();
            params.set("select", selectArr.join(","));
            params.set("order", "banana_score.desc");
            params.set("limit", String(limit));
            const endpoint = `${base}?${params.toString()}`;
            const r = await fetch(endpoint, {
              method: "GET",
              headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
            });
            const text = await r.text();
            return { ok: r.ok, status: r.status, text, endpoint, selectArr };
          })();

          if (out2.ok) {
            rows = out2.text ? JSON.parse(out2.text) : [];
            usedSelect = selectArr;
            lastErr = null;
            break;
          } else {
            lastErr = out2;
          }
        }
      }
    }

    if (!rows) {
      return res.status(500).json({
        ok: false,
        error: `Supabase query failed (${lastErr?.status || "unknown"})`,
        details: (lastErr?.text || "").slice(0, 1200),
        tried_selects: SELECT_CANDIDATES,
        last_endpoint: lastErr?.endpoint,
      });
    }

    // --- zone split helpers ---
    const truthy = (v) => {
      if (v === true) return true;
      if (v === 1) return true;
      if (typeof v === "string") {
        const s = v.trim().toLowerCase();
        if (s === "true" || s === "1") return true;
        if (s.length > 0 && s !== "false" && s !== "0") return true; // timestamps/non-empty
      }
      return false;
    };

    const isCore = (it) => truthy(it.core_confirmed) || truthy(it.core_confirmed_at);
    const isStable = (it) => truthy(it.stable_confirmed) || truthy(it.stable_confirmed_at);

    const core = [];
    const stable = [];
    const early = [];

    for (const it of rows) {
      if (isCore(it)) core.push(it);
      else if (isStable(it)) stable.push(it);
      else early.push(it);
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
      meta: {
        used_select: usedSelect,
        status_filter_applied: !noStatusFilter,
      },
      ts: new Date().toISOString(),
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e) });
  }
}
