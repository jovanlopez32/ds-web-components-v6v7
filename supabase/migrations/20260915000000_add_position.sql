-- Adds a manual sort order to pages and components, so the admin can
-- drag-and-drop to reorder them instead of being stuck with title/created_at.
alter table public.pages add column position integer not null default 0;
alter table public.components add column position integer not null default 0;

-- Backfill with the order these lists render in today, so deploying this
-- causes no visible reshuffle.
with ranked as (
	select id, row_number() over (partition by parent_id order by title) - 1 as rn
	from public.pages
)
update public.pages p set position = ranked.rn from ranked where ranked.id = p.id;

with ranked as (
	select id, row_number() over (partition by page_id order by created_at desc) - 1 as rn
	from public.components
)
update public.components c set position = ranked.rn from ranked where ranked.id = c.id;

create index pages_parent_position_idx on public.pages (parent_id, position);
create index components_page_position_idx on public.components (page_id, position);
