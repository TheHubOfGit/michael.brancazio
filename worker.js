/**
 * Cloudflare Worker for handling Gemini API calls securely
 * This keeps the API key server-side and prevents exposure to the frontend
 * Also supports WebSocket proxy for Gemini Live API
 */

export default {
  async fetch(request, env, ctx) {
    // CORS headers for the portfolio domain
    const allowedOrigins = [
      'https://thehubofgit.github.io',
      'https://michael.brancazio'
    ];
    
    const origin = request.headers.get('Origin');
    const corsHeaders = {
      'Access-Control-Allow-Origin': allowedOrigins.includes(origin) ? origin : allowedOrigins[0],
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    // Handle preflight requests
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    // Handle WebSocket upgrade for Gemini Live
    const upgradeHeader = request.headers.get('Upgrade');
    if (upgradeHeader === 'websocket') {
      return handleWebSocketUpgrade(request, env);
    }

    // Handle request for Gemini Live WebSocket URL (secure endpoint)
    if (request.method === 'GET' && new URL(request.url).pathname === '/gemini-live-ws-url') {
      return handleGeminiLiveUrl(request, env, corsHeaders);
    }

    // Only allow POST requests for regular API calls
    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405 });
    }

    try {
      const { message, context } = await request.json();

      if (!message) {
        return new Response(JSON.stringify({ error: 'Message is required' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      // Get API key from environment variable
      const GEMINI_API_KEY = env.GEMINI_API_KEY;
      if (!GEMINI_API_KEY) {
        return new Response(JSON.stringify({ error: 'API key not configured' }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      // Prepare the request to Gemini API
      const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`;

      const geminiPayload = {
        contents: [{
          parts: [{
            text: context ?
              `Context: ${context}\n\nUser: ${message}\n\nPlease respond as a helpful AI assistant with the given context.` :
              `User: ${message}\n\nPlease respond as a helpful AI assistant.`
          }]
        }],
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 1000,
        }
      };

      // Make request to Gemini API
      const geminiResponse = await fetch(geminiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(geminiPayload)
      });

      if (!geminiResponse.ok) {
        const errorData = await geminiResponse.text();
        console.error('Gemini API error:', errorData);
        console.error('Gemini URL used:', geminiUrl.replace(/key=[^&]*/, 'key=***'));
        return new Response(JSON.stringify({
          error: 'Failed to get response from AI service',
          details: errorData,
          status: geminiResponse.status
        }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      const geminiData = await geminiResponse.json();

      // Extract the response text
      const responseText = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || 'Sorry, I couldn\'t generate a response.';

      return new Response(JSON.stringify({ response: responseText }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });

    } catch (error) {
      console.error('Worker error:', error);
      return new Response(JSON.stringify({ error: 'Internal server error' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
  }
};

/**
 * Handle request for Gemini Live WebSocket URL
 * Returns the WebSocket URL with API key embedded (required by Gemini API)
 */
async function handleGeminiLiveUrl(request, env, corsHeaders) {
  const GEMINI_API_KEY = env.GEMINI_API_KEY;
  if (!GEMINI_API_KEY) {
    return new Response(JSON.stringify({ error: 'API key not configured' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  // Gemini Live API WebSocket endpoint with API key
  const geminiWsUrl = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${GEMINI_API_KEY}`;

  return new Response(JSON.stringify({ wsUrl: geminiWsUrl }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}

/**
 * Handle WebSocket upgrade for Gemini Live API proxy
 * This creates a bidirectional proxy between client and Gemini
 */
async function handleWebSocketUpgrade(request, env) {
  const GEMINI_API_KEY = env.GEMINI_API_KEY;
  if (!GEMINI_API_KEY) {
    return new Response('API key not configured', { status: 500 });
  }

  // Create WebSocket pair for client connection
  const pair = new WebSocketPair();
  const [client, server] = Object.values(pair);

  // Accept the client WebSocket
  server.accept();

  // Gemini Live API WebSocket endpoint
  const geminiWsUrl = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${GEMINI_API_KEY}`;

  // Create connection to Gemini using fetch with WebSocket upgrade
  // Note: Cloudflare Workers support WebSocket client connections via fetch
  let geminiWs = null;
  
  try {
    // Use fetch to upgrade to WebSocket connection
    const upgradeResponse = await fetch(geminiWsUrl, {
      headers: {
        'Upgrade': 'websocket',
        'Connection': 'Upgrade',
      }
    });

    if (upgradeResponse.status === 101 && upgradeResponse.webSocket) {
      geminiWs = upgradeResponse.webSocket;
      geminiWs.accept();

      // Forward messages from client to Gemini
      server.addEventListener('message', (event) => {
        if (geminiWs && geminiWs.readyState === WebSocket.READY_STATE_OPEN) {
          geminiWs.send(event.data);
        }
      });

      // Forward messages from Gemini to client
      geminiWs.addEventListener('message', (event) => {
        if (server.readyState === WebSocket.READY_STATE_OPEN) {
          server.send(event.data);
        }
      });

      // Handle close events
      server.addEventListener('close', () => {
        if (geminiWs && geminiWs.readyState === WebSocket.READY_STATE_OPEN) {
          geminiWs.close();
        }
      });

      geminiWs.addEventListener('close', () => {
        if (server.readyState === WebSocket.READY_STATE_OPEN) {
          server.close();
        }
      });

      geminiWs.addEventListener('error', (error) => {
        console.error('Gemini WebSocket error:', error);
        if (server.readyState === WebSocket.READY_STATE_OPEN) {
          server.close(1011, 'Gemini connection error');
        }
      });
    } else {
      // Fallback: if direct WebSocket connection fails, use alternative approach
      server.send(JSON.stringify({ 
        error: 'Failed to connect to Gemini WebSocket',
        fallback: 'Use /gemini-live-ws-url endpoint for direct connection'
      }));
    }
  } catch (error) {
    console.error('Error creating Gemini WebSocket connection:', error);
    // Fallback: return URL for direct client connection
    server.send(JSON.stringify({ 
      error: 'Proxy connection failed',
      wsUrl: geminiWsUrl,
      message: 'Connect directly using the provided URL'
    }));
  }

  // Return the client WebSocket
  return new Response(null, {
    status: 101,
    webSocket: client,
  });
}
