import { describe, expect, it } from "vitest";
import { createAnchoredStandard, ANCHORED_MINIMAL_PROMPT } from "../src/phases.js";

const TOOLS = ["bash", "read", "write", "replace", "ffgrep", "fffind", "todo"];

interface Entry {
	type: string;
	message?: { role: string };
}

function makePi() {
	// Post-startup steady state: the extension already applied bootstrap.
	let active = ["bash", "read"];
	const sent: Array<{ message: any; options: any }> = [];
	const handlers = new Map<string, Array<(event: any, ctx: any) => any>>();
	const pi = {
		get active() {
			return [...active];
		},
		get sent() {
			return [...sent];
		},
		getActiveTools: () => [...active],
		getAllTools: () => TOOLS.map((name) => ({ name, description: "", parameters: {} })),
		setActiveTools: (names: string[]) => {
			active = [...names];
		},
		sendMessage: (message: any, options: any) => sent.push({ message, options }),
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
	return { sessionManager: { getEntries: () => entries, getSessionId: () => "test-session" } };
}

// Pi calls the extension factory with only `pi`; each event carries its own
// ctx (with sessionManager). The mock mirrors that: emit passes ctx per call.
function setup(options?: Parameters<typeof createAnchoredStandard>[0]) {
	const pi = makePi();
	createAnchoredStandard(options)(pi as any);
	return { pi };
}

describe("bootstrap phase", () => {
	it("starts a new session with only shell + read active", async () => {
		const { pi } = setup();
		await pi.emit("session_start", { type: "session_start", reason: "new" }, makeCtx());
		expect(pi.active.sort()).toEqual(["bash", "read"]);
	});

	it("keeps the bootstrap catalog on the first user turn", async () => {
		const { pi } = setup();
		const result = await pi.emit("before_agent_start", { type: "before_agent_start" }, makeCtx());
		expect(pi.active.sort()).toEqual(["bash", "read"]);
		expect(result.systemPrompt).toBe(ANCHORED_MINIMAL_PROMPT);
	});

	it("keeps pi's prompt when minimalPrompt is null", async () => {
		const { pi } = setup({ minimalPrompt: null });
		const result = await pi.emit("before_agent_start", { type: "before_agent_start" }, makeCtx());
		expect(result).toBeUndefined();
	});

	it("does not promote on user messages", async () => {
		const { pi } = setup();
		await pi.emit("session_start", { type: "session_start", reason: "new" }, makeCtx());
		await pi.emit("message_end", { type: "message_end", message: { role: "user" } }, makeCtx());
		expect(pi.active.sort()).toEqual(["bash", "read"]);
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
		expect(pi.active.sort()).toEqual(["bash", "read"]);
		await pi.emit("tool_call", { type: "tool_call", toolName: "read" }, makeCtx());
		expect(pi.active.sort()).toEqual([...TOOLS].sort());
	});

	it("promoteOn: assistant-message ignores tool calls", async () => {
		const { pi } = setup({ promoteOn: "assistant-message" });
		await pi.emit("tool_call", { type: "tool_call", toolName: "bash" }, makeCtx());
		expect(pi.active.sort()).toEqual(["bash", "read"]);
		await pi.emit("message_end", { type: "message_end", message: { role: "assistant" } }, makeCtx());
		expect(pi.active.sort()).toEqual([...TOOLS].sort());
	});
});

describe("bootstrap provider payload", () => {
	it("caps the first provider request to 1024 tokens", async () => {
		const { pi } = setup();
		const payload = { max_tokens: 384_000 };
		const result = await pi.emit(
			"before_provider_request",
			{ type: "before_provider_request", payload },
			makeCtx(),
		);
		expect(result).toEqual({ max_tokens: 1024 });
		expect(payload.max_tokens).toBe(384_000);
	});

	it("strips late prompt, tool, and context injections", async () => {
		const { pi } = setup();
		const result = await pi.emit(
			"before_provider_request",
			{
				type: "before_provider_request",
				payload: {
					max_tokens: 384_000,
					messages: [
						{ role: "system", content: "pi prompt + workspace + skills" },
						{ role: "user", content: "actual request" },
						{ role: "user", content: "injected skill catalog" },
					],
					tools: TOOLS.map((name) => ({ name })),
				},
			},
			makeCtx(),
		);
		expect(result.max_tokens).toBe(1024);
		expect(result.tools).toEqual([{ name: "bash" }, { name: "read" }]);
		expect(result.messages).toEqual([
			{ role: "system", content: ANCHORED_MINIMAL_PROMPT },
			{ role: "user", content: "actual request" },
		]);
	});

	it("restores installed tools and extension prompts after promotion", async () => {
		const { pi } = setup();
		await pi.emit(
			"before_agent_start",
			{ type: "before_agent_start", systemPrompt: "full pi prompt + workspace + skills" },
			makeCtx(),
		);
		await pi.emit(
			"before_provider_request",
			{
				type: "before_provider_request",
				payload: {
					max_tokens: 384_000,
					messages: [
						{
							role: "system",
							content: `${ANCHORED_MINIMAL_PROMPT}\n\nPONYTAIL MODE ACTIVE — level: lite`,
						},
						{ role: "user", content: "actual request" },
					],
					tools: TOOLS.map((name) => ({ name })),
				},
			},
			makeCtx(),
		);

		const promoted = makeCtx([{ type: "message", message: { role: "assistant" } }]);
		const result = await pi.emit(
			"before_provider_request",
			{
				type: "before_provider_request",
				payload: {
					max_tokens: 384_000,
					messages: [
						{ role: "system", content: ANCHORED_MINIMAL_PROMPT },
						{ role: "user", content: "actual request" },
						{ role: "assistant", content: "tool call" },
					],
					tools: TOOLS.map((name) => ({ name })),
				},
			},
			promoted,
		);
		expect(result.max_tokens).toBe(384_000);
		expect(result.tools).toEqual(TOOLS.map((name) => ({ name })));
		expect(result.tools).toContainEqual({ name: "ffgrep" });
		expect(result.messages[0]).toEqual({
			role: "system",
			content: "full pi prompt + workspace + skills\n\nPONYTAIL MODE ACTIVE — level: lite",
		});
	});

	it("continues exactly once when the bootstrap response hits its token cap", async () => {
		const { pi } = setup();
		await pi.emit(
			"before_provider_request",
			{ type: "before_provider_request", payload: { max_tokens: 384_000 } },
			makeCtx(),
		);
		await pi.emit(
			"message_end",
			{ type: "message_end", message: { role: "assistant", stopReason: "length" } },
			makeCtx(),
		);
		expect(pi.active.sort()).toEqual([...TOOLS].sort());
		expect(pi.sent).toEqual([{
			message: {
				customType: "anchored-standard-continuation",
				content: "Resume the interrupted reasoning exactly where it stopped. Do not restart, summarize, or simplify the plan; preserve its intended quality, then complete the user's request using the restored tools.",
				display: false,
			},
			options: { deliverAs: "steer", triggerTurn: true },
		}]);

		await pi.emit(
			"message_end",
			{ type: "message_end", message: { role: "assistant", stopReason: "length" } },
			makeCtx(),
		);
		expect(pi.sent).toHaveLength(1);
	});

	it("does not continue a normally completed bootstrap response", async () => {
		const { pi } = setup();
		await pi.emit(
			"before_provider_request",
			{ type: "before_provider_request", payload: { max_tokens: 384_000 } },
			makeCtx(),
		);
		await pi.emit(
			"message_end",
			{ type: "message_end", message: { role: "assistant", stopReason: "stop" } },
			makeCtx(),
		);
		expect(pi.sent).toEqual([]);
	});

	it("rejects an invalid bootstrap token cap", () => {
		expect(() => setup({ bootstrapMaxTokens: 0 })).toThrow("positive safe integer");
	});
});

describe("degradation", () => {
	it("degrades to the full catalog when a bootstrap tool is missing", async () => {
		const { pi } = setup({ bootstrapTools: ["bash", "read", "nonexistent"] });
		await pi.emit("session_start", { type: "session_start", reason: "new" }, makeCtx());
		expect(pi.active.sort()).toEqual([...TOOLS].sort());
	});
});
