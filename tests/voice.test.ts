import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../assets/js/chatbot.js', import.meta.url), 'utf8');
const classSource = source.slice(source.indexOf('class MichaelsChatbot'), source.indexOf('// Initialize chatbot when DOM is ready'));
const workletSource = source.slice(source.indexOf('const audioWorkletCode'), source.indexOf('// Integrated Chatbot functionality'));

function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
}

function element() {
    const classes = new Set<string>();
    const attributes: Record<string, string> = {};
    return {
        classList: { add: (name: string) => classes.add(name), remove: (name: string) => classes.delete(name), contains: (name: string) => classes.has(name) },
        setAttribute: (name: string, value: string) => { attributes[name] = value; }, attributes,
        style: {} as Record<string, string>, querySelector: () => ({ offsetWidth: 320 })
    };
}

function audioNode() {
    return {
        connections: [] as unknown[], disconnects: 0, stops: 0, starts: 0, onended: null as null | (() => void), buffer: null as any,
        connect(destination: unknown) { this.connections.push(destination); }, disconnect() { this.disconnects++; },
        start() { this.starts++; }, stop() { this.stops++; }
    };
}

function microphone() {
    const track = { stops: 0, onended: null as null | (() => void), stop() { this.stops++; } };
    return { track, getTracks: () => [track] };
}

function runtime(options: { loadModule?: () => Promise<unknown>; getUserMedia?: () => Promise<ReturnType<typeof microphone>>; sampleRate?: number } = {}) {
    const contexts: any[] = [], sockets: any[] = [], worklets: any[] = [], streams: ReturnType<typeof microphone>[] = [];
    const events: string[] = [], revoked: string[] = [], timers = new Map<number, () => void>();
    const listeners = new Map<string, () => void>();
    let nextTimer = 0;
    class AudioContext {
        sampleRate = options.sampleRate || 48000;
        destination = {};
        state = 'running';
        closeCalls = 0;
        buffers: any[] = [];
        sources: any[] = [];
        recordingSources: any[] = [];
        audioWorklet = { addModule: () => { events.push('module'); return options.loadModule?.() || Promise.resolve(); } };
        constructor() { contexts.push(this); }
        resume() { events.push('resume'); return Promise.resolve(); }
        close() { this.state = 'closed'; this.closeCalls++; return Promise.resolve(); }
        createMediaStreamSource() { const node = audioNode(); this.recordingSources.push(node); return node; }
        createBufferSource() { const node = audioNode(); this.sources.push(node); return node; }
        createBuffer(channels: number, length: number, sampleRate: number) {
            assert.ok(length > 0, 'Web Audio rejects empty buffers');
            const data = new Float32Array(length);
            const buffer = { channels, sampleRate, getChannelData: () => data };
            this.buffers.push(buffer);
            return buffer;
        }
    }
    class AudioWorkletNode {
        port = { onmessage: null as null | ((event: { data: Float32Array }) => void) };
        disconnects = 0;
        constructor() { worklets.push(this); }
        connect() {}
        disconnect() { this.disconnects++; }
    }
    class WebSocket {
        static OPEN = 1;
        readyState = 0;
        bufferedAmount = 0;
        closeCalls = 0;
        sent: any[] = [];
        onopen: null | (() => void) = null;
        onmessage: null | ((event: { data: unknown }) => Promise<void>) = null;
        onclose: null | ((event: { code: number }) => void) = null;
        onerror: null | (() => void) = null;
        failSend = false;
        constructor(public url: URL) { sockets.push(this); }
        send(data: string) { if (this.failSend) throw new Error('Transport closed'); this.sent.push(JSON.parse(data)); }
        close() { this.readyState = 3; this.closeCalls++; }
        open() { this.readyState = 1; this.onopen?.(); }
        message(data: unknown) { return this.onmessage?.({ data: typeof data === 'string' || data instanceof Blob ? data : JSON.stringify(data) }); }
    }
    class ObjectURL extends URL {
        static createObjectURL() { return 'blob:mock-worklet'; }
        static revokeObjectURL(url: string) { revoked.push(url); }
    }
    const window = { AudioContext, AudioWorkletNode, innerWidth: 1200, innerHeight: 900, addEventListener: (name: string, callback: () => void) => listeners.set(name, callback) };
    const context = vm.createContext({
        window, AudioWorkletNode, WebSocket, URL: ObjectURL, Blob, console, atob, btoa,
        navigator: { mediaDevices: { getUserMedia: () => {
            events.push('permission');
            if (options.getUserMedia) return options.getUserMedia();
            const stream = microphone(); streams.push(stream); return Promise.resolve(stream);
        } } },
        document: { querySelector: () => ({ getBoundingClientRect: () => ({ left: 50, width: 500, bottom: 700 }) }) },
        setTimeout: (callback: () => void) => { const id = ++nextTimer; timers.set(id, callback); return id; },
        clearTimeout: (id: number) => timers.delete(id), extractPageContext: () => 'Michael portfolio', CHATBOT_WORKER_URL: 'https://worker.example/api/chat'
    });
    vm.runInContext(`${workletSource}\n${classSource}\nglobalThis.Chatbot = MichaelsChatbot;`, context);
    const bot = Object.create(context.Chatbot.prototype);
    Object.assign(bot, {
        isVoiceActive: false, voiceGeneration: 0, audioContext: null, mediaStream: null, audioWorkletNode: null,
        recordingSource: null, currentSource: null, audioQueue: [], isPlaying: false, voiceStartTime: null,
        voiceBtn: element(), mobileVoiceBtn: element(), mobileModal: element(), container: element(), isMobile: false,
        displayResponse(text: string) { this.lastResponse = text; }, displayMobileResponse(text: string) { this.lastMobileResponse = text; },
        showPopup() {}, hideMobileModal() { this.modalClosed = true; }
    });
    return { bot, context, contexts, sockets, worklets, streams, events, revoked, timers, listeners, window };
}

async function connect(env: ReturnType<typeof runtime>) {
    await env.bot.startVoice();
    const socket = env.sockets.at(-1);
    socket.open();
    await socket.message({ setupComplete: {} });
    return socket;
}

const flush = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };

test('Voice unlocks audio on the initial gesture and waits for setup before capturing', async () => {
    const env = runtime();
    const starting = env.bot.startVoice();
    assert.deepEqual(env.events, ['resume', 'module']);
    await starting;
    assert.equal(env.worklets.length, 0);
    assert.equal(env.bot.voiceBtn.attributes['aria-pressed'], 'true');
    assert.deepEqual(env.revoked, ['blob:mock-worklet']);
    const socket = env.sockets[0];
    assert.equal(socket.url.href, 'wss://worker.example/api/live');
    socket.open();
    assert.deepEqual(socket.sent[0].setup.generationConfig.responseModalities, ['AUDIO']);
    await socket.message({ setupComplete: {} });
    await socket.message({ setupComplete: {} });
    assert.equal(env.worklets.length, 1);
    assert.equal(env.timers.size, 0);
    env.bot.stopVoice();
});

test('Stopping during worklet loading avoids asking for microphone permission', async () => {
    const module = deferred<void>();
    const env = runtime({ loadModule: () => module.promise });
    const starting = env.bot.startVoice();
    env.bot.stopVoice();
    module.resolve();
    await starting;
    assert.equal(env.events.includes('permission'), false);
    assert.equal(env.contexts[0].closeCalls, 1);
    assert.equal(env.sockets.length, 0);
    assert.equal(env.revoked.length, 1);
});

test('Late microphone permission from a stopped session cannot replace a restarted session', async () => {
    const permission = deferred<ReturnType<typeof microphone>>();
    const oldStream = microphone(), newStream = microphone();
    let calls = 0;
    const env = runtime({ getUserMedia: () => ++calls === 1 ? permission.promise : Promise.resolve(newStream) });
    const firstStart = env.bot.startVoice();
    await flush();
    assert.equal(calls, 1);
    env.bot.stopVoice();
    await env.bot.startVoice();
    const newContext = env.bot.audioContext;
    permission.resolve(oldStream);
    await firstStart;
    assert.equal(oldStream.track.stops, 1);
    assert.equal(newStream.track.stops, 0);
    assert.equal(env.bot.mediaStream, newStream);
    assert.equal(env.bot.audioContext, newContext);
    assert.equal(env.sockets.length, 1);
    env.bot.stopVoice();
});

test('Duplicate starts preserve a single context, stream, and connection', async () => {
    const env = runtime();
    await Promise.all([env.bot.startVoice(), env.bot.startVoice()]);
    assert.equal(env.contexts.length, 1);
    assert.equal(env.streams.length, 1);
    assert.equal(env.sockets.length, 1);
    env.bot.stopVoice();
});

test('Permission denial and connection timeout release resources and reset both controls', async () => {
    const denied = runtime({ getUserMedia: async () => { throw Object.assign(new Error('Denied'), { name: 'NotAllowedError' }); } });
    await denied.bot.startVoice();
    assert.match(denied.bot.lastResponse, /Microphone access was not granted/);
    assert.equal(denied.contexts[0].closeCalls, 1);
    assert.equal(denied.bot.mobileVoiceBtn.attributes['aria-pressed'], 'false');
    const env = runtime();
    await env.bot.startVoice();
    [...env.timers.values()][0]();
    assert.match(env.bot.lastResponse, /took too long/);
    assert.equal(env.bot.isVoiceActive, false);
    assert.equal(env.streams[0].track.stops, 1);
    assert.equal(env.sockets[0].closeCalls, 1);
    assert.equal(env.timers.size, 0);
});

test('Microphone chunks declare the actual device rate and use clipped little-endian PCM', async () => {
    const env = runtime({ sampleRate: 44100 });
    const socket = await connect(env);
    env.worklets[0].port.onmessage({ data: new Float32Array([-2, -0.5, 0, 0.5, 2]) });
    const audio = socket.sent.at(-1).realtimeInput.audio;
    assert.equal(audio.mimeType, 'audio/pcm;rate=44100');
    assert.deepEqual([...Buffer.from(audio.data, 'base64')], [0, 128, 0, 192, 0, 0, 255, 63, 255, 127]);
    const count = socket.sent.length;
    socket.bufferedAmount = 262144;
    env.worklets[0].port.onmessage({ data: new Float32Array([1]) });
    assert.equal(socket.sent.length, count, 'congested sockets do not accumulate microphone data');
    env.bot.stopVoice();
});

test('Stopping releases all audio resources and stale callbacks cannot affect a new session', async () => {
    const env = runtime();
    const oldSocket = await connect(env);
    const oldWorklet = env.worklets[0];
    const oldCapture = oldWorklet.port.onmessage;
    const oldClose = oldSocket.onclose;
    env.bot.queueAudio(new Int16Array([1, -2]).buffer);
    const oldPlayback = env.bot.currentSource;
    const oldEnded = oldPlayback.onended;
    env.bot.stopVoice();
    assert.equal(env.streams[0].track.stops, 1);
    assert.equal(env.contexts[0].recordingSources[0].disconnects, 1);
    assert.equal(oldWorklet.disconnects, 1);
    assert.equal(oldWorklet.port.onmessage, null);
    assert.equal(oldPlayback.stops, 1);
    assert.equal(oldPlayback.disconnects, 1);
    assert.equal(env.contexts[0].closeCalls, 1);
    assert.equal(env.bot.voiceBtn.attributes['aria-pressed'], 'false');
    const socket = await connect(env);
    env.bot.queueAudio(new Int16Array([2, -1]).buffer);
    const currentPlayback = env.bot.currentSource;
    const sentCount = socket.sent.length;
    oldCapture({ data: new Float32Array([1]) });
    oldClose({ code: 1006 });
    oldEnded();
    assert.equal(socket.sent.length, sentCount);
    assert.equal(env.bot.isVoiceActive, true);
    assert.equal(env.bot.currentSource, currentPlayback);
    env.bot.stopVoice();
    env.bot.stopVoice();
    assert.equal(env.contexts[1].closeCalls, 1, 'repeated stopping is safe');
});

test('Late blob decoding failures do not terminate a newer voice session', async () => {
    const env = runtime();
    const oldSocket = await connect(env);
    const pending = deferred<string>();
    class DelayedBlob extends Blob { text() { return pending.promise; } }
    const message = oldSocket.message(new DelayedBlob());
    env.bot.stopVoice();
    await connect(env);
    pending.reject(new Error('Blob read failed'));
    await message;
    assert.equal(env.bot.isVoiceActive, true);
    assert.equal(env.streams[1].track.stops, 0);
    env.bot.stopVoice();
});

test('Output PCM stays at 24kHz and only server interruption clears playback', async () => {
    const env = runtime();
    const socket = await connect(env);
    env.bot.queueAudio(new ArrayBuffer(0));
    env.bot.queueAudio(new ArrayBuffer(3));
    assert.equal(env.contexts[0].buffers.length, 0);
    const pcm = Buffer.from([0, 128, 0, 0, 255, 127]).toString('base64');
    await socket.message({ serverContent: { modelTurn: { parts: [{ inlineData: { mimeType: 'audio/pcm;rate=24000', data: pcm } }] } } });
    const audio = env.contexts[0].buffers[0];
    assert.equal(audio.sampleRate, 24000);
    assert.deepEqual([...audio.getChannelData(0)], [-1, 0, 32767 / 32768]);
    const playing = env.bot.currentSource;
    env.worklets[0].port.onmessage({ data: new Float32Array([0.8]) });
    assert.equal(playing.stops, 0, 'echo or noise alone must not cut off the assistant');
    env.bot.queueAudio(new Int16Array([1, 2]).buffer);
    await socket.message({ serverContent: { interrupted: true } });
    assert.equal(playing.stops, 1);
    assert.equal(env.bot.audioQueue.length, 0);
    assert.equal(env.bot.isPlaying, false);
    env.bot.stopVoice();
});

test('Microphone disconnection and socket send failures end the session cleanly', async () => {
    const env = runtime();
    await connect(env);
    env.streams[0].track.onended?.();
    assert.match(env.bot.lastResponse, /Microphone disconnected/);
    assert.equal(env.bot.audioContext, null);
    const socket = await connect(env);
    socket.failSend = true;
    env.worklets[1].port.onmessage({ data: new Float32Array([0]) });
    assert.match(env.bot.lastResponse, /Voice connection interrupted/);
    assert.equal(env.streams[1].track.stops, 1);
    assert.equal(env.bot.isVoiceActive, false);
});

test('Crossing desktop and mobile modes stops hidden microphone sessions and repositions the chat', async () => {
    const env = runtime();
    env.window.innerWidth = 500;
    env.bot.isMobile = true;
    env.bot.setupResponsivePositioning();
    await connect(env);
    env.window.innerWidth = 1200;
    env.listeners.get('resize')?.();
    assert.equal(env.bot.isMobile, false);
    assert.equal(env.bot.modalClosed, true);
    assert.equal(env.bot.container.style.left, '140px');
    assert.equal(env.bot.isVoiceActive, false);
    await connect(env);
    env.window.innerWidth = 500;
    env.listeners.get('resize')?.();
    assert.equal(env.bot.isMobile, true);
    assert.equal(env.bot.isVoiceActive, false);
    assert.equal(env.streams[1].track.stops, 1);
});

test('Worklet delivers bounded 100ms chunks without feeding microphone audio to speakers', () => {
    let Processor: any;
    const chunks: Float32Array[] = [];
    const context = vm.createContext({
        sampleRate: 48000,
        AudioWorkletProcessor: class { port = { postMessage: (chunk: Float32Array) => chunks.push(chunk) }; },
        registerProcessor: (_name: string, processor: any) => { Processor = processor; }
    });
    vm.runInContext(`${workletSource}\neval(audioWorkletCode);`, context);
    const processor = new Processor();
    const output = new Float32Array(128);
    const input = new Float32Array(128).fill(0.25);
    for (let i = 0; i < 75; i++) assert.equal(processor.process([[input]], [[output]], {}), true);
    assert.equal(chunks.length, 2);
    assert.equal(chunks[0].length, 4800);
    assert.ok(chunks.every(chunk => chunk.every(sample => sample === 0.25)));
    assert.ok(output.every(sample => sample === 0));
});
