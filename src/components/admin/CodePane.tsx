import { useMemo, useState } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { oneDark } from '@codemirror/theme-one-dark';
import { html } from '@codemirror/lang-html';
import { less } from '@codemirror/lang-less';
import { javascript } from '@codemirror/lang-javascript';
import { formatCode, type CodeLanguage } from '../../lib/format';
import { button } from '@/components/starwind/button/variants';

interface Props {
	language: CodeLanguage;
	value: string;
	onChange: (value: string) => void;
}

/**
 * CodeMirror 6 rather than Shiki or Prism: those two are read-only
 * highlighters that turn a finished string into coloured markup, so they
 * cannot colour text as it is typed. CodeMirror is an actual editor and brings
 * line numbers, auto-indent and bracket matching along with the colours.
 */
function languageExtension(language: CodeLanguage) {
	switch (language) {
		case 'asp':
			// CodeMirror has no ASP mode. ASP is markup with <% %> blocks, so
			// the HTML mode highlights everything except those blocks
			// correctly, which is the bulk of the file.
			return html();
		case 'less':
			return less();
		case 'javascript':
			return javascript();
	}
}

export default function CodePane({ language, value, onChange }: Props) {
	const [formatError, setFormatError] = useState<string | null>(null);
	const [isFormatting, setIsFormatting] = useState(false);

	const extensions = useMemo(() => [languageExtension(language)], [language]);

	async function handleFormat() {
		setIsFormatting(true);
		const result = await formatCode(value, language);
		setIsFormatting(false);
		setFormatError(result.error);

		// On a parse error the original code comes back untouched, so nothing
		// the author wrote is lost to a failed format.
		if (!result.error) {
			onChange(result.code);
		}
	}

	return (
		<div className="code-pane">
			<div className="code-pane-toolbar">
				<button
					type="button"
					className={button({ variant: 'outline', size: 'sm' })}
					onClick={handleFormat}
					disabled={isFormatting || !value.trim()}
				>
					{isFormatting ? 'Formatting…' : 'Format'}
				</button>
			</div>

			{formatError && (
				<p className="code-pane-error" role="alert">
					Could not format: {formatError}
				</p>
			)}

			<CodeMirror
				value={value}
				onChange={onChange}
				extensions={extensions}
				theme={oneDark}
				height="380px"
				basicSetup={{ lineNumbers: true, bracketMatching: true, autocompletion: true }}
			/>
		</div>
	);
}
