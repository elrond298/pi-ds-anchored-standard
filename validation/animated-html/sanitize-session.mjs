#!/usr/bin/env node

import { readFileSync, writeFileSync } from "node:fs";

const [input, output, label] = process.argv.slice(2);
if (!input || !output || !label) {
	console.error("usage: node sanitize-session.mjs <input.jsonl> <output.jsonl> <label>");
	process.exit(2);
}

const entries = readFileSync(input, "utf8")
	.trimEnd()
	.split("\n")
	.map((line) => JSON.parse(line));
const workspace = entries.find((entry) => entry.type === "session")?.cwd;
const firstTimestamp = Date.parse(
	entries.find((entry) => entry.type === "message" && entry.message?.role === "user")?.timestamp ??
		entries[0]?.timestamp,
);
const ids = new Map();
let nextId = 1;

function anonymizeId(value) {
	if (value == null) return value;
	if (!ids.has(value)) ids.set(value, `id-${String(nextId++).padStart(4, "0")}`);
	return ids.get(value);
}

function sanitizeString(value) {
	let result = value;
	if (workspace) result = result.replaceAll(workspace, "$WORKSPACE");
	result = result.replaceAll(/\/home\/[A-Za-z0-9._-]+/g, "$HOME");
	for (const [original, replacement] of ids) result = result.replaceAll(original, replacement);
	return result;
}

function sanitize(value, key = "") {
	if (Array.isArray(value)) {
		if (/Ids$/.test(key)) return value.map(anonymizeId);
		return value.map((item) => sanitize(item));
	}
	if (value && typeof value === "object") {
		const result = {};
		for (const [childKey, childValue] of Object.entries(value)) {
			if (childKey === "timestamp") continue;
			if (childKey === "cwd") {
				result.cwd = "$WORKSPACE";
				continue;
			}
			if (childKey !== "modelId" && (childKey === "id" || /Id$/.test(childKey))) {
				result[childKey] = anonymizeId(childValue);
				continue;
			}
			result[childKey] = sanitize(childValue, childKey);
		}
		return result;
	}
	return typeof value === "string" ? sanitizeString(value) : value;
}

const sanitized = entries.map((entry) => {
	const result = sanitize(entry);
	const timestamp = Date.parse(entry.timestamp ?? entry.message?.timestamp);
	if (Number.isFinite(timestamp) && Number.isFinite(firstTimestamp)) {
		result.elapsedMs = timestamp - firstTimestamp;
	}
	return result;
});

sanitized[0].validationLabel = label;
writeFileSync(output, sanitized.map((entry) => JSON.stringify(entry)).join("\n") + "\n");
