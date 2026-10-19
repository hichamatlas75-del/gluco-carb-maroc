/**
 * Cloudflare Pages Edge Function : /api/analyze
 * Utilise gemini-3.5-flash-lite sans FSM JSON bloquante (réponse en ~1.2s à 2.1s, quota élevé)
 * avec fallback automatique sur gemma-4-26b-a4b-it.
 */
const DEFAULT_KEY = 'AQ.Ab8RN6IcD0t6smDPSNTKH1wEPUYRFjYuSCUU5FwipEkAAHmRsg';

async function callModel(modelName, base64Data, apiKey) {
  const prompt = `Identifie tous les aliments, gateaux, patisseries ou boissons visibles sur cette photo et estime leur poids en grammes. Reponds uniquement en JSON: {"items":[{"foodId":"id","customName":"Nom precis en francais","grams":100,"carbs100g":40,"fiber100g":2,"gi":65,"x":50,"y":50}]}`;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [
        {
          parts: [
            { text: prompt },
            { inlineData: { mimeType: 'image/jpeg', data: base64Data } }
          ]
        }
      ],
      generationConfig: { temperature: 0.1 }
    })
  });

  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
  const match = rawText.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('Invalid JSON');
  const parsed = JSON.parse(match[0]);
  if (!Array.isArray(parsed.items) || parsed.items.length === 0) {
    throw new Error('Empty items');
  }
  return parsed.items;
}

export async function onRequestPost(context) {
  try {
    const body = await context.request.json();
    const base64Data = body.imageBase64;
    if (!base64Data) {
      return new Response(JSON.stringify({ error: 'Missing imageBase64' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const apiKey = context.env?.GEMINI_API_KEY || body.apiKey || DEFAULT_KEY;

    let items;
    try {
      items = await callModel('gemini-3.5-flash-lite', base64Data, apiKey);
    } catch {
      items = await callModel('gemma-4-26b-a4b-it', base64Data, apiKey);
    }

    return new Response(JSON.stringify({ items }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store'
      }
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err?.message || 'Vision error') }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
