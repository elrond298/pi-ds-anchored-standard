/**
 * pi-ds-anchored-standard — a DeepSeek V4 Pro 0813 performance workaround.
 *
 * Models whose ID or name contains `deepseek-v4-pro` receive the Minimal first
 * request: exact persona, `bash` + `str_replace_editor`, the provider output budget,
 * workspace/skill context. All other models keep ordinary Pi behavior. After a
 * target session's first tool call or assistant message, the normal Pi prompt,
 * output limit, and all enabled tools return.
 *
 * The method is inspired by xiaobright/dsh-anchored-standard. `/trajectory`
 * exposes the related xiaobright/modeltest word-frequency fingerprint as a
 * diagnostic signal for DeepSeek V4 Pro only.
 */
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { createAnchoredStandard, ANCHORED_MINIMAL_PROMPT, isDeepSeekV4ProModel } from "./phases.js";
import { createTrajectoryDetector } from "./detect.js";

export { createAnchoredStandard, ANCHORED_MINIMAL_PROMPT, isDeepSeekV4ProModel } from "./phases.js";
export type { AnchoredStandardOptions } from "./phases.js";
export { TrajectoryTracker, countLetMe, createTrajectoryDetector } from "./detect.js";
export type { TrajectoryStats, TrajectoryDetectorOptions } from "./detect.js";

export default function anchoredStandard(pi: ExtensionAPI): void {
	createAnchoredStandard({ minimalPrompt: ANCHORED_MINIMAL_PROMPT })(pi);

	const detector = createTrajectoryDetector();
	detector.activate(pi);

	pi.registerCommand("trajectory", {
		description:
			"Show DeepSeek V4 Pro trajectory stats (let me / we / let's / future-tense fingerprint)",
		handler: async (_args, ctx: ExtensionCommandContext) => {
			if (!isDeepSeekV4ProModel(ctx)) {
				ctx.ui.notify("trajectory inactive — pi-ds-anchored-standard only applies to DeepSeek V4 Pro", "info");
				return;
			}
			const s = detector.tracker.stats();
			const verdict = s.drift
				? `signal drift — ${s.letMe} "let me" hits (threshold ≥ 2)`
				: `anchored-like signal — ${s.letMe} "let me" hit${s.letMe === 1 ? "" : "s"}`;
			ctx.ui.notify(
				`trajectory (${s.assistantMessages} assistant msgs): ${verdict}` +
					` — we ${s.we}, let's ${s.lets}, i'll/i will ${s.iWill},` +
					` we'll/we will ${s.weWill}, ${s.stagedReplies} staged replies,` +
					` ${s.reasoningBlocks} reasoning blocks (p50 ${s.reasoningP50} chars)`,
				s.drift ? "warning" : "info",
			);
		},
	});
}
