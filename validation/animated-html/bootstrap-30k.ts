import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createTrajectoryDetector } from "../../src/detect.js";
import { createAnchoredStandard } from "../../src/phases.js";

export default function anchored30k(pi: ExtensionAPI): void {
	createAnchoredStandard({
		bootstrapTools: ["bash", "read"],
		bootstrapMaxTokens: 30_000,
	})(pi);
	createTrajectoryDetector().activate(pi);
}
