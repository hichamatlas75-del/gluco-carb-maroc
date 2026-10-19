/**
 * Cloudflare Pages Function : /api/scan (TypeScript)
 * Proxy IA Vision sécurisé avec masquage de clé, validation et garde-fous nutritionnels marocains.
 */

import type { EventContext } from '@cloudflare/workers-types';

interface Env {
  GEMINI_API_KEY?: string;
  SUPABASE_URL?: string;
  SUPABASE_ANON_KEY?: string;
  RATE_LIMIT_KV?: KVNamespace;
}

interface ScanRequestBody {
  imageBase64: string;
  apiKey?: string;
}

interface DetectedFoodItem {
  foodId: string;
  customName: string;
  grams: number;
  carbs100g: number;
  protein100g: number;
  fiber100g: number;
  gi: number;
  x: number;
  y: number;
  portionWarning?: string | null;
}

const FALLBACK_KEY = 'AQ.Ab8RN6IcD0t6smDPSNTKH1wEPUYRFjYuSCUU5FwipEkAAHmRsg';
const FALLBACK_SUPABASE_URL = 'https://plrqzuwbnuryxtsmimyt.supabase.co';
const FALLBACK_SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBscnF6dXdibnVyeXh0c21pbXl0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI0Mzk2OTcsImV4cCI6MjEwODAxNTY5N30.Wzx1Lsh1GGETK_RidTTND1t4Ix3EjhS3qQvlGn-Xglc';

const MOROCCAN_PORTION_SAFEGUARDS = {
  pains: { maxSafeGrams: 200, normalPortion: 70, label: '1/4 de pain individuel' },
  msemen: { maxSafeGrams: 160, normalPortion: 85, label: '1 msemen individuel' },
  harcha: { maxSafeGrams: 150, normalPortion: 80, label: '1 part de harcha' },
  oeufs: { maxSafeGrams: 180, normalPortion: 120, label: 'Portion 2 œufs' },
  huile: { maxSafeGrams: 40, normalPortion: 15, label: '1 cuillère à soupe' }
};

export const onRequestPost = async (context: EventContext<Env, any, any>): Promise<Response> => {
  const { request, env } = context;
  const supabaseUrl = env?.SUPABASE_URL || FALLBACK_SUPABASE_URL;
  const supabaseAnon = env?.SUPABASE_ANON_KEY || FALLBACK_SUPABASE_ANON;

  const corsHeaders: Record<string, string> = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Content-Type': 'application/json'
  };

  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = request.headers.get('Authorization') || '';
    let isGuest = true;
    let userId = 'guest_' + (request.headers.get('CF-Connecting-IP') || 'anonymous');

    if (authHeader.startsWith('Bearer ') && supabaseUrl && supabaseAnon) {
      const token = authHeader.replace('Bearer ', '').trim();
      try {
        const verifyRes = await fetch(`${supabaseUrl}/auth/v1/user`, {
          headers: {
            'Authorization': `Bearer ${token}`,
            'apikey': supabaseAnon
          }
        });
        if (verifyRes.ok) {
          const user = (await verifyRes.json()) as { id: string };
          userId = user.id;
          isGuest = false;
        }
      } catch (_) {}
    }

    const body = (await request.json()) as ScanRequestBody;
    const base64Input = body?.imageBase64;
    if (!base64Input) {
      return new Response(JSON.stringify({ error: 'Image base64 manquante' }), {
        status: 400,
        headers: corsHeaders
      });
    }

    const cleanBase64 = base64Input.includes(',') ? base64Input.split(',')[1] : base64Input;
    const apiKey = env?.GEMINI_API_KEY || body?.apiKey || FALLBACK_KEY;

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

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(apiKey)}`;
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
          temperature: 0.1,
          responseMimeType: 'application/json'
        }
      })
    });

    let parsedData: { items: any[] };

    if (!geminiRes.ok) {
      const fallbackUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent?key=${encodeURIComponent(apiKey)}`;
      const fbRes = await fetch(fallbackUrl, {
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
          generationConfig: { temperature: 0.1 }
        })
      });
      if (!fbRes.ok) throw new Error(`Gemini error HTTP ${geminiRes.status}`);
      const fbData = (await fbRes.json()) as any;
      const rawText = fbData?.candidates?.[0]?.content?.parts?.[0]?.text || '';
      const match = rawText.match(/\{[\s\S]*\}/);
      if (!match) throw new Error('Format JSON invalide');
      parsedData = JSON.parse(match[0]);
    } else {
      const gData = (await geminiRes.json()) as any;
      const rawText = gData?.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
      parsedData = JSON.parse(rawText);
    }

    const items: DetectedFoodItem[] = (parsedData?.items || []).filter((it: any) => {
      const n = String(it.customName || it.foodId || '').toLowerCase();
      const isWater = (n.includes('eau') || n.includes('water')) && !n.includes('gateau');
      return !isWater;
    }).map((it: any) => {
      let grams = Math.max(5, Math.round(Number(it.grams) || 100));
      let warning: string | null = null;
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

      return {
        foodId: it.foodId || `food_${Date.now()}`,
        customName: it.customName || 'Aliment détecté',
        grams,
        carbs100g: Math.max(0, Math.round(Number(it.carbs100g || 0) * 10) / 10),
        protein100g: Math.max(0, Math.round(Number(it.protein100g || 0) * 10) / 10),
        fiber100g: Math.max(0, Math.round(Number(it.fiber100g || 0) * 10) / 10),
        gi: Math.min(100, Math.max(0, Math.round(Number(it.gi || 50)))),
        x: Math.min(85, Math.max(15, Math.round(Number(it.x) || 50))),
        y: Math.min(85, Math.max(15, Math.round(Number(it.y) || 50))),
        portionWarning: warning
      };
    });

    return new Response(JSON.stringify({
      items,
      isGuest,
      userId
    }), {
      status: 200,
      headers: corsHeaders
    });

  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message || 'Erreur analyse photo' }), {
      status: 500,
      headers: corsHeaders
    });
  }
};
