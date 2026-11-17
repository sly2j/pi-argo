# pi-argo

A [pi](https://github.com/earendil-works/pi) package that adds the Argo gateway (ANL) as model provider `argo`. It holds one extension, no build step and no dependencies beyond what pi provides.

- Models are listed live from `GET <gateway>/v1/models` (embedding models dropped).
- Claude models use the native Anthropic Messages API at the gateway root, with strict tools off (the gateway rejects strict tool schemas for Claude models).
- GPT and Gemini models use OpenAI Chat Completions at `<gateway>/v1`, because the gateway's Responses endpoint rejects replayed `status` fields.
- Context window, output limit, thinking levels and compat flags are copied from pi's built-in catalog when a matching model exists (for example `claudeopus55` maps to `claude-opus-5-5`); otherwise 128000 and 16384.

## Install

```sh
pi install /path/to/pi-argo
```

## Set your username

The Argo username is the API key. It is never guessed or defaulted. Without it pi still starts, the provider is disabled and a message says what to do. Either:

- run `/argo-user <your-argo-username>` inside pi, then `/reload`. This writes `argo.json` (mode 0600) into the active pi profile directory (`PI_CODING_AGENT_DIR`, default `~/.pi/agent`); or
- set `ARGO_USER` in the environment, which overrides the file.

`ARGO_BASE_URL` overrides the gateway (default `https://apps.inside.anl.gov/argoapi`).

## Verify

```sh
pi --list-models argo
pi -p --model argo/<model-id>:low "Say hi"
```

## VPN and offline

Every start lists models from the gateway (10 s timeout). The last successful list is cached in `<profile>/cache/argo-models.json`; when the gateway is unreachable (off VPN) pi starts with the cached list. Prompts to Argo still need the VPN. With no cache and no gateway, the provider has no models until a start with access. Use pi's model refresh to re-list while pi runs.

## Use in a pi-supervisor profile

A pi-supervisor profile is a normal pi profile directory. Install into it with that profile's directory selected:

```sh
PI_CODING_AGENT_DIR=<profile dir> pi install /path/to/pi-argo
```

or run `pi install` with the profile's launcher, then set the username as above and reference `argo/<model-id>` in the supervisor's tier config. Username and cache then live in that profile.

## Uninstall

```sh
pi remove /path/to/pi-argo
```

Optionally delete `argo.json` and `cache/argo-models.json` from the profile.

## If you also have a hand-written `argo.ts`

A user extension such as `<profile>/extensions/argo.ts` that also registers provider `argo` is not an error: pi lists a single `argo` provider, not two. Which registration wins was not determined, so remove one of them to avoid surprises.

## Tests

```sh
npm test                      # offline unit tests and an install smoke test (needs pi on PATH)
ARGO_USER=<name> npm run test:live   # lists models and runs one tool-calling prompt per family
```

The live test uses a temporary profile, and skips when `ARGO_USER` is unset or the gateway is unreachable. Node 22.19 or later runs the TypeScript tests directly.
