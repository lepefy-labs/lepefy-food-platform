-- 137: transport metadata columns (run after 136 fixture + 136 + 137).
do $$
declare
  t1 uuid := '11111111-1111-4111-8111-111111111111';
begin
  insert into public.notification_deliveries (tenant_id, idempotency_key, notification_type, webhook_path, payload, transport, provider_message_id)
  values (t1, 'transport:1', 'x', '/webhook/send-email', null, 'brevo', '<202609271200.123@smtp-relay.mailin.fr>');
  begin
    insert into public.notification_deliveries (tenant_id, idempotency_key, notification_type, webhook_path, payload, transport)
    values (t1, 'transport:2', 'x', '/webhook/send-email', null, 'smtp-unknown');
    raise exception 'unknown transport accepted';
  exception when check_violation then null;
  end;
  if (select count(*) from public.notification_deliveries where transport is null and idempotency_key = 'transport:1') <> 0 then
    raise exception 'transport not stored';
  end if;
end $$;

select 'notification delivery transport: ok' as result;
