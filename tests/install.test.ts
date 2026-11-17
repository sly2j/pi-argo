import assert from "node:assert/strict";
import { test } from "node:test";
import { freshProfile, hasPi } from "./helpers.ts";

test("install into a fresh profile; without a username pi still starts and explains how to set it", { skip: !hasPi && "pi not on PATH" }, () => {
	const p = freshProfile();
	try {
		assert.equal(p.install.status, 0, p.install.stderr);
		const r = p.pi(["--list-models", "argo"], 60_000);
		assert.equal(r.status, 0, r.stderr);
		assert.match(r.stderr + r.stdout, /no username configured/);
		assert.match(r.stderr + r.stdout, /\/argo-user/);
		assert.match(r.stderr + r.stdout, /ARGO_USER/);
	} finally {
		p.done();
	}
});
