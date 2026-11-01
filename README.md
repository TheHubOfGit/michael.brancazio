# Michael Brancazio portfolio

A static portfolio with interactive simulations, a print layout, and a Gemini chat/voice assistant backed by a Cloudflare Worker. The frontend and Worker are deployed separately.

## Local development

Use Node.js 22 or newer; `.nvmrc` selects Node.js 24. Dependencies, including Wrangler, are installed locally:

```bash
nvm use # optional, if you use nvm
npm ci
cp .dev.vars.example .dev.vars
```

Edit `.dev.vars` with a Gemini API key, then initialize the **local** D1 database and start the API:

```bash
npm run db:migrate
npm run dev
```

In another terminal, build and serve the frontend with the local API:

```bash
CHATBOT_WORKER_URL=http://localhost:8787 npm run dev:site
```

Open `http://127.0.0.1:8080`. `dev:site` serves only `dist/`, on the loopback interface. Run `npm run build` again after editing static files; include the same `CHATBOT_WORKER_URL` override to keep using the local API. Without an override, the build keeps the production endpoint declared in `main.html`. Voice requires a secure browser context (HTTPS or localhost) and microphone permission. A Gemini key is required for chat and voice; the portfolio itself works without one.

## Validation

```bash
npm run check
```

This runs TypeScript checks, backend/frontend regression tests, HTML asset and anchor checks, JavaScript syntax validation, the static build, and a Worker deployment dry run. It does not deploy or call Gemini. GitHub Actions runs these checks, applies the schema to a local D1 database, and audits dependencies on pushes and pull requests.

| Command | Purpose |
| --- | --- |
| `npm run build` | Copy only approved public pages/assets into `dist/` |
| `npm run dev:site` | Build and preview the static site at port 8080 |
| `npm run dev` | Run the Worker locally at port 8787 |
| `npm test` | Run backend and frontend regression tests |
| `npm run test:browser` | Build and check desktop/mobile flows, both themes, and accessibility in Chromium |
| `npm run check:site` | Check page scripts, duplicate IDs, anchors, and local files |
| `npm run deploy:check` | Bundle and validate the Worker without publishing |
| `npm run db:migrate` | Apply D1 migrations locally |
| `npm run db:migrate:remote` | Apply D1 migrations to the configured remote database |
| `npm run logs` | Read recent remote chat metadata; omits conversation text and IPs |
| `npm run logs:tail` | Stream Worker operational logs |

For browser checks, first install Chromium with `npx playwright install chromium`, then run `npm run test:browser`. To use an existing browser binary instead, set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` to its full path. The smoke test starts its own loopback preview, mocks AI requests, and saves screenshots under `test-results/browser/`. It covers 320, 390, 768, and 1440 pixel widths; it does not contact Gemini or request microphone access. Fonts and the optional physics library still load from their public CDNs.

## Project layout

- `index.html`: portfolio entry page.
- `main.html`, `assets/`: portfolio UI, chatbot, and shared frontend helpers/styles; the **Print portfolio** button uses a dedicated print stylesheet.
- `print.html`: terminal typing demo.
- `3d-ball-simulator.html`, `flowfield-simulation.html`, `nyc-montecarlo.html`, `static_dashboard.html`: interactive demos.
- `src/server/`: Worker routing, validation, Gemini integration, and logging.
- `wrangler.jsonc`: the sole Worker configuration; `worker.js` is a compatibility re-export.
- `migrations/`: versioned D1 schema.
- `scripts/`: public build, static preview, and validation tools.
- `tests/`: regression tests. Generated output belongs in ignored `dist/` or `.wrangler/`.

Add new public pages or top-level asset directories to `scripts/site-files.mjs` so builds include them. Keep API keys in ignored `.dev.vars` for local use and Worker secrets in production. Never publish the repository root as the static website; it contains server code and development configuration.

## Deployment and operations

Follow [the Cloudflare deployment guide](CLOUDFLARE_DEPLOYMENT.md) for Worker secrets, D1 setup, allowed origins, and publishing `dist/` to Pages or GitHub Pages. The included CI workflow validates changes; it does not automatically publish them. The actual hosting connection must be configured in the provider dashboard.

The API's in-memory rate limit is best effort per Worker isolate; it is not a global quota. Enforce shared limits with a Cloudflare rate-limiting binding or WAF rule if needed. CORS controls browser access and does not authenticate API callers.

When D1 is bound, successful text chats store prompts, responses, session identifiers, and client IPs in `chat_logs`; voice audio is not written to that table. Review retention and access controls for this data. `npm run logs` intentionally shows only operational metadata. Removing the D1 binding disables conversation persistence while preserving chat functionality.

See [the Gemini Live guide](GEMINI_LIVE_GUIDE.md) for voice architecture and troubleshooting.
