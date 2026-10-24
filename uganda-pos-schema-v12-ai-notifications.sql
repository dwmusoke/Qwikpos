-- =====================================================================
-- QWICKPOS — SCHEMA V12
-- AI-powered notifications: ai_priority column on notifications table.
-- Safe to re-run. Run AFTER schema v3 (notifications table exists).
-- =====================================================================

alter table notifications add column if not exists ai_priority text
  check (ai_priority in ('high','medium','low'));

create index if not exists idx_notifications_ai_priority on notifications(ai_priority, created_at desc) where ai_priority is not null;

-- Replace insert_notification RPC to support ai_priority
create or replace function insert_notification(
  p_business_id uuid,
  p_user_id uuid,
  p_title text,
  p_body text,
  p_type text default 'info',
  p_route text default null,
  p_ai_priority text default 'low'
) returns uuid
language plpgsql security definer as $$
declare
  v_id uuid;
begin
  insert into notifications (business_id, user_id, title, body, type, route, ai_priority)
  values (p_business_id, p_user_id, p_title, p_body, p_type, p_route, p_ai_priority)
  returning id into v_id;
  return v_id;
end;
$$;

grant execute on function insert_notification(uuid, uuid, text, text, text, text, text) to authenticated;

-- =====================================================================
-- END OF SCHEMA V12
-- =====================================================================
