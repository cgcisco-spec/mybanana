export default async function handler(req, res) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");

  const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!SUPABASE_URL || !SERVICE_KEY) {
    return res.status(200).json({
      ok: false,
      stage: "env",
      has_SUPABASE_URL: !!SUPABASE_URL,
      has_SERVICE_ROLE: !!SERVICE_KEY,
    });
  }

  // 1) 写 page_events
  const ev = await fetch(`${SUPABASE_URL}/rest/v1/page_events`, {
    method: "POST",
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify([{
      session_id: "diag",
      event: "diag_event",
      props: { t: new Date().toISOString() },
      ua: "diag",
      ip: null
    }]),
  });

  const evText = await ev.text();

  // 2) 写 feedback
  const fb = await fetch(`${SUPABASE_URL}/rest/v1/feedback`, {
    method: "POST",
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify([{
      kind: "feedback",
      email: "diag@example.com",
      message: "diag message",
      page: "/diag",
      ca: null,
      props: { t: new Date().toISOString() },
      ua: "diag",
      ip: null
    }]),
  });

  const fbText = await fb.text();

  return res.status(200).json({
    ok: true,
    supabase_url: SUPABASE_URL,
    page_events: { status: ev.status, ok: ev.ok, body: evText.slice(0, 800) },
    feedback: { status: fb.status, ok: fb.ok, body: fbText.slice(0, 800) },
  });
}
