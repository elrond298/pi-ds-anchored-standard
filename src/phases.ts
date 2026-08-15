/**
 * Anchored Standard — core logic, port of xiaobright/dsh-anchored-standard.
 *
 * Bootstraps the first model request with a Minimal-aligned tool catalog
 * (platform shell + read), then exposes the full registered tool catalog
 * after the session's first durable promotion signal (first tool call or
 * first assistant message). The phase is derived from the durable session
 * transcript, so resume, fork, and reload preserve it — no extra state.
 *
 * Rationale (from the original project): DeepSeek V4 Pro conditions strongly
 * on the API-visible tool catalog; a small catalog on request #1 scores
 * better on Project2, and the full catalog is restored once the trajectory
 * is chosen. The same mechanism — pi's dynamic tool loading
 * (`pi.setActiveTools`) — applies here.
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

export interface AnchoredStandardOptions {
	/** Tools exposed on the first model request. Default: `["bash", "read"]`. */
	bootstrapTools?: string[];
	/** First-request output cap matching upstream anchored-standard. Default: `1024`. */
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

/** Bootstrap persona used by the original dsh-anchored-standard preset. */
export const ANCHORED_MINIMAL_PROMPT = "You are a helpful software engineer assistant.";

export function createAnchoredStandard(options: AnchoredStandardOptions = {}) {
	const {
		bootstrapTools = ["bash", "read"],
		bootstrapMaxTokens = 1024,
		promoteOn = "either",
		minimalPrompt = ANCHORED_MINIMAL_PROMPT,
	} = options;
	if (!Number.isSafeInteger(bootstrapMaxTokens) || bootstrapMaxTokens <= 0) {
		throw new TypeError("bootstrapMaxTokens must be a positive safe integer");
	}

	return (pi: ExtensionAPI): void => {
		const allTools = new Set<string>();
		const normalPrompts = new Map<string, string>();
		const bootstrapRequests = new Set<string>();
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

		const promote = () => {
			remember();
			if (allTools.size > 0) pi.setActiveTools([...allTools]);
		};

		const applyBootstrap = () => {
			remember();
			const known = bootstrapTools.filter((t) => allTools.has(t));
			if (known.length !== bootstrapTools.length) {
				// Composition drift: a missing bootstrap tool degrades to the full
				// catalog rather than leaving the model with nothing (as anchored).
				promote();
			} else {
				pi.setActiveTools(known);
			}
		};

		pi.on("session_start", (_event, ctx) => {
			if (hasAssistantContent(ctx)) promote();
			else applyBootstrap();
		});

		// Re-assert the phase on every user turn; this also covers switching
		// between sessions, which does not always fire session_start.
		pi.on("before_agent_start", (event, ctx) => {
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
		// before_agent_start, so set the exact prompt, two tools, context, and
		// output budget here as well.
		pi.on("before_provider_request", (event, ctx) => {
			if (typeof event.payload !== "object" || event.payload === null) return undefined;

			const payload = event.payload as Record<string, unknown>;
			const messages = Array.isArray(payload.messages)
				? payload.messages as Array<Record<string, unknown>>
				: undefined;
			const sessionId = ctx.sessionManager.getSessionId();

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

			const result: Record<string, unknown> = {
				...payload,
				max_tokens: bootstrapMaxTokens,
			};

			if (Array.isArray(payload.tools)) {
				const bootstrap = new Set(bootstrapTools);
				result.tools = (payload.tools as Array<Record<string, unknown>>).filter((tool) => {
					const fn = tool.function;
					const name = typeof tool.name === "string"
						? tool.name
						: typeof fn === "object" && fn !== null
							? (fn as Record<string, unknown>).name
							: undefined;
					return typeof name === "string" && bootstrap.has(name);
				});
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
				// Any tool call promotes — even a blocked or failed execution, which
				// is already durable in the transcript (matches anchored).
				bootstrapRequests.delete(ctx.sessionManager.getSessionId());
				promote();
			});
		}

		if (promoteOn !== "tool-call") {
			pi.on("message_end", (event: MessageEndEvent, ctx) => {
				if (event.message.role !== "assistant") return;
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
