-- MIGRATION 097: NALA SEMANTIC ENRICHMENT
-- Additive, service-role-only asynchronous classification for Nala Analytics.

alter table public.nala_interactions
  add column if not exists intent_confidence numeric,
  add column if not exists demand_status text,
  add column if not exists retrieval_quality text,
  add column if not exists knowledge_status text,
  add column if not exists requested_product_text text,
  add column if not exists semantic_enriched_at timestamptz,
  add column if not exists semantic_enrichment_version text,
  add column if not exists semantic_enrichment_status text not null default 'pending',
  add column if not exists semantic_enrichment_attempts integer not null default 0,
  add column if not exists semantic_enrichment_claimed_at timestamptz,
  add column if not exists semantic_enrichment_last_error_code text;

alter table public.nala_interactions
  add constraint nala_interactions_intent_taxonomy_check check (intent is null or intent in (
    'product_search', 'product_information', 'availability', 'price', 'recommendation',
    'substitution', 'recipe', 'delivery', 'store_information', 'event_information',
    'order_help', 'payment_help', 'complaint', 'small_talk', 'other', 'unknown'
  )),
  add constraint nala_interactions_intent_confidence_check
    check (intent_confidence is null or (intent_confidence >= 0 and intent_confidence <= 1)),
  add constraint nala_interactions_demand_status_check check (demand_status is null or demand_status in (
    'fulfilled', 'partially_fulfilled', 'unmet', 'not_applicable', 'unknown'
  )),
  add constraint nala_interactions_retrieval_quality_check check (retrieval_quality is null or retrieval_quality in (
    'strong', 'weak', 'empty', 'not_applicable', 'unknown'
  )),
  add constraint nala_interactions_knowledge_status_check check (knowledge_status is null or knowledge_status in (
    'sufficient', 'missing', 'not_applicable', 'unknown'
  )),
  add constraint nala_interactions_requested_product_text_check
    check (requested_product_text is null or char_length(requested_product_text) <= 150),
  add constraint nala_interactions_enrichment_version_check
    check (semantic_enrichment_version is null or char_length(semantic_enrichment_version) <= 30),
  add constraint nala_interactions_enrichment_status_check
    check (semantic_enrichment_status in ('pending', 'processing', 'completed', 'failed')),
  add constraint nala_interactions_enrichment_attempts_check
    check (semantic_enrichment_attempts between 0 and 3),
  add constraint nala_interactions_enrichment_error_code_check
    check (semantic_enrichment_last_error_code is null or char_length(semantic_enrichment_last_error_code) <= 50);

comment on column public.nala_interactions.requested_product_text is
  'Short derived product/category phrase; retained only with its parent interaction.';
comment on column public.nala_interactions.semantic_enrichment_version is
  'Classifier/taxonomy version used for the derived semantic fields.';
comment on column public.nala_interactions.semantic_enrichment_last_error_code is
  'Low-cardinality operational code only; never contains provider payloads or raw errors.';

update public.nala_interactions
set intent = 'small_talk',
    intent_confidence = null,
    demand_status = 'not_applicable',
    retrieval_quality = 'not_applicable',
    knowledge_status = 'not_applicable',
    requested_product_text = null,
    semantic_enriched_at = now(),
    semantic_enrichment_version = 'v1',
    semantic_enrichment_status = 'completed',
    semantic_enrichment_claimed_at = null,
    semantic_enrichment_last_error_code = null
where outcome = 'small_talk' and semantic_enriched_at is null;

create index if not exists nala_interactions_tenant_intent_created_idx
  on public.nala_interactions (tenant_id, intent, created_at desc);
create index if not exists nala_interactions_tenant_demand_created_idx
  on public.nala_interactions (tenant_id, demand_status, created_at desc);
create index if not exists nala_interactions_tenant_enrichment_created_idx
  on public.nala_interactions (tenant_id, semantic_enrichment_status, created_at);

create or replace function public.claim_nala_interactions_for_enrichment(p_batch_size integer default 20)
returns table (
  id uuid,
  tenant_id uuid,
  message_text text,
  reply_text text,
  outcome text,
  matched_product_ids uuid[],
  matched_kb_ids uuid[],
  semantic_enrichment_attempts integer
)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  with candidates as (
    select interaction.id
    from public.nala_interactions interaction
    where interaction.semantic_enrichment_attempts < 3
      and (
        interaction.semantic_enrichment_status = 'pending'
        or (
          interaction.semantic_enrichment_status = 'processing'
          and interaction.semantic_enrichment_claimed_at < now() - interval '15 minutes'
        )
      )
    order by interaction.created_at asc
    for update skip locked
    limit greatest(1, least(coalesce(p_batch_size, 20), 25))
  )
  update public.nala_interactions interaction
  set semantic_enrichment_status = 'processing',
      semantic_enrichment_claimed_at = now(),
      semantic_enrichment_attempts = interaction.semantic_enrichment_attempts + 1,
      semantic_enrichment_last_error_code = null
  from candidates
  where interaction.id = candidates.id
  returning
    interaction.id,
    interaction.tenant_id,
    interaction.message_text,
    interaction.reply_text,
    interaction.outcome,
    interaction.matched_product_ids,
    interaction.matched_kb_ids,
    interaction.semantic_enrichment_attempts;
end;
$$;

comment on function public.claim_nala_interactions_for_enrichment(integer) is
  'Atomically claims up to 25 pending Nala interactions using SKIP LOCKED; stale claims recover after 15 minutes and attempts stop at three.';
revoke all on function public.claim_nala_interactions_for_enrichment(integer)
  from public, anon, authenticated;
grant execute on function public.claim_nala_interactions_for_enrichment(integer) to service_role;

insert into public.ai_pricing (
  provider, model, input_price_per_million, output_price_per_million, image_price_flat
)
values ('gemini', 'gemini-2.5-flash-lite', 0.10, 0.40, null)
on conflict (provider, model) do update set
  input_price_per_million = excluded.input_price_per_million,
  output_price_per_million = excluded.output_price_per_million,
  image_price_flat = excluded.image_price_flat,
  active = true,
  updated_at = now();
