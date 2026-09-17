import { useEffect, useRef, useState } from 'react';
import { actions } from 'astro:actions';
import {
	PREVIEW_SANDBOX,
	buildPreviewDocument,
	isPreviewErrorMessage,
	type PreviewSettings,
} from '../../lib/preview';
import { mergeVariables, resolveAsp } from '../../lib/asp';
import type { CompileError } from '../../lib/less-server';
import { button } from '@/components/starwind/button/variants';

/**
 * The code as it was when the author last pressed Compilar.
 *
 * The preview renders this, never the live editor state. Compiling is a server
 * round trip that can fail, so rebuilding on every keystroke meant errors
 * flashing up mid-word for code that was simply half-typed.
 */
export interface PreviewSnapshot {
	aspCode: string;
	lessCode: string;
	jsCode: string;
	mixinsCode: string;
	variables: Record<string, string>;
}

interface Props {
	/** Null until the first compile. */
	snapshot: PreviewSnapshot | null;
	settings: PreviewSettings;
	globalVariables: Record<string, string>;
	/** True when the editor has changed since the snapshot was taken. */
	isStale: boolean;
	onCompile: () => void;
	/** Reports which referenced variables are undefined, for the editor to show. */
	onMissingVariables: (names: string[]) => void;
}

const REGION_LABELS: Record<string, string> = {
	less: 'LESS',
	mixins: 'Mixins',
	'site-variables': 'Variables del sitio',
	platform: 'Plataforma',
};

export default function ComponentPreview({
	snapshot,
	settings,
	globalVariables,
	isStale,
	onCompile,
	onMissingVariables,
}: Props) {
	const iframeRef = useRef<HTMLIFrameElement>(null);
	const [srcDoc, setSrcDoc] = useState('');
	const [lessError, setLessError] = useState<CompileError | null>(null);
	const [runtimeError, setRuntimeError] = useState<string | null>(null);
	const [placeholders, setPlaceholders] = useState<string[]>([]);
	const [isCompiling, setIsCompiling] = useState(false);

	// Depend on the contents of these, not their object identity: this effect
	// calls setState, so a caller that rebuilt an object on each render would
	// drive it into an endless rebuild loop.
	const settingsKey = [settings.previewCssUrls.join('|'), settings.previewJsUrls.join('|')].join(
		' ',
	);
	const snapshotKey = snapshot === null ? null : JSON.stringify(snapshot);
	const globalsKey = JSON.stringify(globalVariables);

	useEffect(() => {
		if (snapshot === null) return;

		let cancelled = false;
		setIsCompiling(true);

		(async () => {
			// Compiled on the server so the component's LESS can use the real
			// platform mixins, which live in 112 files on disk.
			const { data: compiled, error: compileError } = await actions.preview.compileLess({
				lessCode: snapshot.lessCode,
				mixinsCode: snapshot.mixinsCode,
			});

			// A slower earlier request must not overwrite a newer result.
			if (cancelled) return;

			setIsCompiling(false);
			setLessError(
				compileError ? { message: compileError.message, line: null } : compiled.error,
			);

			const resolved = resolveAsp(
				snapshot.aspCode,
				mergeVariables(globalVariables, snapshot.variables),
			);
			setPlaceholders(resolved.placeholders);
			onMissingVariables(resolved.missing);

			// A previous run's error must not stick around and be blamed on
			// the code the author just fixed.
			setRuntimeError(null);

			setSrcDoc(
				buildPreviewDocument(
					{ markup: resolved.code, css: compiled?.css ?? '', jsCode: snapshot.jsCode },
					settings,
				),
			);
		})();

		return () => {
			cancelled = true;
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps -- the *Key values stand in for the objects
	}, [snapshotKey, settingsKey, globalsKey]);

	// The sandboxed document reports its own uncaught errors by postMessage,
	// because its console is invisible from here and a component that throws
	// on load would otherwise just look like an empty preview.
	useEffect(() => {
		function onMessage(event: MessageEvent) {
			// The frame has an opaque origin, so identity is established by
			// comparing the source window rather than by checking event.origin.
			if (event.source !== iframeRef.current?.contentWindow) return;
			if (!isPreviewErrorMessage(event.data)) return;

			setRuntimeError(
				event.data.line ? `${event.data.message} (línea ${event.data.line})` : event.data.message,
			);
		}

		window.addEventListener('message', onMessage);
		return () => window.removeEventListener('message', onMessage);
	}, []);

	return (
		<div className="preview">
			<div className="preview-header">
				<h2>Vista previa</h2>
				<div className="preview-controls">
					{snapshot !== null && isStale && (
						<span className="preview-stale">Código cambiado</span>
					)}
					<button
						type="button"
						className={button({ size: 'sm' })}
						onClick={onCompile}
						disabled={isCompiling}
					>
						{isCompiling ? 'Compilando…' : 'Compilar'}
					</button>
				</div>
			</div>

			{lessError && (
				<p className="preview-error" role="alert">
					<strong>{REGION_LABELS[lessError.region ?? 'less'] ?? 'LESS'}:</strong>{' '}
					{lessError.message}
					{lessError.line !== null && ` (línea ${lessError.line})`}
				</p>
			)}

			{runtimeError && (
				<p className="preview-error" role="alert">
					<strong>JS:</strong> {runtimeError}
				</p>
			)}

			{placeholders.length > 0 && (
				<p className="preview-note">
					Funciones ASP mostradas como marcador:{' '}
					{placeholders.map((name) => `[${name}]`).join(', ')}
				</p>
			)}

			{snapshot === null ? (
				<p className="preview-empty">
					Presiona <strong>Compilar</strong> para ver el componente.
				</p>
			) : (
				<iframe
					ref={iframeRef}
					title="Vista previa del componente"
					className="preview-frame"
					sandbox={PREVIEW_SANDBOX}
					srcDoc={srcDoc}
				/>
			)}
		</div>
	);
}
