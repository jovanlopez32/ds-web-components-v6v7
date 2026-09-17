import { button } from '@/components/starwind/button/variants';
import { input } from '@/components/starwind/input/variants';

interface Props {
	/** This component's own overrides, edited here. */
	variables: Record<string, string>;
	onChange: (variables: Record<string, string>) => void;
	/** Global variables, shown read-only so the author sees what they inherit. */
	globalVariables: Record<string, string>;
	/** Names the ASP code references but nothing defines. */
	missing: string[];
}

export default function VariablesPanel({
	variables,
	onChange,
	globalVariables,
	missing,
}: Props) {
	const entries = Object.entries(variables);

	function rename(oldName: string, newName: string) {
		// Rebuild in order rather than delete-then-add, so a row does not jump
		// to the bottom of the list while it is being renamed.
		onChange(
			Object.fromEntries(
				entries.map(([name, value]) => (name === oldName ? [newName, value] : [name, value])),
			),
		);
	}

	function setValue(name: string, value: string) {
		onChange({ ...variables, [name]: value });
	}

	function remove(name: string) {
		const next = { ...variables };
		delete next[name];
		onChange(next);
	}

	function add(name = '') {
		onChange({ ...variables, [name]: '' });
	}

	// Only offer names that are actually referenced and not yet defined
	// anywhere, so the shortcut fills a real gap instead of adding noise.
	const inheritedNames = Object.keys(globalVariables);

	return (
		<section className="variables-panel">
			<div className="variables-header">
				<h3>Variables de este componente</h3>
				<button type="button" className={button({ variant: 'outline', size: 'sm' })} onClick={() => add()}>
					Agregar
				</button>
			</div>

			<p className="variables-help">
				Sustituyen las variables ASP solo en la vista previa, y ganan sobre las globales.
				No forman parte del código que se publica.
			</p>

			{missing.length > 0 && (
				<div className="variables-missing">
					<p>
						Tu ASP usa estas variables y no están definidas ni aquí ni en las globales.
						Se renderizan vacías, igual que en ASP:
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
									Definir
								</button>
							</li>
						))}
					</ul>
				</div>
			)}

			{entries.length === 0 && <p className="variables-empty">Sin variables propias.</p>}

			{entries.map(([name, value], index) => (
				// Index-keyed on purpose: the name is the editable field, so
				// keying by it would remount the input on every keystroke and
				// lose focus mid-word.
				<div className="variables-row" key={index}>
					<input
						type="text"
						className={input({ size: 'sm' })}
						aria-label="Nombre"
						placeholder="TXT_IMG_PATH"
						value={name}
						onChange={(event) => rename(name, event.target.value)}
					/>
					<input
						type="text"
						className={input({ size: 'sm' })}
						aria-label="Valor"
						placeholder="valor"
						value={value}
						onChange={(event) => setValue(name, event.target.value)}
					/>
					<button
						type="button"
						className={`${button({ variant: 'ghost', size: 'icon-sm' })} variables-remove`}
						aria-label={`Quitar ${name}`}
						onClick={() => remove(name)}
					>
						&times;
					</button>
				</div>
			))}

			{inheritedNames.length > 0 && (
				<details className="variables-global">
					<summary>Globales heredadas ({inheritedNames.length})</summary>
					<ul>
						{inheritedNames.map((name) => (
							<li key={name}>
								<code>{name}</code>
								<span>{globalVariables[name] || <em>(vacío)</em>}</span>
							</li>
						))}
					</ul>
					<a href="/admin/variables">Editar variables globales</a>
				</details>
			)}
		</section>
	);
}
