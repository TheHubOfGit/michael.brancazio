# Portfolio Website - Deployment Instructions

This website is hosted using GitHub Pages from the `main` branch of the `TheHubOfGit/michael.brancazio` repository.

## Features

- **Interactive Portfolio**: Modern, responsive design showcasing experience and projects
- **AI Chatbot**: Text-based assistant powered by Gemini API via Cloudflare Workers
- **Voice Interaction**: Native voice chat using Gemini 2.5 Flash with audio preview (NEW!)
- **Dark Mode**: Chain-pull interaction for theme switching
- **Timeline Animation**: Interactive career progression visualization

## How to Update the Live Site

1.  **Make Changes:** Edit the website files (HTML, CSS, JS, images) in the `/Users/michaelbrancazio/Documents/Projects/Portfolio Website` directory locally.
2.  **Stage Changes:** Open a terminal in the project directory and run:
    ```bash
    git add .
    ```
    (Or use `git add <file_path>` for specific files).
3.  **Commit Changes:** Run:
    ```bash
    git commit -m "Describe your changes here"
    ```
4.  **Push Changes:** Run:
    ```bash
    git push
    ```

Pushing changes to the `main` branch will automatically trigger a GitHub Actions workflow that rebuilds and deploys the site. The updated site will be live at [https://TheHubOfGit.github.io/michael.brancazio/](https://TheHubOfGit.github.io/michael.brancazio/) within a few minutes.

## Cloudflare Workers Deployment

This site uses Cloudflare Workers for:
- **Text Chatbot** (`worker.js`) - See `CLOUDFLARE_DEPLOYMENT.md`
- **Voice Interaction** (`voice-worker.js`) - See `VOICE_DEPLOYMENT.md`

For detailed deployment instructions, refer to:
- [CLOUDFLARE_DEPLOYMENT.md](CLOUDFLARE_DEPLOYMENT.md) - Text chatbot worker setup
- [VOICE_DEPLOYMENT.md](VOICE_DEPLOYMENT.md) - Voice interaction worker setup