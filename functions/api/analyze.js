/**
 * Cloudflare Pages Edge Function : /api/analyze (Fallback)
 * Analyse de secours pour plats et boissons.
 */

export async function onRequest(context) {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Content-Type': 'application/json'
  };

  if (context.request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  if (context.request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: corsHeaders
    });
  }

  try {
    const body = await context.request.json().catch(() => ({}));
    const base64Data = body?.imageBase64;
    if (!base64Data) {
      return new Response(JSON.stringify({ error: 'Missing imageBase64' }), {
        status: 400,
        headers: corsHeaders
      });
    }

    const cleanBase64 = base64Data.includes(',') ? base64Data.split(',')[1] : base64Data;
    const apiKey = context.env?.GEMINI_API_KEY || body?.apiKey;

    if (!apiKey || apiKey.startsWith('AQ.') || apiKey.length < 20) {
      return new Response(JSON.stringify({
        error: 'Clé API Gemini non configurée.'
      }), {
        status: 401,
        headers: corsHeaders
      });
    }

    const prompt = `Tu es un expert en nutrition clinique et diabétologie. Analyse cette photo de repas :
1. Identifie uniquement les aliments et boissons caloriques consommés par UNE SEULE personne.
2. EXCLUSION OBLIGATOIRE : NE PAS inclure l'eau pure (bouteille d'eau, verre d'eau minérale, carafe), ni les théières vides, couverts, serviettes ou objets sans calories.
3. PORTION INDIVIDUELLE : Estime la portion réelle consommée par une personne pour son repas. Pour le pain (Khobz, pain céréales, baguette), compte la portion d'une personne soit 1 morceau (~60g à 80g max). Pour les œufs (omelette, khlii), compte la portion d'une personne (~120g à 180g max).
4. Pour le pain aux céréales ou complet, les glucides nets sont de ~35g/100g (car riche en fibres).

Réponds UNIQUEMENT en JSON strict avec ce format :
{"items":[{"foodId":"id_court","customName":"Nom précis en français","grams":70,"carbs100g":42,"protein100g":10,"fiber100g":7,"gi":52,"x":50,"y":50}]}`;

    const models = ['gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-3.8-flash'];
    let items = null;
    let lastError = null;

    for (const model of models) {
      try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [
              {
                parts: [
                  { text: prompt },
                  { inlineData: { mimeType: 'image/jpeg', data: cleanBase64 } }
                ]
              }
            ],
            generationConfig: { temperature: 0.1 }
          })
        });

        if (!res.ok) {
          lastError = new Error(`${model} HTTP ${res.status}`);
          continue;
        }

        const data = await res.json();
        const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
        const match = rawText.match(/\{[\s\S]*\}/);
        if (match) {
          const parsed = JSON.parse(match[0]);
          if (Array.isArray(parsed.items) && parsed.items.length > 0) {
            items = parsed.items;
            break;
          }
        }
      } catch (err) {
        lastError = err;
      }
    }

    if (!items) {
      return new Response(JSON.stringify({ error: lastError?.message || 'Empty items' }), {
        status: 502,
        headers: corsHeaders
      });
    }

    const filtered = items.filter(it => {
      const name = String(it.customName || it.foodId || '').toLowerCase();
      const isWater = (name.includes('eau') || name.includes('water')) && !name.includes('gateau');
      const isZeroCal = Number(it.carbs100g || 0) === 0 && Number(it.fiber100g || 0) === 0 && isWater;
      return !isZeroCal;
    });

    return new Response(JSON.stringify({ items: filtered.length > 0 ? filtered : items }), {
      status: 200,
      headers: corsHeaders
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err?.message || 'Vision error') }), {
      status: 500,
      headers: corsHeaders
    });
  }
}
