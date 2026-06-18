// ConvertToPodcast - Cloudflare Pages Function
// API endpoint: /api/generate

export async function onRequest(context) {
  const { request, env } = context;
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };

  if (request.method === 'OPTIONS') {
    return new Response(null, { headers, status: 204 });
  }

  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405, headers,
    });
  }

  try {
    const contentType = request.headers.get('Content-Type') || '';

    // Require authenticated user — anonymous usage is disabled (2026-06-17).
    // Users must sign up / log in (Supabase Auth) to use the converter.
    const authHeader = request.headers.get('Authorization') || '';
    const accessToken = authHeader.replace(/^Bearer\s+/i, '').trim();

    if (!accessToken) {
      return new Response(JSON.stringify({
        error: 'Authentication required',
        code: 'auth_required',
        message: 'Please sign up or log in to use the converter.',
      }), { headers, status: 401 });
    }

    if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY) {
      return new Response(JSON.stringify({
        error: 'Server misconfigured (missing Supabase env vars)',
      }), { headers, status: 500 });
    }

    let userId = null;
    try {
      const userResp = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
        headers: {
          'apikey': env.SUPABASE_SERVICE_KEY,
          'Authorization': `Bearer ${accessToken}`,
        },
      });
      if (!userResp.ok) {
        return new Response(JSON.stringify({
          error: 'Invalid or expired session',
          code: 'auth_invalid',
        }), { headers, status: 401 });
      }
      const u = await userResp.json();
      userId = u.id;
    } catch (e) {
      return new Response(JSON.stringify({
        error: 'Auth verification failed',
        details: e.message,
      }), { headers, status: 401 });
    }

    let input;

    if (contentType.includes('multipart/form-data')) {
      const formData = await request.formData();
      const file = formData.get('file');
      const style = formData.get('style') || 'deep';
      const language = formData.get('language') || 'en';
      const length = formData.get('length') || 'medium';

      if (!file) throw new Error('No file uploaded');

      const text = await extractTextFromPDF(file);
      input = { text, style, language, length, source: 'pdf' };
    } else {
      const body = await request.json();
      const { source, content, style, language, length } = body;

      if (!content) throw new Error('No content provided');

      let text;
      if (source === 'url') {
        text = await extractTextFromURL(content);
      } else {
        text = content;
      }

      input = { text, style, language, length, source };
    }

    // Validate text length
    if (!input.text || input.text.length < 50) {
      throw new Error('Content too short. Please provide at least 50 characters.');
    }

    // Trim to max length based on plan
    const maxLength = input.length === 'short' ? 3000 : input.length === 'long' ? 15000 : 8000;
    const trimmedText = input.text.slice(0, maxLength);

    // Generate podcast script
    const script = await generateScript(trimmedText, input.style, input.language, input.length, env);

    // Generate audio using TTS
    const audioResult = await generateAudio(script, input.language, input.length, env);

    // Upload audio to Supabase Storage for shareable link
    let shareUrl = '';
    let uploadDebug = '';
    // Use the base64 data URL from generateAudio to reconstruct binary
    const dataUrl = audioResult.url;
    if (dataUrl && dataUrl.startsWith('data:') && dataUrl.includes('base64,')) {
      try {
        const base64Data = dataUrl.split('base64,')[1];
        uploadDebug = `base64 ${base64Data.length} chars, decoding...`;
        const binaryStr = atob(base64Data);
        const bytes = new Uint8Array(binaryStr.length);
        for (let i = 0; i < binaryStr.length; i++) {
          bytes[i] = binaryStr.charCodeAt(i);
        }
        uploadDebug = `decoded ${bytes.length}b, uploading...`;
        const filename = `podcast-${Date.now()}-${Math.random().toString(36).slice(2, 10)}.mp3`;
        const uploadResp = await fetch(
          `${env.SUPABASE_URL}/storage/v1/object/podcast-audio/${filename}`,
          {
            method: 'PUT',
            headers: {
              'Authorization': `Bearer ${env.SUPABASE_SERVICE_KEY}`,
              'apikey': env.SUPABASE_SERVICE_KEY,
              'Content-Type': 'audio/mpeg',
              'x-upsert': 'true',
            },
            body: bytes.buffer,
          }
        );
        uploadDebug = 'upload status: ' + uploadResp.status;
        if (uploadResp.ok) {
          shareUrl = `${env.SUPABASE_URL}/storage/v1/object/public/podcast-audio/${filename}`;
          uploadDebug = '';
        } else {
          const errBody = await uploadResp.text().catch(() => '?');
          uploadDebug = 'upload fail: ' + errBody.slice(0, 80);
        }
      } catch (e) {
        uploadDebug = 'EXCEPTION: ' + e.message;
      }
    } else {
      uploadDebug = 'no valid data URL (type=' + typeof dataUrl + ')';
    }

    // Calculate credits used (1 credit per minute of audio, min 1)
    const duration = audioResult.duration || 60;
    const creditsUsed = Math.max(1, Math.ceil(duration / 60));

    // Consume credits from Supabase (userId is guaranteed non-null by auth gate above)
    const consumeResp = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/consume_credit`, {
      method: 'POST',
      headers: {
        'apikey': env.SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${env.SUPABASE_SERVICE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        p_user_id: userId,
        p_credits: creditsUsed,
        p_source: input.source,
        p_style: input.style,
        p_language: input.language,
        p_length: input.length,
        p_duration: duration,
      }),
    });
    if (!consumeResp.ok) {
      const err = await consumeResp.json().catch(() => ({}));
      return new Response(JSON.stringify({
        error: 'Credit check failed',
        details: err,
      }), { headers, status: 500 });
    }
    const result = await consumeResp.json();
    if (!result || result.length === 0) {
      return new Response(JSON.stringify({
        error: 'Credit check returned no result',
      }), { headers, status: 500 });
    }
    const r = result[0];
    if (!r.ok) {
      return new Response(JSON.stringify({
        error: r.message || 'Insufficient credits',
        credits_remaining: r.remaining,
        code: r.message === 'Insufficient credits' ? 'no_credits' : 'credit_error',
      }), { headers, status: 402 });
    }
    const creditsRemaining = r.remaining;

    return new Response(JSON.stringify({
      success: true,
      title: generateTitle(trimmedText, input.language),
      audio_url: audioResult.url,
      share_url: shareUrl,
      upload_error: uploadDebug,
      duration: audioResult.duration,
      credits_used: creditsUsed,
      credits_remaining: creditsRemaining,
    }), { headers, status: 200 });

  } catch (err) {
    return new Response(JSON.stringify({
      error: err.message || 'Internal server error',
    }), { headers, status: 400 });
  }
}

// --- Text Extraction ---

async function extractTextFromURL(url) {
  try {
    const resp = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; ConvertToPodcast/1.0)',
        'Accept': 'text/html,application/xhtml+xml',
      },
    });
    const html = await resp.text();
    return extractReadableContent(html);
  } catch (err) {
    throw new Error(`Failed to fetch URL: ${err.message}`);
  }
}

async function extractTextFromPDF(file) {
  // For Cloudflare Pages, we'd need pdf.js or a WASM PDF parser
  // For now, return a placeholder — will implement with pdf-lib or similar
  const text = await file.text();
  // Simple heuristic: try to read as text, if binary, return structured error
  if (text.includes('%PDF')) {
    return "PDF content extraction requires a PDF parser. " +
           "We're processing your PDF. For best results, copy-paste text directly.";
  }
  return text;
}

function extractReadableContent(html) {
  // Simple content extraction — strip tags, scripts, styles
  let text = html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, '')
    .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, '')
    .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[^;]+;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // Try to find main content area — look for article, main, or content divs
  const mainMatch = html.match(/<article[^>]*>([\s\S]*?)<\/article>/i);
  const contentMatch = html.match(/<main[^>]*>([\s\S]*?)<\/main>/i);
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);

  if (mainMatch) return stripHTML(mainMatch[1]);
  if (contentMatch) return stripHTML(contentMatch[1]);
  return text;
}

function stripHTML(html) {
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[^;]+;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// --- Script Generation ---

async function generateScript(text, style, language, length, env) {
  const stylePrompts = {
    deep: "two expert podcast hosts who dive deep into the content, explaining concepts clearly. Host A is curious and asks questions. Host B is knowledgeable and explains in detail.",
    quick: "a fast-paced 60-second podcast summary that covers the key points quickly and engagingly.",
    debate: "two hosts with opposing viewpoints debating the content's arguments and conclusions.",
  };

  const lengthWords = {
    short: "The podcast should be about 300-400 words total (roughly 2-3 minutes).",
    medium: "The podcast should be about 800-1200 words total (roughly 5-8 minutes).",
    long: "The podcast should be about 1500-2000 words total (roughly 10-15 minutes).",
  };

  const prompt = `You are a podcast script writer. Write a natural conversation between ${stylePrompts[style] || stylePrompts.deep}

${lengthWords[length] || lengthWords.medium}

Format each line as:
**Host A**: [dialogue]
**Host B**: [dialogue]

The podcast should be engaging, informative, and sound like a real conversation — not a lecture. Start with a brief hook, cover the key points from the content naturally, and end with a conclusion.

Content to convert:
---
${text}
---

Generate the podcast script in ${getLanguageName(language)}.`;

  // Call LLM API
  const apiKey = env.DEEPSEEK_API_KEY || env.OPENAI_API_KEY;
  if (!apiKey) {
    // Return demo script if no API key configured
    return generateDemoScript(text, style, language);
  }

  const model = env.LLM_MODEL || 'deepseek-chat';
  const baseUrl = env.LLM_BASE_URL || 'https://api.deepseek.com/v1';

  try {
    const resp = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: 'You are a professional podcast script writer. Write natural, engaging conversations.' },
          { role: 'user', content: prompt },
        ],
        max_tokens: length === 'short' ? 800 : length === 'long' ? 4000 : 2000,
        temperature: 0.7,
      }),
    });

    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error?.message || 'LLM API error');

    return data.choices[0].message.content;
  } catch (err) {
    // Fallback to demo script on API error
    return generateDemoScript(text, style, language);
  }
}

// --- Audio Generation (ElevenLabs TTS) ---

async function generateAudio(script, language, length, env) {
  const apiKey = env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    return {
      url: '', share_url: '',
      duration: length === 'short' ? 180 : length === 'long' ? 900 : 480,
    };
  }

  // Custom voice created in ElevenLabs Voice Design
  const voiceId = '7PJTk5zh11ocOACTPzQr';

  const resp = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
    method: 'POST',
    headers: {
      'xi-api-key': apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      text: script,
      model_id: 'eleven_multilingual_v2',
      voice_settings: {
        stability: 0.35,
        similarity_boost: 0.75,
      },
    }),
  });

  if (!resp.ok) {
    const err = await resp.text().catch(() => 'Unknown error');
    return {
      url: '', share_url: '',
      duration: length === 'short' ? 180 : length === 'long' ? 900 : 480,
    };
  }

  const audioBuffer = await resp.arrayBuffer();
  const base64 = arrayBufferToBase64(audioBuffer);
  const mimeType = resp.headers.get('content-type') || 'audio/mpeg';

  // Estimate duration: ~2.5 words/sec speaking rate
  const wordCount = script.split(/\s+/).length;
  const duration = Math.max(30, Math.ceil(wordCount / 2.5));

  return {
    url: `data:${mimeType};base64,${base64}`,
    share_url: '',  // Main handler will try to upload
    audioBuffer: audioBuffer,
    duration,
  };
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunk = 8192;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.slice(i, i + chunk));
  }
  return btoa(binary);
}

function parseScript(script) {
  const segments = [];
  const lines = script.split('\n');

  for (const line of lines) {
    const match = line.match(/\*\*(Host [AB])\*\*:\s*(.*)/);
    if (match) {
      segments.push({ host: match[1], text: match[2].trim() });
    }
  }

  if (segments.length === 0) {
    // Fallback: treat whole script as one person speaking
    return [{ host: 'Host A', text: script.slice(0, 1000) }];
  }

  return segments;
}

// --- Demo fallback ---

function generateDemoScript(text, style, language) {
  const lang = getLanguageName(language);
  const title = text.split('\n')[0]?.slice(0, 80) || 'your content';
  const preview = text.slice(0, 300);

  if (language === 'zh') {
    return `**Host A**: 嘿，你今天看了这篇文章吗？关于"${title}"的。

**Host B**: 是的，很有意思。让我给大家总结一下核心观点。

**Host A**: 好，那我们从最基础的说起。这篇文章的核心主题是什么？

**Host B**: 简单来说，${preview}...

**Host A**: 原来如此。那你觉得最大的亮点在哪里？

**Host B**: 我认为最值得注意的是作者对这个问题独特的分析角度。他把复杂的概念拆解得非常清晰。

**Host A**: 确实，听完你的分析我觉得收获很大。感谢分享！

**Host B**: 不客气！如果你对原文感兴趣，欢迎去 converttopodcast.com 上传更多内容，我们会帮你生成播客版本。`;
  }

  return `**Host A**: Hey, have you seen this piece about "${title}"?

**Host B**: Yeah, it's really interesting. Let me break down the key points for our listeners.

**Host A**: So what's the core idea here?

**Host B**: ${preview}...

**Host A**: That makes a lot of sense. What stood out to you most?

**Host B**: I think the author's approach to explaining this concept is really fresh. They break down complex ideas into digestible pieces that anyone can understand.

**Host A**: Great insights. Thanks for walking us through this!

**Host B**: Anytime! If you enjoyed this, head over to converttopodcast.com to convert your own articles, PDFs, or notes into podcast form.`;
}

// --- Helpers ---

function generateTitle(text, language) {
  const firstLine = text.split('\n')[0]?.trim()?.slice(0, 60);
  if (firstLine) return firstLine;
  return language === 'zh' ? 'AI 播客' : 'AI Podcast';
}

function getLanguageName(code) {
  const names = { en: 'English', zh: 'Chinese (中文)', es: 'Spanish (Español)', ja: 'Japanese (日本語)', pt: 'Portuguese (Português)' };
  return names[code] || 'English';
}
