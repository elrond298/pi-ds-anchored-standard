/**
 * pi-anchored-standard — bootstrap with a Minimal tool catalog, then expose
 * the full catalog after the first tool call or assistant message.
 *
 * Port of xiaobright/dsh-anchored-standard to pi's dynamic tool loading
 * (`pi.setActiveTools`): request #1 uses the exact Minimal persona, only
 * `bash` + `read`, `max_tokens: 1024`, and no generated workspace/skill
 * context. After its first durable promotion signal, the full pi prompt,
 * provider budget, and tool catalog return. Resume/fork/reload preserve phase.
 *
 * The bundled trajectory detector (`/trajectory`) verifies the bootstrap is
 * effective using the "let me" word-frequency fingerprint from
 * xiaobright/modeltest's DeepSeek V4 trajectory analysis: anchored sessions
 * keep "let me" ≈ 0–1 while "we"/"let's" dominate.
 */
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { createAnchoredStandard, ANCHORED_MINIMAL_PROMPT } from "./phases.js";
import { createTrajectoryDetector } from "./detect.js";

export { createAnchoredStandard, ANCHORED_MINIMAL_PROMPT } from "./phases.js";
export type { AnchoredStandardOptions } from "./phases.js";
export { TrajectoryTracker, countLetMe, createTrajectoryDetector } from "./detect.js";
export type { TrajectoryStats, TrajectoryDetectorOptions } from "./detect.js";

export default function anchoredStandard(pi: ExtensionAPI): void {
	createAnchoredStandard({ minimalPrompt: ANCHORED_MINIMAL_PROMPT })(pi);

	const detector = createTrajectoryDetector();
	detector.activate(pi);

	pi.registerCommand("trajectory", {
		description:
			"Show anchored-standard trajectory stats (let me / we / let's fingerprint)",
		handler: async (_args, ctx: ExtensionCommandContext) => {
			const s = detector.tracker.stats();
			const verdict = s.drift
				? `DRIFT — ${s.letMe} "let me" hits: bootstrap not anchoring`
				: `anchored — ${s.letMe} "let me" hit${s.letMe === 1 ? "" : "s"} (threshold ≥ 2)`;
			ctx.ui.notify(
				`trajectory (${s.assistantMessages} assistant msgs): ${verdict}` +
					` — we ${s.we}, let's ${s.lets}, ${s.stagedReplies} staged replies,` +
					` ${s.reasoningBlocks} reasoning blocks (p50 ${s.reasoningP50} chars)`,
				s.drift ? "warning" : "info",
			);
		},
	});
}
