import { describe, expect, it } from "vitest";
import { createAnchoredStandard, ANCHORED_MINIMAL_PROMPT, isDeepSeekV4ProModel } from "../src/phases.js";

const TOOLS = ["bash", "read", "write", "replace", "ffgrep", "fffind", "todo"];

interface Entry {
	type: string;
	message?: { role: string };
}

function makePi(initialTools = TOOLS) {
	// Ordinary Pi may have any user-selected active tool subset.
	const tools = TOOLS.map((name) => ({ name, description: "", parameters: {} }));
	let active = [...initialTools];
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
		getAllTools: () => [...tools],
		registerTool: (tool: any) => {
			tools.push(tool);
			active.push(tool.name);
		},
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

function makeCtx(entries: Entry[] = [], modelId: string | undefined = "deepseek-v4-pro") {
	return {
		model: modelId ? { id: modelId } : undefined,
		sessionManager: { getEntries: () => entries, getSessionId: () => "test-session" },
	};
}

// Pi calls the extension factory with only `pi`; each event carries its own
// ctx (with sessionManager). The mock mirrors that: emit passes ctx per call.
function setup(
	options?: Parameters<typeof createAnchoredStandard>[0],
	initialTools?: string[],
) {
	const pi = makePi(initialTools);
	createAnchoredStandard(options)(pi as any);
	return { pi };
}

describe("model gating", () => {
	it.each([
		"deepseek-v4-pro",
		"deepseek-v4-pro-0813",
		"deepseek/deepseek-v4-pro",
		"deepseek/deepseek-v4-pro-0813",
		"vendor/deepseek-v4-pro-custom",
		"Vendor/DeepSeek-V4-Pro-Latest",
	])("recognizes targeted model id %s", (id) => {
		expect(isDeepSeekV4ProModel(makeCtx([], id) as any)).toBe(true);
	});

	it("recognizes the marker in the model name", () => {
		expect(isDeepSeekV4ProModel({
			model: { id: "provider-alias", name: "vendor/deepseek-v4-pro-preview" },
		} as any)).toBe(true);
	});

	it.each(["deepseek-v4-flash", "gpt-5.4"])(
		"rejects non-target model %s",
		(id) => expect(isDeepSeekV4ProModel(makeCtx([], id) as any)).toBe(false),
	);

	it("rejects an undefined model", () => {
		expect(isDeepSeekV4ProModel({ model: undefined } as any)).toBe(false);
	});

	it("leaves a non-target model on ordinary Pi tools and prompt", async () => {
		const { pi } = setup(undefined, ["read"]);
		const ctx = makeCtx([], "gpt-5.4");
		await pi.emit("session_start", { type: "session_start", reason: "new" }, ctx);
		const agentResult = await pi.emit(
			"before_agent_start",
			{ type: "before_agent_start", systemPrompt: "normal pi prompt" },
			ctx,
		);
		const payload = { max_tokens: 128_000, messages: [{ role: "user", content: "hello" }] };
		const providerResult = await pi.emit(
			"before_provider_request",
			{ type: "before_provider_request", payload },
			ctx,
		);

		expect(pi.active).toEqual(["read"]);
		expect(agentResult).toBeUndefined();
		expect(providerResult).toBeUndefined();
		expect(payload.max_tokens).toBe(128_000);
	});

	it("does not continue a truncated response from another model", async () => {
		const { pi } = setup(undefined, ["read"]);
		const ctx = makeCtx([], "gpt-5.4");
		await pi.emit(
			"before_provider_request",
			{ type: "before_provider_request", payload: { max_tokens: 128_000 } },
			ctx,
		);
		await pi.emit(
			"message_end",
			{ type: "message_end", message: { role: "assistant", stopReason: "length" } },
			ctx,
		);

		expect(pi.active).toEqual(["read"]);
		expect(pi.sent).toEqual([]);
	});

	it("starts bootstrapping if a blank session switches to DeepSeek V4 Pro", async () => {
		const { pi } = setup();
		await pi.emit("session_start", { type: "session_start", reason: "new" }, makeCtx([], "gpt-5.4"));
		const result = await pi.emit(
			"before_agent_start",
			{ type: "before_agent_start", systemPrompt: "normal pi prompt" },
			makeCtx([], "deepseek-v4-pro"),
		);

		expect(pi.active.sort()).toEqual(["bash", "str_replace_editor"]);
		expect(result.systemPrompt).toBe(ANCHORED_MINIMAL_PROMPT);
	});

	it("restores the normal prompt if the model changes before the provider call", async () => {
		const { pi } = setup(undefined, ["read", "write"]);
		await pi.emit(
			"before_agent_start",
			{ type: "before_agent_start", systemPrompt: "normal pi prompt" },
			makeCtx(),
		);
		const result = await pi.emit(
			"before_provider_request",
			{
				type: "before_provider_request",
				payload: {
					max_tokens: 128_000,
					messages: [
						{ role: "system", content: ANCHORED_MINIMAL_PROMPT },
						{ role: "user", content: "hello" },
					],
				},
			},
			makeCtx([], "gpt-5.4"),
		);

		expect(pi.active.sort()).toEqual(["read", "write"]);
		expect(result.messages[0]).toEqual({ role: "system", content: "normal pi prompt" });
		expect(result.max_tokens).toBe(128_000);
	});
});

describe("bootstrap phase", () => {
	it("starts a new session with the Minimal tool pair active", async () => {
		const { pi } = setup();
		await pi.emit("session_start", { type: "session_start", reason: "new" }, makeCtx());
		expect(pi.active.sort()).toEqual(["bash", "str_replace_editor"]);
	});

	it("keeps the bootstrap catalog on the first user turn", async () => {
		const { pi } = setup();
		const result = await pi.emit("before_agent_start", { type: "before_agent_start" }, makeCtx());
		expect(pi.active.sort()).toEqual(["bash", "str_replace_editor"]);
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
		expect(pi.active.sort()).toEqual(["bash", "str_replace_editor"]);
	});
});

describe("promotion", () => {
	it("restores the pre-bootstrap tool list on a tool call", async () => {
		const { pi } = setup(undefined, ["read", "write"]);
		await pi.emit("session_start", { type: "session_start", reason: "new" }, makeCtx());
		await pi.emit("tool_call", { type: "tool_call", toolName: "bash" }, makeCtx());
		expect(pi.active.sort()).toEqual(["read", "write"]);
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
		await pi.emit("session_start", { type: "session_start", reason: "new" }, makeCtx());
		await pi.emit("message_end", { type: "message_end", message: { role: "assistant" } }, makeCtx());
		expect(pi.active.sort()).toEqual(["bash", "str_replace_editor"]);
		await pi.emit("tool_call", { type: "tool_call", toolName: "read" }, makeCtx());
		expect(pi.active.sort()).toEqual([...TOOLS].sort());
	});

	it("promoteOn: assistant-message ignores tool calls", async () => {
		const { pi } = setup({ promoteOn: "assistant-message" });
		await pi.emit("session_start", { type: "session_start", reason: "new" }, makeCtx());
		await pi.emit("tool_call", { type: "tool_call", toolName: "bash" }, makeCtx());
		expect(pi.active.sort()).toEqual(["bash", "str_replace_editor"]);
		await pi.emit("message_end", { type: "message_end", message: { role: "assistant" } }, makeCtx());
		expect(pi.active.sort()).toEqual([...TOOLS].sort());
	});
});

describe("bootstrap provider payload", () => {
	it("leaves the first provider request uncapped by default", async () => {
		const { pi } = setup();
		const payload = { max_tokens: 384_000 };
		const result = await pi.emit(
			"before_provider_request",
			{ type: "before_provider_request", payload },
			makeCtx(),
		);
		expect(result).toEqual({ max_tokens: 384_000 });
		expect(payload.max_tokens).toBe(384_000);
	});

	it("applies an opt-in bootstrap token cap", async () => {
		const { pi } = setup({ bootstrapMaxTokens: 1024 });
		const result = await pi.emit(
			"before_provider_request",
			{ type: "before_provider_request", payload: { max_tokens: 384_000 } },
			makeCtx(),
		);
		expect(result.max_tokens).toBe(1024);
	});

	it("strips late prompt, tool, and context injections", async () => {
		const { pi } = setup();
		const providerTools = pi.getAllTools().map((tool: any) => ({
			type: "function",
			function: { name: tool.name, description: tool.description, parameters: tool.parameters },
		}));
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
					tools: providerTools,
				},
			},
			makeCtx(),
		);
		expect(result.max_tokens).toBe(384_000);
		expect(result.tools.map((tool: any) => tool.function.name)).toEqual([
			"bash",
			"str_replace_editor",
		]);
		const bash = result.tools[0].function;
		expect(bash.parameters.required).toEqual(["command"]);
		expect(Object.keys(bash.parameters.properties)).toEqual(["command"]);
		const editor = result.tools[1].function;
		expect(editor.parameters.properties.command.enum).toEqual([
			"view",
			"create",
			"str_replace",
			"insert",
		]);
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
	it("keeps ordinary active tools when a bootstrap tool is missing", async () => {
		const { pi } = setup(
			{ bootstrapTools: ["bash", "read", "nonexistent"] },
			["read", "write"],
		);
		await pi.emit("session_start", { type: "session_start", reason: "new" }, makeCtx());
		expect(pi.active.sort()).toEqual(["read", "write"]);
	});
});
