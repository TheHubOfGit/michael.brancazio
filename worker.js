/**
 * Cloudflare Worker for handling Gemini API calls securely
 * This keeps the API key server-side and prevents exposure to the frontend
 */

export default {
  async fetch(request, env, ctx) {
    // CORS headers for the portfolio domain
    const allowedOrigins = [
      'https://thehubofgit.github.io',
      'https://michael.brancazio',
      'https://michaelbrancazio.pages.dev'
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

    // Only allow POST requests
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

      // Prepare the request payload
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

      // Try primary model first (gemini-2.5-flash)
      let geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`;
      let geminiResponse = await fetch(geminiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(geminiPayload)
      });

      // If primary model fails, fallback to lite model
      if (!geminiResponse.ok) {
        console.error('Primary model (gemini-2.5-flash) failed, trying fallback (gemini-2.5-flash-lite)...');
        const errorData = await geminiResponse.text();
        console.error('Primary model error:', errorData);
        
        // Try fallback model
        geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${GEMINI_API_KEY}`;
        geminiResponse = await fetch(geminiUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(geminiPayload)
        });

        // If fallback also fails, return error
        if (!geminiResponse.ok) {
          const fallbackErrorData = await geminiResponse.text();
          console.error('Fallback model (gemini-2.5-flash-lite) also failed:', fallbackErrorData);
          console.error('Gemini URL used:', geminiUrl.replace(/key=[^&]*/, 'key=***'));
          return new Response(JSON.stringify({
            error: 'Failed to get response from AI service',
            details: fallbackErrorData,
            status: geminiResponse.status
          }), {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }
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
