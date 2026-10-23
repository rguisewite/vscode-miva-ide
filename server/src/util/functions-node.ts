import { SpawnOptionsWithoutStdio, spawn } from 'child_process';
import { lstat, readdir } from 'fs/promises';
import { dirname, join, sep } from 'path';

export function asyncSpawn (command: string, args?: readonly string[], options?: SpawnOptionsWithoutStdio): Promise<{stdout: string, stderr: string}> {
	return new Promise((resolve, reject) => {
		let stdout = '';
		let stderr = '';

		const cmd = spawn(
			command,
			args,
			options
		);

		cmd.stdout.on('data', data => {
			stdout += data.toString();
		});

		cmd.stderr.on('data', data => {
			stderr += data.toString();
		});

		cmd.on('close', () => {
			resolve({
				stdout,
				stderr,
			});
		});
	});
}

export async function walk (dir: string, pathEnding: string | string[], ignoredDirectoryNames: string[] = []): Promise<string[]> {
	const parsedPathEndings = (Array.isArray(pathEnding) ? pathEnding : [pathEnding]).map(ending => ending.replace(/\//g, sep));
	let files = await readdir(dir);

	// @ts-ignore
	files = await Promise.all(files.map(async file => {
		const filePath = join(dir, file);
		const stats = await lstat(filePath);

		if (stats.isDirectory()) {
			if (ignoredDirectoryNames.includes(file)) {
				return;
			}

			return walk(filePath, pathEnding, ignoredDirectoryNames);
		}
		else if (stats.isFile() && parsedPathEndings.some(parsedPathEnding => file.endsWith(parsedPathEnding) || filePath.endsWith(parsedPathEnding))) {
			return filePath;
		}
	}));

	// Filter out undefined entries before concatenating
	return files
		.filter(Boolean)
		.reduce((all, folderContents) => all.concat(folderContents), [])
}

export function fileIsInFolder (filePath: string, folderPath: string): boolean {
	const rootFilePath = dirname(filePath);

	return rootFilePath.startsWith(folderPath);
}