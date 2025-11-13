#!/bin/bash

# Cloudflare Pages + Worker Deployment Script
echo "🚀 Starting Cloudflare deployment..."

# Check if wrangler is installed
if ! command -v wrangler &> /dev/null; then
    echo "❌ Wrangler CLI not found. Install it with: npm install -g wrangler"
    exit 1
fi

# Check if user is logged in
echo "🔐 Checking Cloudflare authentication..."
if ! wrangler whoami &> /dev/null; then
    echo "❌ Not logged in to Cloudflare. Run: wrangler auth login"
    exit 1
fi

echo "✅ Authentication confirmed"

# Set the API key secret
echo "🔑 Setting up Gemini API key secret..."
echo "Enter your Gemini API key:"
read -s GEMINI_API_KEY

if [ -z "$GEMINI_API_KEY" ]; then
    echo "❌ No API key provided"
    exit 1
fi

# Set the secret
echo "$GEMINI_API_KEY" | wrangler secret put GEMINI_API_KEY

if [ $? -ne 0 ]; then
    echo "❌ Failed to set API key secret"
    exit 1
fi

echo "✅ API key secret set"

# Deploy the worker
echo "⚙️ Deploying Cloudflare Worker..."
WORKER_URL=$(wrangler deploy 2>&1 | grep -o 'https://.*\.workers\.dev')

if [ $? -ne 0 ]; then
    echo "❌ Worker deployment failed"
    exit 1
fi

echo "✅ Worker deployed at: $WORKER_URL"

# Update the frontend code with the worker URL
echo "🔧 Updating frontend with worker URL..."
sed -i.bak "s|https://portfolio-chatbot-worker\.your-subdomain\.workers\.dev|$WORKER_URL|g" main.html

if [ $? -eq 0 ]; then
    echo "✅ Frontend updated with worker URL"
    echo "📁 Backup created: main.html.bak"
else
    echo "⚠️ Could not automatically update frontend URL"
    echo "Please manually update CHATBOT_WORKER_URL in main.html to: $WORKER_URL"
fi

echo ""
echo "🎉 Deployment completed!"
echo ""
echo "Next steps:"
echo "1. Deploy your site to Cloudflare Pages:"
echo "   wrangler pages deploy ."
echo ""
echo "2. Or connect your GitHub repo to Cloudflare Pages dashboard"
echo ""
echo "3. Your chatbot API key is now secure! 🔒"
