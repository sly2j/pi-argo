/**
 * Argo Gateway API (ANL) provider for pi.
 *
 * Username: ARGO_USER, else {"user": "..."} in <agent dir>/argo.json (set with /argo-user).
 * Gateway:  ARGO_BASE_URL (default https://apps.inside.anl.gov/argoapi).
 * Models are listed live from GET /v1/models and cached in <agent dir>/cache/argo-models.json.
 */
import { getModels } from "@earendil-works/pi-ai/compat";
import { type ExtensionAPI, getAgentDir } from "@earendil-works/pi-coding-agent";
import {
	baseUrl,
	cachePath,
	fetchModels,
	loadModels,
	NO_USER_MESSAGE,
	resolveUser,
	saveUser,
	toModelConfig,
} from "./argo-core.ts";

const catalog = (provider: string) => getModels(provider as any) as any[];

export default async function (pi: ExtensionAPI) {
	const agentDir = getAgentDir();

	pi.registerCommand("argo-user", {
		description: "Set your Argo username (stored in the pi profile), then /reload",
		handler: async (args, ctx) => {
			const user = args.trim();
			if (!user) {
				ctx.ui.notify("Usage: /argo-user <your-argo-username>", "warning");
				return;
			}
			saveUser(agentDir, user);
			ctx.ui.notify("Argo username saved. Run /reload to load the models.", "info");
		},
	});

	const user = resolveUser(agentDir, process.env);
	if (!user) {
		// stderr covers print mode and --list-models; the notice covers the TUI.
		console.error(NO_USER_MESSAGE);
		pi.on("session_start", async (_event, ctx) => {
			if (ctx.hasUI) ctx.ui.notify(NO_USER_MESSAGE, "warning");
		});
		return;
	}

	const base = baseUrl(process.env);
	const opts = { base, user, cacheFile: cachePath(agentDir) };
	const models = await loadModels(opts);

	pi.registerProvider("argo", {
		name: "Argo Gateway API",
		baseUrl: base,
		apiKey: user,
		api: "anthropic-messages",
		models: models.map((m) => toModelConfig(m, base, catalog)) as any,
		async refreshModels(ctx) {
			const fresh = await fetchModels({ ...opts, signal: ctx.signal });
			return fresh.map((m) => toModelConfig(m, base, catalog)) as any;
		},
	});
}
