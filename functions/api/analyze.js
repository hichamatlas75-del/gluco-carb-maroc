/**
 * Cloudflare Pages Edge Function : /api/analyze
 * Utilise gemini-3.5-flash-lite sans FSM JSON bloquante (réponse en ~1.2s à 2.1s, quota élevé)
 * avec fallback automatique sur gemma-4-26b-a4b-it.
 */
const DEFAULT_KEY = 'AQ.Ab8RN6IcD0t6smDPSNTKH1wEPUYRFjYuSCUU5FwipEkAAHmRsg';

async function callModel(modelName, base64Data, apiKey) {
  const prompt = `Tu es un expert en nutrition clinique et diabétologie. Analyse cette photo de repas :
1. Identifie uniquement les aliments et boissons caloriques consommés par UNE SEULE personne.
2. EXCLUSION OBLIGATOIRE : NE PAS inclure l'eau pure (bouteille d'eau, verre d'eau minérale, carafe), ni les théières vides, couverts, serviettes ou objets sans calories.
3. PORTION INDIVIDUELLE : Estime la portion réelle consommée par une personne pour son repas. Ne compte JAMAIS une corbeille entière de pain ni un pain géant de table : pour le pain (Khobz, pain céréales, baguette), compte la portion d'une personne soit 1 morceau (~60g à 80g max). Pour les œufs (omelette, khlii), compte la portion d'une personne (~120g à 180g max).
4. Pour le pain aux céréales ou complet, les glucides nets sont de ~35g/100g (car riche en fibres).

Réponds UNIQUEMENT en JSON strict avec ce format :
{"items":[{"foodId":"id_court","customName":"Nom précis en français","grams":70,"carbs100g":42,"fiber100g":7,"gi":52,"x":50,"y":50}]}`;

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

  // Filtrer l'eau pure ou objets non caloriques s'ils ont été retournés par inadvertance
  const filtered = parsed.items.filter(it => {
    const name = String(it.customName || it.foodId || '').toLowerCase();
    const isWater = (name.includes('eau') || name.includes('water')) && !name.includes('gateau') && !name.includes('chapeau');
    const isZeroCal = Number(it.carbs100g || 0) === 0 && Number(it.fiber100g || 0) === 0 && isWater;
    return !isZeroCal;
  });

  return filtered.length > 0 ? filtered : parsed.items;
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
