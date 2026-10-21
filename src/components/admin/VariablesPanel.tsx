import { button } from '@/components/starwind/button/variants';
import { input } from '@/components/starwind/input/variants';

/**
 * One editable row. The panel works on a list rather than on the name -> value
 * map that gets saved: as a map, two rows sharing a name (an empty new row next
 * to another empty one, or "TXT_A" typed on the way to "TXT_AB" while TXT_A
 * already exists) collapsed into one key and silently lost the other's value.
 */
export interface VariableRow {
	/** Stable React key, since the name is the editable field. */
	id: number;
	name: string;
	value: string;
}

let nextRowId = 0;

export function toVariableRows(variables: Record<string, string>): VariableRow[] {
	return Object.entries(variables).map(([name, value]) => ({ id: nextRowId++, name, value }));
}

/** Rows without a name are skipped; on a repeated name the last row wins. */
export function toVariableRecord(rows: VariableRow[]): Record<string, string> {
	return Object.fromEntries(
		rows.filter((row) => row.name.trim()).map((row) => [row.name.trim(), row.value]),
	);
}

interface Props {
	/** This component's own overrides, edited here. */
	rows: VariableRow[];
	onChange: (rows: VariableRow[]) => void;
	/** Global variables, shown read-only so the author sees what they inherit. */
	globalVariables: Record<string, string>;
	/** Names the ASP code references but nothing defines. */
	missing: string[];
	/** True when editing an existing component, whose variables save as they change. */
	autosaves: boolean;
	saveError: string | null;
}

export default function VariablesPanel({
	rows,
	onChange,
	globalVariables,
	missing,
	autosaves,
	saveError,
}: Props) {
	function update(id: number, changes: Partial<VariableRow>) {
		onChange(rows.map((row) => (row.id === id ? { ...row, ...changes } : row)));
	}

	function remove(id: number) {
		onChange(rows.filter((row) => row.id !== id));
	}

	function add(name = '') {
		onChange([...rows, { id: nextRowId++, name, value: '' }]);
	}

	// Flagged rather than blocked, so a name can pass through a duplicate
	// while it is being typed.
	const nameCounts = new Map<string, number>();
	for (const row of rows) {
		const name = row.name.trim();
		if (name) nameCounts.set(name, (nameCounts.get(name) ?? 0) + 1);
	}
	const duplicates = [...nameCounts].filter(([, count]) => count > 1).map(([name]) => name);

	const inheritedNames = Object.keys(globalVariables);

	return (
		<section className="variables-panel">
			<div className="variables-header">
				<h3>This component's variables</h3>
				<button type="button" className={button({ variant: 'outline', size: 'sm' })} onClick={() => add()}>
					Add
				</button>
			</div>

			<p className="variables-help">
				These override ASP variables only in the preview, take precedence over the globals
				and apply as you type. They are not part of the published code.{' '}
				{autosaves ? (
					'They are saved automatically.'
				) : (
					<>
						They are saved with <strong>Create component</strong>.
					</>
				)}
			</p>

			{saveError && (
				<p className="variables-duplicate" role="alert">
					Couldn't save the variables: {saveError}
				</p>
			)}

			{missing.length > 0 && (
				<div className="variables-missing">
					<p>
						Your ASP code uses these variables, and they aren't defined here or in the
						globals. They render empty, just like in ASP:
					</p>
					<ul>
						{missing.map((name) => (
							<li key={name}>
								<code>{name}</code>
								<button
									type="button"
									className={button({ variant: 'ghost', size: 'sm' })}
									onClick={() => add(name)}
								>
									Define
								</button>
							</li>
						))}
					</ul>
				</div>
			)}

			{duplicates.length > 0 && (
				<p className="variables-duplicate" role="alert">
					Defined more than once, only the last one is used: {duplicates.join(', ')}
				</p>
			)}

			{rows.length === 0 && <p className="variables-empty">No component-specific variables.</p>}

			{rows.map((row) => (
				<div className="variables-row" key={row.id}>
					<input
						type="text"
						className={input({ size: 'sm' })}
						aria-label="Name"
						placeholder="TXT_IMG_PATH"
						value={row.name}
						onChange={(event) => update(row.id, { name: event.target.value })}
					/>
					<input
						type="text"
						className={input({ size: 'sm' })}
						aria-label="Value"
						placeholder="value"
						value={row.value}
						onChange={(event) => update(row.id, { value: event.target.value })}
					/>
					<button
						type="button"
						className={`${button({ variant: 'ghost', size: 'icon-sm' })} variables-remove`}
						aria-label={`Remove ${row.name}`}
						onClick={() => remove(row.id)}
					>
						&times;
					</button>
				</div>
			))}

			{inheritedNames.length > 0 && (
				<details className="variables-global">
					<summary>Inherited globals ({inheritedNames.length})</summary>
					<ul>
						{inheritedNames.map((name) => (
							<li key={name}>
								<code>{name}</code>
								<span>{globalVariables[name] || <em>(empty)</em>}</span>
							</li>
						))}
					</ul>
					<a href="/admin/variables">Edit global variables</a>
				</details>
			)}
		</section>
	);
}
