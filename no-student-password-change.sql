-- اختیاری: جلوگیری کامل از تغییر رمز توسط دانش‌آموز (حتی با فراخوانی مستقیم API)
-- در Supabase ← SQL Editor اجرا کنید. بعد از این، فقط مدیر از تب «دانش‌آموزان» رمز را عوض می‌کند.
do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname = 'student_change_password'
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
  end loop;
end $$;
notify pgrst, 'reload schema';
