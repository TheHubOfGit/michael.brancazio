/**
 * Gemini Live Voice Interaction Module
 * Handles native audio streaming with Gemini 2.5 Flash
 */

class GeminiVoiceChat {
  constructor(workerUrl) {
    this.workerUrl = workerUrl;
    this.ws = null;
    this.isConnected = false;
    this.isRecording = false;
    this.audioContext = null;
    this.mediaStream = null;
    this.audioWorkletNode = null;
    this.audioQueue = [];
    this.isPlaying = false;
    
    // Callbacks
    this.onConnected = null;
    this.onDisconnected = null;
    this.onError = null;
    this.onAudioResponse = null;
    this.onTextResponse = null;
    this.onTurnComplete = null;
  }

  async initialize() {
    try {
      // Initialize AudioContext
      this.audioContext = new (window.AudioContext || window.webkitAudioContext)({
        sampleRate: 16000 // Gemini expects 16kHz
      });

      // Create audio worklet for processing
      await this.setupAudioWorklet();

      console.log('Voice chat initialized');
      return true;
    } catch (error) {
      console.error('Failed to initialize voice chat:', error);
      if (this.onError) this.onError(error);
      return false;
    }
  }

  async setupAudioWorklet() {
    // We'll use ScriptProcessorNode as AudioWorklet isn't supported everywhere
    // In production, you'd want to feature-detect and use AudioWorklet when available
  }

  async connect() {
    if (this.isConnected) {
      console.log('Already connected');
      return;
    }

    try {
      // Convert HTTP(S) URL to WS(S) URL
      const wsUrl = this.workerUrl.replace(/^http/, 'ws');
      
      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        console.log('WebSocket connected');
      };

      this.ws.onmessage = (event) => {
        this.handleServerMessage(event.data);
      };

      this.ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        if (this.onError) this.onError(error);
      };

      this.ws.onclose = () => {
        console.log('WebSocket closed');
        this.isConnected = false;
        if (this.onDisconnected) this.onDisconnected();
      };

    } catch (error) {
      console.error('Failed to connect:', error);
      if (this.onError) this.onError(error);
    }
  }

  handleServerMessage(data) {
    try {
      const message = JSON.parse(data);

      switch (message.type) {
        case 'connected':
          console.log('Voice service connected');
          this.isConnected = true;
          if (this.onConnected) this.onConnected();
          break;

        case 'setupComplete':
          console.log('Setup complete');
          break;

        case 'audio':
          // Received audio response from Gemini
          this.handleAudioResponse(message.data);
          if (this.onAudioResponse) this.onAudioResponse(message.data);
          break;

        case 'text':
          // Received text response (for debugging/display)
          console.log('Received text:', message.data);
          if (this.onTextResponse) this.onTextResponse(message.data);
          break;

        case 'turnComplete':
          console.log('Turn complete');
          if (this.onTurnComplete) this.onTurnComplete();
          break;

        case 'error':
          console.error('Server error:', message.message);
          if (this.onError) this.onError(new Error(message.message));
          break;

        default:
          console.log('Unknown message type:', message.type);
      }
    } catch (error) {
      console.error('Error handling server message:', error);
    }
  }

  async handleAudioResponse(base64Audio) {
    try {
      // Decode base64 to ArrayBuffer
      const binaryString = atob(base64Audio);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }

      // Convert PCM to AudioBuffer
      // Gemini sends 16-bit PCM at 16kHz
      const pcmData = new Int16Array(bytes.buffer);
      const audioBuffer = this.audioContext.createBuffer(
        1, // mono
        pcmData.length,
        16000 // sample rate
      );

      // Convert Int16 PCM to Float32 for Web Audio API
      const channelData = audioBuffer.getChannelData(0);
      for (let i = 0; i < pcmData.length; i++) {
        channelData[i] = pcmData[i] / 32768.0; // Normalize to -1.0 to 1.0
      }

      // Queue audio for playback
      this.audioQueue.push(audioBuffer);
      
      if (!this.isPlaying) {
        this.playNextAudio();
      }

    } catch (error) {
      console.error('Error handling audio response:', error);
    }
  }

  playNextAudio() {
    if (this.audioQueue.length === 0) {
      this.isPlaying = false;
      return;
    }

    this.isPlaying = true;
    const audioBuffer = this.audioQueue.shift();

    const source = this.audioContext.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(this.audioContext.destination);

    source.onended = () => {
      this.playNextAudio();
    };

    source.start();
  }

  async startRecording() {
    if (this.isRecording) {
      console.log('Already recording');
      return;
    }

    if (!this.isConnected) {
      console.error('Not connected to voice service');
      if (this.onError) this.onError(new Error('Not connected'));
      return;
    }

    try {
      // Get microphone access
      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          sampleRate: 16000,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        }
      });

      const source = this.audioContext.createMediaStreamSource(this.mediaStream);

      // Use ScriptProcessorNode for audio processing
      const bufferSize = 4096;
      const processor = this.audioContext.createScriptProcessor(bufferSize, 1, 1);

      processor.onaudioprocess = (e) => {
        if (!this.isRecording) return;

        const inputData = e.inputBuffer.getChannelData(0);
        
        // Convert Float32 to Int16 PCM
        const pcmData = new Int16Array(inputData.length);
        for (let i = 0; i < inputData.length; i++) {
          const s = Math.max(-1, Math.min(1, inputData[i]));
          pcmData[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
        }

        // Convert to base64
        const base64Audio = this.arrayBufferToBase64(pcmData.buffer);

        // Send to server
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
          this.ws.send(JSON.stringify({
            type: 'audio',
            data: base64Audio
          }));
        }
      };

      source.connect(processor);
      processor.connect(this.audioContext.destination);

      this.audioWorkletNode = processor;
      this.isRecording = true;

      console.log('Recording started');

    } catch (error) {
      console.error('Failed to start recording:', error);
      if (this.onError) this.onError(error);
    }
  }

  stopRecording() {
    if (!this.isRecording) {
      return;
    }

    this.isRecording = false;

    // Stop media stream
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach(track => track.stop());
      this.mediaStream = null;
    }

    // Disconnect audio nodes
    if (this.audioWorkletNode) {
      this.audioWorkletNode.disconnect();
      this.audioWorkletNode = null;
    }

    // Signal turn complete to server
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        type: 'turnComplete'
      }));
    }

    console.log('Recording stopped');
  }

  arrayBufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  disconnect() {
    this.stopRecording();

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    this.isConnected = false;
  }

  cleanup() {
    this.disconnect();

    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }

    this.audioQueue = [];
  }
}

// Export for use in HTML
if (typeof window !== 'undefined') {
  window.GeminiVoiceChat = GeminiVoiceChat;
}
