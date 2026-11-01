import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';

const helpers = readFileSync(new URL('../assets/js/portfolio.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('../assets/js/chatbot.js', import.meta.url), 'utf8');
const classSource = html.slice(html.indexOf('class MichaelsChatbot'), html.indexOf('// Initialize chatbot when DOM is ready'));

function runtime(extra = {}) {
    const context = vm.createContext({
        setTimeout, clearTimeout, AbortController, TextEncoder, console,
        gtag() {}, extractPageContext: () => 'portfolio '.repeat(4000),
        CHATBOT_WORKER_URL: 'https://worker.example/api/chat',
        ...extra
    });
    vm.runInContext(helpers, context);
    vm.runInContext(`${classSource}\nglobalThis.Chatbot = MichaelsChatbot;`, context);
    return context;
}

test('Markdown renders lists, aligned tables, and code without interpreting raw HTML', () => {
    const { Portfolio } = runtime();
    const result = Portfolio.renderMarkdown('- first\n- **second**\n\n| Name | Empty |\n| :--- | ---: |\n| SQL | |\n\n```html\n<img src=x onerror=alert(1)>\n**literal**\n```');
    assert.match(result, /<ul class="chat-list"><li>first<\/li><li><strong>second<\/strong><\/li><\/ul>/);
    assert.match(result, /<td>SQL<\/td><td><\/td>/);
    assert.match(result, /&lt;img src=x onerror=alert\(1\)&gt;/);
    assert.match(result, /\*\*literal\*\*/);
    assert.doesNotMatch(result, /<img|<script|<br>\s*<li>/);
});

test('Markdown keeps inline code literal, identifiers intact, and unsafe links as text', () => {
    const { Portfolio } = runtime();
    const result = Portfolio.renderMarkdown('`**literal**` snake_case_id [link](javascript:alert(1)) <script>alert(1)</script>');
    assert.match(result, /<code class="inline-code">\*\*literal\*\*<\/code>/);
    assert.match(result, /snake_case_id/);
    assert.doesNotMatch(result, /<script|<a /);
    assert.equal(Portfolio.renderMarkdown(null), '');
});

test('Blocked browser storage preserves session preferences without crashing', () => {
    const context = runtime();
    Object.defineProperty(context, 'localStorage', { get() { throw new Error('Storage blocked'); } });
    assert.equal(context.Portfolio.storage.get('theme'), null);
    context.Portfolio.storage.set('theme', 'light');
    assert.equal(context.Portfolio.storage.get('theme'), 'light');
});

function chatbot(context: ReturnType<typeof runtime>) {
    const instance = Object.create(context.Chatbot.prototype);
    const input = () => ({ value: '', setCustomValidity() {}, reportValidity() {} });
    Object.assign(instance, {
        input: input(), mobileInput: input(), sendButton: {}, mobileSendButton: {},
        responseContent: { setAttribute() {} }, mobileResponseContent: { setAttribute() {} },
        conversationHistory: [], promptCount: 0, isSending: false, sessionId: 'test',
        showTypingIndicator() {}, hideTypingIndicator() {}, showMobileTypingIndicator() {},
        hideMobileTypingIndicator() {}, showPopup() {}, hideSuggestions() {},
        displayResponse(text: string) { this.lastResponse = text; },
        displayMobileResponse(text: string) { this.lastResponse = text; }
    });
    return instance;
}

test('Desktop and mobile submissions share a single in-flight request', async () => {
    const instance = chatbot(runtime());
    let resolve!: (value: string) => void;
    let calls = 0;
    instance.callGeminiAPI = () => { calls++; return new Promise<string>(done => { resolve = done; }); };
    instance.input.value = 'First question';
    const pending = instance.sendMessage();
    instance.mobileInput.value = 'Second question';
    await instance.sendMobileMessage();
    assert.equal(calls, 1);
    assert.equal(instance.mobileInput.value, 'Second question');
    assert.equal(instance.sendButton.disabled, true);
    resolve('Answer');
    await pending;
    assert.equal(instance.conversationHistory.length, 2);
    assert.equal(instance.sendButton.disabled, false);
    assert.equal(instance.mobileSendButton.disabled, false);
});

test('Failed questions can be retried and failures do not pollute conversation history', async () => {
    const instance = chatbot(runtime());
    instance.callGeminiAPI = async () => { throw new Error('Try again later.'); };
    instance.input.value = 'My question';
    await instance.sendMessage();
    assert.equal(instance.input.value, 'My question');
    assert.equal(instance.conversationHistory.length, 0);
    assert.equal(instance.lastResponse, 'Try again later.');
    instance.callGeminiAPI = async () => { instance.input.value = 'A new draft'; throw new Error('Offline'); };
    await instance.sendMessage();
    assert.equal(instance.input.value, 'A new draft');
});

test('Chat requests cap context and reject empty provider results', async () => {
    let sent: { context: string; message: string } | undefined;
    const instance = chatbot(runtime({ fetch: async (_url: string, options: RequestInit) => {
        sent = JSON.parse(options.body as string);
        return { ok: true, json: async () => ({ response: ' ' }) };
    } }));
    instance.conversationHistory = [{ role: 'assistant', content: 'x'.repeat(50000) }];
    await assert.rejects(instance.callGeminiAPI('Question'), /empty response/);
    assert.ok(sent && sent.context.length < 35000);
    assert.equal(sent.message, 'Question');
});

test('Chat throttling presents the server retry interval', async () => {
    const instance = chatbot(runtime({ fetch: async () => ({ ok: false, status: 429, headers: new Headers({ 'Retry-After': '20' }) }) }));
    await assert.rejects(instance.callGeminiAPI('Question'), /20 seconds/);
});

test('Multilingual chat payloads respect the server byte limit without losing the question', () => {
    const { Portfolio } = runtime();
    const question = '你好'.repeat(2000);
    const history = [
        { role: 'user', content: '早期问题'.repeat(4000) },
        { role: 'assistant', content: '回答'.repeat(8000) }
    ];
    const body = Portfolio.createChatBody({ message: question, sessionId: 'test' }, '資料'.repeat(9000), history);
    assert.ok(new TextEncoder().encode(body).byteLength <= 60000);
    assert.equal(JSON.parse(body).message, question);
    assert.equal(history.length, 2, 'history passed by the caller is not mutated');
});
