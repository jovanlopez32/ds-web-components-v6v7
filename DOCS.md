# Component Library — How It Works

An admin tool for storing reusable web components (ASP + LESS + jQuery) and
previewing them live, outside the real ASP platform.

## The problem it solves

Our components ship into a Classic ASP site. Their source contains `<% %>`
blocks a browser will never run, their LESS depends on platform variables and
mixins, and their JS is jQuery 1.10.2. So you cannot just open the files in a
browser and see the component. This tool reproduces enough of the platform to
render it faithfully while you edit.

## Pages

| Route | What it does |
|---|---|
| `/admin/pages` | Pages and subpages. A page groups components; a subpage nests one level under another page. |
| `/admin/pages/<adminSlug>` | The components inside one page. |
| `/admin/pages/<adminSlug>/components/new` <br> `/admin/pages/<adminSlug>/components/<id>` | The editor. Create, edit and delete live here. |
| `/admin/variables` | Global ASP variables. |
| `/admin/configuration` | What the preview environment loads. |

The admin URL uses a separate unguessable `admin_slug`, so the management link
is not derivable from the public one.

These pages are the site's **main navigation**. Developers can also hand-write
their own Astro pages and pull in components by reference — see
[Using a component in your own page](#using-a-component-in-your-own-page).

## The editor

Four tabs, each a CodeMirror 6 editor with syntax colours, line numbers and
auto-indent:

| Tab | What goes in it |
|---|---|
| **ASP** | The markup, `<% %>` blocks and all. |
| **LESS** | The component's styles. |
| **Mixins** | LESS mixins this one component needs. Compiled *before* its LESS, so the LESS can call them. Define them with parentheses — `.thing() { … }` — or a plain `.thing { … }` ruleset is emitted as real CSS. Platform mixins are already available here without declaring anything. |
| **JS** | jQuery or vanilla. |

A **Formatear** button runs Prettier on the active tab. If the code cannot be
parsed you get the error and your code is left exactly as you wrote it; nothing
is silently rewritten.

Above the tabs, a strip shows **who created** the component, **when it was last
modified**, and its **reference snippet** with a copy button.

### Compiling is explicit

The preview only rebuilds when you press **Compilar**. It is not reactive.

Compiling is a ~140 ms server round trip that can fail, so rebuilding on every
keystroke meant error messages flashing up for code that was simply half-typed.
When the editor has drifted from what the preview is showing, a **Código
cambiado** badge appears next to the button — so on-demand compiling never
leaves you looking at a stale preview without knowing it.

Opening an existing component compiles once automatically, so you see it
immediately. A new, empty component compiles nothing until you ask.

### Why the preview is an iframe

The component's JS has to genuinely run, and its LESS must not leak into the
admin's own styling. So the preview is an `<iframe>` with a fresh document.

It is sandboxed with `allow-scripts` but deliberately **without**
`allow-same-origin`. Those two together are an escape hatch: the framed page
could then reach `parent.document` and remove its own sandbox. Leaving
`allow-same-origin` off gives the frame an opaque origin — component code can
do anything to its own document and still cannot touch the admin DOM, cookies,
or the Supabase session token.

The whole document reloads on every change rather than being patched in place.
jQuery code is not idempotent: `$(document).ready`, event bindings and plugins
stack up if you re-run them over an already-mutated DOM, and you end up with
double-bound handlers and a preview that lies. A fresh document is the only
thing that matches a real page load.

### Errors you will see

- **LESS / Mixins / Variables del sitio / Plataforma:** a compile error, tagged
  with which of those four regions it came from and, where the region is one you
  can edit, the line number *within that region*. This matters: without it, a
  fault in your mixins or in Configuration looks like a fault in your LESS, at a
  line number that does not exist in the tab you are staring at.
- **JS:** an uncaught error from inside the preview. The sandbox has no visible
  console, so the frame reports its own errors back to the editor.
- **Missing variables:** listed above the variables panel with a "Definir"
  shortcut.

## Using a component in your own page

Every component has a short **reference number** (`ref`), shown in the editor
and in the component list. Drop it into any hand-written Astro page:

```astro
---
import CodeComponent from '../components/CodeComponent.astro';
export const prerender = false;
---

<CodeComponent id="1" />
```

That renders the live example plus its source, collapsed per language. Props:

| Prop | Default | What it does |
|---|---|---|
| `id` | required | The component's `ref` number. |
| `showCode` | `true` | `false` shows only the live example, no source listing. |
| `height` | `"520px"` | Height of the preview frame. |

`ref` is a separate sequential column, not the uuid primary key, precisely so
this tag stays writable by hand — `id="1"` is usable, a uuid is not.

Nothing about such a page lives in the database: it does not appear in the admin
navigation and is unaffected if someone reorganises pages. The only thing it
reads from the database is each component it names.

Everything runs on the server. The source listing is highlighted by Astro's
built-in `<Code />` (Shiki), so it ships **zero client JavaScript** — verified:
the production build emits no client chunk for `CodeComponent`. The sandboxed
iframe is the same one the editor uses, with the same
`allow-scripts`-without-`allow-same-origin` isolation.

A working example lives at `src/pages/example-manual-page.astro`; copy it as a
starting point. A `ref` that does not exist renders a visible error rather than
nothing, since it means a typo in hand-written markup.

## ASP variables

Two shapes appear in our source, and they are handled differently:

| In your ASP | In the preview |
|---|---|
| `<%=TXT_IMG_PATH%>` | The variable's stored value. |
| `<% = txtRetriever("landing","Content2") %>` | A placeholder: `[txtRetriever]`. |

An undefined variable renders as an empty string — the same thing ASP does —
and its name is reported in the editor so an invisible gap is not a mystery.

**The stored `asp_code` always keeps the real `<% %>` blocks.** Only the preview
substitutes them, so what you copy out is still valid ASP.

### Two levels

- **Global** (`/admin/variables`) — shared across every component. Put things
  like `TXT_IMG_PATH` here.
- **Per component** (variables panel in the editor) — overrides a global of the
  same name. Useful for previewing one component against a specific value
  without changing what everything else sees. These are a preview aid; they are
  not part of the published code.

## LESS compilation

A component's LESS is compiled **on the server**, against the platform's real
mixin files mirrored in `src/v6v7/_platform-less-ref/` (112 files, 1.1 MB).

Sources are concatenated in this order, each layer able to use the ones before
it: platform definitions → site variables (Configuration) → the component's
**Mixins** tab → the component's **LESS** tab.

So `.container`, `.transition()`, `.display-flex()`, `.fluid-property()`,
`@screen-lg-min` and the rest all just work, with nothing to declare. They are
read from the platform source, so they cannot drift from what production does.

Three details that are not obvious and will bite anyone changing this code:

1. **`math: 'always'` is mandatory.** The platform LESS is written for Less 3.x,
   where `/` always divides. Under Less 4's default (`parens-division`), a mixin
   like `.fluid-property` — which computes `(@max - @min) / (@end - @start) * 100`
   — fails with *"Operation on an invalid type"*.

2. **The context is imported with `@import (reference)`.** That makes every
   platform variable, mixin and class callable while emitting no CSS of its own
   (verified at 0 bytes). The compile output is only ever the component's own
   rules. `bootstrap.less` is imported whole rather than cherry-picking its
   variables/mixins files, because those are not self-contained and components
   call Bootstrap classes like `.container` as mixins.

3. **`/bootstrap-v3.2.0/...` imports are root-absolute** against the server's
   LESS root (`/src/less/`), which Node would read as a filesystem path. A
   custom `FileManager` remaps the leading slash to the mirror.

It runs server-side rather than in the browser because the platform files are on
disk there (less.js resolves their `@import` chains natively), it avoids shipping
1.1 MB of platform LESS to every editor session, and it keeps the ~156 KB browser
build of `less` out of the client bundle.

### Where the time goes

A compile started out at ~500 ms. Measured, it was three separate costs, and
LESS was the smallest of them:

| Cost | Before | After |
|---|---|---|
| `middleware` verifying the session | 160–260 ms | ~1 ms |
| Reading `settings` for the site variables | 130–500 ms | 0 ms (cached) |
| `less.render` parsing the platform context | 110–150 ms | unchanged |
| **Total, steady state** | **~500 ms** | **~140 ms median** |

Three things were done, in order of what the measurements justified:

1. **The middleware verifies the JWT locally.** It used to call
   `auth.setSession()`, a network round trip to Supabase Auth on *every*
   protected request. This project signs tokens with **ES256**, so
   `auth.getClaims()` can verify the signature against the project's JWKS —
   fetched once, then cached — in about 1 ms. Admin navigation dropped from
   ~200 ms to 12–17 ms as a side effect.

   The expired-token path is preserved deliberately: `getClaims()` rejects an
   expired JWT, and the middleware then falls back to `setSession()` to mint a
   new one from the refresh token and rewrite the cookies. Swapping in
   `getClaims()` *without* that fallback would log everyone out once an hour.

2. **The settings singleton is cached in memory.** One row, edited every few
   weeks, was costing a Supabase round trip per compile — frequently more than
   compiling. `settings.save` clears the cache explicitly so an edit applies at
   once; a 30 s TTL is the backstop for other serverless instances, which an
   explicit invalidation cannot reach. `/admin/configuration` deliberately
   reads *uncached*, since it is the surface that edits them.

3. **`less` is imported statically** in the actions module, which Astro loads at
   server start, so its 576 KB is parsed then rather than inside the first
   compile request.

### What is left, and why

The remaining ~140 ms is almost entirely `less.render` re-parsing the platform
context. Things that were measured and rejected:

- **Caching file reads:** the 112 files take **9 ms** to read from disk. Not the
  bottleneck; the cost is parsing and evaluating them.
- **Trimming the context:** the platform and Bootstrap files are mutually
  dependent — Bootstrap alone fails on `.transform`, the platform files alone
  fail on `.sr-only`. Neither half stands up without the other.
- A trivial one-rule component costs the same as the real 10 KB one, which
  confirms the component's own LESS is free next to the context.

Reusing a pre-parsed AST across compiles would be the next real win, but less.js
exposes no stable API for it.

## Configuration

Three fields. The first two are about what the preview *loads*; the third is
about what the compiler *knows*.

### External stylesheets

One URL per line, injected as `<link>` into the preview only — never into the
Astro admin pages. This is for icon fonts and any other external CSS the
platform loads in its own `<head>`:

```
//maxcdn.bootstrapcdn.com/font-awesome/4.7.0/css/font-awesome.min.css
//cdn.dealerspike.com/tp/iconmonstr-iconic-font/1.3.0/iconmonstr-iconic-font.min.css
```

Protocol-relative `//` URLs are fine — they are pinned to `https:`
automatically, so the same file loads in local dev and in production.

Note this is **not** where design-system CSS goes. The preview deliberately
injects no site baseline: a component is shown with its own compiled styles
only, not wrapped in the site's body, header and navbar CSS.

### Scripts

One URL per line, loaded before the component's own JS. jQuery goes here:

```
//ajax.googleapis.com/ajax/libs/jquery/1.10.2/jquery.min.js
```

Vanilla JS needs nothing extra. jQuery being present does not change how
`document.querySelector` behaves, so the two do not need separating.

### Site variables (LESS)

Only the values that **differ from site to site**, since those live in each
site's own theme rather than in the platform:

```less
@black: #0f0f0f;
@white: #ffffff;
@index-primary: #c8102e;
@img-path: "/images/";
```

Platform mixins and variables do **not** go here — see LESS compilation above.
If a component uses a theme variable that is not declared here, compilation
fails and the editor shows the error with the line number.

Copy real values from a site's `less/themes/<site>/variables.less`. Inventing
them makes the preview lie: the example theme's `@black` is `#0f0f0f`, and a
plausible-looking `#1a1a1a` produces visibly wrong colours.

## Data model

```
pages       id, parent_id, title, slug, admin_slug, description
components  id, ref, page_id, user_id, created_by_email, title,
            asp_code, less_code, mixins_code, js_code, variables,
            created_at, updated_at
variables   id, name, value                       -- global ASP variables
settings    preview_css_urls, preview_js_urls, preview_less_variables
```

`components.ref` is a `bigint generated always as identity` — the short number
`<CodeComponent id="…" />` uses.

`created_by_email` is denormalised on purpose: it lets the editor credit the
author without exposing `auth.users` to the client, and the credit survives that
account being deleted.

`updated_at` is stamped by the update action rather than by a trigger, so the
one place that writes components is the one place that stamps it.

`components.variables` is a JSON name→value map rather than its own table: it
is always read and written together with the component and edited as one block.
Global variables get a table because they are a shared registry with their own
screen.

Row level security is a shared-library model: everything is publicly readable
(components render on public pages) and any signed-in user can manage any row.

Schema lives in `supabase/migrations/20260907000000_init.sql` as one
starting-point migration that drops and recreates everything.

## Code layout

```
src/actions/index.ts              all mutations + the LESS compile (Astro Actions)
src/lib/asp.ts                    resolves <% %> blocks
src/lib/preview.ts                builds the iframe document
src/lib/less-server.ts            SERVER ONLY: compiles LESS vs platform mixins
src/lib/format.ts                 Prettier wrapper
src/lib/settings.ts               loads settings and global variables
src/components/CodeComponent.astro  renders one component anywhere, by ref
src/components/admin/
  ComponentEditor.tsx             the island: state, compile, save, delete
  CodePane.tsx                    one CodeMirror + Formatear
  ComponentPreview.tsx            the sandboxed iframe, driven by a snapshot
  VariablesPanel.tsx              per-component variables
src/pages/example-manual-page.astro    example of a hand-written page
```

`ComponentPreview` renders a **snapshot** of the code — the state as of the last
Compilar — rather than the live editor state. That is what makes compiling
explicit, and it makes staleness a plain comparison instead of extra state.

### Reference material (not application code)

```
src/v6v7/_platform-less-ref/      mirrored platform LESS — a RUNTIME dependency
src/v6v7/less/                    an example site theme, reference only
src/v6v7/site-example-structure.md  how a site on this platform is laid out
component-example/                a real component, used to verify the tool
```

`_platform-less-ref` is not documentation: the server reads it on every compile,
so it must stay committed and is listed in `astro.config.mjs` under the Vercel
adapter's `includeFiles` (enumerated, not globbed — `includeFiles` resolves each
entry with `realpath`, so `**` fails). Its risk is being a point-in-time copy;
refresh it from
`https://<site>.clients.dealerspike.net/src/less/platform/...` when the platform
moves.

`less/` and `site-example-structure.md` are read by people, not by the app.
Nothing under `src/v6v7/` should ever be imported by an Astro page.

`buildPreviewDocument()` is in `src/lib/` and not inside the island on purpose:
the public pages will need the identical document, so what an author sees while
editing is what the team sees later.

Mutations go through Astro Actions, not API routes, so the island gets
end-to-end types and Zod validation. Each handler builds a Supabase client from
the caller's own access token, so RLS evaluates the real `auth.uid()`.

Delete accepts form data so the per-row delete buttons stay plain
`<form method="POST">` and keep working with JavaScript disabled, while the
editor calls the same action with a `FormData`.

## Notes and limits

- The editor is `client:only` — CodeMirror needs a real DOM and cannot be
  server-rendered.
- `prettier` loads on first use, so it stays out of the initial bundle. Its
  entry points are listed in `astro.config.mjs` under `optimizeDeps.include`
  because Vite's dev scanner does not follow dynamic imports; without that the
  first format fails with *"Failed to fetch dynamically imported module"*.
- `less` is server-only and marked `ssr.external`, so Vite leaves it as a real
  Node dependency that can read the platform files from disk.
- The example LESS uses syntax Less 4 deprecates and warns about: `.container;`
  and `.ul-zero-out;` without parentheses, and `.transform ( … )` with a space
  before the parenthesis. It compiles, but the warnings are real.
- CodeMirror has no ASP mode; the HTML mode is used, which colours everything
  except the `<% %>` blocks. Prettier has no ASP parser either, so formatting
  ASP is best-effort via the HTML parser.
- Subpages are one level deep. Only top-level pages are offered as a parent,
  which makes a parent cycle impossible to create through the UI.
- The database-driven public pages (`/<slug>`, from the pages/subpages
  navigation) are not built yet. `<CodeComponent />` covers the hand-written
  case today, and those pages will reuse it.
- `<CodeComponent />` compiles the component's LESS on every request (~140 ms
  each). Fine for a docs page with a handful of components; if a page ever
  carries dozens, the compiled CSS is the thing to cache — key it on the
  component's `updated_at` plus the site variables.
