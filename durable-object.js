/**
 * Durable Object for proxying WebSocket connections to Gemini Live API
 * This handles the bidirectional WebSocket communication
 */

export class GeminiLiveProxy {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.geminiWs = null;
    this.clientWs = null;
  }

  async fetch(request) {
    // Handle WebSocket upgrade
    const upgradeHeader = request.headers.get('Upgrade');
    if (upgradeHeader === 'websocket') {
      return this.handleWebSocket(request);
    }
    return new Response('Expected WebSocket', { status: 400 });
  }

  async handleWebSocket(request) {
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    this.clientWs = server;
    server.accept();

    // Connect to Gemini Live API
    const GEMINI_API_KEY = this.env.GEMINI_API_KEY;
    if (!GEMINI_API_KEY) {
      server.send(JSON.stringify({ error: 'API key not configured' }));
      server.close();
      return new Response(null, { status: 500 });
    }

    const geminiWsUrl = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService/BidiGenerateContent?key=${GEMINI_API_KEY}`;
    
    let isSetup = false;
    let pendingMessages = [];

    // Create connection to Gemini
    try {
      // In Durable Objects, we can use the WebSocket API
      // Note: This might need adjustment based on actual Cloudflare Durable Objects WebSocket support
      // For now, we'll use fetch with upgrade header
      
      // Actually, Durable Objects might need a different approach
      // Let's use the standard WebSocket constructor if available
      this.geminiWs = new WebSocket(geminiWsUrl);

      this.geminiWs.addEventListener('open', () => {
        // Send setup message
        const setupMessage = {
          setup: {
            model: 'gemini-2.5-flash-native-audio-preview-09-2025',
            generation_config: {
              response_modalities: ['AUDIO'],
              input_audio_transcription: {},
              output_audio_transcription: {}
            }
          }
        };
        this.geminiWs.send(JSON.stringify(setupMessage));
        isSetup = true;

        // Send any pending messages
        while (pendingMessages.length > 0) {
          this.geminiWs.send(pendingMessages.shift());
        }
      });

      this.geminiWs.addEventListener('message', (event) => {
        if (this.clientWs && this.clientWs.readyState === WebSocket.READY_STATE_OPEN) {
          this.clientWs.send(event.data);
        }
      });

      this.geminiWs.addEventListener('error', (error) => {
        console.error('Gemini WebSocket error:', error);
        if (this.clientWs && this.clientWs.readyState === WebSocket.READY_STATE_OPEN) {
          this.clientWs.send(JSON.stringify({ error: 'Connection to Gemini failed' }));
        }
      });

      this.geminiWs.addEventListener('close', () => {
        if (this.clientWs && this.clientWs.readyState === WebSocket.READY_STATE_OPEN) {
          this.clientWs.close();
        }
      });

    } catch (error) {
      console.error('Failed to create Gemini connection:', error);
      server.send(JSON.stringify({ error: 'Failed to connect to Gemini' }));
      server.close();
      return new Response(null, { status: 500 });
    }

    // Handle messages from client
    server.addEventListener('message', (event) => {
      if (isSetup && this.geminiWs && this.geminiWs.readyState === WebSocket.READY_STATE_OPEN) {
        this.geminiWs.send(event.data);
      } else {
        // Queue messages until setup is complete
        pendingMessages.push(event.data);
      }
    });

    server.addEventListener('close', () => {
      if (this.geminiWs && this.geminiWs.readyState === WebSocket.READY_STATE_OPEN) {
        this.geminiWs.close();
      }
    });

    server.addEventListener('error', (error) => {
      console.error('Client WebSocket error:', error);
      if (this.geminiWs && this.geminiWs.readyState === WebSocket.READY_STATE_OPEN) {
        this.geminiWs.close();
      }
    });

    return new Response(null, {
      status: 101,
      webSocket: client,
    });
  }
}

