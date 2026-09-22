// Compiles a component's LESS on the server, against the real platform mixins.
//
// This runs server-side, not in the browser, for three reasons:
//   * The platform LESS is 112 files / 1.1 MB. Resolving @import in the browser
//     would mean shipping all of it to every editor session and exposing it
//     publicly.
//   * less.js resolves imports from disk here, so the platform's own @import
//     chains work untouched.
//   * It keeps the ~576 KB browser build of `less` out of the client bundle.

import path from 'node:path';
import less from 'less';

/** Where the mirrored platform LESS lives, relative to the project root. */
const PLATFORM_ROOT = path.join(process.cwd(), 'src/v6v7/_platform-less-ref');

/**
 * The compile context: platform variables, mixins and classes.
 *
 * Imported with `(reference)`, which makes every definition callable while
 * emitting no CSS of its own — verified at 0 bytes. So the compile output is
 * only ever the component's own rules, and nothing from the platform leaks
 * into the preview.
 *
 * bootstrap.less is imported whole rather than cherry-picking its variables and
 * mixins files: those are not self-contained (mixins/hide-text.less calls
 * .sr-only, which lives in a different file), and components call Bootstrap
 * classes like `.container` as mixins, which requires the class to exist.
 */
const CONTEXT_IMPORTS = [
	'bootstrap-v3.2.0/bootstrap.less',
	'platform/global-variables.less',
	'platform/mixins.less',
	'platform/v7/default-variables.less',
	'platform/v7/mixins.less',
	'platform/v7/flexbox-mixins.less',
	'platform/v7.1/inventory-mixins.less',
];

/**
 * Resolves the platform's root-absolute imports.
 *
 * platform-core-v7.1.less writes `@import "/bootstrap-v3.2.0/bootstrap.less"`,
 * where the leading slash means the server's LESS root (/src/less/). Node would
 * read that as a filesystem-absolute path, so it is remapped to the mirror.
 */
class PlatformRootFileManager extends less.FileManager {
	supports() {
		return true;
	}

	loadFile(filename: string, currentDirectory: string, options: unknown, environment: unknown) {
		if (filename.startsWith('/')) {
			return super.loadFile(
				filename.slice(1),
				PLATFORM_ROOT,
				options as never,
				environment as never,
			);
		}

		return super.loadFile(filename, currentDirectory, options as never, environment as never);
	}
}

const platformRootPlugin: Less.Plugin = {
	install(_less, pluginManager) {
		pluginManager.addFileManager(new PlatformRootFileManager());
	},
};

/** Which editable region a compile error landed in. */
export type CompileErrorRegion = 'less' | 'mixins' | 'site-variables' | 'platform';

export interface CompileError {
	message: string;
	/** Line within the region named below, not within the assembled source. */
	line: number | null;
	region?: CompileErrorRegion;
}

export interface CompileResult {
	css: string;
	error: CompileError | null;
}

/**
 * @param lessCode   the component's own LESS
 * @param siteVariables  LESS declarations for the values that differ per site
 *   (@black, @index-primary, @img-path, ...). These are not in the platform
 *   files because each site's theme defines its own, so they come from
 *   Configuration instead.
 * @param mixinsCode  LESS mixins belonging to this one component, compiled
 *   ahead of its LESS so they can use the platform's mixins and be used by it.
 */
export async function compileComponentLess(
	lessCode: string,
	siteVariables: string,
	mixinsCode = '',
): Promise<CompileResult> {
	if (!lessCode.trim() && !mixinsCode.trim()) {
		return { css: '', error: null };
	}

	// Order matters: platform definitions, then the site's own variables, then
	// this component's mixins, then the component. Each layer can use the ones
	// before it.
	const platform = CONTEXT_IMPORTS.map((file) => `@import (reference) "${file}";`).join('\n');
	const context = [platform, siteVariables, mixinsCode].join('\n');

	// Every line of context shifts the line numbers the compiler reports, so
	// they get subtracted again below. The mixins are a region the author can
	// actually see and edit, so their own line numbers are reported too.
	const beforeMixinsLines = [platform, siteVariables].join('\n').split('\n').length;
	const mixinsLines = mixinsCode.split('\n').length;
	const contextLines = context.split('\n').length;

	try {
		const output = await less.render(`${context}\n${lessCode}`, {
			paths: [PLATFORM_ROOT],
			plugins: [platformRootPlugin],
			// Required, not a preference. The platform LESS is written for
			// Less 3.x, where `/` always divides. Under Less 4's default
			// (parens-division) a mixin like .fluid-property — which computes
			// `(@max - @min) / (@end - @start) * 100` — fails outright with
			// "Operation on an invalid type".
			math: 'always',
		});

		return { css: output.css, error: null };
	} catch (error) {
		const lessError = error as { message?: string; line?: number; filename?: string };
		const message = lessError.message ?? 'Error compiling LESS';

		// An error inside an imported platform file has nothing to do with the
		// line the author is looking at, so it is reported by file instead.
		const inPlatformFile =
			typeof lessError.filename === 'string' && lessError.filename.includes('_platform-less-ref');

		if (inPlatformFile) {
			return {
				css: '',
				error: {
					message: `${message} (in ${path.basename(lessError.filename!)}, a platform file)`,
					line: null,
					region: 'platform',
				},
			};
		}

		const rawLine = typeof lessError.line === 'number' ? lessError.line : null;

		if (rawLine === null) {
			return { css: '', error: { message, line: null } };
		}

		// Which of the three regions the reported line landed in. Saying so is
		// what keeps an author from hunting through their LESS for a fault that
		// lives in their mixins or in Configuration.
		if (rawLine > contextLines) {
			return { css: '', error: { message, line: rawLine - contextLines, region: 'less' } };
		}

		if (rawLine > beforeMixinsLines) {
			return {
				css: '',
				error: {
					message,
					line: rawLine - beforeMixinsLines,
					region: 'mixins',
				},
			};
		}

		return {
			css: '',
			error: {
				message: `${message} (the error is in the site variables, in Configuration)`,
				line: null,
				region: 'site-variables',
			},
		};
	}
}
