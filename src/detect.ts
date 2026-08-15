/**
 * Trajectory detector — verifies that the anchored-standard bootstrap is
 * effective, using the word-frequency fingerprint from
 * xiaobright/modeltest's DeepSeek V4 trajectory analysis.
 *
 * Methodology (docs/v4.1/DEEPSEEK_V4_TRAJECTORY_ANALYSIS_20260814.md):
 * completed assistant messages are scanned case-insensitively with word
 * boundaries, counting `let me` / `we` / `let's` across both visible text
 * and reasoning blocks. In the analysis:
 *
 *   minimal / anchored-standard:  `let me` 0–1 total per task, `we` 165+,
 *   `let's` 88+, ~1 staged reply, many short reasoning blocks
 *   standard:                    `let me` 208, `we` 11, `let's` 2, 55 staged
 *   replies
 *
 * So a session that stays on the anchored trajectory keeps `let me` ≈ 0–1
 * while `we`/`let's` dominate; crossing `driftThreshold` "let me" hits means
 * the catalog/prompt no longer anchors the trajectory (extension not loaded,
 * composition drifted, or the model just doesn't condition this way).
 */

import type {
	ExtensionAPI,
	ExtensionContext,
	MessageEndEvent,
} from "@earendil-works/pi-coding-agent";

/** Structural subset of an assistant message (text + thinking parts). */
interface AssistantMessageLike {
	role: "assistant";
	content: Array<{ type: string; text?: string; thinking?: string }>;
}

export interface TrajectoryStats {
	/** Total `let me` hits (visible text + reasoning). */
	letMe: number;
	/** Total `we` hits. */
	we: number;
	/** Total `let's` hits. */
	lets: number;
	/** Number of assistant messages that carried visible text (staged replies). */
	stagedReplies: number;
	/** Number of reasoning blocks seen. */
	reasoningBlocks: number;
	/** Median reasoning-block length in chars (0 when no blocks). */
	reasoningP50: number;
	/** Assistant messages scanned. */
	assistantMessages: number;
	/** Whether the session has crossed the drift threshold. */
	drift: boolean;
}

export interface TrajectoryDetectorOptions {
	/**
	 * "let me" hits at or above which the trajectory counts as drifted.
	 * The analysis observed 0–1 per anchored task vs 208 for standard.
	 * Default: 2.
	 */
	driftThreshold?: number;
}

const LET_ME = /\blet me\b/gi;
const WE = /\bwe\b/gi;
const LETS = /\blet's\b/gi;

export function countLetMe(text: string): number {
	return (text.match(LET_ME) ?? []).length;
}

export class TrajectoryTracker {
	letMe = 0;
	we = 0;
	lets = 0;
	stagedReplies = 0;
	reasoningBlocks: number[] = [];
	assistantMessages = 0;

	constructor(private driftThreshold = 2) {}

	/** Scan one completed assistant message (text + reasoning parts). */
	add(message: AssistantMessageLike): void {
		this.assistantMessages++;
		let visible = "";
		for (const part of message.content) {
			if (part.type === "text" && part.text) {
				visible += part.text;
			} else if (part.type === "thinking" && part.thinking) {
				this.reasoningBlocks.push(part.thinking.length);
				this.scan(part.thinking);
			}
		}
		if (visible.length > 0) this.stagedReplies++;
		this.scan(visible);
	}

	private scan(text: string): void {
		this.letMe += (text.match(LET_ME) ?? []).length;
		this.we += (text.match(WE) ?? []).length;
		this.lets += (text.match(LETS) ?? []).length;
	}

	stats(): TrajectoryStats {
		const blocks = [...this.reasoningBlocks].sort((a, b) => a - b);
		const mid = Math.floor(blocks.length / 2);
		const p50 = blocks.length
			? blocks.length % 2
				? blocks[mid]
				: (blocks[mid - 1] + blocks[mid]) / 2
			: 0;
		return {
			letMe: this.letMe,
			we: this.we,
			lets: this.lets,
			stagedReplies: this.stagedReplies,
			reasoningBlocks: blocks.length,
			reasoningP50: p50,
			assistantMessages: this.assistantMessages,
			drift: this.letMe >= this.driftThreshold,
		};
	}
}

export function createTrajectoryDetector(options: TrajectoryDetectorOptions = {}) {
	const tracker = new TrajectoryTracker(options.driftThreshold ?? 2);
	let warned = false;

	return {
		tracker,
		activate: (pi: ExtensionAPI): void => {
			pi.on("message_end", (event: MessageEndEvent, ctx: ExtensionContext) => {
				if (event.message.role !== "assistant") return;
				tracker.add(event.message);
				if (!warned && tracker.stats().drift) {
					warned = true;
					const s = tracker.stats();
					ctx.ui.notify(
						`[anchored-standard] trajectory drift: ${s.letMe} "let me" hits` +
							` (we ${s.we}, let's ${s.lets}, ${s.stagedReplies} staged replies) —` +
							" bootstrap may not be anchoring",
						"warning",
					);
				}
			});
		},
	};
}
