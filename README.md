# Portfolio Website - Deployment Instructions

This website is hosted using GitHub Pages from the `main` branch of the `TheHubOfGit/portfolio-website` repository.

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

Pushing changes to the `main` branch will automatically trigger a GitHub Actions workflow that rebuilds and deploys the site. The updated site will be live at [https://TheHubOfGit.github.io/portfolio-website/](https://TheHubOfGit.github.io/portfolio-website/) within a few minutes.