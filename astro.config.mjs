// @ts-check
import { readdirSync } from 'node:fs';
import { defineConfig } from 'astro/config';

import react from '@astrojs/react';
import tailwindcss from '@tailwindcss/vite';
import vue from '@astrojs/vue';
import vercel from '@astrojs/vercel';

const PLATFORM_LESS_DIR = './src/v6v7/_platform-less-ref';

/** Every mirrored platform LESS file, as paths relative to the project root. */
function platformLessFiles() {
	return readdirSync(PLATFORM_LESS_DIR, { recursive: true, encoding: 'utf8' })
		.filter((entry) => entry.endsWith('.less'))
		// Windows readdir returns backslashes; the adapter wants forward slashes.
		.map((entry) => `${PLATFORM_LESS_DIR}/${entry.split('\\').join('/')}`);
}


// https://astro.build/config
export default defineConfig({
  // Server-rendered by default, because the navbar is not static content: it
  // reads the `pages` table on every render, and that table is edited from
  // /admin at any time. Under the default 'static' output a page without an
  // explicit `prerender = false` bakes the navbar in at build time, so the
  // links keep showing whatever the menu looked like on the last deploy —
  // which is why the DB-backed routes were correct and the home page was not.
  //
  // Opt individual routes back into prerendering with `export const prerender
  // = true` only if they render nothing that comes from the database.
  output: 'server',

  integrations: [react(), vue()],
  adapter: vercel({
    // The LESS compile reads the mirrored platform files from disk at runtime.
    // Vercel only ships what it can statically see imported, and these are
    // opened by path, so they have to be listed or compiling breaks in
    // production while working fine locally.
    //
    // Enumerated rather than globbed: includeFiles resolves each entry with
    // realpath, so a '**' pattern fails with ENOENT.
    includeFiles: platformLessFiles()
  }),

  vite: {
    plugins: [tailwindcss()],

    optimizeDeps: {
      // Prettier is only reached through `await import(...)` inside the editor
      // island, so Vite's dev-time scanner never sees it and the first format
      // fails with "Failed to fetch dynamically imported module". Listing the
      // entry points here pre-bundles them up front.
      //
      // `less` is deliberately absent: it runs server-side only (see
      // src/lib/less-server.ts), because component LESS is compiled against
      // the platform's 112 mixin files on disk.
      include: [
        'prettier/standalone',
        'prettier/plugins/html',
        'prettier/plugins/postcss',
        'prettier/plugins/babel',
        'prettier/plugins/estree',
      ]
    },

    ssr: {
      // Keep `less` a real Node dependency rather than letting Vite bundle it:
      // it reads the platform LESS from the filesystem at runtime.
      external: ['less']
    }
  }
});