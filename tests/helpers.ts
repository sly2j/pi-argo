import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

export const ROOT = resolve(import.meta.dirname, "..");
export const hasPi = spawnSync("pi", ["--version"]).status === 0;

/** A fresh, empty pi profile (agent dir) with this package installed; env never contains ARGO_USER unless given. */
export function freshProfile(extraEnv: Record<string, string> = {}) {
	const dir = mkdtempSync(join(tmpdir(), "sup-argoprofile-"));
	const env: Record<string, string | undefined> = { ...process.env, PI_CODING_AGENT_DIR: dir, ...extraEnv };
	if (!("ARGO_USER" in extraEnv)) delete env.ARGO_USER;
	const install = spawnSync("pi", ["install", ROOT], { env, encoding: "utf8" });
	return {
		dir,
		env,
		install,
		pi: (args: string[], timeout = 180_000) => spawnSync("pi", args, { env, encoding: "utf8", timeout, cwd: dir }),
		done: () => rmSync(dir, { recursive: true, force: true }),
	};
}
