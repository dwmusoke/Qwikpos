-- MIGRATION v11 — Active User Sessions & Device Tracking
-- Lets tenant admins and superadmins see who is logged in, from which device, IP, and when.
-- Sessions are upserted on login, heartbeated while active, and ended on logout.

-- 1. USER SESSIONS — one row per active device/browser per user
create table if not exists user_sessions (
  id uuid primary key default gen_random_uuid(),
  session_id text not null unique,
  user_id uuid not null references auth.users(id) on delete cascade,
  app_user_id uuid references app_users(id) on delete set null,
  business_id uuid references businesses(id) on delete cascade,
  device_type text not null default 'desktop',
  ip_address text,
  user_agent text,
  logged_in_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists idx_user_sessions_user on user_sessions(user_id, is_active);
create index if not exists idx_user_sessions_business on user_sessions(business_id, is_active);
create index if not exists idx_user_sessions_session on user_sessions(session_id);

alter table user_sessions enable row level security;

drop policy if exists user_sessions_isolation on user_sessions;
create policy user_sessions_isolation on user_sessions
  for all using (
    business_id = auth_business_id()
    or is_superadmin()
    or app_user_id = auth.uid()
  )
  with check (
    business_id = auth_business_id()
    or is_superadmin()
    or app_user_id = auth.uid()
  );

-- 2. RPC: upsert_user_session — insert or refresh a session row
create or replace function upsert_user_session(
  p_session_id text,
  p_user_id uuid,
  p_app_user_id uuid,
  p_business_id uuid,
  p_device_type text,
  p_ip_address text,
  p_user_agent text
)
returns uuid as $$
declare
  v_id uuid;
begin
  update user_sessions
  set last_seen_at = now(),
      is_active = true,
      device_type = p_device_type,
      ip_address = p_ip_address,
      user_agent = p_user_agent
  where session_id = p_session_id
    and is_active = true;

  if not found then
    insert into user_sessions (
      session_id, user_id, app_user_id, business_id,
      device_type, ip_address, user_agent,
      logged_in_at, last_seen_at, is_active
    ) values (
      p_session_id, p_user_id, p_app_user_id, p_business_id,
      p_device_type, p_ip_address, p_user_agent,
      now(), now(), true
    )
    returning id into v_id;
  else
    select id into v_id from user_sessions where session_id = p_session_id;
  end if;

  return v_id;
end;
$$ language plpgsql security definer;

grant execute on function upsert_user_session(text, uuid, uuid, uuid, text, text, text) to authenticated, anon;

-- 3. RPC: end_user_session — mark a session inactive (logout)
create or replace function end_user_session(p_session_id text)
returns void as $$
begin
  update user_sessions
  set is_active = false
  where session_id = p_session_id;
end;
$$ language plpgsql security definer;

grant execute on function end_user_session(text) to authenticated, anon;

-- 4. RPC: get_active_sessions — list currently active sessions (tenant-scoped via RLS)
create or replace function get_active_sessions()
returns table (
  id uuid,
  session_id text,
  user_id uuid,
  app_user_id uuid,
  business_id uuid,
  business_name text,
  user_name text,
  user_role text,
  device_type text,
  ip_address text,
  user_agent text,
  logged_in_at timestamptz,
  last_seen_at timestamptz,
  is_active boolean
) as $$
begin
  return query
  select
    us.id,
    us.session_id,
    us.user_id,
    us.app_user_id,
    us.business_id,
    b.name as business_name,
    au.full_name as user_name,
    au.role as user_role,
    us.device_type,
    us.ip_address,
    us.user_agent,
    us.logged_in_at,
    us.last_seen_at,
    us.is_active
  from user_sessions us
  left join app_users au on au.id = us.app_user_id
  left join businesses b on b.id = us.business_id
  where us.is_active = true
    and (
      us.business_id = auth_business_id()
      or is_superadmin()
      or us.app_user_id = auth.uid()
    )
  order by us.last_seen_at desc;
end;
$$ language plpgsql security definer;

grant execute on function get_active_sessions() to authenticated, anon;

-- 5. RPC: end_all_user_sessions — kick all sessions for a user (superadmin)
create or replace function end_all_user_sessions(p_app_user_id uuid)
returns void as $$
begin
  update user_sessions
  set is_active = false
  where app_user_id = p_app_user_id;
end;
$$ language plpgsql security definer;

grant execute on function end_all_user_sessions(uuid) to authenticated, anon;

-- END OF MIGRATION v11
