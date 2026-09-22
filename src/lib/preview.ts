// Builds the self-contained HTML document that the preview iframe renders.
//
// This lives in src/lib/ rather than inside the editor island on purpose: the
// public pages that will show a live example per component need the exact same
// document, so the preview a FED sees while authoring is byte-for-byte what the
// team sees later.

export interface PreviewSettings {
	/**
	 * External stylesheets the components need, injected as <link> tags —
	 * icon fonts (Font Awesome, iconmonstr) and anything similar the platform
	 * loads in its own <head>. Not the design system's compiled CSS: the
	 * preview deliberately injects no site baseline, so a component is shown
	 * with its own styles only.
	 */
	previewCssUrls: string[];
	/** Scripts loaded before the component's own JS (jQuery lives here). */
	previewJsUrls: string[];
	/**
	 * LESS declarations for the values that differ per site (@black,
	 * @index-primary, @img-path, ...). Platform mixins and variables are NOT
	 * here — those come from the real files under src/v6v7/_platform-less-ref.
	 * Used by compileComponentLess() in src/lib/less-server.ts.
	 */
	previewLessVariables: string;
}

export interface PreviewInput {
	/** ASP markup with its <% %> blocks already substituted. See resolveAsp(). */
	markup: string;
	/** LESS already compiled to plain CSS, via the preview.compileLess action. */
	css: string;
	jsCode: string;
}

/**
 * Message posted from inside the preview when the component's JS throws.
 * Without this a broken component just renders as an empty box and the author
 * has no idea why, since the sandbox has no visible console.
 */
export interface PreviewErrorMessage {
	source: 'ds-preview';
	kind: 'runtime-error';
	message: string;
	line: number | null;
}

/** Type guard for messages arriving on the parent's `message` event. */
export function isPreviewErrorMessage(data: unknown): data is PreviewErrorMessage {
	return (
		typeof data === 'object' &&
		data !== null &&
		(data as PreviewErrorMessage).source === 'ds-preview' &&
		(data as PreviewErrorMessage).kind === 'runtime-error'
	);
}

/**
 * The sandbox grants scripts but deliberately withholds `allow-same-origin`.
 *
 * The component's JS has to genuinely run for the preview to be worth anything,
 * which requires `allow-scripts`. But `allow-scripts` combined with
 * `allow-same-origin` is a known escape: the framed document can then reach
 * `parent.document` and strip its own sandbox attribute. Omitting
 * `allow-same-origin` gives the frame an opaque origin, so component code can
 * do whatever it likes to its own document and still cannot touch the admin
 * DOM, its cookies, or the Supabase session token.
 */
export const PREVIEW_SANDBOX = 'allow-scripts allow-forms allow-popups';

/** Prevents a `</script>` inside author JS from closing our wrapper tag early. */
function escapeClosingScriptTag(js: string): string {
	return js.replace(/<\/script/gi, '<\\/script');
}

/**
 * Forces protocol-relative URLs to https.
 *
 * A srcdoc document inherits its base URL from the parent page, so a `//host/…`
 * asset would be fetched over plain http while developing on http://localhost.
 * Pinning https keeps the preview loading the same file in dev and production.
 */
function normalizeAssetUrl(url: string): string {
	const trimmed = url.trim();
	return trimmed.startsWith('//') ? `https:${trimmed}` : trimmed;
}

export function buildPreviewDocument(input: PreviewInput, settings: PreviewSettings): string {
	const links = settings.previewCssUrls
		.filter((url) => url.trim())
		.map((url) => `<link rel="stylesheet" href="${escapeAttribute(normalizeAssetUrl(url))}">`)
		.join('\n\t\t');

	const scripts = settings.previewJsUrls
		.filter((url) => url.trim())
		.map((url) => `<script src="${escapeAttribute(normalizeAssetUrl(url))}"></script>`)
		.join('\n\t\t');

	// Author JS runs last, after the DS scripts and the markup are parsed, so
	// `$(...)` and `document.querySelector` both find what the author expects.
	// It is wrapped in a function to keep `var` declarations from colliding
	// with the DS globals, and in try/catch so a throw is reported rather than
	// leaving a silently half-initialised component.
	return `<!doctype html>
<html lang="en">
	<head>
		<meta charset="utf-8">
		<meta name="viewport" content="width=device-width, initial-scale=1">
		<script>
			window.addEventListener('error', function (event) {
				parent.postMessage({
					source: 'ds-preview',
					kind: 'runtime-error',
					message: event.message || 'Unknown error',
					line: typeof event.lineno === 'number' ? event.lineno : null,
				}, '*');
			});
			window.addEventListener('unhandledrejection', function (event) {
				parent.postMessage({
					source: 'ds-preview',
					kind: 'runtime-error',
					message: 'Unhandled rejection: ' + (event.reason && event.reason.message || event.reason),
					line: null,
				}, '*');
			});
		</script>
		${links}
		<style>${input.css}</style>
	</head>
	<body>
${input.markup}
		${scripts}
		<script>
			(function () {
				try {
${escapeClosingScriptTag(input.jsCode)}
				} catch (error) {
					parent.postMessage({
						source: 'ds-preview',
						kind: 'runtime-error',
						message: (error && error.message) || String(error),
						line: null,
					}, '*');
				}
			})();
		</script>
	</body>
</html>`;
}

function escapeAttribute(value: string): string {
	return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}
// LESS compilation deliberately does not live here. It needs the platform's
// 112 mixin files from disk, so it runs on the server: see
// compileComponentLess() in src/lib/less-server.ts, exposed through the
// preview.compileLess action.
