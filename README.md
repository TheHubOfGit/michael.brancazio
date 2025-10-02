# Portfolio Website - Deployment Instructions

This website is hosted using GitHub Pages from the `main` branch of the `TheHubOfGit/michael.brancazio` repository.

## Configuration Setup

The portfolio site includes an AI-powered chatbot that requires a Gemini API key to function.

### Setting up the API Key

1. **Copy the template file:**
   ```bash
   cp config.template.js config.js
   ```

2. **Add your API key:** Open `config.js` and replace `YOUR_GEMINI_API_KEY_HERE` with your actual Gemini API key from [Google AI Studio](https://makersuite.google.com/app/apikey).

3. **Important:** The `config.js` file is excluded from version control via `.gitignore` to keep your API key secure. Never commit this file to the repository.

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