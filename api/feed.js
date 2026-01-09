// /api/feed.js
export default async function handler(req, res) {
  try {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    // CDN 缓存：60 秒，后台可“过期继续用” 5 分钟（更稳、更省）
    res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=300");

    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
      return res.status(500).json({ ok: false, error: "Missing Supabase env vars." });
    }

    const url = new URL(req.url, `https://${req.headers.host}`);

    // 兼容旧参数：limit 表示“每个分区最多多少条”（更符合 feed 直觉）
    // 如果你希望 limit 表示“总条数”，把 perZoneLimit 改成分配策略即可。
    const perZoneLimit = Math.min(parseInt(url.searchParams.get("limit") || "50", 10), 200);

    // 可选：分别指定每区数量（优先级高于 limit）
    const coreLimit = Math.min(parseInt(url.searchParams.get("core_limit") || "", 10) || perZoneLimit, 200);
    const stableLimit = Math.min(parseInt(url.searchParams.get("stable_limit") || "", 10) || perZoneLimit, 200);
    const earlyLimit = Math.min(parseInt(url.searchParams.get("early_limit") || "", 10) || perZoneLimit, 200);

    // 选择字段：保持与前端渲染一致
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

    // 通用的 PostgREST fetch
    async function fetchPendingPool(whereParams, limit) {
      const base =
        `${SUPABASE_URL}/rest/v1/pending_pool` +
        `?select=${encodeURIComponent(selectFields)}` +
        `&status=eq.passed` +
        whereParams +
        `&order=banana_score.desc` +
        `&limit=${limit}`;

      const r = await fetch(base, {
        method: "GET",
        headers: {
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        },
      });

      if (!r.ok) {
        const text = await r.text();
        const err = new Error(`Supabase query failed: ${r.status}`);
        err.details = text.slice(0, 500);
        throw err;
      }

      return await r.json();
    }

    // ✅ 分区查询：先过滤 tier，再排序+limit（避免 core/stable 被排行榜截断）
    // CORE: core_confirmed = true
    // STABLE: stable_confirmed = true AND core_confirmed = false（避免和 CORE 重叠）
    // EARLY: stable_confirmed = false（把 forming 先归到 early；你想单独分 forming 再加一段即可）
    const [coreRows, stableRows, earlyRows] = await Promise.all([
      fetchPendingPool(`&core_confirmed=eq.true`, coreLimit),
      fetchPendingPool(`&stable_confirmed=eq.true&core_confirmed=eq.false`, stableLimit),
      fetchPendingPool(`&stable_confirmed=eq.false`, earlyLimit),
    ]);

    // 保险去重：理论上 stable 已排除 core，不会重复；但如果数据异常，仍保证唯一
    const seen = new Set();
    function uniq(rows) {
      const out = [];
      for (const it of rows || []) {
        if (!it?.ca) continue;
        if (seen.has(it.ca)) continue;
        seen.add(it.ca);
        out.push(it);
      }
      return out;
    }

    const core = uniq(coreRows);
    const stable = uniq(stableRows);
    const early = uniq(earlyRows);

    return res.status(200).json({
      ok: true,
      counts: {
        core: core.length,
        stable: stable.length,
        early: early.length,
        total: core.length + stable.length + early.length,
      },
      zones: { core, stable, early },
      ts: new Date().toISOString(),
      // 额外回传一下每区 limit，方便你前端 debug/展示（可删）
      limits: { core: coreLimit, stable: stableLimit, early: earlyLimit },
    });
  } catch (e) {
    // 统一错误响应（带 details 会更好排查）
    return res.status(500).json({
      ok: false,
      error: e?.message || String(e),
      details: e?.details,
    });
  }
}
