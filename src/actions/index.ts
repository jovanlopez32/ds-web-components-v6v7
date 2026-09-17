import { ActionError, defineAction } from 'astro:actions';
import { z } from 'astro/zod';
import { createUserClient } from '../lib/supabase';
import { invalidatePreviewSettings, loadPreviewSettingsCached } from '../lib/settings';
// Imported statically, not lazily: Astro loads this actions module at server
// start, so `less` and its 576 KB of code are parsed then rather than inside
// the first compile request. It is server-only either way.
import { compileComponentLess } from '../lib/less-server';
import type { ActionAPIContext } from 'astro:actions';

// Every mutation goes through the signed-in user's own Supabase client rather
// than a shared one, so RLS policies evaluate against the real auth.uid().
// That is the whole reason createUserClient() exists in src/lib/supabase.ts.
function dbFor(context: ActionAPIContext) {
	const accessToken = context.cookies.get('sb-access-token')?.value;

	if (!accessToken) {
		throw new ActionError({
			code: 'UNAUTHORIZED',
			message: 'Tu sesión expiró. Recarga la página para volver a entrar.',
		});
	}

	return createUserClient(accessToken);
}

/** Turns a Supabase error into an action error, so the UI can show the reason. */
function fail(error: { message: string } | null) {
	if (error) {
		throw new ActionError({ code: 'INTERNAL_SERVER_ERROR', message: error.message });
	}
}

/**
 * An optional text field. Astro converts empty form inputs to `null`, which a
 * bare `z.string()` would reject, so null is accepted explicitly instead of
 * relying on `.default()` (which only fills in `undefined`).
 */
const optionalText = z
	.string()
	.nullish()
	.transform((value) => value ?? '');

const componentFields = z.object({
	title: z.string().trim().min(1, 'El título es obligatorio'),
	aspCode: optionalText,
	lessCode: optionalText,
	jsCode: optionalText,
	// LESS mixins this component needs, compiled ahead of its own LESS.
	mixinsCode: optionalText,
	// This component's own ASP variable overrides, merged over the global ones
	// at preview time.
	variables: z.record(z.string(), z.string()).default({}),
});

function toComponentRow(input: z.infer<typeof componentFields>) {
	return {
		title: input.title,
		asp_code: input.aspCode || null,
		less_code: input.lessCode || null,
		js_code: input.jsCode || null,
		mixins_code: input.mixinsCode || null,
		variables: input.variables,
	};
}

export const server = {
	preview: {
		// Compiling here rather than in the browser is what lets a component's
		// LESS see the real platform mixins: they are 112 files on disk, and
		// less.js resolves their @import chains natively server-side.
		compileLess: defineAction({
			input: z.object({ lessCode: optionalText, mixinsCode: optionalText }),
			handler: async ({ lessCode, mixinsCode }, context) => {
				// Guarded like every other action: this reads platform files
				// and is only for signed-in authors.
				if (!context.locals.user) {
					throw new ActionError({ code: 'UNAUTHORIZED', message: 'No hay sesión activa.' });
				}

				// Cached: this used to cost a Supabase round trip per compile,
				// frequently longer than compiling.
				const settings = await loadPreviewSettingsCached(dbFor(context));

				return compileComponentLess(lessCode, settings.previewLessVariables, mixinsCode);
			},
		}),
	},

	components: {
		create: defineAction({
			input: componentFields.extend({ pageId: z.uuid() }),
			handler: async (input, context) => {
				if (!context.locals.user) {
					throw new ActionError({ code: 'UNAUTHORIZED', message: 'No hay sesión activa.' });
				}

				const { data, error } = await dbFor(context)
					.from('components')
					.insert({
						...toComponentRow(input),
						page_id: input.pageId,
						// The insert policy requires the row be attributed to
						// whoever is actually creating it.
						user_id: context.locals.user.id,
						// Denormalised so the editor can credit the author
						// without exposing auth.users to the client.
						created_by_email: context.locals.user.email ?? null,
					})
					.select('id, ref')
					.single();

				fail(error);
				return { id: data!.id as string, ref: data!.ref as number };
			},
		}),

		update: defineAction({
			input: componentFields.extend({ id: z.uuid() }),
			handler: async (input, context) => {
				const updatedAt = new Date();

				const { error } = await dbFor(context)
					.from('components')
					.update({ ...toComponentRow(input), updated_at: updatedAt.toISOString() })
					.eq('id', input.id);

				fail(error);
				// Returned so the editor can show the new timestamp without
				// re-reading the row.
				return { id: input.id, updatedAt };
			},
		}),

		// accept: 'form' on purpose. The per-row delete button on the page
		// detail view stays a plain <form method="POST">, so it keeps working
		// with JavaScript disabled, while the editor island calls this same
		// action with a FormData. One action, two ways in.
		remove: defineAction({
			accept: 'form',
			input: z.object({ id: z.uuid() }),
			handler: async ({ id }, context) => {
				const { error } = await dbFor(context).from('components').delete().eq('id', id);

				fail(error);
				return { id };
			},
		}),

		// Called after a drag-and-drop reorder in the page detail view. ids is
		// the component list's new top-to-bottom order; position is just its
		// index, so the list can be read back with `.order('position')`.
		reorder: defineAction({
			input: z.object({ ids: z.array(z.uuid()).min(1) }),
			handler: async ({ ids }, context) => {
				const db = dbFor(context);
				const results = await Promise.all(
					ids.map((id, position) => db.from('components').update({ position }).eq('id', id)),
				);

				fail(results.find((result) => result.error)?.error ?? null);
				return { ids };
			},
		}),
	},

	pages: {
		create: defineAction({
			accept: 'form',
			input: z.object({
				title: z.string().trim().min(1, 'El título es obligatorio'),
				slug: z
					.string()
					.trim()
					.min(1, 'El slug es obligatorio')
					.regex(/^[a-z0-9-]+$/, 'El slug solo admite minúsculas, números y guiones'),
				description: optionalText,
				// Empty means a top-level page. The form only offers pages that
				// are themselves top-level, keeping the tree to two levels
				// without needing a trigger to detect cycles.
				parentId: z
					.string()
					.nullish()
					.transform((value) => (value ? value : null)),
			}),
			handler: async (input, context) => {
				const { error } = await dbFor(context).from('pages').insert({
					title: input.title,
					slug: input.slug,
					description: input.description || null,
					parent_id: input.parentId,
				});

				if (error) {
					// The unique constraint is the one failure a user can fix
					// themselves, so it gets its own message.
					throw new ActionError({
						code: error.code === '23505' ? 'CONFLICT' : 'INTERNAL_SERVER_ERROR',
						message:
							error.code === '23505'
								? `El slug "${input.slug}" ya está en uso.`
								: error.message,
					});
				}

				return { slug: input.slug };
			},
		}),

		remove: defineAction({
			accept: 'form',
			input: z.object({ id: z.uuid() }),
			handler: async ({ id }, context) => {
				// Subpages and components cascade from the FK definitions.
				const { error } = await dbFor(context).from('pages').delete().eq('id', id);

				fail(error);
				return { id };
			},
		}),

		// Shared by the top-level page list and every subpage group: ids is one
		// sibling group's new order (they all share the same parent_id), and
		// position only needs to be consistent within that group.
		reorder: defineAction({
			input: z.object({ ids: z.array(z.uuid()).min(1) }),
			handler: async ({ ids }, context) => {
				const db = dbFor(context);
				const results = await Promise.all(
					ids.map((id, position) => db.from('pages').update({ position }).eq('id', id)),
				);

				fail(results.find((result) => result.error)?.error ?? null);
				return { ids };
			},
		}),
	},

	variables: {
		save: defineAction({
			accept: 'form',
			input: z.object({
				// Present when editing an existing row, absent when creating.
				id: z
					.string()
					.nullish()
					.transform((value) => (value ? value : null)),
				name: z
					.string()
					.trim()
					.min(1, 'El nombre es obligatorio')
					.regex(
						/^[A-Za-z_][A-Za-z0-9_]*$/,
						'Debe ser un identificador válido, como TXT_IMG_PATH',
					),
				value: optionalText,
			}),
			handler: async (input, context) => {
				const db = dbFor(context);
				const row = { name: input.name, value: input.value };

				const { error } = input.id
					? await db.from('variables').update(row).eq('id', input.id)
					: await db.from('variables').insert(row);

				if (error) {
					throw new ActionError({
						code: error.code === '23505' ? 'CONFLICT' : 'INTERNAL_SERVER_ERROR',
						message:
							error.code === '23505'
								? `Ya existe una variable llamada "${input.name}".`
								: error.message,
					});
				}

				return { name: input.name };
			},
		}),

		remove: defineAction({
			accept: 'form',
			input: z.object({ id: z.uuid() }),
			handler: async ({ id }, context) => {
				const { error } = await dbFor(context).from('variables').delete().eq('id', id);

				fail(error);
				return { id };
			},
		}),
	},

	settings: {
		save: defineAction({
			accept: 'form',
			input: z.object({
				// Textareas, one URL per line — easier to edit than a
				// comma-separated field, and it matches how these get pasted.
				previewCssUrls: optionalText,
				previewJsUrls: optionalText,
				previewLessVariables: optionalText,
			}),
			handler: async (input, context) => {
				const { error } = await dbFor(context)
					.from('settings')
					.update({
						preview_css_urls: splitLines(input.previewCssUrls),
						preview_js_urls: splitLines(input.previewJsUrls),
						preview_less_variables: input.previewLessVariables,
						updated_at: new Date().toISOString(),
					})
					.eq('id', true);

				fail(error);
				// The compile reads these from a cache; without this an edit
				// would not take effect until the TTL lapsed.
				invalidatePreviewSettings();
				return { saved: true };
			},
		}),
	},
};

function splitLines(value: string): string[] {
	return value
		.split('\n')
		.map((line) => line.trim())
		.filter(Boolean);
}
