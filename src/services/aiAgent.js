function getGlobalFetch() {
  if (typeof fetch !== 'undefined') return fetch;
  throw new Error('Global fetch is not available in this Node runtime. Please upgrade to Node 18+ or polyfill fetch.');
}

function buildPrompt(context) {
  const { schema, sampleRows, numericStats, correlations } = context;
  const safeSample = sampleRows.slice(0, 50);
  const prompt = `You are a data analysis assistant. Analyze the provided tabular data summary and return ONLY valid JSON following the schema below. Do not include any extra commentary.

Schema to return:
{
  "charts": [
    {"title": string, "type": "histogram"|"bar"|"line"|"scatter"|"pie", "x": string|null, "y": string|null, "agg"?: "mean"|"sum"|"count"|null, "description": string}
  ],
  "insights": [ {"title": string, "detail": string} ],
  "forecasts": [ {"target": string, "method": string, "horizon": number, "points": [{"label": string, "value": number}] } ]
}

Data schema with inferred types: ${JSON.stringify(schema)}
Numeric stats (per column): ${JSON.stringify(numericStats)}
Correlations (Pearson for numeric pairs): ${JSON.stringify(correlations)}
Sample rows (first up to 50): ${JSON.stringify(safeSample)}

Important:
- Prefer simple, actionable charts.
- Keep 6-12 charts max.
- Provide at most 5 forecast points per series.
- Ensure the JSON is minified and strictly valid.`;
  return prompt;
}

async function tryOllama(prompt) {
  const fetchFn = getGlobalFetch();
  const base = process.env.OLLAMA_HOST || 'http://127.0.0.1:11434';
  const models = (process.env.OLLAMA_MODELS || 'llama3.1,llama3,qwen2.5,phi3').split(',').map((m) => m.trim()).filter(Boolean);
  for (const model of models) {
    try {
      const resp = await fetchFn(`${base}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, prompt, stream: false })
      });
      console.log(resp);
      if (!resp.ok) continue;
      const json = await resp.json();
      const text = json?.response || '';
      if (!text) continue;
      return { provider: 'ollama', model, text };
    } catch (_err) {
      // try next model/provider
    }
  }
  return null;
}

async function tryGemini(prompt) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;
  const fetchFn = getGlobalFetch();
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${apiKey}`;
  const body = {
    contents: [ { parts: [ { text: prompt } ] } ],
    generationConfig: { temperature: 0.2 }
  };
  const resp = await fetchFn(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!resp.ok) return null;
  const data = await resp.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
  if (!text) return null;
  return { provider: 'gemini', model: 'gemini-1.5-flash', text };
}

async function tryOpenAI(prompt) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;
  const fetchFn = getGlobalFetch();
  const url = 'https://api.openai.com/v1/chat/completions';
  const body = {
    model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
    temperature: 0.2,
    messages: [ { role: 'user', content: prompt } ]
  };
  const resp = await fetchFn(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` }, body: JSON.stringify(body) });
  if (!resp.ok) return null;
  const data = await resp.json();
  const text = data?.choices?.[0]?.message?.content || '';
  if (!text) return null;
  return { provider: 'openai', model: body.model, text };
}

async function tryHuggingFace(prompt) {
  const apiKey = process.env.HF_API_TOKEN;
  if (!apiKey) return null;
  const fetchFn = getGlobalFetch();
  const model = process.env.HF_MODEL || 'mistralai/Mistral-7B-Instruct-v0.2';
  const url = `https://api-inference.huggingface.co/models/${encodeURIComponent(model)}`;
  const body = {
    inputs: prompt,
    parameters: {
      max_new_tokens: 1024,
      temperature: 0.2,
      return_full_text: false
    }
  };
  const resp = await fetchFn(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` }, body: JSON.stringify(body) });
  if (!resp.ok) return null;
  const data = await resp.json();
  const text = Array.isArray(data) ? (data[0]?.generated_text || '') : (data?.generated_text || '');
  if (!text) return null;
  return { provider: 'huggingface', model, text };
}

function safeParseJson(text) {
  try {
    const trimmed = text.trim();
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start !== -1 && end !== -1) {
      const slice = trimmed.slice(start, end + 1);
      return JSON.parse(slice);
    }
    return JSON.parse(trimmed);
  } catch (_err) {
    return null;
  }
}

export async function analyzeWithAI(context, preferredProvider = null) {
  const prompt = buildPrompt(context);

  const providers = [];
  if (preferredProvider === 'ollama' || !preferredProvider) providers.push(tryOllama);
  if (preferredProvider === 'gemini' || !preferredProvider) providers.push(tryGemini);
  if (preferredProvider === 'openai' || !preferredProvider) providers.push(tryOpenAI);
  if (preferredProvider === 'huggingface' || !preferredProvider) providers.push(tryHuggingFace);

  for (const fn of providers) {
    try {
      const result = await fn(prompt);
      if (!result) continue;
      const parsed = safeParseJson(result.text);
      if (!parsed) continue;
      return { provider: result.provider, model: result.model, output: parsed, raw: result.text };
    } catch (_err) {
      // try next
    }
  }

  return null;
}


