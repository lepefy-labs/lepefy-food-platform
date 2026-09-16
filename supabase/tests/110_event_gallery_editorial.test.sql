-- Migration syntax, historical row preservation, constraints and independent flags.
begin;
do $$
begin
  if exists (
    select id, tenant_id, event_id, image_url, caption, sort_order, is_social_share, created_at
    from public.event_gallery_photos
    except select * from public.gallery_editorial_before
  ) or (select count(*) from public.event_gallery_photos) <> 3 then
    raise exception 'Original gallery data changed';
  end if;
  if exists (
    select 1 from public.event_gallery_photos
    where category <> case when event_id is not null then 'event' else 'general' end
      or hero_eligible or hero_priority <> 50
  ) then raise exception 'Backfill/defaults incorrect'; end if;
  if not (select relrowsecurity from pg_class where oid = 'public.event_gallery_photos'::regclass)
    or not exists (select 1 from pg_policies where tablename = 'event_gallery_photos' and policyname = 'event_gallery_photos_select_public') then
    raise exception 'Existing RLS changed';
  end if;

  insert into public.event_gallery_photos (id, tenant_id, image_url)
    values ('00000000-0000-0000-0000-000000000004', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'https://images.example/new');
  if not exists (select 1 from public.event_gallery_photos where id = '00000000-0000-0000-0000-000000000004' and category = 'general' and hero_eligible = false and hero_priority = 50) then
    raise exception 'New-row defaults incorrect';
  end if;
  begin
    update public.event_gallery_photos set category = 'invalid';
    raise exception 'Invalid category accepted';
  exception when check_violation then null;
  end;
  begin
    update public.event_gallery_photos set hero_priority = -1;
    raise exception 'Negative priority accepted';
  exception when check_violation then null;
  end;
  begin
    update public.event_gallery_photos set hero_priority = 101;
    raise exception 'Priority above 100 accepted';
  exception when check_violation then null;
  end;
  begin
    update public.event_gallery_photos set category = null;
    raise exception 'Null category accepted';
  exception when not_null_violation then null;
  end;
  update public.event_gallery_photos set hero_eligible = true, hero_priority = 100
    where tenant_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
  if exists (select 1 from public.event_gallery_photos where tenant_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' and hero_eligible) then
    raise exception 'Tenant-scoped edit changed another tenant';
  end if;
  if exists (select 1 from public.event_gallery_photos where tenant_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' and is_social_share) then
    raise exception 'Hero toggle changed social-sharing flag';
  end if;
end $$;
rollback;
