/**
 * Cloudflare Worker for Gemini Live API with native audio support
 * Handles WebSocket connections for bidirectional audio streaming
 */

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    
    // CORS headers
    const allowedOrigins = [
      'https://thehubofgit.github.io',
      'https://michael.brancazio',
      'http://localhost:8080',
      'http://127.0.0.1:8080'
    ];
    
    const origin = request.headers.get('Origin');
    const corsHeaders = {
      'Access-Control-Allow-Origin': allowedOrigins.includes(origin) ? origin : allowedOrigins[0],
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Upgrade, Connection',
    };

    // Handle preflight requests
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    // Handle WebSocket upgrade for voice streaming
    if (request.headers.get('Upgrade') === 'websocket') {
      return await handleWebSocket(request, env, corsHeaders);
    }

    // Fallback for regular HTTP requests
    return new Response('Voice worker - WebSocket endpoint', {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'text/plain' }
    });
  }
};

async function handleWebSocket(request, env, corsHeaders) {
  const GEMINI_API_KEY = env.GEMINI_API_KEY;
  if (!GEMINI_API_KEY) {
    return new Response('API key not configured', { 
      status: 500,
      headers: corsHeaders 
    });
  }

  // Create WebSocket pair
  const webSocketPair = new WebSocketPair();
  const [client, server] = Object.values(webSocketPair);

  // Accept the WebSocket connection
  server.accept();

  // Connect to Gemini Live API
  const modelName = 'models/gemini-2.5-flash-native-audio-preview-09-2025';
  const geminiWsUrl = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent?key=${GEMINI_API_KEY}`;

  let geminiWs = null;
  let isGeminiConnected = false;

  try {
    // Establish connection to Gemini
    geminiWs = new WebSocket(geminiWsUrl);
    
    geminiWs.addEventListener('open', () => {
      console.log('Connected to Gemini Live API');
      isGeminiConnected = true;

      // Send initial setup message
      const setupMessage = {
        setup: {
          model: modelName,
          generation_config: {
            response_modalities: ['AUDIO'],
            speech_config: {
              voice_config: {
                prebuilt_voice_config: {
                  voice_name: 'Puck' // You can choose: Puck, Charon, Kore, Fenrir, Aoede
                }
              }
            }
          },
          system_instruction: {
            parts: [{
              text: `You are a professional assistant helping users learn about Michael Brancazio's experience and qualifications. 
              
Provide accurate, concise information about his background and skills in a professional, conversational tone suitable for voice interaction. 
Keep responses brief (2-3 sentences) for voice conversations unless specifically asked for more detail.

When answering:
- Be conversational and natural for voice interaction
- Keep responses concise and to the point
- Use a friendly but professional tone
- If asked about your model or capabilities, mention you're powered by Gemini's native audio capabilities
- Remember previous parts of the conversation for context`
            }]
          }
        }
      };

      geminiWs.send(JSON.stringify(setupMessage));
      
      // Notify client that connection is ready
      server.send(JSON.stringify({ 
        type: 'connected',
        message: 'Connected to voice assistant'
      }));
    });

    geminiWs.addEventListener('message', (event) => {
      try {
        const data = JSON.parse(event.data);
        
        // Forward responses to client
        if (data.serverContent) {
          const parts = data.serverContent.modelTurn?.parts || [];
          
          for (const part of parts) {
            if (part.inlineData && part.inlineData.mimeType === 'audio/pcm') {
              // Forward audio response to client
              server.send(JSON.stringify({
                type: 'audio',
                data: part.inlineData.data,
                mimeType: part.inlineData.mimeType
              }));
            } else if (part.text) {
              // Forward text response if any
              server.send(JSON.stringify({
                type: 'text',
                data: part.text
              }));
            }
          }
        }

        // Handle turn completion
        if (data.serverContent?.turnComplete) {
          server.send(JSON.stringify({
            type: 'turnComplete'
          }));
        }

        // Handle setup completion
        if (data.setupComplete) {
          server.send(JSON.stringify({
            type: 'setupComplete'
          }));
        }

        // Handle tool calls if needed
        if (data.toolCall) {
          server.send(JSON.stringify({
            type: 'toolCall',
            data: data.toolCall
          }));
        }

      } catch (err) {
        console.error('Error processing Gemini message:', err);
        server.send(JSON.stringify({
          type: 'error',
          message: 'Error processing response'
        }));
      }
    });

    geminiWs.addEventListener('error', (error) => {
      console.error('Gemini WebSocket error:', error);
      server.send(JSON.stringify({
        type: 'error',
        message: 'Connection error with voice service'
      }));
    });

    geminiWs.addEventListener('close', () => {
      console.log('Gemini WebSocket closed');
      isGeminiConnected = false;
      server.close(1000, 'Gemini connection closed');
    });

    // Handle messages from client
    server.addEventListener('message', (event) => {
      try {
        const message = JSON.parse(event.data);

        if (!isGeminiConnected) {
          server.send(JSON.stringify({
            type: 'error',
            message: 'Not connected to voice service'
          }));
          return;
        }

        // Forward audio data to Gemini
        if (message.type === 'audio') {
          const audioMessage = {
            realtimeInput: {
              mediaChunks: [{
                mimeType: 'audio/pcm',
                data: message.data
              }]
            }
          };
          geminiWs.send(JSON.stringify(audioMessage));
        }

        // Handle text input
        if (message.type === 'text') {
          const textMessage = {
            clientContent: {
              turns: [{
                role: 'user',
                parts: [{ text: message.data }]
              }],
              turnComplete: true
            }
          };
          geminiWs.send(JSON.stringify(textMessage));
        }

        // Handle turn complete signal
        if (message.type === 'turnComplete') {
          // Client finished speaking, signal to Gemini
          geminiWs.send(JSON.stringify({
            realtimeInput: {
              mediaChunks: []
            }
          }));
        }

      } catch (err) {
        console.error('Error processing client message:', err);
        server.send(JSON.stringify({
          type: 'error',
          message: 'Error processing your message'
        }));
      }
    });

    server.addEventListener('close', () => {
      console.log('Client WebSocket closed');
      if (geminiWs && isGeminiConnected) {
        geminiWs.close();
      }
    });

    server.addEventListener('error', (error) => {
      console.error('Client WebSocket error:', error);
      if (geminiWs && isGeminiConnected) {
        geminiWs.close();
      }
    });

  } catch (error) {
    console.error('Error setting up WebSocket:', error);
    server.send(JSON.stringify({
      type: 'error',
      message: 'Failed to establish connection'
    }));
    server.close(1011, 'Internal error');
  }

  // Return WebSocket response
  return new Response(null, {
    status: 101,
    webSocket: client,
  });
}
