/** Live smoke test: needs ARGO_USER in the environment and a reachable gateway, else it skips. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { baseUrl } from "../extensions/argo-core.ts";
import { freshProfile, hasPi } from "./helpers.ts";

const user = process.env.ARGO_USER?.trim();
const base = baseUrl(process.env);

async function reachable() {
	if (!user || !hasPi) return false;
	try {
		const r = await fetch(`${base}/v1/models`, { headers: { Authorization: `Bearer ${user}` }, signal: AbortSignal.timeout(8000) });
		return r.ok;
	} catch {
		return false;
	}
}

const ok = await reachable();
const skip = ok ? false : "ARGO_USER unset, pi missing, or gateway unreachable";

// Cheap model per family, by name preference; the first listed model of the family otherwise.
const families: [string, RegExp, RegExp][] = [
	["claude", /^argo\/claude/, /haiku/],
	["gpt", /^argo\/gpt/, /mini|nano/],
	["gemini", /^argo\/gemini/, /flash/],
];

test("live: listing and one tool-calling prompt per family", { skip, timeout: 900_000 }, async (t) => {
	const p = freshProfile({ ARGO_USER: user! });
	try {
		assert.equal(p.install.status, 0, p.install.stderr);
		const list = p.pi(["--list-models", "argo"], 60_000);
		assert.equal(list.status, 0, list.stderr);
		const ids = (list.stdout + list.stderr)
			.split("\n")
			.map((l) => l.trim().split(/\s+/))
			.filter((c) => c[0] === "argo")
			.map((c) => `argo/${c[1]}`);
		assert.ok(ids.length > 0, `no argo models listed:\n${list.stdout}${list.stderr}`);
		for (const [name, family, prefer] of families) {
			await t.test(name, () => {
				const pool = ids.filter((i) => family.test(i));
				assert.ok(pool.length > 0, `no ${name} model listed`);
				const model = pool.find((i) => prefer.test(i)) ?? pool[0];
				const r = p.pi(["-p", "--no-session", "--model", `${model}:low`, "Use the bash tool to run 'echo argo-ok', then reply with just its output."]);
				assert.equal(r.status, 0, `${model}: ${r.stderr}`);
				assert.match(r.stdout, /argo-ok/, `${model}: ${r.stdout}${r.stderr}`);
			});
		}
	} finally {
		p.done();
	}
});
