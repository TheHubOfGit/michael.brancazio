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

    // Correct endpoint: v1beta (not v1alpha) and dot notation (not slash)
    const geminiWsUrl = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${GEMINI_API_KEY}`;
    
    let isSetup = false;
    let pendingMessages = [];

    // Create connection to Gemini
    // Note: Cloudflare Durable Objects don't support creating outbound WebSocket clients
    // We need to use fetch with upgrade headers instead
    try {
      // Use fetch to create WebSocket connection
      const upgradeRequest = new Request(geminiWsUrl, {
        headers: {
          'Upgrade': 'websocket',
          'Connection': 'Upgrade',
        }
      });
      
      // Try to upgrade the fetch request to WebSocket
      // This may not work - Durable Objects have limitations with outbound WebSockets
      const response = await fetch(upgradeRequest);
      
      if (response.status === 101 && response.webSocket) {
        // WebSocket upgrade successful
        this.geminiWs = response.webSocket;
        this.geminiWs.accept();
      } else {
        // Fallback: Try using WebSocket constructor (may not work in Durable Objects)
        // This is a limitation - Durable Objects may not support outbound WebSocket clients
        throw new Error('WebSocket upgrade not supported. Durable Objects may not support outbound WebSocket connections.');
      }

      this.geminiWs.addEventListener('open', () => {
        // Send setup message
        const setupMessage = {
          setup: {
            model: 'models/gemini-2.5-flash-native-audio-preview-09-2025',
            generationConfig: {
              responseModalities: ['AUDIO']
            },
            inputAudioTranscription: {},
            outputAudioTranscription: {}
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

