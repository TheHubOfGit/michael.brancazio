# Cloudflare Pages + Worker Deployment Guide

This guide shows you how to securely deploy your portfolio with the Gemini API key protected using Cloudflare Workers.

## 🚀 Quick Deployment

### Step 1: Install Cloudflare CLI
```bash
npm install -g wrangler
```

### Step 2: Authenticate with Cloudflare
```bash
wrangler auth login
```

### Step 3: Deploy the Worker
```bash
# Set your Gemini API key as a secret
wrangler secret put GEMINI_API_KEY

# Deploy the worker
wrangler deploy
```

### Step 4: Update the Worker URL in your frontend
After deployment, Cloudflare will give you a worker URL like:
`https://portfolio-chatbot-worker.your-subdomain.workers.dev`

Update the `CHATBOT_WORKER_URL` in `main.html`:
```javascript
const CHATBOT_WORKER_URL = 'https://portfolio-chatbot-worker.your-subdomain.workers.dev';
```

### Step 5: Deploy to Cloudflare Pages
```bash
# If using wrangler for Pages
wrangler pages deploy . --compatibility-date 2024-01-01

# Or use the Cloudflare dashboard to connect your GitHub repo
```

## 🔧 Configuration Details

### Worker Files
- `worker.js` - The Cloudflare Worker that securely handles Gemini API calls
- `wrangler.toml` - Worker configuration

### Environment Variables
The worker uses the following secret:
- `GEMINI_API_KEY` - Your Gemini API key (set via `wrangler secret put GEMINI_API_KEY`)

### CORS Configuration
The worker allows requests from any origin (`*`). For production, you should restrict this to your domain:
```javascript
'Access-Control-Allow-Origin': 'https://yourdomain.com'
```

## 🛡️ Security Benefits

1. **API Key Protection**: The Gemini API key is never exposed in your frontend code
2. **Server-side Processing**: All API calls go through your Cloudflare Worker
3. **Rate Limiting**: You can add rate limiting in the worker if needed
4. **Request Validation**: The worker can validate and sanitize requests

## 🐛 Troubleshooting

### Worker Deployment Issues
```bash
# Check worker status
wrangler tail

# List your workers
wrangler list
```

### Frontend Issues
- Check browser console for CORS errors
- Verify the worker URL is correct in `main.html`
- Ensure the worker is deployed and accessible

### API Issues
- Verify your Gemini API key is set correctly: `wrangler secret list`
- Check worker logs: `wrangler tail`

## 📝 File Changes Made

### Removed from `main.html`:
- Hardcoded `GEMINI_API_KEY`
- Direct Gemini API URL construction

### Added to `main.html`:
- `CHATBOT_WORKER_URL` constant
- Updated `testConnection()` to use the worker
- Updated `callGeminiAPI()` to use the worker

### New Files:
- `worker.js` - Cloudflare Worker for secure API calls
- `wrangler.toml` - Worker configuration
- `CLOUDFLARE_DEPLOYMENT.md` - This deployment guide

## 🔄 Migration Notes

Your existing chatbot functionality will work exactly the same, but now securely through the Cloudflare Worker. Users won't notice any difference in functionality, but your API key is now protected.
