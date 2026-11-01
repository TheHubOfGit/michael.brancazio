#!/usr/bin/env bash
set -euo pipefail

cd -- "$(dirname -- "${BASH_SOURCE[0]}")"

if [[ ! -x node_modules/.bin/wrangler ]]; then
    printf '%s\n' 'Install project dependencies first: npm ci' >&2
    exit 1
fi

case "${1:-}" in
    --dry-run)
        npm run check
        exit 0
        ;;
    --help|-h)
        printf '%s\n' 'Usage: ./deploy.sh [--dry-run]' \
            'Validates the project, then deploys only the Worker.' \
            'Set GEMINI_API_KEY beforehand with: npx wrangler secret put GEMINI_API_KEY --config wrangler.jsonc' \
            'Publish the separate dist/ frontend using the deployment guide.'
        exit 0
        ;;
    '') ;;
    *)
        printf 'Unknown option: %s\n' "$1" >&2
        exit 2
        ;;
esac

npm run check
node_modules/.bin/wrangler whoami --config wrangler.jsonc
npm run deploy
printf '%s\n' 'Worker deployment finished. Deploy dist/ separately for frontend changes.'
