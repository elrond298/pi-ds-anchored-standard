import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { registerStrReplaceEditor } from "../src/str-replace-editor.js";

const dirs: string[] = [];
afterEach(async () => {
	await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function captureTool() {
	let tool: any;
	registerStrReplaceEditor({ registerTool: (definition: any) => { tool = definition; } } as any);
	return tool;
}

describe("str_replace_editor", () => {
	it("exposes the Minimal schema", () => {
		const tool = captureTool();
		expect(tool.name).toBe("str_replace_editor");
		expect(tool.parameters.required).toEqual(["command", "path"]);
		expect(tool.parameters.properties.command.enum).toEqual([
			"view",
			"create",
			"str_replace",
			"insert",
		]);
	});

	it("creates, views, replaces, and inserts UTF-8 text", async () => {
		const cwd = await mkdtemp(join(tmpdir(), "str-replace-editor-"));
		dirs.push(cwd);
		const path = join(cwd, "sample.txt");
		const tool = captureTool();
		const execute = (params: any) => tool.execute("call", params, undefined, undefined, { cwd });

		await execute({ command: "create", path, file_text: "alpha\nbeta\n" });
		const viewed = await execute({ command: "view", path, view_range: [1, -1] });
		expect(viewed.content[0].text).toContain("     1\talpha\n     2\tbeta");

		await execute({ command: "str_replace", path, old_str: "beta", new_str: "BETA" });
		await execute({ command: "insert", path, insert_line: 1, new_str: "middle" });
		expect(await readFile(path, "utf8")).toBe("alpha\nmiddle\nBETA\n");

		const empty = join(cwd, "empty.txt");
		await execute({ command: "create", path: empty, file_text: "" });
		await execute({ command: "insert", path: empty, insert_line: 0, new_str: "first" });
		expect(await readFile(empty, "utf8")).toBe("first");
	});

	it("rejects non-unique replacements and hides dotfiles in directory views", async () => {
		const cwd = await mkdtemp(join(tmpdir(), "str-replace-editor-"));
		dirs.push(cwd);
		await writeFile(join(cwd, "visible.txt"), "same same", "utf8");
		await writeFile(join(cwd, ".secret"), "hidden", "utf8");
		await mkdir(join(cwd, "nested"));
		await writeFile(join(cwd, "nested", "child.txt"), "child", "utf8");
		const tool = captureTool();
		const execute = (params: any) => tool.execute("call", params, undefined, undefined, { cwd });

		await expect(execute({
			command: "str_replace",
			path: "visible.txt",
			old_str: "same",
			new_str: "other",
		})).rejects.toThrow("must be unique");
		const viewed = await execute({ command: "view", path: cwd });
		expect(viewed.content[0].text).toContain("visible.txt");
		expect(viewed.content[0].text).toContain("nested/child.txt");
		expect(viewed.content[0].text).not.toContain(".secret");
	});
});
