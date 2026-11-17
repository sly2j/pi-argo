import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
	baseUrl,
	cachedModels,
	cachePath,
	configPath,
	fetchModels,
	findBuiltin,
	loadModels,
	resolveUser,
	saveUser,
	toModelConfig,
} from "../extensions/argo-core.ts";

const tmp = () => {
	const d = mkdtempSync(join(tmpdir(), "sup-argotest-"));
	return { d, done: () => rmSync(d, { recursive: true, force: true }) };
};

const catalogs: Record<string, any[]> = {
	anthropic: [
		{
			id: "claude-opus-5-5",
			input: ["text", "image"],
			reasoning: true,
			contextWindow: 1000000,
			maxTokens: 64000,
			thinkingLevelMap: { high: "high" },
			compat: { forceAdaptiveThinking: true, supportsTemperature: false },
		},
	],
	openai: [
		{ id: "gpt-5.4-mini", input: ["text", "image"], reasoning: true, contextWindow: 400000, maxTokens: 128000 },
		{ id: "o3", input: ["text"], reasoning: true, contextWindow: 200000, maxTokens: 100000 },
	],
	google: [{ id: "gemini-3.5-flash", input: ["text", "image"], reasoning: true, contextWindow: 1048576, maxTokens: 65536 }],
};
const catalog = (p: string) => catalogs[p] ?? [];
const BASE = "https://gw.example/argoapi";
const claude = { id: "Claude Opus 5.5", owned_by: "anthropic", internal_id: "claudeopus55" };
const gpt = { id: "GPT-5.4 mini", owned_by: "openai", internal_id: "gpt54mini" };
const gemini = { id: "Gemini 3.5 Flash", owned_by: "google", internal_id: "gemini35flash" };

test("catalog mapping: internal ids resolve to built-in entries", () => {
	assert.equal(findBuiltin(claude, catalog)?.id, "claude-opus-5-5");
	assert.equal(findBuiltin(gpt, catalog)?.id, "gpt-5.4-mini");
	assert.equal(findBuiltin(gemini, catalog)?.id, "gemini-3.5-flash");
	assert.equal(findBuiltin({ id: "GPT o3", owned_by: "openai", internal_id: "gpto3" }, catalog)?.id, "o3");
	assert.equal(findBuiltin({ id: "X", owned_by: "openai", internal_id: "nomatch" }, catalog), undefined);
});

test("catalog mapping: metadata is copied, defaults apply without a match, a throwing catalog is tolerated", () => {
	const c = toModelConfig(claude, BASE, catalog);
	assert.equal(c.contextWindow, 1000000);
	assert.equal(c.maxTokens, 64000);
	assert.deepEqual((c as any).thinkingLevelMap, { high: "high" });
	const d = toModelConfig({ id: "New", owned_by: "openai", internal_id: "newmodel" }, BASE, () => {
		throw new Error("no catalog");
	});
	assert.equal(d.contextWindow, 128000);
	assert.equal(d.maxTokens, 16384);
	assert.equal(d.reasoning, true);
	assert.deepEqual(d.input, ["text", "image"]);
});

test("protocol: Claude uses anthropic-messages at the gateway root, strict tools off", () => {
	const c: any = toModelConfig(claude, BASE, catalog);
	assert.equal(c.id, "claudeopus55");
	assert.equal(c.name, "Claude Opus 5.5 (Argo)");
	assert.equal(c.api, "anthropic-messages");
	assert.equal(c.baseUrl, BASE);
	assert.equal(c.compat.supportsStrictTools, false);
	assert.equal(c.compat.forceAdaptiveThinking, true);
	assert.equal(c.compat.supportsTemperature, false);
});

test("protocol: GPT uses openai-completions at /v1 with max_completion_tokens", () => {
	const c: any = toModelConfig(gpt, BASE, catalog);
	assert.equal(c.api, "openai-completions");
	assert.equal(c.baseUrl, `${BASE}/v1`);
	assert.equal(c.compat.maxTokensField, "max_completion_tokens");
	assert.equal(c.compat.supportsReasoningEffort, true);
});

test("protocol: Gemini uses openai-completions at /v1 with max_tokens", () => {
	const c: any = toModelConfig(gemini, BASE, catalog);
	assert.equal(c.api, "openai-completions");
	assert.equal(c.baseUrl, `${BASE}/v1`);
	assert.equal(c.compat.maxTokensField, "max_tokens");
});

const reply = (data: unknown[], status = 200) => (async () => new Response(JSON.stringify({ data }), { status })) as typeof fetch;

test("listing: embeddings and id-less entries dropped, bearer header sent, cache written", async () => {
	const t = tmp();
	let seen: any;
	const fetchFn = (async (url: string, init: any) => {
		seen = { url, init };
		return new Response(JSON.stringify({ data: [claude, { id: "Text Embedding 3", owned_by: "openai", internal_id: "te3" }, { id: "x", owned_by: "openai" }, gpt] }));
	}) as any;
	const cacheFile = cachePath(t.d);
	const models = await fetchModels({ base: BASE, user: "alice", cacheFile, fetchFn });
	assert.deepEqual(models.map((m) => m.internal_id), ["claudeopus55", "gpt54mini"]);
	assert.equal(seen.url, `${BASE}/v1/models`);
	assert.equal(seen.init.headers.Authorization, "Bearer alice");
	assert.deepEqual(cachedModels(cacheFile).map((m) => m.internal_id), ["claudeopus55", "gpt54mini"]);
	t.done();
});

test("cache fallback: unreachable gateway and HTTP errors use the cache; no cache gives an empty list", async () => {
	const t = tmp();
	const cacheFile = cachePath(t.d);
	const down = (async () => {
		throw new TypeError("fetch failed");
	}) as typeof fetch;
	assert.deepEqual(await loadModels({ base: BASE, user: "a", cacheFile, fetchFn: down }), []);
	await loadModels({ base: BASE, user: "a", cacheFile, fetchFn: reply([gemini]) });
	assert.deepEqual((await loadModels({ base: BASE, user: "a", cacheFile, fetchFn: down })).map((m) => m.internal_id), ["gemini35flash"]);
	assert.deepEqual((await loadModels({ base: BASE, user: "a", cacheFile, fetchFn: reply([], 401) })).map((m) => m.internal_id), ["gemini35flash"]);
	writeFileSync(cacheFile, "not json");
	assert.deepEqual(cachedModels(cacheFile), []);
	t.done();
});

test("cache lives inside the given profile directory", () => {
	assert.equal(cachePath("/p/profile"), "/p/profile/cache/argo-models.json");
	assert.equal(configPath("/p/profile"), "/p/profile/argo.json");
});

test("username: missing everywhere gives undefined, never a default", () => {
	const t = tmp();
	assert.equal(resolveUser(t.d, {}), undefined);
	assert.equal(resolveUser(t.d, { ARGO_USER: "  " }), undefined);
	writeFileSync(configPath(t.d), "{ broken");
	assert.equal(resolveUser(t.d, {}), undefined);
	writeFileSync(configPath(t.d), JSON.stringify({ user: "" }));
	assert.equal(resolveUser(t.d, {}), undefined);
	t.done();
});

test("username: saved config is read back, private, and overridden by ARGO_USER", () => {
	const t = tmp();
	saveUser(t.d, "alice");
	assert.equal(resolveUser(t.d, {}), "alice");
	assert.equal(resolveUser(t.d, { ARGO_USER: "bob" }), "bob");
	assert.equal(statSync(configPath(t.d)).mode & 0o777, 0o600);
	assert.equal(JSON.parse(readFileSync(configPath(t.d), "utf8")).user, "alice");
	t.done();
});

test("base url: default, override, trailing slashes trimmed", () => {
	assert.equal(baseUrl({}), "https://apps.inside.anl.gov/argoapi");
	assert.equal(baseUrl({ ARGO_BASE_URL: "http://localhost:1/x//" }), "http://localhost:1/x");
});
