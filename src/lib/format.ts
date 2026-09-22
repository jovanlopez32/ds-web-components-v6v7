// Prettier in the browser, used by the "Format" button in the editor.
//
// Everything is imported lazily: Prettier's standalone build plus three parser
// plugins is a lot of bytes to hand someone who only came to read a component.

import type { Plugin } from 'prettier';

export type CodeLanguage = 'asp' | 'less' | 'javascript';

export interface FormatResult {
	code: string;
	/**
	 * Set when the code could not be parsed. The caller keeps the original
	 * code in that case — silently mangling or discarding what someone typed
	 * is far worse than leaving it unformatted.
	 */
	error: string | null;
}

/** Prettier's parser name and the plugins each language needs. */
async function loadParser(language: CodeLanguage) {
	switch (language) {
		case 'asp': {
			// ASP is markup with <% %> blocks embedded in it, so the html
			// parser is the closest fit; Prettier has no ASP parser. It treats
			// the server-side blocks as text, which is fine for indentation but
			// means formatting is best-effort: if a block sits somewhere the
			// html parser cannot make sense of, format() reports the error and
			// the author's code is left exactly as they wrote it.
			const plugin = await import('prettier/plugins/html');
			return { parser: 'html', plugins: [plugin] };
		}
		case 'less': {
			// LESS is handled by the postcss plugin (which also covers css and
			// scss), not by a plugin named "css".
			const plugin = await import('prettier/plugins/postcss');
			return { parser: 'less', plugins: [plugin] };
		}
		case 'javascript': {
			// babel needs estree alongside it to print the AST it produces.
			const [babel, estree] = await Promise.all([
				import('prettier/plugins/babel'),
				import('prettier/plugins/estree'),
			]);
			return { parser: 'babel', plugins: [babel, estree] };
		}
	}
}

export async function formatCode(code: string, language: CodeLanguage): Promise<FormatResult> {
	if (!code.trim()) {
		return { code, error: null };
	}

	try {
		const [prettier, { parser, plugins }] = await Promise.all([
			import('prettier/standalone'),
			loadParser(language),
		]);

		const formatted = await prettier.format(code, {
			parser,
			// Unlike the Node API, the standalone build never auto-loads
			// plugins; they have to be passed in explicitly. The imported
			// plugin modules are namespace objects, which Prettier accepts but
			// which do not structurally match its Plugin type.
			plugins: plugins as unknown as Plugin[],
			useTabs: true,
			printWidth: 100,
		});

		return { code: formatted, error: null };
	} catch (error) {
		return {
			code,
			error: error instanceof Error ? error.message : 'Could not format the code',
		};
	}
}
