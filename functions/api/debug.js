// Full diagnostic of the upload flow in generateAudio
// Returns every step so we can see where it fails
export async function onRequest(context) {
  const { env } = context;
  const headers = { 'Content-Type': 'application/json' };
  const logs = [];

  // Step 1: Check env vars
  logs.push({ step: 'env.SUPABASE_URL exists', value: !!env.SUPABASE_URL });
  logs.push({ step: 'env.SUPABASE_SERVICE_KEY exists', value: !!env.SUPABASE_SERVICE_KEY });
  logs.push({ step: 'SUPABASE_URL type', value: typeof env.SUPABASE_URL });
  logs.push({ step: 'SUPABASE_SERVICE_KEY type', value: typeof env.SUPABASE_SERVICE_KEY });

  const supabaseUrl = env.SUPABASE_URL;
  const serviceKey = env.SUPABASE_SERVICE_KEY;

  if (!supabaseUrl || !serviceKey) {
    logs.push({ step: 'SKIP: env vars missing', shareUrl: '' });
    return new Response(JSON.stringify({ logs }), { headers });
  }

  // Step 2: Upload a small file using EXACT same code as generateAudio
  // Using a real HTTP response to get an ArrayBuffer (like ElevenLabs does)
  try {
    // Get a real large response to test ArrayBuffer upload
    const sampleResp = await fetch('https://api.elevenlabs.io/v1/text-to-speech/EXAVITQu4vr4xnSDxMaL', {
      method: 'POST',
      headers: {
        'xi-api-key': env.ELEVENLABS_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        text: 'This is a test of the audio upload system for converttopodcast. Testing audio buffer upload to Supabase Storage.',
        model_id: 'eleven_multilingual_v2',
      }),
    });
    logs.push({ step: 'TTS fetch ok', status: sampleResp.status });
    
    const sampleBuffer = await sampleResp.arrayBuffer();
    logs.push({ step: 'arrayBuffer', size: sampleBuffer.byteLength, type: sampleBuffer.constructor.name });

    // Step 3: Upload the buffer to Supabase
    const filename = `debug-${Date.now()}.mp3`;
    const uploadResp = await fetch(
      `${supabaseUrl}/storage/v1/object/podcast-audio/${filename}`,
      {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${serviceKey}`,
          'apikey': serviceKey,
          'Content-Type': 'audio/mpeg',
          'x-upsert': 'true',
        },
        body: sampleBuffer,
      }
    );

    const uploadBody = await uploadResp.text().catch(() => 'no body');
    logs.push({
      step: 'upload result',
      ok: uploadResp.ok,
      status: uploadResp.status,
      body: uploadBody.slice(0, 200),
      share_url: uploadResp.ok ? `${supabaseUrl}/storage/v1/object/public/podcast-audio/${filename}` : ''
    });

  } catch (e) {
    logs.push({ step: 'EXCEPTION', message: e.message, stack: (e.stack || '').slice(0, 200) });
  }

  return new Response(JSON.stringify({ logs }, null, 2), { headers });
}
