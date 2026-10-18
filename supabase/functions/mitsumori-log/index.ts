import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// 見積診断アプリ（iizima）の利用イベントを1行記録する（広告の効果測定・離脱分析用）。
// 写真診断アプリの shashin-log をお手本に、同じSupabaseプロジェクトに追加する。
// shashin-log・shashin_events には一切触れない。
//
// 受け取るのは {event, source, session_id} だけ。金額・名前・電話番号・見積書の文字など、
// 個人情報や見積書の中身は一切受け取らない・保存しない。

const ALLOWED_ORIGINS = ["https://iizima61-cloud.github.io"];
const EVENTS = ["page_view", "file_selected", "score_shown", "form_start", "form_sent", "line_click"];
// 1つのIPから短時間に大量に来たら断る（shashin-shindanと同じ、shindan_bump RPCによる1日あたりの上限方式）。
// ※shashin-log自体には現在このIP制限が入っていないが、匿名で叩けるPOSTエンドポイントのため、
//   同じプロジェクトに既にあるこの仕組みを使って新たに追加する。
const DAILY_LIMIT = Number(Deno.env.get("MITSUMORI_DAILY_LIMIT") ?? "5000");
const PER_IP_LIMIT = Number(Deno.env.get("MITSUMORI_PER_IP_LIMIT") ?? "300");

function cors(origin: string | null) {
  const o = origin && ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": o,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}
function json(body: unknown, status: number, origin: string | null) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors(origin), "Content-Type": "application/json" } });
}
async function sha(text: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 24);
}

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(origin) });
  if (req.method !== "POST") return json({ error: "method" }, 405, origin);
  if (!origin || !ALLOWED_ORIGINS.includes(origin)) return json({ error: "origin" }, 403, origin);

  let body: any;
  try { body = await req.json(); } catch { return json({ error: "invalid_json" }, 400, origin); }
  const event = String(body?.event ?? "");
  const source = String(body?.source ?? "");
  const session_id = String(body?.session_id ?? "");
  if (!EVENTS.includes(event)) return json({ error: "event" }, 400, origin);
  if (!/^[A-Za-z0-9_-]{1,40}$/.test(source)) return json({ error: "source" }, 400, origin);
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(session_id)) return json({ error: "session_id" }, 400, origin);

  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  // 利用回数の上限（止まっていたら安全側で断る。写真診断アプリとは別カウンタのキーを使う）
  try {
    const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "unknown";
    const ipKey = "mitsumori_ip:" + (await sha(ip + (Deno.env.get("IP_SALT") ?? "iizima")));
    const total = await sb.rpc("shindan_bump", { p_key: "mitsumori_total" });
    if (total.error) throw total.error;
    if (total.data > DAILY_LIMIT) return json({ error: "busy" }, 429, origin);
    const mine = await sb.rpc("shindan_bump", { p_key: ipKey });
    if (mine.error) throw mine.error;
    if (mine.data > PER_IP_LIMIT) return json({ error: "limit" }, 429, origin);
  } catch (_e) {
    return json({ error: "busy" }, 503, origin);
  }

  // event・source・session_idだけを1行追加する（個人情報・見積書の内容は受け取っていないので保存しようがない）。
  const { error } = await sb.from("mitsumori_events").insert({ event, source, session_id });
  if (error) return json({ error: "db" }, 500, origin);
  return json({ ok: true }, 200, origin);
});
