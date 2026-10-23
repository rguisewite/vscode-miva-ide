import { Location, Range, SymbolKind } from 'vscode-languageserver';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { SymbolInformationWithDocumentation } from './interfaces';

const IDENTIFIER = '[A-Za-z_$][\\w$]*';

// Right-hand side of an assignment that defines a function or class
const FUNCTION_VALUE = `(?:async\\s+)?(?:function\\b|\\([^()]*\\)\\s*=>|${ IDENTIFIER }\\s*=>|class\\b)`;

// Words that look like method shorthand when followed by "(...) {"
const NON_METHOD_KEYWORDS = new Set(['if', 'for', 'while', 'switch', 'catch', 'function', 'with', 'return', 'typeof', 'await', 'yield']);

interface JavaScriptSymbolPattern {
	regex: RegExp;
	kind: (match: RegExpMatchArray) => SymbolKind;
	filter?: (name: string) => boolean;
}

/**
 * Every pattern captures the symbol name in the "name" group. The "d" flag provides the group offsets so ranges
 * point at the name itself without counting lines for each match.
 */
const PATTERNS: JavaScriptSymbolPattern[] = [
	// function foo(
	{
		regex: new RegExp(`\\bfunction\\b\\s*\\*?\\s*(?<name>${ IDENTIFIER })\\s*\\(`, 'gd'),
		kind: () => SymbolKind.Function
	},
	// foo = function(, const foo = (a) =>, var Foo = class
	{
		regex: new RegExp(`(?<![\\w$.])(?<name>${ IDENTIFIER })\\s*=\\s*(?<value>${ FUNCTION_VALUE })`, 'gd'),
		kind: (match) => match.groups.value.startsWith('class') ? SymbolKind.Class : SymbolKind.Function
	},
	// Foo.prototype.bar = function(
	{
		regex: new RegExp(`(?<![\\w$.])(?<name>${ IDENTIFIER }\\.prototype\\.${ IDENTIFIER })\\s*=\\s*${ FUNCTION_VALUE }`, 'gd'),
		kind: () => SymbolKind.Method
	},
	// class Foo {, class Foo extends Bar
	{
		regex: new RegExp(`\\bclass\\s+(?<name>${ IDENTIFIER })(?=\\s*(?:extends\\b|\\{))`, 'gd'),
		kind: () => SymbolKind.Class
	},
	// Method shorthand: bar(a, b) {
	{
		regex: new RegExp(`^[ \\t]*(?:(?:static|async|get|set)\\s+)*\\*?\\s*(?<name>${ IDENTIFIER })\\s*\\([^()]*\\)\\s*\\{`, 'gmd'),
		kind: () => SymbolKind.Method,
		filter: (name) => !NON_METHOD_KEYWORDS.has(name)
	}
];

/**
 * Returns the short name used for definition lookups, e.g. "bar" for "Foo.prototype.bar"
 */
export function getJavaScriptSymbolLookupName (name: string): string {
	return name.substring(name.lastIndexOf('.') + 1);
}

/**
 * Finds function, method and class definitions in a JavaScript document using regular expressions
 */
export function findJavaScriptSymbols (document: TextDocument, uri: string = document.uri): SymbolInformationWithDocumentation[] {
	const text = document.getText();
	const symbols: { offset: number, symbol: SymbolInformationWithDocumentation }[] = [];

	for (let {regex, kind, filter} of PATTERNS) {
		for (let match of text.matchAll(regex)) {
			const name = match.groups.name;

			if (filter && !filter(name)) {
				continue;
			}

			const [start, end] = (match as RegExpMatchArray & { indices: { groups: Record<string, [number, number]> } }).indices.groups.name;

			symbols.push({
				offset: start,
				symbol: {
					name,
					kind: kind(match),
					languageId: 'javascript',
					location: Location.create(uri, Range.create(document.positionAt(start), document.positionAt(end)))
				}
			});
		}
	}

	return symbols
		.sort((a, b) => a.offset - b.offset)
		.map(({symbol}) => symbol);
}
