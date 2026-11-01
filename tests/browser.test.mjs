import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';

const port = process.env.BROWSER_TEST_PORT || '4179';
const origin = `http://127.0.0.1:${port}`;
const preview = spawn(process.execPath, ['scripts/serve-site.mjs'], {
    env: { ...process.env, PORT: port }, stdio: ['ignore', 'pipe', 'pipe']
});
let output = '';
preview.stdout.on('data', data => { output += data; });
preview.stderr.on('data', data => { output += data; });
let browser;

try {
    for (let attempt = 0; attempt < 100; attempt++) {
        if (preview.exitCode !== null) throw new Error(`Preview failed: ${output}`);
        if (output.includes('Portfolio preview:')) break;
        if (attempt === 99) throw new Error(`Preview did not start: ${output}`);
        await delay(50);
    }
    browser = await chromium.launch({
        headless: true,
        ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {})
    });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/googletagmanager.com/**', route => route.fulfill({ body: '' }));
    let calls = 0;
    let releaseFirstResponse;
    const firstResponse = new Promise(resolve => { releaseFirstResponse = resolve; });
    await page.route(url => url.hostname.endsWith('.workers.dev') || url.port === '8787', async route => {
        calls++;
        if (calls === 1) await firstResponse;
        await route.fulfill({ json: { response: '**Test reply**\n- one\n- two' }, headers: { 'Access-Control-Allow-Origin': '*' } });
    });
    await page.goto(`${origin}/index.html?show=lol`);
    await page.keyboard.press('a');
    await page.keyboard.press('Enter');
    await page.waitForURL('**/main.html?show=lol');
    await page.locator('.integrated-chatbot.visible').waitFor();
    assert.equal(calls, 0, 'loading the portfolio must not call the AI service');
    assert.equal(await page.locator('iframe[src]').count(), 0, 'project frames start unloaded');

    await page.locator('#theme-toggle').click();
    assert.equal(await page.evaluate(() => localStorage.getItem('theme')), 'light');
    await page.locator('.filter-keyword[data-keyword="Python"]').click();
    assert.ok(await page.locator('.highlight').count() > 0);
    assert.equal(await page.locator('.filter-keyword[data-keyword="Python"]').getAttribute('aria-pressed'), 'true');
    await page.locator('#clear-filter-btn').click();
    assert.equal(await page.locator('.highlight').count(), 0);

    const project = page.locator('[data-modal-target="flowfield-modal"]');
    await project.click();
    assert.equal(await page.locator('#flowfield-modal').getAttribute('aria-hidden'), 'false');
    assert.equal(await page.locator('#flowfield-modal iframe').getAttribute('src'), 'flowfield-simulation.html');
    assert.equal(await page.locator('#portfolio-content').evaluate(element => element.inert), true);
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#flowfield-modal iframe').getAttribute('src'), 'about:blank');
    assert.equal(await project.evaluate(element => element === document.activeElement), true);
    assert.equal(await page.locator('#portfolio-content').evaluate(element => element.inert), false);

    await page.locator('#chat-input').fill('What does Michael do?');
    await page.locator('#chat-input').press('Enter');
    await page.locator('#chat-input').fill('A draft for later');
    await page.locator('#chat-input').press('Enter');
    releaseFirstResponse();
    await page.locator('#response-content').getByText('Test reply').waitFor();
    assert.equal(calls, 1, 'Enter must not submit another request while one is pending');
    assert.equal(await page.locator('#chat-input').inputValue(), 'A draft for later');
    assert.equal(await page.locator('#response-content li').count(), 2);

    for (const width of [1440, 768, 390, 320]) {
        await page.setViewportSize({ width, height: 900 });
        await page.evaluate(() => window.scrollTo(0, 0));
        for (const theme of ['light', 'dark']) {
            await page.evaluate(theme => document.body.classList.toggle('dark-mode', theme === 'dark'), theme);
            assert.equal(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth), 0, `${width}px overflow`);
            const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
            assert.deepEqual(violations.map(({ id, nodes }) => ({ id, targets: nodes.map(node => node.target) })), [], `${width}px ${theme} accessibility`);
        }
        console.log(`PASS layout and accessibility: ${width}px, both themes`);
    }
    await page.locator('#chatbot-fab').click();
    await page.locator('#chatbot-input').fill('Mobile question');
    await page.locator('#chatbot-send').click();
    await page.locator('#mobile-response-content').getByText('Test reply').waitFor();
    assert.equal(calls, 2);
    const { violations } = await new AxeBuilder({ page }).include('#mobile-chatbot-modal').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
    assert.deepEqual(violations.map(({ id }) => id), []);
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#chatbot-fab').evaluate(element => element === document.activeElement), true);
    assert.deepEqual(errors, [], 'no uncaught page errors');

    await mkdir('test-results/browser', { recursive: true });
    await page.screenshot({ path: 'test-results/browser/mobile.png' });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.screenshot({ path: 'test-results/browser/desktop.png' });
    await page.emulateMedia({ media: 'print' });
    assert.equal(await page.locator('.card-scrollable-content').evaluateAll(elements => elements.filter(element =>
        element.scrollHeight > element.clientHeight + 2 && getComputedStyle(element).overflowY !== 'visible'
    ).length), 0, 'print layout must expose all card content');
    await page.pdf({ path: 'test-results/browser/portfolio.pdf', format: 'A4', printBackground: true });
    await context.close();

    // The intro remains a working link when scripts or browser storage are unavailable.
    const noScript = await browser.newContext({ javaScriptEnabled: false });
    const basicPage = await noScript.newPage();
    await basicPage.goto(`${origin}/index.html`);
    await basicPage.getByRole('link', { name: 'Explore portfolio' }).click();
    await basicPage.waitForURL('**/main.html');
    assert.equal(await basicPage.locator('h1').textContent(), 'Michael Brancazio');
    await noScript.close();
    console.log('PASS intro, theme, filters, lazy frames, modal focus, chat concurrency, Markdown, mobile chat, and no-JavaScript entry');
} finally {
    await browser?.close();
    preview.kill();
}
