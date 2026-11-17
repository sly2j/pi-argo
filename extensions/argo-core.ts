/** Pure logic for the Argo provider: no pi imports, every dependency injected, so tests run offline. */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export const DEFAULT_BASE_URL = "https://apps.inside.anl.gov/argoapi";
export const ZERO_COST = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

export interface ArgoModel {
	id: string; // display name, e.g. "Claude Opus 5.5"
	owned_by: string; // "anthropic" | "openai" | "google"
	internal_id: string; // e.g. "claudeopus55" (accepted by all endpoints)
}

/** Returns pi's built-in catalog for a provider name; may throw. */
export type CatalogFn = (provider: string) => any[];

export const configPath = (agentDir: string) => join(agentDir, "argo.json");
export const cachePath = (agentDir: string) => join(agentDir, "cache", "argo-models.json");

export function baseUrl(env: Record<string, string | undefined>): string {
	return (env.ARGO_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, "");
}

/** The Argo username: ARGO_USER wins, else `{"user": "..."}` in <agentDir>/argo.json. Never defaulted. */
export function resolveUser(agentDir: string, env: Record<string, string | undefined>): string | undefined {
	const fromEnv = env.ARGO_USER?.trim();
	if (fromEnv) return fromEnv;
	try {
		const u = JSON.parse(readFileSync(configPath(agentDir), "utf8"))?.user;
		return typeof u === "string" && u.trim() ? u.trim() : undefined;
	} catch {
		return undefined;
	}
}

export function saveUser(agentDir: string, user: string): void {
	const file = configPath(agentDir);
	mkdirSync(dirname(file), { recursive: true });
	writeFileSync(file, `${JSON.stringify({ user }, null, 2)}\n`, { mode: 0o600 });
}

export const NO_USER_MESSAGE =
	"Argo: no username configured, so the argo provider is disabled. Run /argo-user <your-argo-username> then /reload, or set ARGO_USER.";

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Find pi's built-in catalog entry for an Argo model (e.g. claudeopus55 -> claude-opus-5-5). */
export function findBuiltin(m: ArgoModel, catalogFn: CatalogFn) {
	const provider = m.owned_by === "anthropic" ? "anthropic" : m.owned_by === "google" ? "google" : "openai";
	let catalog: any[];
	try {
		catalog = catalogFn(provider);
	} catch {
		return undefined;
	}
	const keys = new Set([norm(m.internal_id), norm(m.id), norm(m.internal_id).replace(/^gpto/, "o")]);
	return catalog.find((b) => keys.has(norm(b.id)));
}

export function toModelConfig(m: ArgoModel, base: string, catalogFn: CatalogFn) {
	const b = findBuiltin(m, catalogFn);
	const shared = {
		id: m.internal_id,
		name: `${m.id} (Argo)`,
		input: (b?.input ?? ["text", "image"]) as ("text" | "image")[],
		cost: ZERO_COST,
		reasoning: b?.reasoning ?? true,
		contextWindow: b?.contextWindow ?? 128000,
		maxTokens: b?.maxTokens ?? 16384,
		...(b?.thinkingLevelMap ? { thinkingLevelMap: b.thinkingLevelMap } : {}),
	};
	if (m.owned_by === "anthropic") {
		// Native Anthropic Messages API at the gateway root.
		return {
			...shared,
			api: "anthropic-messages",
			baseUrl: base,
			compat: {
				forceAdaptiveThinking: b?.compat?.forceAdaptiveThinking ?? false,
				supportsTemperature: b?.compat?.supportsTemperature ?? true,
				// The gateway rejects strict tool schemas for Claude models, so strict tools are off.
				supportsStrictTools: false,
			},
		};
	}
	// OpenAI and Google: Chat Completions. Argo's Responses endpoint rejects replayed `status` fields.
	return {
		...shared,
		api: "openai-completions",
		baseUrl: `${base}/v1`,
		compat: {
			supportsReasoningEffort: shared.reasoning,
			maxTokensField: m.owned_by === "openai" ? "max_completion_tokens" : "max_tokens",
		},
	};
}

export interface FetchOpts {
	base: string;
	user: string;
	cacheFile: string;
	fetchFn?: typeof fetch;
	signal?: AbortSignal;
}

/** Live listing (10 s timeout, embeddings dropped); the result is cached for offline starts. */
export async function fetchModels(o: FetchOpts): Promise<ArgoModel[]> {
	const timeout = AbortSignal.timeout(10_000);
	const res = await (o.fetchFn ?? fetch)(`${o.base}/v1/models`, {
		headers: { Authorization: `Bearer ${o.user}` },
		signal: o.signal ? AbortSignal.any([o.signal, timeout]) : timeout,
	});
	if (!res.ok) throw new Error(`Argo /v1/models: HTTP ${res.status}`);
	const body = (await res.json()) as { data?: ArgoModel[] };
	const models = (body.data ?? []).filter((m) => m.internal_id && !/embedding/i.test(m.id));
	try {
		mkdirSync(dirname(o.cacheFile), { recursive: true });
		writeFileSync(o.cacheFile, JSON.stringify(models, null, 2));
	} catch {}
	return models;
}

export function cachedModels(cacheFile: string): ArgoModel[] {
	try {
		const parsed = JSON.parse(readFileSync(cacheFile, "utf8"));
		return Array.isArray(parsed) ? parsed : [];
	} catch {
		return [];
	}
}

/** Live list, falling back to the cache when the gateway is unreachable. */
export async function loadModels(o: FetchOpts): Promise<ArgoModel[]> {
	try {
		return await fetchModels(o);
	} catch {
		return cachedModels(o.cacheFile);
	}
}
