/**
 * Cloudflare Pages Edge Function : /api/analyze
 * Renforce l'API Vision en exécutant la requête depuis le réseau fibre Cloudflare Edge :
 * 1. Contourne les lenteurs DNS/IPv6 et restrictions opérateurs mobiles 4G/5G
 * 2. Impose un schéma JSON strict (responseSchema) + System Instruction clinique
 * 3. Interroge en course parallèle (Promise.any) gemini-3.5-flash et gemma-4-26b-a4b-it
 */
const DEFAULT_KEY = 'AQ.Ab8RN6IcD0t6smDPSNTKH1wEPUYRFjYuSCUU5FwipEkAAHmRsg';

const SYSTEM_INSTRUCTION = {
  parts: [
    {
      text: "Tu es un expert en nutrition clinique et insulinotherapie. Estime le grammage exact en utilisant la taille standard d'une assiette (24-26cm) ou d'un verre (150ml). Distingue clairement les patisseries/gateaux (ex: Cheesecake San Sebastian, mille-feuille, tiramisu, croissant) des pains et plats marocains (khobz, msemen, tajine, couscous, harira)."
    }
  ]
};

const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  required: ['items'],
  properties: {
    items: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        required: ['foodId', 'customName', 'grams', 'carbs100g', 'fiber100g', 'gi', 'x', 'y'],
        properties: {
          foodId: { type: 'STRING' },
          customName: { type: 'STRING' },
          grams: { type: 'NUMBER' },
          carbs100g: { type: 'NUMBER' },
          fiber100g: { type: 'NUMBER' },
          gi: { type: 'NUMBER' },
          x: { type: 'NUMBER' },
          y: { type: 'NUMBER' }
        }
      }
    }
  }
};

async function callModel(modelName, base64Data, apiKey) {
  const prompt = `Identifie TOUS les aliments, gateaux, patisseries ou plats visibles sur cette photo et estime leur poids en grammes. Reponds uniquement en JSON: {"items":[{"foodId":"id_ou_custom","customName":"Nom precis en francais","grams":130,"carbs100g":22.5,"fiber100g":0.5,"gi":52,"x":50,"y":50}]}`;

  const isGemini = modelName.startsWith('gemini');
  const payload = {
    ...(isGemini ? { systemInstruction: SYSTEM_INSTRUCTION } : {}),
    contents: [
      {
        parts: [
          { text: prompt },
          { inlineData: { mimeType: 'image/jpeg', data: base64Data } }
        ]
      }
    ],
    generationConfig: isGemini
      ? {
          responseMimeType: 'application/json',
          responseSchema: RESPONSE_SCHEMA,
          temperature: 0.1,
          mediaResolution: 'MEDIA_RESOLUTION_LOW',
          thinkingConfig: { thinkingLevel: 'MINIMAL' }
        }
      : {
          temperature: 0.1
        }
  };

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
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

    const items = await Promise.any([
      callModel('gemini-3.5-flash', base64Data, apiKey),
      callModel('gemma-4-26b-a4b-it', base64Data, apiKey)
    ]);

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
