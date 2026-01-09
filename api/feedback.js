export default async function handler(req, res) {
  try {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");

    if (req.method === "OPTIONS") return res.status(200).json({ ok: true });
    if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method not allowed" });

    const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
    const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!SUPABASE_URL || !SERVICE_KEY) {
      return res.status(500).json({
        ok: false,
        error: "Missing env vars",
        details: { hasUrl: !!SUPABASE_URL, hasServiceKey: !!SERVICE_KEY },
      });
    }

    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;

    const kind = (body?.kind || "feedback").trim(); // 'waitlist' | 'feedback' | 'report'
    const email = (body?.email || "").trim() || null;
    const message = (body?.message || "").trim() || null;
    const page = (body?.page || "").trim() || null;
    const ca = (body?.ca || "").trim() || null;
    const session_id = (body?.session_id || "").trim() || null;

    const ua = req.headers["user-agent"] || "";
    const ip = (req.headers["x-forwarded-for"] || "").split(",")[0].trim() || null;

    if (kind !== "waitlist" && (!message || message.length < 2)) {
      return res.status(400).json({ ok: false, error: "Message too short" });
    }
    if (kind === "waitlist" && (!email && (!message || message.length < 2))) {
      return res.status(400).json({ ok: false, error: "Provide email or a short message" });
    }

    const payload = [{
      kind,
      email,
      message,
      page,
      ca,
      props: { session_id },
      ua,
      ip,
    }];

    const r = await fetch(`${SUPABASE_URL}/rest/v1/feedback`, {
      method: "POST",
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        "Content-Type": "application/json",
        Prefer: "return=representation",
      },
      body: JSON.stringify(payload),
    });

    const text = await r.text();
    if (!r.ok) {
      return res.status(500).json({
        ok: false,
        error: `Supabase insert failed (${r.status})`,
        details: text.slice(0, 800),
      });
    }

    // representation 会返回插入行；这里不强依赖解析
    return res.status(200).json({ ok: true, raw: text ? text.slice(0, 300) : "" });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e) });
  }
}
