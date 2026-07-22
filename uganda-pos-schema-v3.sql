-- =====================================================================
-- QWICKPOS — SCHEMA V3
-- Run AFTER uganda-pos-schema.sql + uganda-pos-schema-billing.sql + uganda-pos-schema-v2.sql.
-- Adds: in-app notifications, team chat, push subscriptions.
-- Safe to re-run.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. IN-APP NOTIFICATIONS
-- ---------------------------------------------------------------------
create table if not exists notifications (
  id uuid primary key default gen_random_uuid(),
  business_id uuid references businesses(id) on delete cascade,
  user_id uuid references app_users(id) on delete cascade,   -- null = broadcast to all in business
  title text not null,
  body text,
  type text not null default 'info' check (type in ('info','success','warning','error','sale','stock','subscription','chat')),
  route text,                                                 -- optional: nav link to open on click
  is_read boolean default false,
  created_at timestamptz default now()
);

create index if not exists idx_notifications_user on notifications(user_id, is_read, created_at desc);
create index if not exists idx_notifications_business on notifications(business_id, created_at desc);

alter table notifications enable row level security;

drop policy if exists business_isolation_notifications on notifications;
create policy business_isolation_notifications on notifications
  for select using (
    (user_id = auth.uid())
    or (user_id is null and business_id = auth_business_id())
    or is_superadmin()
  );

drop policy if exists business_insert_notifications on notifications;
create policy business_insert_notifications on notifications
  for insert with check (
    business_id = auth_business_id() or is_superadmin()
  );

drop policy if exists business_update_notifications on notifications;
create policy business_update_notifications on notifications
  for update using (
    user_id = auth.uid()
    or (user_id is null and business_id = auth_business_id())
    or is_superadmin()
  ) with check (
    user_id = auth.uid()
    or (user_id is null and business_id = auth_business_id())
    or is_superadmin()
  );

drop policy if exists business_delete_notifications on notifications;
create policy business_delete_notifications on notifications
  for delete using (
    user_id = auth.uid()
    or is_admin_or_manager()
    or is_superadmin()
  );

-- ---------------------------------------------------------------------
-- 2. TEAM CHAT — conversations + messages
-- ---------------------------------------------------------------------
create table if not exists chat_conversations (
  id uuid primary key default gen_random_uuid(),
  business_id uuid references businesses(id) on delete cascade,
  name text,                                                 -- null = DM, set for group chats
  is_group boolean default false,
  created_by uuid references app_users(id),
  created_at timestamptz default now()
);

alter table chat_conversations enable row level security;

drop policy if exists business_isolation_conversations on chat_conversations;
create policy business_isolation_conversations on chat_conversations
  for all using (
    business_id = auth_business_id() or is_superadmin()
  ) with check (
    business_id = auth_business_id() or is_superadmin()
  );

create table if not exists chat_members (
  conversation_id uuid references chat_conversations(id) on delete cascade,
  user_id uuid references app_users(id) on delete cascade,
  last_read_at timestamptz default now(),
  joined_at timestamptz default now(),
  primary key (conversation_id, user_id)
);

alter table chat_members enable row level security;

drop policy if exists business_isolation_chat_members on chat_members;
create policy business_isolation_chat_members on chat_members
  for all using (
    user_id = auth.uid()
    or conversation_id in (
      select id from chat_conversations where business_id = auth_business_id()
    )
    or is_superadmin()
  ) with check (
    user_id = auth.uid()
    or conversation_id in (
      select id from chat_conversations where business_id = auth_business_id()
    )
    or is_superadmin()
  );

create table if not exists chat_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid references chat_conversations(id) on delete cascade,
  sender_id uuid references app_users(id),
  body text not null,
  created_at timestamptz default now()
);

create index if not exists idx_chat_messages_conv on chat_messages(conversation_id, created_at desc);

alter table chat_messages enable row level security;

drop policy if exists business_isolation_chat_messages on chat_messages;
create policy business_isolation_chat_messages on chat_messages
  for all using (
    conversation_id in (
      select cm.conversation_id from chat_members cm where cm.user_id = auth.uid()
    )
    or conversation_id in (
      select id from chat_conversations where business_id = auth_business_id()
    )
    or is_superadmin()
  ) with check (
    conversation_id in (
      select cm.conversation_id from chat_members cm where cm.user_id = auth.uid()
    )
    or conversation_id in (
      select id from chat_conversations where business_id = auth_business_id()
    )
    or is_superadmin()
  );

-- ---------------------------------------------------------------------
-- 3. PUSH NOTIFICATION SUBSCRIPTIONS (Web Push API)
-- ---------------------------------------------------------------------
create table if not exists push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references app_users(id) on delete cascade,
  business_id uuid references businesses(id) on delete cascade,
  endpoint text not null,
  p256dh text not null,
  auth text not null,
  created_at timestamptz default now()
);

create unique index if not exists idx_push_sub_endpoint on push_subscriptions(endpoint);

alter table push_subscriptions enable row level security;

drop policy if exists business_isolation_push_subs on push_subscriptions;
create policy business_isolation_push_subs on push_subscriptions
  for all using (
    user_id = auth.uid()
    or business_id = auth_business_id()
    or is_superadmin()
  ) with check (
    user_id = auth.uid()
    or business_id = auth_business_id()
    or is_superadmin()
  );

-- ---------------------------------------------------------------------
-- 4. HELPER — insert notification RPC (security definer to bypass RLS
--    when called from edge functions or triggers)
-- ---------------------------------------------------------------------
create or replace function insert_notification(
  p_business_id uuid,
  p_user_id uuid,
  p_title text,
  p_body text,
  p_type text default 'info',
  p_route text default null
) returns uuid
language plpgsql security definer as $$
declare
  v_id uuid;
begin
  insert into notifications (business_id, user_id, title, body, type, route)
  values (p_business_id, p_user_id, p_title, p_body, p_type, p_route)
  returning id into v_id;
  return v_id;
end;
$$;

grant execute on function insert_notification(uuid, uuid, text, text, text, text) to authenticated;

-- =====================================================================
-- END OF SCHEMA V3
-- =====================================================================
