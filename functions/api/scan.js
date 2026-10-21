/**
 * Cloudflare Pages Function : /api/scan
 * Proxy IA Vision sécurisé avec validation et garde-fous nutritionnels marocains.
 */

const FALLBACK_KEY = 'AQ.Ab8RN6IcD0t6smDPSNTKH1wEPUYRFjYuSCUU5FwipEkAAHmRsg';

const MOROCCAN_PORTION_SAFEGUARDS = {
  pains: { maxSafeGrams: 200, normalPortion: 70, label: '1/4 de pain individuel' },
  msemen: { maxSafeGrams: 160, normalPortion: 85, label: '1 msemen individuel' },
  harcha: { maxSafeGrams: 150, normalPortion: 80, label: '1 part de harcha' },
  oeufs: { maxSafeGrams: 180, normalPortion: 120, label: 'Portion 2 œufs' },
  huile: { maxSafeGrams: 40, normalPortion: 15, label: '1 cuillère à soupe' }
};

export async function onRequest(context) {
  const { request, env } = context;

  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Content-Type': 'application/json'
  };

  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Méthode non autorisée' }), {
      status: 405,
      headers: corsHeaders
    });
  }

  try {
    const body = await request.json().catch(() => ({}));
    const base64Input = body?.imageBase64;
    if (!base64Input) {
      return new Response(JSON.stringify({ error: 'Image base64 manquante' }), {
        status: 400,
        headers: corsHeaders
      });
    }

    const cleanBase64 = base64Input.includes(',') ? base64Input.split(',')[1] : base64Input;
    const apiKey = env?.GEMINI_API_KEY || body?.apiKey || FALLBACK_KEY;

    if (!apiKey || typeof apiKey !== 'string' || apiKey.trim().length < 15) {
      return new Response(JSON.stringify({
        error: 'Clé API Gemini non configurée. Veuillez ajouter votre clé dans Synthèse > Paramètres IA avancés ou définir la variable GEMINI_API_KEY sur Cloudflare.'
      }), {
        status: 401,
        headers: corsHeaders
      });
    }

    const systemPrompt = `Tu es un médecin nutritionniste expert en diabétologie et spécialiste de la gastronomie marocaine.
Analyse la photo de ce repas :
1. EXCLUSION STRICTE : N'inclus JAMAIS l'eau pure (bouteille, carafe, verre d'eau plate/gazeuse), ni les théières sans sucre, couverts, serviettes ou objets sans calories.
2. PORTION INDIVIDUELLE : Estime uniquement ce qu'UNE SEULE personne va consommer pour son repas. Ne compte JAMAIS une corbeille entière de pain (1 part de Khobz ou Batbout = 60g à 80g max). Pour un Tagine partagé, compte la part individuelle (ex: ~120g viande + ~100g légumes).
3. CUISINE MAROCAINE :
   - Khobz dar (farine/semoule) : ~45g glucides/100g, 8.5g protéines.
   - Pain complet ou céréales : ~35g glucides nets/100g (riche en fibres).
   - Huile d'olive : 0g glucides, 0g protéines, 100g lipides.
   - Kefta marocaine : ~14g protéines/100g, ~2g glucides.
   - Sardines grillées : ~20g protéines/100g, 0g glucides.
4. Position x, y : Indique le centre de chaque aliment en pourcentage (0 à 100) par rapport à l'image.

Réponds UNIQUEMENT en JSON strict sous cette forme :
{"items":[{"foodId":"id_court","customName":"Nom précis en français","grams":70,"carbs100g":42,"protein100g":10,"fiber100g":7,"gi":52,"x":50,"y":50}]}`;

    const models = ['gemini-3.5-flash-lite', 'gemini-3.8-flash', 'gemini-3.5-flash'];
    let parsedData = null;
    let lastError = null;

    for (const model of models) {
      try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey.trim())}`;
        const geminiRes = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [
              {
                parts: [
                  { text: systemPrompt },
                  { inlineData: { mimeType: 'image/jpeg', data: cleanBase64 } }
                ]
              }
            ],
            generationConfig: {
              responseMimeType: 'application/json'
            }
          })
        });

        if (!geminiRes.ok) {
          const errBody = await geminiRes.text();
          lastError = new Error(`${model} HTTP ${geminiRes.status}: ${errBody}`);
          continue;
        }

        const gData = await geminiRes.json();
        const parts = gData?.candidates?.[0]?.content?.parts || [];
        const rawText = parts.find(p => !p.thought && p.text)?.text || parts[0]?.text || '';
        const match = rawText.match(/\{[\s\S]*\}/);
        if (match) {
          const parsed = JSON.parse(match[0]);
          if (Array.isArray(parsed?.items)) {
            parsedData = parsed;
            break;
          }
        }
      } catch (err) {
        lastError = err;
      }
    }

    if (!parsedData) {
      return new Response(JSON.stringify({
        error: `Erreur analyse IA : ${lastError?.message || 'Réponse invalide'}`
      }), {
        status: 502,
        headers: corsHeaders
      });
    }

    const items = (parsedData.items || []).filter(it => {
      const n = String(it.customName || it.foodId || '').toLowerCase();
      const isWater = (n.includes('eau') || n.includes('water')) && !n.includes('gateau');
      return !isWater;
    }).map(it => {
      let grams = Math.max(5, Math.round(Number(it.grams) || 100));
      let warning = null;
      const ln = (it.customName || '').toLowerCase();

      if (ln.includes('pain') || ln.includes('khobz') || ln.includes('batbout')) {
        if (grams > MOROCCAN_PORTION_SAFEGUARDS.pains.maxSafeGrams) {
          warning = `Portion ajustée à ${MOROCCAN_PORTION_SAFEGUARDS.pains.normalPortion}g (1/4 de pain individuel)`;
          grams = MOROCCAN_PORTION_SAFEGUARDS.pains.normalPortion;
        }
      } else if (ln.includes('msemen') && grams > MOROCCAN_PORTION_SAFEGUARDS.msemen.maxSafeGrams) {
        warning = `Portion ajustée à 1 msemen (~85g)`;
        grams = MOROCCAN_PORTION_SAFEGUARDS.msemen.normalPortion;
      }

      const safeNum = (v, def) => {
        const n = Number(v);
        return Number.isFinite(n) ? n : def;
      };

      return {
        foodId: it.foodId || `food_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`,
        customName: it.customName || 'Aliment détecté',
        grams,
        carbs100g: Math.max(0, Math.round(safeNum(it.carbs100g, 0) * 10) / 10),
        protein100g: Math.max(0, Math.round(safeNum(it.protein100g, 0) * 10) / 10),
        fiber100g: Math.max(0, Math.round(safeNum(it.fiber100g, 0) * 10) / 10),
        gi: Math.min(100, Math.max(0, Math.round(safeNum(it.gi, 50)))),
        x: Math.min(85, Math.max(15, Math.round(safeNum(it.x, 50)))),
        y: Math.min(85, Math.max(15, Math.round(safeNum(it.y, 50)))),
        portionWarning: warning
      };
    });

    return new Response(JSON.stringify({ items }), {
      status: 200,
      headers: corsHeaders
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message || 'Erreur analyse photo' }), {
      status: 500,
      headers: corsHeaders
    });
  }
}
