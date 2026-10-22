-- The site's own sitewide LESS (its main.less): the base styles every
-- component sits on top of on the real platform, compiled into the preview
-- ahead of the component's LESS.
alter table public.settings add column if not exists preview_sitewide_less text not null default '';
