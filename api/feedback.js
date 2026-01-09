export default async function handler(req, res) {
  try {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");

    if (req.method !== "POST") {
      return res.status(405).json({ ok: false, error: "Method not allowed" });
    }

    const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
    const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!SUPABASE_URL || !SERVICE_KEY) {
      return res.status(500).json({ ok: false, error: "Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY" });
    }

    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;

    const kind = (body?.kind || "feedback").trim();     // 'waitlist' | 'feedback' | 'report'
    const email = (body?.email || "").trim() || null;
    const message = (body?.message || "").trim() || null;
    const page = (body?.page || "").trim() || null;
    const ca = (body?.ca || "").trim() || null;
    const session_id = (body?.session_id || "").trim() || null;

    const ua = req.headers["user-agent"] || "";
    const ip = (req.headers["x-forwarded-for"] || "").split(",")[0].trim() || null;

    // 最小校验：feedback 必须有 message；waitlist 可以只留 email
    if (kind !== "waitlist" && (!message || message.length < 2)) {
      return res.status(400).json({ ok: false, error: "Message too short" });
    }
    if (kind === "waitlist" && (!email && (!message || message.length < 2))) {
      return res.status(400).json({ ok: false, error: "Please provide email or a short message" });
    }

    const props = { session_id };

    const r = await fetch(`${SUPABASE_URL}/rest/v1/feedback`, {
      method: "POST",
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify([{ kind, email, message, page, ca, props, ua, ip }]),
    });

    if (!r.ok) {
      const text = await r.text();
      return res.status(500).json({ ok: false, error: `Insert failed: ${r.status}`, details: text.slice(0, 500) });
    }

    return res.status(200).json({ ok: true });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e) });
  }
}
