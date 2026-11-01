# Cloudflare deployment

The static website and chat Worker are separate deployments. `wrangler.jsonc` configures the TypeScript Worker at `src/server/index.ts`, its D1 binding, and observability. The compatibility date is intentionally pinned independently of the Wrangler dependency version.

## Prepare and validate

```bash
npm ci
npm run check
npx wrangler login
npx wrangler whoami
```

The project uses a local Wrangler v4 installation and requires Node.js 22+. The `check` command bundles the Worker with `--dry-run`, without changing your Cloudflare account. `./deploy.sh --dry-run` runs the same checks.

## Configure the API and database

Set the Gemini secret using Wrangler's interactive prompt:

```bash
npx wrangler secret put GEMINI_API_KEY --config wrangler.jsonc
```

The committed configuration references the portfolio's existing `portfolio-chat-db`. For a different Cloudflare account, create a database and replace `database_id` in `wrangler.jsonc` with the returned ID:

```bash
npx wrangler d1 create portfolio-chat-db --config wrangler.jsonc
```

Apply the schema locally first, then explicitly to the intended remote database:

```bash
npm run db:migrate
npm run db:migrate:remote
```

`migrations/0001_create_chat_logs.sql` creates the chat table and indexes if absent. It does not delete or rewrite existing rows. Check an existing database's schema before migrating an installation with a different table definition. D1 migrations are tracked by Wrangler. See [Cloudflare's migration reference](https://developers.cloudflare.com/d1/reference/migrations/).

## Origins and frontend API URL

The Worker accepts the exact browser origins listed in `src/server/config.ts`. To add a deployment or preview domain, set a comma-separated `ALLOWED_ORIGINS` value in the Worker's `vars` object in `wrangler.jsonc`:

```jsonc
"vars": {
  "ALLOWED_ORIGINS": "https://your-site.pages.dev,https://your-custom-domain.example"
}
```

Use origins only: scheme, host, and optional port, without paths or trailing slashes. Preview subdomains under `michaelbrancazio.pages.dev` and `michaelbrancazio-resume.pages.dev` are also accepted. Other Pages projects need an explicit allowed origin. CORS is not authentication, and non-browser requests can still reach the API.

The build preserves `CHATBOT_WORKER_URL` from `main.html` by default. To use another Worker, build with its HTTPS origin:

```bash
CHATBOT_WORKER_URL=https://your-worker.your-subdomain.workers.dev npm run build
```

This changes only the generated `dist/main.html`, leaving source files untouched. Do not put an API key in the frontend URL or any public file.

## Deploy the Worker

```bash
./deploy.sh
```

The script runs checks, displays the authenticated Cloudflare account, and runs `npm run deploy`. It does not rotate secrets, migrate the remote database, edit HTML, or publish the frontend. Wrangler's output shows the deployed Worker URL.

## Publish the website

Build the site and upload **only `dist/`**. This allowlist excludes Worker code, configuration, tests, dependencies, and local secrets:

```bash
npm run build
npx wrangler pages deploy dist --project-name your-existing-pages-project
```

Set `CHATBOT_WORKER_URL` on the build command if you use a different API. Replace the Pages project name with the actual project. For Git-integrated Pages, use build command `npm run build`, build output directory `dist`, and Node.js 24. Set `CHATBOT_WORKER_URL` as a build environment variable when needed. See [Cloudflare Pages direct upload](https://developers.cloudflare.com/pages/get-started/direct-upload/).

For GitHub Pages, configure a Pages deployment workflow to upload `dist/` using the Pages artifact/deployment actions. The included `.github/workflows/ci.yml` only validates changes and deliberately does not publish. Keep relative asset URLs so hosting under a repository subpath works.

## Verify and troubleshoot

Visit the portfolio and test a text message and a voice session. `GET /api/health` on the Worker reports service configuration; it does not make a billable Gemini request or guarantee model availability.

```bash
npx wrangler secret list --config wrangler.jsonc
npm run logs:tail
npm run logs
```

- **CORS error:** confirm the page's exact origin is allowed, then redeploy the Worker.
- **Chat unavailable:** check that `GEMINI_API_KEY` exists and that the models configured in `src/server/config.ts` are available to your Gemini project.
- **D1 table missing:** apply the migrations to the correct local or remote database.
- **Voice unavailable:** use HTTPS or localhost, allow the microphone, and check the browser console for WebSocket/model errors.
- **Changed frontend not visible:** rebuild `dist/` and publish it to the intended site/branch.

The default metadata log query omits conversation text. D1 still stores successful chat content and client IPs; configure suitable access and retention for that data. For shared traffic controls, use a Cloudflare rate limit or WAF rule in addition to the in-process limiter.
