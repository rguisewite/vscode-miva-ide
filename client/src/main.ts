import {
	ExtensionContext,
	StatusBarAlignment,
	StatusBarItem,
	languages,
	window,
	workspace
} from 'vscode';
import {
	LanguageClient,
	ServerOptions,
	TransportKind
} from 'vscode-languageclient/node';
import { getClientOptions, sharedActivate } from './main-shared';

// Define language client to be used during activate and deactivate callbacks
let client: LanguageClient;

// Define status mmt bar item
let mmtRemoteStatusBar: StatusBarItem;
let mmtBranchKeyStatusBar: StatusBarItem;

export function activate( context: ExtensionContext ) {
	// Path to server module
	const serverModule = context.asAbsolutePath( 'server/out/main.js' );

	// The debug options for the server
	const debugOptions = { execArgv: [ '--nolazy', '--inspect=6045' ] };

	// If the extension is launch in debug mode the debug server options are use
	// Otherwise the run options are used
	const serverOptions: ServerOptions = {
		run: { module: serverModule, transport: TransportKind.ipc },
		debug: { module: serverModule, transport: TransportKind.ipc, options: debugOptions }
	};

	const clientOptions = getClientOptions();

	// The built-in JavaScript extension already lists symbols for open .js files, so drop ours for those to avoid duplicates
	clientOptions.middleware = {
		...clientOptions.middleware,
		async provideWorkspaceSymbols( query, token, next ) {
			const symbols = await next( query, token );
			const openJavaScriptUris = new Set(
				workspace.textDocuments
					.filter( document => document.languageId === 'javascript' )
					.map( document => document.uri.toString() )
			);

			if (!symbols || openJavaScriptUris.size === 0) {
				return symbols;
			}

			return symbols.filter( symbol => !openJavaScriptUris.has( symbol.location.uri.toString() ) );
		}
	};

	// Create the language client and start the client.
	client = new LanguageClient( 'miva', 'Miva IDE Language Server', serverOptions, clientOptions );
	client.registerProposedFeatures();

	const mmtListener = client.onNotification('mmt/updateStatusBar', config => {
		if (config) {
			if (!mmtRemoteStatusBar) {
				mmtRemoteStatusBar = window.createStatusBarItem(StatusBarAlignment.Left, 51);
				context.subscriptions.push( mmtRemoteStatusBar );
			}

			if (!mmtBranchKeyStatusBar) {
				mmtBranchKeyStatusBar = window.createStatusBarItem(StatusBarAlignment.Left, 50);
				context.subscriptions.push( mmtBranchKeyStatusBar );
			}

			mmtRemoteStatusBar.text = `MMT - $(repo) Remote: ${config.remote_key}`;
			mmtRemoteStatusBar.tooltip = `MMT Information\n\nRemote: ${config.remote_key}\nBranch: ${config.branch_name}\nBranch Key: ${config.branch_key}`;
			mmtRemoteStatusBar.show();

			mmtBranchKeyStatusBar.text = `MMT - $(source-control) BranchKey: ${config.branch_key}`;
			mmtBranchKeyStatusBar.tooltip = 'Click to copy branch key.';
			mmtBranchKeyStatusBar.command = {
				command: 'mivaIde.mmt.copyBranchKey',
				arguments: [config.branch_key],
				title: 'Copy Branch Key'
			};
			mmtBranchKeyStatusBar.show();
		}
	});

	context.subscriptions.push( mmtListener );

	// JavaScript files aren't synced with the server, so definitions are requested with the editor's current text
	const javaScriptDefinitionProvider = languages.registerDefinitionProvider({ language: 'javascript' }, {
		async provideDefinition( document, position, token ) {
			if (!workspace.getConfiguration( 'mivaScript', document.uri ).get<boolean>( 'workspaceSymbols.includeJavaScript' ) || !client.isRunning()) {
				return undefined;
			}

			const wordRange = document.getWordRangeAtPosition( position );

			if (!wordRange) {
				return undefined;
			}

			const result = await client.sendRequest( 'miva/javaScriptDefinition', {
				uri: document.uri.toString(),
				word: document.getText( wordRange ),
				text: document.getText()
			}, token );

			return client.protocol2CodeConverter.asDefinitionResult( result as any, token );
		}
	});

	context.subscriptions.push( javaScriptDefinitionProvider );

	client.start();

	// Push client to subscriptions
	context.subscriptions.push( client );

	sharedActivate(context);
}

export function deactivate(): Thenable<void> | undefined {
	client?.stop();

	return;
}