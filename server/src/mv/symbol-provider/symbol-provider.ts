import { existsSync } from 'fs';
import { readFile, stat } from 'fs/promises';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { FileSystemDetector } from '../../util/file-system-detector';
import { uriToFsPath } from '../../util/functions';
import { walk } from '../../util/functions-node';
import { SymbolInformationWithDocumentation, Workspace } from '../../util/interfaces';

interface Folder {
	filePaths: string[];
	lsk: boolean;
};

interface CachedFile {
	mtimeMs: number;
	size: number;
	lsk: boolean;
	symbols: SymbolInformationWithDocumentation[];
};

// Max number of files read from disk at once
const READ_CONCURRENCY = 64;

// Directories that never contain Miva Script source
const IGNORED_DIRECTORY_NAMES = ['node_modules', '.git'];

export class WorkspaceSymbolProvider {
	private workspace: Workspace;
	private detectedLskPath: string;
	private lskDetector = new FileSystemDetector({
		rootPath: '',
		fileNames: [
			'mmlsk-download.mv',
			'mmlsk-json.mv',
			'mmlsk-merchant.mv',
			'mmlsk-uri.mv'
		],
		fileNamesMethod: 'every'
	})

	// Parsed symbols per file path, reused while the file is unchanged on disk
	private fileCache: Map<string, CachedFile> = new Map();
	private cachedSymbols: SymbolInformationWithDocumentation[] = [];
	private pendingSymbols: Promise<SymbolInformationWithDocumentation[]> | null = null;

	private async createTextDocumentFromPath (path: string): Promise<TextDocument> {
		const fileContents = await readFile(path, {
			encoding: 'utf-8'
		});

		return TextDocument.create(path, path.endsWith('.js') ? 'javascript' : 'mv', 1, fileContents);
	}

	private async gatherMivaScriptFoldersFromWorkspace (): Promise<Folder[]> {
		const includeJavaScript = this.workspace.settings?.mivaScript?.workspaceSymbols?.includeJavaScript === true;

		return Promise.all(this.workspace.folders.map(async (workspaceFolder) => {
			const workspaceFolderPath = uriToFsPath(workspaceFolder.uri);

			// Check if path exists
			if (!existsSync(workspaceFolderPath)) {
				return {
					filePaths: [],
					lsk: false
				};
			}

			// Set new root path and attempt to detect
			this.lskDetector.setRootPath(workspaceFolderPath);

			// Attempt to detect the lsk path; exit this folder if lsk was already detected
			const lskDetected = await this.lskDetector.detect();
			if (!this.detectedLskPath && lskDetected) {
				this.detectedLskPath = workspaceFolderPath;
			}
			if (lskDetected && workspaceFolderPath !== this.detectedLskPath) {
				return {
					filePaths: [],
					lsk: lskDetected
				};
			}

			const filePaths = await walk(workspaceFolderPath, includeJavaScript ? ['.mv', '.js'] : '.mv', IGNORED_DIRECTORY_NAMES);

			return {
				// Minified files are generated output and would only add duplicate or mangled names
				filePaths: includeJavaScript ? filePaths.filter(filePath => !filePath.endsWith('.min.js')) : filePaths,
				lsk: lskDetected
			};
		}));
	}

	private async collectSymbols (iterator: ( document: TextDocument, lsk: boolean ) => SymbolInformationWithDocumentation[]): Promise<SymbolInformationWithDocumentation[]> {
		const folders = await this.gatherMivaScriptFoldersFromWorkspace();
		const files: { filePath: string, lsk: boolean }[] = [];
		const seen: Set<string> = new Set();

		for (let {filePaths, lsk} of folders) {
			for (let filePath of filePaths) {
				// The same file can be reached from overlapping folders (e.g. LSK path inside the workspace)
				if (!seen.has(filePath)) {
					seen.add(filePath);
					files.push({ filePath, lsk });
				}
			}
		}

		const nextFileCache: Map<string, CachedFile> = new Map();
		let changed = files.length !== this.fileCache.size;

		// Only read and parse files that are new or have changed since the last run
		for (let i = 0; i < files.length; i += READ_CONCURRENCY) {
			await Promise.all(files.slice(i, i + READ_CONCURRENCY).map(async ({filePath, lsk}) => {
				try {
					const {mtimeMs, size} = await stat(filePath);
					const cached = this.fileCache.get(filePath);

					if (cached && cached.mtimeMs === mtimeMs && cached.size === size && cached.lsk === lsk) {
						nextFileCache.set(filePath, cached);
						return;
					}

					const document = await this.createTextDocumentFromPath(filePath);

					nextFileCache.set(filePath, {
						mtimeMs,
						size,
						lsk,
						symbols: iterator(document, lsk)
					});
					changed = true;
				}
				catch {
					// File was removed or is unreadable; drop it from the results
					changed = true;
				}
			}));
		}

		this.fileCache = nextFileCache;

		if (changed) {
			const symbols: SymbolInformationWithDocumentation[] = [];

			for (let {symbols: fileSymbols} of nextFileCache.values()) {
				for (let symbol of fileSymbols) {
					symbols.push(symbol);
				}
			}

			this.cachedSymbols = symbols;
		}

		return this.cachedSymbols;
	}

	/**
	 * Returns the symbols for every .mv file in the workspace (and .js file when enabled). Unchanged files are served from cache, and calls made
	 * while a scan is already running share its result. The same array is returned when nothing has changed.
	 */
	provideSymbols (iterator: ( document: TextDocument, lsk: boolean ) => SymbolInformationWithDocumentation[]): Promise<SymbolInformationWithDocumentation[]> {
		if (!this.pendingSymbols) {
			this.pendingSymbols = this.collectSymbols(iterator).finally(() => {
				this.pendingSymbols = null;
			});
		}

		return this.pendingSymbols;
	}

	setWorkspace (workspace: Workspace): void {
		this.workspace = workspace;
	}
}
