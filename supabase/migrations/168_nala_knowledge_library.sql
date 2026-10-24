-- Nala knowledge library: immutable editorial versions, explicit tenant adoption,
-- and append-only revisions of tenant knowledge. No tenant entry is activated here.
begin;

create table if not exists public.knowledge_library (
  id uuid primary key default gen_random_uuid(),
  stable_key text not null check (stable_key ~ '^[a-z0-9][a-z0-9_-]{2,79}$'),
  locale text not null check (locale ~ '^[a-z]{2}(-[A-Z]{2})?$'),
  version integer not null check (version > 0),
  title text not null check (char_length(title) between 1 and 160),
  category text not null check (category in ('recipe','expression','greeting','cultural_context','faq')),
  content text not null check (char_length(content) between 1 and 2000),
  scope text not null check (scope in ('global','cultural')),
  cultural_area text check (cultural_area is null or cultural_area ~ '^[A-Z]{2}$'),
  provenance text not null check (char_length(provenance) between 1 and 500),
  verification_status text not null default 'draft' check (verification_status in ('draft','verified','withdrawn')),
  reviewed_at timestamptz,
  review_due_at timestamptz,
  requires_tenant_confirmation boolean not null default true,
  is_current boolean not null default false,
  embedding vector(768),
  created_at timestamptz not null default now(),
  constraint knowledge_library_scope_area_check check (
    (scope = 'global' and cultural_area is null) or
    (scope = 'cultural' and cultural_area is not null)
  ),
  constraint knowledge_library_current_verified_check check (
    not is_current or verification_status = 'verified'
  ),
  unique (stable_key, locale, version)
);

create unique index if not exists knowledge_library_one_current_idx
  on public.knowledge_library (stable_key, locale) where is_current;
create index if not exists knowledge_library_browse_idx
  on public.knowledge_library (locale, scope, cultural_area, category, title)
  where is_current and verification_status = 'verified';

alter table public.knowledge_library enable row level security;
alter table public.knowledge_library force row level security;
revoke all on public.knowledge_library from public, anon, authenticated;
grant select, insert, update, delete on public.knowledge_library to service_role;

create or replace function public.protect_verified_knowledge_version()
returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    if old.verification_status = 'verified' then
      raise exception 'Verified knowledge versions cannot be deleted';
    end if;
    return old;
  end if;
  if old.verification_status = 'verified' and (
    new.stable_key, new.locale, new.version, new.title, new.category,
    new.content, new.scope, new.cultural_area, new.provenance
  ) is distinct from (
    old.stable_key, old.locale, old.version, old.title, old.category,
    old.content, old.scope, old.cultural_area, old.provenance
  ) then
    raise exception 'Verified knowledge content is immutable; publish a new version';
  end if;
  return new;
end;
$$;
revoke all on function public.protect_verified_knowledge_version() from public, anon, authenticated;
create trigger knowledge_library_immutable_verified
  before update or delete on public.knowledge_library for each row
  execute function public.protect_verified_knowledge_version();

alter table public.tenant_knowledge_base
  add column if not exists title text,
  add column if not exists library_key text,
  add column if not exists library_locale text,
  add column if not exists library_version integer,
  add column if not exists modified_by text,
  add column if not exists deleted_at timestamptz,
  add column if not exists revision integer not null default 1;

alter table public.tenant_knowledge_base
  add constraint tenant_knowledge_library_reference_check check (
    (library_key is null and library_locale is null and library_version is null) or
    (library_key is not null and library_locale is not null and library_version is not null)
  );
alter table public.tenant_knowledge_base
  add constraint tenant_knowledge_library_version_fk
  foreign key (library_key, library_locale, library_version)
  references public.knowledge_library (stable_key, locale, version)
  on update restrict on delete restrict;
create unique index if not exists tenant_knowledge_library_adoption_idx
  on public.tenant_knowledge_base (tenant_id, library_key, library_locale)
  where library_key is not null and deleted_at is null;
create index if not exists tenant_knowledge_live_page_idx
  on public.tenant_knowledge_base (tenant_id, deleted_at, created_at desc);

create table if not exists public.tenant_knowledge_revisions (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  knowledge_id uuid not null,
  revision integer not null check (revision > 0),
  action text not null check (action in ('created','updated','paused','reactivated','deleted')),
  title text,
  category text not null,
  content text not null,
  source text,
  active boolean not null,
  library_key text,
  library_version integer,
  actor text,
  recorded_at timestamptz not null default now(),
  unique (knowledge_id, revision)
);
create index if not exists tenant_knowledge_revisions_tenant_idx
  on public.tenant_knowledge_revisions (tenant_id, knowledge_id, revision desc);
alter table public.tenant_knowledge_revisions enable row level security;
alter table public.tenant_knowledge_revisions force row level security;
revoke all on public.tenant_knowledge_revisions from public, anon, authenticated;
grant select, insert on public.tenant_knowledge_revisions to service_role;

create or replace function public.reject_tenant_knowledge_revision_mutation()
returns trigger language plpgsql as $$
begin
  -- Retain normal append-only behaviour, while allowing an actual tenant deletion
  -- to cascade through its private history for data-erasure requests.
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then return old; end if;
  raise exception 'Knowledge revisions are append-only';
end;
$$;
revoke all on function public.reject_tenant_knowledge_revision_mutation() from public, anon, authenticated;
create trigger tenant_knowledge_revisions_append_only
  before update or delete on public.tenant_knowledge_revisions for each row
  execute function public.reject_tenant_knowledge_revision_mutation();

create or replace function public.tenant_knowledge_revision_before_update()
returns trigger language plpgsql set search_path = public as $$
begin
  new.revision := old.revision + 1;
  return new;
end;
$$;
create or replace function public.tenant_knowledge_revision_after_change()
returns trigger language plpgsql set search_path = public as $$
declare
  v_row public.tenant_knowledge_base%rowtype;
  v_action text;
begin
  if tg_op = 'DELETE' then
    v_row := old;
    v_action := 'deleted';
  else
    v_row := new;
    if tg_op = 'INSERT' then v_action := 'created';
    elsif old.deleted_at is null and new.deleted_at is not null then v_action := 'deleted';
    elsif old.active and not new.active then v_action := 'paused';
    elsif not old.active and new.active then v_action := 'reactivated';
    else v_action := 'updated';
    end if;
  end if;
  -- Dismissal markers are review-queue state, never knowledge content.
  if coalesce(v_row.source, '') like 'nala_dismissed:%' then return null; end if;
  insert into public.tenant_knowledge_revisions
    (tenant_id, knowledge_id, revision, action, title, category, content, source,
     active, library_key, library_version, actor)
  values
    (v_row.tenant_id, v_row.id, v_row.revision, v_action, v_row.title,
     v_row.category, v_row.content, v_row.source, v_row.active,
     v_row.library_key, v_row.library_version,
     coalesce(v_row.modified_by, v_row.reviewed_by));
  return null;
end;
$$;
revoke all on function public.tenant_knowledge_revision_before_update() from public, anon, authenticated;
revoke all on function public.tenant_knowledge_revision_after_change() from public, anon, authenticated;
drop trigger if exists tenant_knowledge_revision_before_update on public.tenant_knowledge_base;
create trigger tenant_knowledge_revision_before_update
  before update on public.tenant_knowledge_base for each row
  execute function public.tenant_knowledge_revision_before_update();
drop trigger if exists tenant_knowledge_revision_after_change on public.tenant_knowledge_base;
create trigger tenant_knowledge_revision_after_change
  after insert or update or delete on public.tenant_knowledge_base for each row
  execute function public.tenant_knowledge_revision_after_change();

-- Editorially checked process guidance. It contains no live price, stock or rate.
insert into public.knowledge_library
  (stable_key, locale, version, title, category, content, scope, cultural_area,
   provenance, verification_status, reviewed_at, review_due_at, is_current)
values
  ('order_online','fr',1,'Commander en ligne','faq',
   'Pour commander en ligne, choisissez les produits dans le catalogue, vérifiez le format et la quantité indiqués sur chaque fiche, puis ajoutez-les au panier. Suivez ensuite les étapes de livraison et de paiement affichées par la boutique. Seules les informations affichées au moment de votre commande font foi.',
   'global',null,'Lepefy storefront: catalogue, panier et parcours de commande','verified',now(),now() + interval '12 months',true),
  ('selling_format','fr',1,'Prix et format de vente','faq',
   'Le prix affiché sur une fiche produit correspond à son format de vente indiqué : à la pièce, au poids ou par conditionnement selon le produit. Vérifiez l’unité et le contenu net sur la fiche avant d’ajouter au panier. Pour un prix actuel, consultez toujours le catalogue.',
   'global',null,'Lepefy storefront: fiche produit et selling format','verified',now(),now() + interval '12 months',true),
  ('minimum_quantity','fr',1,'Quantités minimales et pas','faq',
   'Certains produits ont une quantité minimale ou un pas de commande. La fiche produit et le panier indiquent les quantités possibles. Si plusieurs produits appartiennent à un groupe à combiner, le panier indique la progression du groupe. Vérifiez toujours la règle affichée pour les produits choisis.',
   'global',null,'Lepefy storefront: règles de quantité et panier','verified',now(),now() + interval '12 months',true),
  ('shipping_cost','fr',1,'Connaître les frais de livraison','faq',
   'Les frais de livraison dépendent de votre panier et de la destination. Renseignez l’adresse ou le pays demandé dans le parcours de commande pour obtenir le montant calculé par la boutique. Nala ne peut pas garantir un montant sans ce calcul.',
   'global',null,'Lepefy storefront: devis de livraison et checkout','verified',now(),now() + interval '12 months',true),
  ('promotions_new','fr',1,'Promotions et nouveautés','faq',
   'Pour connaître les promotions et nouveautés du moment, consultez les rubriques correspondantes du catalogue. Les produits, prix et dates peuvent changer : fiez-vous aux informations affichées sur chaque fiche.',
   'global',null,'Lepefy storefront: catalogue, promotions et nouveautés','verified',now(),now() + interval '12 months',true),
  ('ndole_terminology','fr',1,'Ndolé : feuilles ou plat','cultural_context',
   'Selon le contexte, « ndolé » peut désigner les feuilles utilisées en cuisine ou le plat camerounais préparé avec ces feuilles. Si la demande ne précise pas lequel, demandez si la personne cherche les feuilles ou un plat préparé. Cette explication ne signifie pas que la boutique vend l’un ou l’autre.',
   'cultural','CM','Ministère du Tourisme et des Loisirs du Cameroun — https://mintoul.gov.cm/cameroun-en-decouverte/cuisine/','verified',now(),now() + interval '12 months',true),
  ('cameroon_ingredients','fr',1,'Ingrédients de la cuisine camerounaise','cultural_context',
   'La cuisine camerounaise emploie, selon les plats et les régions, des ingrédients comme les feuilles de ndolé, les arachides, le manioc, la banane plantain et le niébé. Cette liste donne un contexte culturel général : ne présumez jamais que ces produits sont disponibles dans la boutique et vérifiez le catalogue pour chaque demande.',
   'cultural','CM','Ministère du Tourisme et des Loisirs du Cameroun — https://mintoul.gov.cm/cameroun-en-decouverte/cuisine/','verified',now(),now() + interval '12 months',true)
on conflict (stable_key, locale, version) do nothing;

create or replace function public.match_knowledge_base(
  query_embedding vector(768), p_tenant_id uuid, match_count int default 3,
  min_similarity float default 0.35
)
returns table (id uuid, category text, content text, similarity float)
language sql stable set search_path = public as $$
  select k.id, k.category, k.content,
    1 - (k.embedding <=> query_embedding) as similarity
  from public.tenant_knowledge_base k
  where k.tenant_id = p_tenant_id and k.active = true
    and k.deleted_at is null and k.embedding is not null
    and 1 - (k.embedding <=> query_embedding) >= min_similarity
  order by k.embedding <=> query_embedding
  limit least(greatest(match_count, 0), 10);
$$;
revoke all on function public.match_knowledge_base(vector, uuid, int, float) from public, anon, authenticated;
grant execute on function public.match_knowledge_base(vector, uuid, int, float) to service_role;

commit;
