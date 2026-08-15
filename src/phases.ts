/**
 * Anchored Standard — core logic inspired by xiaobright/dsh-anchored-standard.
 *
 * Improves DeepSeek V4 Pro 0813 behavior when the active model ID or name
 * contains `deepseek-v4-pro`, using the Minimal tool pair (`bash` +
 * `str_replace_editor`), then restoring the exact pre-bootstrap tool list after
 * the first tool call or assistant message. Other models are never bootstrapped.
 * is derived from the durable transcript, so resume, fork, and reload preserve it.
 *
 * The method is inspired by xiaobright/dsh-anchored-standard and implemented
 * here with Pi's dynamic tool loading (`pi.setActiveTools`).
 *
 * Note on pi's extension contract: the factory receives only `pi`; the
 * per-event `ctx` (with `sessionManager`, `ui`, ...) arrives on each handler
 * invocation, so no ctx is captured at activate time.
 */

import type {
	ExtensionAPI,
	BeforeAgentStartEvent,
	ExtensionContext,
	MessageEndEvent,
	ToolCallEvent,
} from "@earendil-works/pi-coding-agent";
import { registerStrReplaceEditor } from "./str-replace-editor.js";
export interface AnchoredStandardOptions {
	/** Tools exposed on the first model request. Default: `["bash", "str_replace_editor"]`. */
	bootstrapTools?: string[];
	/** Optional first-request output cap. Default: uncapped (provider budget). */
	bootstrapMaxTokens?: number;
	/** What promotes the session to the full catalog. Default: `"either"`. */
	promoteOn?: "either" | "tool-call" | "assistant-message";
	/**
	 * System prompt used while the session is in the bootstrap phase.
	 * Defaults to the byte-identical Minimal persona. Set `null` to keep pi's
	 * normal system prompt instead.
	 */
	minimalPrompt?: string | null;
}

/** Bootstrap persona used by the DeepSeek V4 Pro workaround. */
export const ANCHORED_MINIMAL_PROMPT = "You are a helpful software engineer assistant.";

const MINIMAL_BASH_DESCRIPTION = `Run commands in a bash shell
* When invoking this tool, the contents of the "command" parameter does NOT need to be XML-escaped.
* You don't have access to the internet via this tool.
* You do have access to a mirror of common linux and python packages via apt and pip.
* State is persistent across command calls and discussions with the user.
* To inspect a particular line range of a file, e.g. lines 10-25, try 'sed -n 10,25p /path/to/the/file'.
* Please avoid commands that may produce a very large amount of output.
* Please run long lived commands in the background, e.g. 'sleep 10 &' or start a server in the background.`;

const MINIMAL_BASH_PARAMETERS = {
	type: "object",
	properties: {
		command: {
			type: "string",
			description: "The bash command to run. Relative path is preferred in the command.",
		},
	},
	required: ["command"],
};

function withMinimalBashSchema(tool: Record<string, unknown>): Record<string, unknown> {
	const fn = typeof tool.function === "object" && tool.function !== null
		? tool.function as Record<string, unknown>
		: undefined;
	const name = typeof tool.name === "string" ? tool.name : fn?.name;
	if (name !== "bash") return tool;
	if (fn) {
		return {
			...tool,
			function: {
				...fn,
				description: MINIMAL_BASH_DESCRIPTION,
				parameters: MINIMAL_BASH_PARAMETERS,
			},
		};
	}
	return "input_schema" in tool
		? { ...tool, description: MINIMAL_BASH_DESCRIPTION, input_schema: MINIMAL_BASH_PARAMETERS }
		: { ...tool, description: MINIMAL_BASH_DESCRIPTION, parameters: MINIMAL_BASH_PARAMETERS };
}

/** Whether the active Pi model ID or name contains the targeted model marker. */
export function isDeepSeekV4ProModel(ctx: Pick<ExtensionContext, "model">): boolean {
	const model = ctx.model;
	return !!model && [model.id, model.name].some(
		(value) => value?.toLowerCase().includes("deepseek-v4-pro") ?? false,
	);
}

export function createAnchoredStandard(options: AnchoredStandardOptions = {}) {
	const {
		bootstrapTools = ["bash", "str_replace_editor"],
		bootstrapMaxTokens,
		promoteOn = "either",
		minimalPrompt = ANCHORED_MINIMAL_PROMPT,
	} = options;
	if (bootstrapMaxTokens !== undefined &&
		(!Number.isSafeInteger(bootstrapMaxTokens) || bootstrapMaxTokens <= 0)) {
		throw new TypeError("bootstrapMaxTokens must be a positive safe integer");
	}
	const useMinimalSchemas = bootstrapTools.includes("bash") &&
		bootstrapTools.includes("str_replace_editor");

	return (pi: ExtensionAPI): void => {
		let ownsStrReplaceEditor = false;
		if (bootstrapTools.includes("str_replace_editor")) {
			registerStrReplaceEditor(pi);
			ownsStrReplaceEditor = true;
		}
		const allTools = new Set<string>();
		const normalPrompts = new Map<string, string>();
		const bootstrapRequests = new Set<string>();
		let bootstrapActive = false;
		let toolsBeforeBootstrap: string[] | undefined;
		const remember = () => {
			for (const t of pi.getAllTools()) allTools.add(t.name);
		};

		// Durable phase: the session is promoted once its transcript contains an
		// assistant message or a tool result. Resume/fork/reload inherit it.
		const hasAssistantContent = (ctx: ExtensionContext) =>
			ctx.sessionManager
				.getEntries()
				.some(
					(e) =>
						e.type === "message" &&
						(e.message.role === "assistant" || e.message.role === "toolResult"),
				);

		const restoreOrdinaryTools = () => {
			if (bootstrapActive && toolsBeforeBootstrap) {
				pi.setActiveTools(toolsBeforeBootstrap);
			} else if (ownsStrReplaceEditor) {
				pi.setActiveTools(pi.getActiveTools().filter((name) => name !== "str_replace_editor"));
			}
			bootstrapActive = false;
			toolsBeforeBootstrap = undefined;
		};

		const promote = restoreOrdinaryTools;

		const applyBootstrap = () => {
			remember();
			const known = bootstrapTools.filter((t) => allTools.has(t));
			if (known.length !== bootstrapTools.length) {
				// Composition drift: leave Pi's ordinary active tools unchanged instead
				// of exposing an incomplete bootstrap set.
				promote();
			} else {
				if (!bootstrapActive) {
					toolsBeforeBootstrap = pi.getActiveTools().filter(
						(name) => !ownsStrReplaceEditor || name !== "str_replace_editor",
					);
				}
				pi.setActiveTools(known);
				bootstrapActive = true;
			}
		};

		pi.on("session_start", (_event, ctx) => {
			if (!isDeepSeekV4ProModel(ctx)) {
				restoreOrdinaryTools();
			} else if (hasAssistantContent(ctx)) {
				promote();
			} else {
				applyBootstrap();
			}
		});

		// Re-assert the phase on every user turn; this also covers switching
		// between sessions, which does not always fire session_start.
		pi.on("before_agent_start", (event, ctx) => {
			if (!isDeepSeekV4ProModel(ctx)) {
				restoreOrdinaryTools();
				return undefined;
			}
			if (hasAssistantContent(ctx)) {
				promote();
				return undefined; // normal pi system prompt
			}
			normalPrompts.set(ctx.sessionManager.getSessionId(), event.systemPrompt);
			applyBootstrap();
			return minimalPrompt ? { systemPrompt: minimalPrompt } : undefined;
		});

		// Enforce the complete upstream bootstrap at the final provider boundary.
		// Other extensions may append prompt text or activate tools after
		// before_agent_start, so set the exact prompt, Minimal tool schemas, context,
		// and optional output cap here as well.
		pi.on("before_provider_request", (event, ctx) => {
			if (typeof event.payload !== "object" || event.payload === null) return undefined;

			const payload = event.payload as Record<string, unknown>;
			const messages = Array.isArray(payload.messages)
				? payload.messages as Array<Record<string, unknown>>
				: undefined;
			const sessionId = ctx.sessionManager.getSessionId();

			if (!isDeepSeekV4ProModel(ctx)) {
				bootstrapRequests.delete(sessionId);
				restoreOrdinaryTools();
				const normalPrompt = normalPrompts.get(sessionId);
				if (!normalPrompt || !messages) return undefined;
				const hasSystem = messages.some((message) => message.role === "system");
				return {
					...payload,
					messages: hasSystem
						? messages.map((message) => message.role === "system"
							? { ...message, content: normalPrompt }
							: message)
						: [{ role: "system", content: normalPrompt }, ...messages],
				};
			}

			if (hasAssistantContent(ctx)) {
				const normalPrompt = normalPrompts.get(sessionId);
				if (!normalPrompt || !messages) return undefined;
				const hasSystem = messages.some((message) => message.role === "system");
				return {
					...payload,
					messages: hasSystem
						? messages.map((message) => message.role === "system"
							? { ...message, content: normalPrompt }
							: message)
						: [{ role: "system", content: normalPrompt }, ...messages],
				};
			}

			const result: Record<string, unknown> = { ...payload };
			if (bootstrapMaxTokens !== undefined) result.max_tokens = bootstrapMaxTokens;

			if (Array.isArray(payload.tools)) {
				const bootstrap = new Set(bootstrapTools);
				result.tools = (payload.tools as Array<Record<string, unknown>>)
					.filter((tool) => {
						const fn = tool.function;
						const name = typeof tool.name === "string"
							? tool.name
							: typeof fn === "object" && fn !== null
								? (fn as Record<string, unknown>).name
								: undefined;
						return typeof name === "string" && bootstrap.has(name);
					})
					.map((tool) => useMinimalSchemas ? withMinimalBashSchema(tool) : tool);
			}

			if (minimalPrompt && messages) {
				const system = messages.find((message) => message.role === "system");
				const user = messages.find((message) => message.role === "user");
				if (typeof system?.content === "string") {
					const normalPrompt = normalPrompts.get(sessionId);
					if (!normalPrompt) {
						normalPrompts.set(sessionId, system.content);
					} else if (system.content.startsWith(minimalPrompt)) {
						const extensionSuffix = system.content.slice(minimalPrompt.length);
						if (extensionSuffix && !normalPrompt.endsWith(extensionSuffix)) {
							normalPrompts.set(sessionId, normalPrompt + extensionSuffix);
						}
					}
				}
				result.messages = [
					system ? { ...system, content: minimalPrompt } : { role: "system", content: minimalPrompt },
					...(user ? [user] : []),
				];
			}
			bootstrapRequests.add(sessionId);
			return result;
		});

		if (promoteOn !== "assistant-message") {
			pi.on("tool_call", (_event: ToolCallEvent, ctx) => {
				if (!isDeepSeekV4ProModel(ctx)) {
					restoreOrdinaryTools();
					return;
				}
				// Any tool call promotes — even a blocked or failed execution, which
				// is already durable in the transcript (matches anchored).
				bootstrapRequests.delete(ctx.sessionManager.getSessionId());
				promote();
			});
		}

		if (promoteOn !== "tool-call") {
			pi.on("message_end", (event: MessageEndEvent, ctx) => {
				if (event.message.role !== "assistant") return;
				if (!isDeepSeekV4ProModel(ctx)) {
					restoreOrdinaryTools();
					return;
				}
				const wasBootstrap = bootstrapRequests.delete(ctx.sessionManager.getSessionId());
				promote();
				if (wasBootstrap && (event.message as { stopReason?: string }).stopReason === "length") {
					pi.sendMessage(
						{
							customType: "anchored-standard-continuation",
							content: "Resume the interrupted reasoning exactly where it stopped. Do not restart, summarize, or simplify the plan; preserve its intended quality, then complete the user's request using the restored tools.",
							display: false,
						},
						{ deliverAs: "steer", triggerTurn: true },
					);
				}
			});
		}
	};
}
