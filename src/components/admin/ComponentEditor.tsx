import { useCallback, useEffect, useState } from 'react';
import { actions, isInputError } from 'astro:actions';
import './ComponentEditor.css';
import CodePane from './CodePane';
import ComponentPreview, { type PreviewSnapshot } from './ComponentPreview';
import VariablesPanel from './VariablesPanel';
import type { PreviewSettings } from '../../lib/preview';
import type { CodeLanguage } from '../../lib/format';
import { button } from '@/components/starwind/button/variants';
import { input } from '@/components/starwind/input/variants';

export interface EditableComponent {
	id: string;
	/** The short number developers use in <CodeComponent id="..." />. */
	ref: number;
	title: string;
	aspCode: string;
	lessCode: string;
	jsCode: string;
	mixinsCode: string;
	variables: Record<string, string>;
	createdByEmail: string | null;
	updatedAt: string;
}

interface Props {
	pageId: string;
	pageTitle: string;
	adminSlug: string;
	settings: PreviewSettings;
	globalVariables: Record<string, string>;
	/** Absent when creating; the island uses this to tell the two modes apart. */
	component?: EditableComponent;
}

/**
 * The editor tabs. `key` is separate from `language` because Mixins and LESS
 * are both LESS source but are stored and compiled as distinct fields.
 */
type TabKey = 'asp' | 'less' | 'mixins' | 'javascript';

const TABS: { key: TabKey; label: string; language: CodeLanguage }[] = [
	{ key: 'asp', label: 'ASP', language: 'asp' },
	{ key: 'less', label: 'LESS', language: 'less' },
	{ key: 'mixins', label: 'Mixins', language: 'less' },
	{ key: 'javascript', label: 'JS', language: 'javascript' },
];

function formatDateTime(value: string | Date): string {
	const date = typeof value === 'string' ? new Date(value) : value;
	return date.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
}

export default function ComponentEditor({
	pageId,
	pageTitle,
	adminSlug,
	settings,
	globalVariables,
	component,
}: Props) {
	const isEditing = Boolean(component);
	const backHref = `/admin/pages/${adminSlug}`;

	const [title, setTitle] = useState(component?.title ?? '');
	const [aspCode, setAspCode] = useState(component?.aspCode ?? '');
	const [lessCode, setLessCode] = useState(component?.lessCode ?? '');
	const [jsCode, setJsCode] = useState(component?.jsCode ?? '');
	const [mixinsCode, setMixinsCode] = useState(component?.mixinsCode ?? '');
	const [variables, setVariables] = useState<Record<string, string>>(component?.variables ?? {});

	// The preview renders this, not the live editor state. Compiling only
	// happens when the author asks for it.
	const [snapshot, setSnapshot] = useState<PreviewSnapshot | null>(null);

	const [missingVariables, setMissingVariables] = useState<string[]>([]);
	const [activeTab, setActiveTab] = useState<TabKey>('asp');
	const [isSaving, setIsSaving] = useState(false);
	const [isDeleting, setIsDeleting] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [updatedAt, setUpdatedAt] = useState<Date | null>(
		component ? new Date(component.updatedAt) : null,
	);
	const [copied, setCopied] = useState(false);

	const handleCompile = useCallback(() => {
		setSnapshot({ aspCode, lessCode, jsCode, mixinsCode, variables });
	}, [aspCode, lessCode, jsCode, mixinsCode, variables]);

	// Compile once on open when editing, so an existing component is visible
	// without having to ask for it. A new component has nothing to compile.
	useEffect(() => {
		if (isEditing) handleCompile();
		// eslint-disable-next-line react-hooks/exhaustive-deps -- on mount only
	}, []);

	// Whether the editor has drifted from what the preview is showing.
	const isStale =
		snapshot !== null &&
		(snapshot.aspCode !== aspCode ||
			snapshot.lessCode !== lessCode ||
			snapshot.jsCode !== jsCode ||
			snapshot.mixinsCode !== mixinsCode ||
			JSON.stringify(snapshot.variables) !== JSON.stringify(variables));

	// The preview reports missing variables on every rebuild. Bail out when the
	// list has not actually changed, so an unchanged result cannot bounce
	// state back and forth between the two components.
	const handleMissingVariables = useCallback((names: string[]) => {
		setMissingVariables((current) =>
			current.length === names.length && current.every((name, i) => name === names[i])
				? current
				: names,
		);
	}, []);

	/** Field-level validation is reported separately from server failures. */
	function reportSaveError(actionError: unknown) {
		setError(
			isInputError(actionError)
				? Object.values((actionError as { fields: Record<string, string[]> }).fields)
						.flat()
						.join(' ')
				: (actionError as { message: string }).message,
		);
	}

	async function handleSave() {
		setIsSaving(true);
		setError(null);

		const payload = { title, aspCode, lessCode, jsCode, mixinsCode, variables };

		// The two calls are kept apart rather than folded into a ternary
		// because they return different shapes, and a union of the two cannot
		// be narrowed by the `isEditing` boolean.
		if (component) {
			const { data, error: updateError } = await actions.components.update({
				...payload,
				id: component.id,
			});
			setIsSaving(false);

			if (updateError) return reportSaveError(updateError);
			setUpdatedAt(data.updatedAt);
			return;
		}

		const { error: createError } = await actions.components.create({ ...payload, pageId });
		setIsSaving(false);

		if (createError) return reportSaveError(createError);

		// A freshly created component has no id in this island's state, so
		// staying here would leave "Save" creating duplicates.
		window.location.href = backHref;
	}

	async function handleDelete() {
		if (!component) return;
		if (!window.confirm(`Delete "${component.title}"? This action cannot be undone.`)) {
			return;
		}

		setIsDeleting(true);
		setError(null);

		// `remove` accepts form data so the no-JS delete button on the page
		// list can share it; from here that means handing it a FormData.
		const formData = new FormData();
		formData.set('id', component.id);
		const { error: actionError } = await actions.components.remove(formData);

		if (actionError) {
			setIsDeleting(false);
			setError(actionError.message);
			return;
		}

		window.location.href = backHref;
	}

	const reference = component ? `<CodeComponent id="${component.ref}" />` : null;

	async function copyReference() {
		if (!reference) return;
		await navigator.clipboard.writeText(reference);
		setCopied(true);
		setTimeout(() => setCopied(false), 2000);
	}

	const codeFor: Record<TabKey, { value: string; setValue: (value: string) => void }> = {
		asp: { value: aspCode, setValue: setAspCode },
		less: { value: lessCode, setValue: setLessCode },
		mixins: { value: mixinsCode, setValue: setMixinsCode },
		javascript: { value: jsCode, setValue: setJsCode },
	};

	return (
		<div className="editor">
			<header className="editor-header">
				<div>
					<a href={backHref}>&larr; Back to {pageTitle}</a>
					<h1>{isEditing ? 'Edit component' : 'New component'}</h1>
				</div>
				<div className="editor-actions">
					{isEditing && (
						<button
							type="button"
							className={button({ variant: 'error', size: 'sm' })}
							onClick={handleDelete}
							disabled={isDeleting || isSaving}
						>
							{isDeleting ? 'Deleting…' : 'Delete'}
						</button>
					)}
					<button
						type="button"
						className={button({ size: 'sm' })}
						onClick={handleSave}
						disabled={isSaving || isDeleting}
					>
						{isSaving ? 'Saving…' : isEditing ? 'Save changes' : 'Create component'}
					</button>
				</div>
			</header>

			{error && (
				<p className="editor-error" role="alert">
					{error}
				</p>
			)}

			{component && (
				<dl className="editor-meta">
					<div>
						<dt>Created by</dt>
						<dd>{component.createdByEmail ?? 'unknown'}</dd>
					</div>
					<div>
						<dt>Last modified</dt>
						<dd>{updatedAt ? formatDateTime(updatedAt) : '—'}</dd>
					</div>
					<div>
						<dt>Reference</dt>
						<dd>
							<code>{reference}</code>
							<button
								type="button"
								className={`${button({ variant: 'outline', size: 'sm' })} editor-copy`}
								onClick={copyReference}
							>
								{copied ? 'Copied' : 'Copy'}
							</button>
						</dd>
					</div>
				</dl>
			)}

			<label className="editor-title">
				Title
				<input
					type="text"
					className={input({ size: 'sm' })}
					value={title}
					onChange={(event) => setTitle(event.target.value)}
					placeholder="E.g. What You Need section"
					required
				/>
			</label>

			<div className="editor-split">
				<section className="editor-code">
					<div className="editor-tabs" role="tablist">
						{TABS.map((tab) => (
							<button
								key={tab.key}
								type="button"
								role="tab"
								aria-selected={activeTab === tab.key}
								className={activeTab === tab.key ? 'active' : ''}
								onClick={() => setActiveTab(tab.key)}
							>
								{tab.label}
							</button>
						))}
					</div>

					{activeTab === 'mixins' && (
						<p className="editor-tab-help">
							This component's own mixins, compiled before its LESS. Define them with
							parentheses — <code>.something() {'{ … }'}</code> — so they don't emit CSS on
							their own. Platform mixins (<code>.transition()</code>,{' '}
							<code>.display-flex()</code>) are already available without declaring anything.
						</p>
					)}

					{/*
						Every pane stays mounted and only the inactive ones are
						hidden with CSS. Unmounting would throw away each
						editor's undo history and cursor position every time
						someone switches tabs.
					*/}
					{TABS.map((tab) => (
						<div key={tab.key} role="tabpanel" hidden={activeTab !== tab.key}>
							<CodePane
								language={tab.language}
								value={codeFor[tab.key].value}
								onChange={codeFor[tab.key].setValue}
							/>
						</div>
					))}
				</section>

				<div className="editor-right">
					<ComponentPreview
						snapshot={snapshot}
						settings={settings}
						globalVariables={globalVariables}
						isStale={isStale}
						onCompile={handleCompile}
						onMissingVariables={handleMissingVariables}
					/>

					<VariablesPanel
						variables={variables}
						onChange={setVariables}
						globalVariables={globalVariables}
						missing={missingVariables}
					/>
				</div>
			</div>
		</div>
	);
}
