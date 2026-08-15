import { describe, expect, it } from "vitest";
import { createAnchoredStandard, ANCHORED_MINIMAL_PROMPT } from "../src/phases.js";

const TOOLS = ["bash", "read", "write", "replace", "ffgrep", "fffind", "todo"];

interface Entry {
	type: string;
	message?: { role: string };
}

function makePi() {
	// Post-startup steady state: the extension already applied bootstrap.
	let active = ["bash", "read", "write"];
	const handlers = new Map<string, Array<(event: any, ctx: any) => any>>();
	const pi = {
		get active() {
			return [...active];
		},
		getActiveTools: () => [...active],
		getAllTools: () => TOOLS.map((name) => ({ name, description: "", parameters: {} })),
		setActiveTools: (names: string[]) => {
			active = [...names];
		},
		on: (evt: string, h: (event: any, ctx: any) => any) => {
			handlers.set(evt, [...(handlers.get(evt) ?? []), h]);
		},
		emit: async (evt: string, event: any, ctx: any) => {
			let last;
			for (const h of handlers.get(evt) ?? []) last = await h(event, ctx);
			return last;
		},
	};
	return pi;
}

function makeCtx(entries: Entry[] = []) {
	return { sessionManager: { getEntries: () => entries } };
}

// Pi calls the extension factory with only `pi`; each event carries its own
// ctx (with sessionManager). The mock mirrors that: emit passes ctx per call.
function setup(options?: Parameters<typeof createAnchoredStandard>[0]) {
	const pi = makePi();
	createAnchoredStandard(options)(pi as any);
	return { pi };
}

describe("bootstrap phase", () => {
	it("starts a new session with shell + read + write active", async () => {
		const { pi } = setup();
		await pi.emit("session_start", { type: "session_start", reason: "new" }, makeCtx());
		expect(pi.active.sort()).toEqual(["bash", "read", "write"]);
	});

	it("keeps the bootstrap catalog on the first user turn", async () => {
		const { pi } = setup();
		const result = await pi.emit("before_agent_start", { type: "before_agent_start" }, makeCtx());
		expect(pi.active.sort()).toEqual(["bash", "read", "write"]);
		expect(result).toBeUndefined(); // no prompt replacement by default
	});

	it("replaces the system prompt during bootstrap when minimalPrompt is set", async () => {
		const { pi } = setup({ minimalPrompt: ANCHORED_MINIMAL_PROMPT });
		const result = await pi.emit("before_agent_start", { type: "before_agent_start" }, makeCtx());
		expect(result.systemPrompt).toBe(ANCHORED_MINIMAL_PROMPT);
	});

	it("does not promote on user messages", async () => {
		const { pi } = setup();
		await pi.emit("session_start", { type: "session_start", reason: "new" }, makeCtx());
		await pi.emit("message_end", { type: "message_end", message: { role: "user" } }, makeCtx());
		expect(pi.active.sort()).toEqual(["bash", "read", "write"]);
	});
});

describe("promotion", () => {
	it("promotes to the full catalog on a tool call", async () => {
		const { pi } = setup();
		await pi.emit("tool_call", { type: "tool_call", toolName: "bash" }, makeCtx());
		expect(pi.active.sort()).toEqual([...TOOLS].sort());
	});

	it("promotes on a text-only assistant reply", async () => {
		const { pi } = setup();
		await pi.emit("message_end", { type: "message_end", message: { role: "assistant" } }, makeCtx());
		expect(pi.active.sort()).toEqual([...TOOLS].sort());
	});

	it("resumes a session with assistant content already promoted", async () => {
		const { pi } = setup();
		const resumed = makeCtx([
			{ type: "message", message: { role: "user" } },
			{ type: "message", message: { role: "assistant" } },
		]);
		await pi.emit("session_start", { type: "session_start", reason: "resume" }, resumed);
		expect(pi.active.sort()).toEqual([...TOOLS].sort());
	});

	it("promoteOn: tool-call ignores assistant messages", async () => {
		const { pi } = setup({ promoteOn: "tool-call" });
		await pi.emit("message_end", { type: "message_end", message: { role: "assistant" } }, makeCtx());
		expect(pi.active.sort()).toEqual(["bash", "read", "write"]);
		await pi.emit("tool_call", { type: "tool_call", toolName: "read" }, makeCtx());
		expect(pi.active.sort()).toEqual([...TOOLS].sort());
	});

	it("promoteOn: assistant-message ignores tool calls", async () => {
		const { pi } = setup({ promoteOn: "assistant-message" });
		await pi.emit("tool_call", { type: "tool_call", toolName: "bash" }, makeCtx());
		expect(pi.active.sort()).toEqual(["bash", "read", "write"]);
		await pi.emit("message_end", { type: "message_end", message: { role: "assistant" } }, makeCtx());
		expect(pi.active.sort()).toEqual([...TOOLS].sort());
	});
});

describe("degradation", () => {
	it("degrades to the full catalog when a bootstrap tool is missing", async () => {
		const { pi } = setup({ bootstrapTools: ["bash", "read", "nonexistent"] });
		await pi.emit("session_start", { type: "session_start", reason: "new" }, makeCtx());
		expect(pi.active.sort()).toEqual([...TOOLS].sort());
	});
});
