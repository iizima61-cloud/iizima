-- 見積診断アプリ（iizima）の利用イベントを1行記録する（広告の効果測定・離脱分析用）。
-- 写真診断アプリの shashin_events とは別の独立したテーブル（shashin_events には触れない）。
-- 個人情報・見積書の内容・金額・連絡先・IPアドレス・端末情報は一切保存しない。
--
-- shashin_events と異なり、event は「セッション中1回だけ」のものと「毎回記録する」ものが
-- 混在する（form_sent・line_click は毎回）。その区別は画面側（app.jsのtrack関数）で行うため、
-- このテーブルには (session_id, event) の重複禁止インデックスは作らない。
create table if not exists public.mitsumori_events (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  event text not null check (event in ('page_view','file_selected','score_shown','form_start','form_sent','line_click')),
  source text not null check (source ~ '^[A-Za-z0-9_-]{1,40}$'),
  session_id text not null check (char_length(session_id) between 8 and 64)
);

create index if not exists mitsumori_events_created_idx on public.mitsumori_events (created_at);
create index if not exists mitsumori_events_source_event_idx on public.mitsumori_events (source, event);

-- 匿名ユーザーは直接読み書きできない（ポリシーを作らない＝全拒否。Edge Functionだけがservice_roleで操作）
alter table public.mitsumori_events enable row level security;
revoke all on public.mitsumori_events from anon, authenticated;
