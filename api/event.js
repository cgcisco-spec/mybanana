export default async function handler(req, res) {
  try {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");

    if (req.method === "OPTIONS") return res.status(200).json({ ok: true });
    if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method not allowed" });

    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!SUPABASE_URL || !SERVICE_KEY) {
      return res.status(500).json({
        ok: false,
        error: "Missing env vars",
        details: { hasUrl: !!SUPABASE_URL, hasServiceKey: !!SERVICE_KEY },
      });
    }

    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    const event = (body?.event || "").trim();
    const session_id = (body?.session_id || "").trim();
    const props = body?.props || {};

    if (!event || !session_id) {
      return res.status(400).json({ ok: false, error: "Missing event or session_id" });
    }

    const ua = req.headers["user-agent"] || "";
    const ip = (req.headers["x-forwarded-for"] || "").split(",")[0].trim() || null;

    const r = await fetch(`${SUPABASE_URL}/rest/v1/page_events`, {
      method: "POST",
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        "Content-Type": "application/json",
        Prefer: "return=representation",
      },
      body: JSON.stringify([{ session_id, event, props, ua, ip }]),
    });

    const text = await r.text();
    if (!r.ok) {
      return res.status(500).json({
        ok: false,
        error: `Supabase insert failed (${r.status})`,
        details: text.slice(0, 1000),
      });
    }

    return res.status(200).json({ ok: true });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e) });
  }
}
