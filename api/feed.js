export default async function handler(req, res) {
  try {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    // CDN 缓存：60 秒，后台可“过期继续用” 5 分钟（更稳、更省）
    res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=300");

    // 读取环境变量（兼容你之前 VITE_ 命名）
    const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
    const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;

    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
      return res.status(500).json({ ok: false, error: "Missing Supabase env vars." });
    }

    // 读取可选参数（不传就用默认）
    const url = new URL(req.url, `https://${req.headers.host}`);
    const limit = Math.min(parseInt(url.searchParams.get("limit") || "50", 10), 200);

    // 用 Supabase PostgREST 直接查询（不依赖 supabase-js）
    // 只做 SELECT：pending_pool(status=passed) + 排序 + limit
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

    // 三分区切分（保持你现在的逻辑：CORE > STABLE > EARLY）
    const core = [];
    const stable = [];
    const early = [];

    for (const item of rows) {
      if (item.core_confirmed) core.push(item);
      else if (item.stable_confirmed) stable.push(item);
      else early.push(item);
    }

    // 返回结构：前端直接渲染
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
