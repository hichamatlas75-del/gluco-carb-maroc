/**
 * Cloudflare Pages Edge Function : /api/analyze (Fallback)
 * Analyse de secours pour plats et boissons.
 */

const WATER_WORD_RE = /(^|[^a-zà-öø-ÿ])(eau|eaux|water)([^a-zà-öø-ÿ]|$)/i;

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

    if (!apiKey || typeof apiKey !== 'string' || apiKey.trim().length < 15) {
      return new Response(JSON.stringify({
        error: 'Clé API Gemini non configurée.'
      }), {
        status: 401,
        headers: corsHeaders
      });
    }

    const prompt = `Tu es un médecin nutritionniste expert en diabétologie, nutrition sportive et gastronomie marocaine et méditerranéenne.
Analyse la photo de ce repas :
1. EXCLUSION OBLIGATOIRE : NE PAS inclure l'eau pure (bouteille d'eau, verre d'eau minérale, carafe), ni les théières sans sucre, couverts, serviettes ou objets sans calories.
2. PORTION INDIVIDUELLE : Estime uniquement ce qu'UNE SEULE personne consomme pour son repas. Pour le pain (Khobz, pain céréales, baguette), compte 1 morceau (~60g à 80g max). Pour les œufs (omelette, au plat), compte la portion normale (~120g à 180g max).
3. PETIT-DÉJEUNER MAROCAIN & CONDIMENTS (ATTENTION CONFUSIONS FRÉQUENTES) :
   - HUILE D'OLIVE (Zit Zitoun) vs MIEL : Dans un repas avec des œufs (omelette, au plat) ou du pain, toute coupelle, ramequin ou saucière contenant un liquide huileux (doré, ambré, vert) est de l'HUILE D'OLIVE ("huile-olive-pure", 0g glucides, 100g lipides), JAMAIS du miel ni de la confiture !
   - JBEN BELDI (Fromage frais) vs BEURRE : La pâte blanche ou fromage servi avec le pain ou dans l'huile est du "Jben beldi" ("jben-huile-olive" : ~14g protéines/100g, 2.5g glucides), JAMAIS du beurre classique.
   - OMELETTE / ŒUFS : ~13g protéines/100g, ~1.1g glucides (portion 2 œufs = ~120g).
   - PAIN AUX CÉRÉALES / COMPLET : ~35g glucides nets/100g, 10g protéines, 7g fibres.
4. foodId recommandés : "oeufs-plat", "pain-cereales", "khobz-complet", "khobz-blanc", "jben-huile-olive", "huile-olive-pure", "olives-marocaines", "poulet-grille", "sardines-grillees", "kefta-grillee", "salade-marocaine".

Réponds UNIQUEMENT en JSON strict avec ce format :
{"items":[{"foodId":"id_court","customName":"Nom précis en français","grams":70,"carbs100g":42,"protein100g":10,"fiber100g":7,"gi":52,"x":50,"y":50}]}`;

    const models = ['gemini-3.5-flash-lite', 'gemini-3.8-flash', 'gemini-3.5-flash'];
    let items = null;
    let lastError = null;

    for (const model of models) {
      try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey.trim())}`;
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
            generationConfig: {
              responseMimeType: 'application/json'
            }
          })
        });

        if (!res.ok) {
          lastError = new Error(`${model} HTTP ${res.status}`);
          continue;
        }

        const data = await res.json();
        const parts = data?.candidates?.[0]?.content?.parts || [];
        const rawText = parts.find(p => !p.thought && p.text)?.text || parts[0]?.text || '';
        const match = rawText.match(/\{[\s\S]*\}/);
        if (match) {
          const parsed = JSON.parse(match[0]);
          if (Array.isArray(parsed?.items)) {
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

    const safeNum = (v, def) => {
      const n = Number(v);
      return Number.isFinite(n) ? n : def;
    };

    const sanitized = items.map((it, idx) => ({
      foodId: it.foodId || `food_${Date.now()}_${idx}`,
      customName: it.customName || 'Aliment détecté',
      grams: Math.round(safeNum(it.grams, 100)),
      carbs100g: Math.max(0, Math.round(safeNum(it.carbs100g, 0) * 10) / 10),
      protein100g: Math.max(0, Math.round(safeNum(it.protein100g, 0) * 10) / 10),
      fiber100g: Math.max(0, Math.round(safeNum(it.fiber100g, 0) * 10) / 10),
      gi: Math.min(100, Math.max(0, Math.round(safeNum(it.gi, 50)))),
      x: Math.min(85, Math.max(15, Math.round(safeNum(it.x, 50)))),
      y: Math.min(85, Math.max(15, Math.round(safeNum(it.y, 50))))
    }));

    const filtered = sanitized.filter(it => {
      const isWater = WATER_WORD_RE.test(String(it.customName || it.foodId || ''));
      const isZeroCal = Number(it.carbs100g || 0) === 0 && Number(it.fiber100g || 0) === 0 && Number(it.protein100g || 0) === 0 && isWater;
      return !isZeroCal;
    });

    return new Response(JSON.stringify({ items: filtered.length > 0 ? filtered : sanitized }), {
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
