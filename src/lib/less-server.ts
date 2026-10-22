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
 * emitting no CSS of its own — verified at 0 bytes. So a component compile
 * outputs only the component's own rules, and nothing from the platform leaks
 * into the preview. (The sitewide styles are compiled separately.)
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
 * The v7 site template's own definitions, also `(reference)`, so they emit
 * nothing by themselves.
 *
 * A site's main.less is written against these, not just the platform: the
 * `@internal-*` / `@bg-*` variables and mixins like `.soc-icon-sizer()`,
 * `.calendar-styler()` or `.dvSIZECONTROL()` exist only here. They are the
 * same template files in every v7 site; the blackdiamondhd theme is simply the
 * copy this repo has. variables.less goes first so the site variables from
 * Configuration, which come after it, override its defaults.
 *
 * Only the sitewide compile gets these, never a component's. Several share a
 * name with a platform mixin, and LESS applies every definition of a name, so
 * adding them to a component's context changed the CSS of existing components
 * (extra rules in the footers and the header).
 */
const TEMPLATE_DIR = '../less/themes/blackdiamondhd';
const TEMPLATE_IMPORTS = [
	'variables.less',
	'utilities/mixins.less',
	'utilities/general-styler.less',
	'utilities/flexbox-mixins.less',
	'utilities/bootstrap-xl-shim.less',
	'stylers/button-styler.less',
	'stylers/calendar-styler.less',
	'stylers/carousel-styler.less',
	'stylers/header-styler.less',
	'stylers/navbar-styler.less',
	'stylers/social-button-styler.less',
	'stylers/inventory-styler.less',
].map((file) => `${TEMPLATE_DIR}/${file}`);

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
export type CompileErrorRegion = 'less' | 'mixins' | 'sitewide' | 'site-variables' | 'platform';

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


type RegionName = CompileErrorRegion | 'context';

/**
 * Renders a list of regions as one LESS source, and maps a compile error back
 * to the region it landed in, with the line number counted from that region's
 * own first line. Saying which region is what keeps an author from hunting
 * through their LESS for a fault that lives in their mixins or in
 * Configuration.
 */
async function renderRegions(regions: { name: RegionName; code: string }[]): Promise<CompileResult> {
	let nextLine = 1;
	const bounds = regions.map((region) => {
		const start = nextLine;
		nextLine += region.code.split('\n').length;
		return { ...region, start };
	});

	try {
		const output = await less.render(regions.map((region) => region.code).join('\n'), {
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

		// An error inside an imported platform or template file has nothing to
		// do with the line the author is looking at, so it is reported by file
		// instead.
		if (typeof lessError.filename === 'string' && lessError.filename !== 'input') {
			return {
				css: '',
				error: {
					message: `${message} (in ${path.basename(lessError.filename)}, a platform file)`,
					line: null,
					region: 'platform',
				},
			};
		}

		const rawLine = typeof lessError.line === 'number' ? lessError.line : null;

		if (rawLine === null) {
			return { css: '', error: { message, line: null } };
		}

		const region = [...bounds].reverse().find((bound) => bound.start <= rawLine)!;

		if (region.name === 'site-variables' || region.name === 'context') {
			return {
				css: '',
				error: {
					message: `${message} (the error is in the site variables, in Configuration)`,
					line: null,
					region: 'site-variables',
				},
			};
		}

		return {
			css: '',
			error: {
				message:
					region.name === 'sitewide'
						? `${message} (the error is in the sitewide styles, in Configuration)`
						: message,
				line: rawLine - region.start + 1,
				region: region.name,
			},
		};
	}
}

function referenceImports(files: string[]): string {
	return files.map((file) => `@import (reference) "${file}";`).join('\n');
}

/**
 * The sitewide CSS, keyed by its inputs. It is the same for every component
 * and every compile until Configuration changes, and it is the largest compile
 * by far (a whole main.less against the template), so there is no point paying
 * for it on each Compile press.
 */
let sitewideCache: { key: string; result: Promise<CompileResult> } | null = null;

function compileSitewideLess(sitewideLess: string, siteVariables: string): Promise<CompileResult> {
	if (!sitewideLess.trim()) {
		return Promise.resolve({ css: '', error: null });
	}

	const key = JSON.stringify([sitewideLess, siteVariables]);
	if (sitewideCache?.key !== key) {
		sitewideCache = {
			key,
			result: renderRegions([
				{ name: 'context', code: referenceImports([...CONTEXT_IMPORTS, ...TEMPLATE_IMPORTS]) },
				{ name: 'site-variables', code: siteVariables },
				{ name: 'sitewide', code: sitewideLess },
			]),
		};
	}
	return sitewideCache.result;
}

/**
 * @param lessCode   the component's own LESS
 * @param siteVariables  LESS declarations for the values that differ per site
 *   (@black, @index-primary, @img-path, ...). These are not in the platform
 *   files because each site's theme defines its own, so they come from
 *   Configuration instead.
 * @param mixinsCode  LESS mixins belonging to this one component, compiled
 *   ahead of its LESS so they can use the platform's mixins and be used by it.
 * @param sitewideLess  the site's main.less, from Configuration. Compiled on
 *   its own, against the platform plus the v7 template (see TEMPLATE_IMPORTS),
 *   and its CSS goes ahead of the component's: it is the base the component
 *   sits on.
 */
export async function compileComponentLess(
	lessCode: string,
	siteVariables: string,
	mixinsCode = '',
	sitewideLess = '',
): Promise<CompileResult> {
	const sitewide = compileSitewideLess(sitewideLess, siteVariables);

	// Order matters: platform definitions, then the site's own variables, then
	// this component's mixins, then the component. Each layer can use the ones
	// before it.
	const component =
		!lessCode.trim() && !mixinsCode.trim()
			? Promise.resolve<CompileResult>({ css: '', error: null })
			: renderRegions([
					{ name: 'context', code: referenceImports(CONTEXT_IMPORTS) },
					{ name: 'site-variables', code: siteVariables },
					{ name: 'mixins', code: mixinsCode },
					{ name: 'less', code: lessCode },
				]);

	const [base, own] = await Promise.all([sitewide, component]);

	// The component's own error comes first: it is the code the author is
	// editing right now. A broken sitewide stylesheet still leaves the
	// component's CSS in place, so the preview does not go blank over it.
	return {
		css: [base.css, own.css].filter(Boolean).join('\n'),
		error: own.error ?? base.error,
	};
}
