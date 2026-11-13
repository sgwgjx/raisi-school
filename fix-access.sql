-- ============================================================
-- fix-access.sql — دسترسی مدیر به «پنل دانش‌آموزی»
-- در Supabase ← SQL Editor ← New query ← Paste ← Run
-- چند بار اجرا کردنش بی‌خطر است. جدول یا داده‌ای حذف/تغییر نمی‌کند.
-- ============================================================

-- ۱) اجازهٔ دیدن schema و GRANT روی جدول‌ها برای مدیر (کاربر لاگین‌شده)
grant usage on schema public to anon, authenticated;

do $$
declare t text;
begin
  foreach t in array array['students','panel_exams','panel_content','exam_results'] loop
    if to_regclass('public.' || t) is not null then
      execute format('grant select, insert, update, delete on public.%I to authenticated', t);
      execute format('alter table public.%I enable row level security', t);
      -- فقط کاربر لاگین‌شده (مدیر) مستقیماً به جدول دسترسی دارد؛ دانش‌آموزها فقط از راه توابع (RPC)
      execute format('drop policy if exists admin_all on public.%I', t);
      execute format('create policy admin_all on public.%I for all to authenticated using (true) with check (true)', t);
    else
      raise notice 'جدول % وجود ندارد — فایل اصلی student-panel.sql را اجرا کنید', t;
    end if;
  end loop;
end $$;

-- ۲) اجرای توابع: توابع دانش‌آموز/آنلاین برای همه؛ توابع admin_* فقط برای مدیر
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig, p.proname
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and (p.proname like 'admin\_%' or p.proname like 'student\_%'
           or p.proname in ('heartbeat', 'online_count'))
  loop
    if f.proname like 'admin\_%' then
      execute format('revoke all on function %s from public, anon', f.sig);
      execute format('grant execute on function %s to authenticated', f.sig);
    else
      execute format('grant execute on function %s to anon, authenticated', f.sig);
    end if;
  end loop;
end $$;

-- ۳) باکت فایل‌ها (panel-files): خواندن عمومی، آپلود/حذف فقط مدیر
insert into storage.buckets (id, name, public, file_size_limit)
values ('panel-files', 'panel-files', true, 52428800)
on conflict (id) do update set public = true, file_size_limit = 52428800;

drop policy if exists "panel-files read"  on storage.objects;
drop policy if exists "panel-files admin" on storage.objects;
create policy "panel-files read"  on storage.objects for select to anon, authenticated
  using (bucket_id = 'panel-files');
create policy "panel-files admin" on storage.objects for all to authenticated
  using (bucket_id = 'panel-files') with check (bucket_id = 'panel-files');

-- ۴) تازه‌سازی کش API
notify pgrst, 'reload schema';
