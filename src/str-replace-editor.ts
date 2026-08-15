import { readFile, readdir, stat, writeFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { withFileMutationQueue } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

const DESCRIPTION = `Custom editing tool for viewing, creating and editing files
* State is persistent across command calls and discussions with the user
* If \`path\` is a file, \`view\` displays the result of applying \`cat -n\`. If \`path\` is a directory, \`view\` lists non-hidden files and directories up to 2 levels deep
* The \`create\` command cannot be used if the specified \`path\` already exists as a file
* If a \`command\` generates a long output, it will be truncated and marked with \`<response clipped>\`

Notes for using the \`str_replace\` command:
* The \`old_str\` parameter should match EXACTLY one or more consecutive lines from the original file. Be mindful of whitespaces!
* If the \`old_str\` parameter is not unique in the file, the replacement will not be performed. Make sure to include enough context in \`old_str\` to make it unique
* The \`new_str\` parameter should contain the edited lines that should replace the \`old_str\``;

const parameters = Type.Object({
	command: Type.Unsafe<"view" | "create" | "str_replace" | "insert">({
		type: "string",
		description: "The commands to run. Allowed options are: `view`, `create`, `str_replace`, `insert`.",
		enum: ["view", "create", "str_replace", "insert"],
	}),
	path: Type.String({
		description: "Absolute path to file or directory, e.g. `/repo/file.py` or `/repo`.",
	}),
	file_text: Type.Optional(Type.String({
		description: "Required parameter of `create` command, with the content of the file to be created.",
	})),
	insert_line: Type.Optional(Type.Integer({
		description: "Required parameter of `insert` command. The `new_str` will be inserted AFTER the line `insert_line` of `path`.",
	})),
	new_str: Type.Optional(Type.String({
		description: "Optional parameter of `str_replace` command containing the new string (if not given, no string will be added). Required parameter of `insert` command containing the string to insert.",
	})),
	old_str: Type.Optional(Type.String({
		description: "Required parameter of `str_replace` command containing the string in `path` to replace.",
	})),
	view_range: Type.Optional(Type.Array(Type.Integer(), {
		description: "Optional parameter of `view` command when `path` points to a file. If none is given, the full file is shown. If provided, the file will be shown in the indicated line number range, e.g. [11, 12] will show lines 11 and 12. Indexing at 1 to start. Setting `[start_line, -1]` shows all lines from `start_line` to the end of the file.",
	})),
});

type Params = {
	command: "view" | "create" | "str_replace" | "insert";
	path: string;
	file_text?: string;
	insert_line?: number;
	new_str?: string;
	old_str?: string;
	view_range?: number[];
};

const MAX_OUTPUT_CHARS = 16_000;

function clip(text: string): string {
	const marker = "\n<response clipped>";
	return text.length <= MAX_OUTPUT_CHARS
		? text
		: text.slice(0, MAX_OUTPUT_CHARS - marker.length) + marker;
}

function targetPath(cwd: string, input: string): string {
	const path = input.startsWith("@") ? input.slice(1) : input;
	return isAbsolute(path) ? path : resolve(cwd, path);
}

function numbered(text: string, range?: number[]): string {
	const lines = text.split("\n");
	if (lines.at(-1) === "") lines.pop();
	let start = 1;
	let end = lines.length;
	if (range) {
		if (range.length !== 2 || range[0] < 1 || (range[1] !== -1 && range[1] < range[0])) {
			throw new Error("view_range must be [start, end] with 1-based lines; end may be -1");
		}
		[start, end] = range;
		if (end === -1) end = lines.length;
	}
	return lines
		.slice(start - 1, end)
		.map((line, index) => `${String(start + index).padStart(6)}\t${line}`)
		.join("\n");
}

async function directoryView(root: string): Promise<string> {
	const lines: string[] = [];
	const visit = async (dir: string, prefix: string, depth: number): Promise<void> => {
		const entries = (await readdir(dir, { withFileTypes: true }))
			.filter((entry) => !entry.name.startsWith("."))
			.sort((a, b) => a.name.localeCompare(b.name));
		for (const entry of entries) {
			lines.push(`${prefix}${entry.name}${entry.isDirectory() ? "/" : ""}`);
			if (entry.isDirectory() && depth < 2) {
				await visit(resolve(dir, entry.name), `${prefix}${entry.name}/`, depth + 1);
			}
		}
	};
	await visit(root, "", 1);
	return lines.join("\n");
}

function textResult(text: string) {
	return { content: [{ type: "text" as const, text: clip(text) }], details: {} };
}

export function registerStrReplaceEditor(pi: ExtensionAPI): void {
	pi.registerTool({
		name: "str_replace_editor",
		label: "String Replace Editor",
		description: DESCRIPTION,
		parameters,
		executionMode: "sequential",
		async execute(_toolCallId, params: Params, signal, _onUpdate, ctx) {
			signal?.throwIfAborted();
			const path = targetPath(ctx.cwd, params.path);

			if (params.command === "view") {
				const info = await stat(path);
				return textResult(info.isDirectory()
					? await directoryView(path)
					: numbered(await readFile(path, "utf8"), params.view_range));
			}

			return withFileMutationQueue(path, async () => {
				signal?.throwIfAborted();
				if (params.command === "create") {
					if (params.file_text === undefined) throw new Error("file_text is required for create");
					await writeFile(path, params.file_text, { encoding: "utf8", flag: "wx" });
					return textResult(`File created successfully at: ${path}`);
				}

				const original = await readFile(path, "utf8");
				if (params.command === "str_replace") {
					if (!params.old_str) throw new Error("old_str is required for str_replace");
					const matches = original.split(params.old_str).length - 1;
					if (matches !== 1) {
						throw new Error(matches === 0
							? "old_str was not found in the file"
							: `old_str appears ${matches} times; it must be unique`);
					}
					signal?.throwIfAborted();
					await writeFile(path, original.replace(params.old_str, params.new_str ?? ""), "utf8");
					return textResult(`The file ${path} has been edited.`);
				}

				if (params.insert_line === undefined || params.new_str === undefined) {
					throw new Error("insert_line and new_str are required for insert");
				}
				const trailingNewline = original.endsWith("\n");
				const lines = original === "" ? [] : original.split("\n");
				if (trailingNewline) lines.pop();
				if (params.insert_line < 0 || params.insert_line > lines.length) {
					throw new Error(`insert_line must be between 0 and ${lines.length}`);
				}
				lines.splice(params.insert_line, 0, params.new_str);
				signal?.throwIfAborted();
				await writeFile(path, lines.join("\n") + (trailingNewline ? "\n" : ""), "utf8");
				return textResult(`The file ${path} has been edited.`);
			});
		},
	});
}
