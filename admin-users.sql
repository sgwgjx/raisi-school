-- ============================================================
-- admin-users.sql — بخش «مدیران» (چند مدیر با نام کاربری و رمز)
-- در Supabase ← SQL Editor ← New query ← Paste ← Run
-- چند بار اجرا کردنش بی‌خطر است. مدیر اصلی (admin@raisi-school.com) دست‌نخورده می‌ماند.
-- ============================================================

create extension if not exists pgcrypto with schema extensions;

create table if not exists public.admin_users (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique,
  display_name text not null default '',
  is_main boolean not null default false,
  created_at timestamptz not null default now()
);
alter table public.admin_users enable row level security;
revoke all on public.admin_users from anon, authenticated;   -- فقط از راه توابع زیر

-- مدیر اصلی را ثبت کن
insert into public.admin_users (id, username, display_name, is_main)
select id, 'admin', 'مدیر اصلی', true from auth.users where lower(email) = 'admin@raisi-school.com'
on conflict (id) do nothing;

-- آیا کاربر فعلی مدیر است؟
create or replace function public._is_admin() returns boolean
language sql stable security definer set search_path = public, auth as $$
  select auth.uid() is not null and (
    exists (select 1 from public.admin_users where id = auth.uid())
    or lower(coalesce(auth.jwt() ->> 'email', '')) = 'admin@raisi-school.com');
$$;

-- فهرست مدیران
create or replace function public.admin_list_admins()
returns table (id uuid, username text, display_name text, is_main boolean, created_at timestamptz)
language plpgsql security definer set search_path = public, auth as $$
begin
  if not public._is_admin() then raise exception 'not_admin'; end if;
  return query select a.id, a.username, a.display_name, a.is_main, a.created_at
               from public.admin_users a order by a.is_main desc, a.created_at;
end $$;

-- افزودن مدیر (ایمیل داخلی = نام‌کاربری@raisi-school.com)
create or replace function public.admin_create_admin(p_username text, p_name text, p_password text)
returns uuid
language plpgsql security definer set search_path = public, auth, extensions as $$
declare
  v_user  text := lower(trim(coalesce(p_username, '')));
  v_email text;
  v_id    uuid := gen_random_uuid();
  c       record;
begin
  if not public._is_admin() then raise exception 'not_admin'; end if;
  if v_user !~ '^[a-z0-9_.]{3,30}$' then raise exception 'bad_username'; end if;
  if v_user = 'admin' then raise exception 'username_taken'; end if;
  if length(coalesce(p_password, '')) < 6 then raise exception 'short_admin_password'; end if;
  v_email := v_user || '@raisi-school.com';
  if exists (select 1 from auth.users where lower(email) = v_email)
     or exists (select 1 from public.admin_users where username = v_user) then
    raise exception 'username_taken';
  end if;

  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                          raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
                          confirmation_token, recovery_token, email_change_token_new, email_change)
  values ('00000000-0000-0000-0000-000000000000', v_id, 'authenticated', 'authenticated', v_email,
          crypt(p_password, gen_salt('bf')), now(),
          '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(), '', '', '', '');

  -- ستون‌های توکنِ NULL باعث خطای ورود می‌شوند؛ همه را رشتهٔ خالی کن
  for c in select column_name from information_schema.columns
           where table_schema = 'auth' and table_name = 'users'
             and column_name in ('confirmation_token','recovery_token','email_change_token_new','email_change',
                                 'email_change_token_current','phone_change','phone_change_token','reauthentication_token')
  loop
    execute format('update auth.users set %1$I = coalesce(%1$I, '''') where id = $1', c.column_name) using v_id;
  end loop;

  insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  values (gen_random_uuid(), v_id, v_id::text,
          jsonb_build_object('sub', v_id::text, 'email', v_email, 'email_verified', true),
          'email', now(), now(), now());

  insert into public.admin_users (id, username, display_name)
  values (v_id, v_user, coalesce(nullif(trim(p_name), ''), v_user));
  return v_id;
end $$;

-- تغییر رمز یک مدیر (رمز مدیر اصلی را فقط خودش می‌تواند عوض کند)
create or replace function public.admin_set_admin_password(p_id uuid, p_password text)
returns void
language plpgsql security definer set search_path = public, auth, extensions as $$
declare t public.admin_users;
begin
  if not public._is_admin() then raise exception 'not_admin'; end if;
  if length(coalesce(p_password, '')) < 6 then raise exception 'short_admin_password'; end if;
  select * into t from public.admin_users where id = p_id;
  if not found then raise exception 'not_found'; end if;
  if t.is_main and p_id <> auth.uid() then raise exception 'forbidden_main'; end if;
  update auth.users set encrypted_password = crypt(p_password, gen_salt('bf')), updated_at = now() where id = p_id;
end $$;

-- حذف مدیر (نه خودِ شما، نه مدیر اصلی)
create or replace function public.admin_delete_admin(p_id uuid)
returns void
language plpgsql security definer set search_path = public, auth as $$
declare t public.admin_users;
begin
  if not public._is_admin() then raise exception 'not_admin'; end if;
  if p_id = auth.uid() then raise exception 'cannot_delete_self'; end if;
  select * into t from public.admin_users where id = p_id;
  if not found then raise exception 'not_found'; end if;
  if t.is_main then raise exception 'cannot_delete_main'; end if;
  delete from auth.users where id = p_id;      -- admin_users و نشست‌ها هم خودکار پاک می‌شوند
end $$;

-- دسترسی: فقط کاربر لاگین‌شده
revoke all on function public._is_admin() from public, anon;
revoke all on function public.admin_list_admins() from public, anon;
revoke all on function public.admin_create_admin(text, text, text) from public, anon;
revoke all on function public.admin_set_admin_password(uuid, text) from public, anon;
revoke all on function public.admin_delete_admin(uuid) from public, anon;
grant execute on function public._is_admin() to authenticated;
grant execute on function public.admin_list_admins() to authenticated;
grant execute on function public.admin_create_admin(text, text, text) to authenticated;
grant execute on function public.admin_set_admin_password(uuid, text) to authenticated;
grant execute on function public.admin_delete_admin(uuid) to authenticated;

notify pgrst, 'reload schema';
