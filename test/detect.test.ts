import { describe, expect, it, vi } from "vitest";
import { countLetMe, TrajectoryTracker, createTrajectoryDetector } from "../src/detect.js";

function assistantMessage(content: Array<{ type: string; text?: string; thinking?: string }>): {
	role: "assistant";
	content: Array<{ type: string; text?: string; thinking?: string }>;
} {
	return { role: "assistant", content };
}

describe("countLetMe", () => {
	it("counts case-insensitive word-boundary hits", () => {
		expect(countLetMe("Let me check. let me verify. Let me")).toBe(3);
	});

	it("ignores partial matches and other words", () => {
		expect(countLetMe("let's go, let mew, outlet member, let me")).toBe(1);
		expect(countLetMe("we should fix it")).toBe(0);
	});
});

describe("TrajectoryTracker", () => {
	it("scans both visible text and reasoning blocks", () => {
		const t = new TrajectoryTracker();
		t.add(
			assistantMessage([
				{ type: "thinking", thinking: "Let me plan the approach." },
				{ type: "text", text: "We need to refactor. Let me check." },
			]),
		);
		expect(t.stats().letMe).toBe(2);
		expect(t.stats().we).toBe(1);
	});

	it("counts staged replies and reasoning blocks with p50", () => {
		const t = new TrajectoryTracker();
		t.add(assistantMessage([{ type: "thinking", thinking: "a".repeat(100) }]));
		t.add(assistantMessage([{ type: "thinking", thinking: "b".repeat(300) }]));
		t.add(assistantMessage([{ type: "text", text: "Done." }]));
		const s = t.stats();
		expect(s.reasoningBlocks).toBe(2);
		expect(s.reasoningP50).toBe(200); // median of [100, 300]
		expect(s.stagedReplies).toBe(1);
		expect(s.assistantMessages).toBe(3);
		expect(s.drift).toBe(false);
	});

	it("flags drift at the threshold", () => {
		const t = new TrajectoryTracker(2);
		t.add(assistantMessage([{ type: "text", text: "let me a, let me b" }]));
		expect(t.stats().drift).toBe(true);
	});
});

describe("createTrajectoryDetector", () => {
	it("notifies once when drift is first detected", async () => {
		const notify = vi.fn();
		const handlers = new Map<string, Array<(event: any, ctx: any) => any>>();
		const pi = {
			on: (evt: string, h: (event: any, ctx: any) => any) =>
				handlers.set(evt, [...(handlers.get(evt) ?? []), h]),
		};
		const ctx = { model: { id: "deepseek-v4-pro" }, ui: { notify } };
		createTrajectoryDetector().activate(pi as any);

		const msg = () =>
			assistantMessage([{ type: "text", text: "let me do it, let me again" }]);
		await handlers.get("message_end")![0]({ type: "message_end", message: msg() }, ctx);
		await handlers.get("message_end")![0]({ type: "message_end", message: msg() }, ctx);
		expect(notify).toHaveBeenCalledTimes(1);
		expect(notify.mock.calls[0][0]).toContain("trajectory drift");
		expect(notify.mock.calls[0][1]).toBe("warning");
	});

	it("does not notify while the trajectory stays anchored", async () => {
		const notify = vi.fn();
		const handlers = new Map<string, Array<(event: any, ctx: any) => any>>();
		const pi = {
			on: (evt: string, h: (event: any, ctx: any) => any) =>
				handlers.set(evt, [...(handlers.get(evt) ?? []), h]),
		};
		createTrajectoryDetector().activate(pi as any);
		const ctx = { model: { id: "deepseek-v4-pro" }, ui: { notify } };

		const anchored = () =>
			assistantMessage([
				{ type: "thinking", thinking: "We should check the module." },
				{ type: "text", text: "Let's fix it." },
			]);
		for (let i = 0; i < 5; i++) {
			await handlers.get("message_end")![0](
				{ type: "message_end", message: anchored() },
				ctx,
			);
		}
		expect(notify).not.toHaveBeenCalled();
		expect(handlers.get("message_end")![0]).toBeDefined();
	});

	it("ignores assistant messages from other models", async () => {
		const notify = vi.fn();
		const handlers = new Map<string, Array<(event: any, ctx: any) => any>>();
		const pi = {
			on: (evt: string, h: (event: any, ctx: any) => any) =>
				handlers.set(evt, [...(handlers.get(evt) ?? []), h]),
		};
		const detector = createTrajectoryDetector();
		detector.activate(pi as any);
		await handlers.get("message_end")![0](
			{
				type: "message_end",
				message: assistantMessage([{ type: "text", text: "let me, let me" }]),
			},
			{ model: { id: "gpt-5.4" }, ui: { notify } },
		);

		expect(detector.tracker.stats().assistantMessages).toBe(0);
		expect(notify).not.toHaveBeenCalled();
	});
});
