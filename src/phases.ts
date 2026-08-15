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
	/** What promotes the session to the full catalog. Default: `"either"`. */
	promoteOn?: "either" | "tool-call" | "assistant-message";
	/**
	 * System prompt used while the session is in the bootstrap phase.
	 * `null` (default) keeps pi's normal system prompt, whose tool sections
	 * already shrink to the active catalog. Set to the anchored-standard
	 * persona — `"You are a helpful software engineer assistant."` — to also
	 * reproduce its minimal complete system prompt on request #1.
	 */
	minimalPrompt?: string | null;
}

/** Bootstrap persona used by the original dsh-anchored-standard preset. */
export const ANCHORED_MINIMAL_PROMPT = "You are a helpful software engineer assistant.";

export function createAnchoredStandard(options: AnchoredStandardOptions = {}) {
	const {
		bootstrapTools = ["bash", "read"],
		promoteOn = "either",
		minimalPrompt = null,
	} = options;

	return (pi: ExtensionAPI): void => {
		const allTools = new Set<string>();
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
		pi.on("before_agent_start", (_event, ctx) => {
			if (hasAssistantContent(ctx)) {
				promote();
				return undefined; // normal pi system prompt
			}
			applyBootstrap();
			return minimalPrompt ? { systemPrompt: minimalPrompt } : undefined;
		});

		if (promoteOn !== "assistant-message") {
			pi.on("tool_call", (_event: ToolCallEvent) => {
				// Any tool call promotes — even a blocked or failed execution, which
				// is already durable in the transcript (matches anchored).
				promote();
			});
		}

		if (promoteOn !== "tool-call") {
			pi.on("message_end", (event: MessageEndEvent) => {
				if (event.message.role === "assistant") promote();
			});
		}
	};
}
