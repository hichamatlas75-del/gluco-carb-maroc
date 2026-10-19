import { FoodRepository } from '../data/foods.js';

/**
 * Service de reconnaissance visuelle ultra-rapide (~1 seconde) :
 * - Modèle prioritaire : gemini-3.5-flash-lite avec thinkingLevel: "MINIMAL"
 * - Compression de l'image à 512px JPEG (~30 Ko) pour un transfert instantané sur 4G/5G
 * - Timeout strict par requête (AbortController 6s) pour ne jamais bloquer l'interface
 */
const FAST_VISION_MODELS = [
  'gemini-3.5-flash-lite',
  'gemini-3.1-flash-lite',
  'gemini-3.5-flash'
];

function normalizeCoord(val, fallback) {
  const n = Number(val);
  if (Number.isNaN(n) || n <= 0) return fallback;
  // Si le modèle renvoie des coordonnées sur 1000 (standard Gemini 0..1000), convertir en %
  const pct = n > 100 ? n / 10 : n;
  return Math.min(82, Math.max(18, Math.round(pct)));
}

export const VisionAnalyzer = {
  /**
   * Redimensionne et compresse la photo en 512px JPEG (~30 Ko) en moins de 30ms
   */
  compressImageDataUrl(dataUrl, maxDim = 512, quality = 0.72) {
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve(dataUrl), 1500);
      const img = new Image();
      img.onload = () => {
        clearTimeout(timer);
        let { width, height } = img;
        if (width > maxDim || height > maxDim) {
          if (width > height) {
            height = Math.round((height * maxDim) / width);
            width = maxDim;
          } else {
            width = Math.round((width * maxDim) / height);
            height = maxDim;
          }
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.onerror = () => {
        clearTimeout(timer);
        resolve(dataUrl);
      };
      img.src = dataUrl;
    });
  },

  async detectWithGemini(rawDataUrl, apiKey) {
    if (!apiKey) return null;

    // 1. Compression ultra-légère (512px)
    const compressedUrl = await this.compressImageDataUrl(rawDataUrl, 512, 0.72);
    const base64Data = compressedUrl.split(',')[1];
    const mimeMatch = compressedUrl.match(/^data:(image\/[a-zA-Z0-9+.-]+);base64,/);
    const mimeType = mimeMatch ? mimeMatch[1] : 'image/jpeg';

    // Prompt court et direct pour minimiser le temps de génération (< 1.2s)
    const prompt = `Expert nutritionniste Maroc. Identifie chaque aliment visible sur cette photo et estime son poids réel en grammes dans l'assiette.
Si c'est un aliment marocain connu, utilise l'un de ces foodId: khobz-blanc, khobz-complet, khobz-ch3ir, batbout, msemen, meloui, harcha, baghrir, krachel, couscous-semoule, couscous-belboula, legumes-couscous, tfaya, tajine-poulet-olives, tajine-kefta, tajine-pruneaux, pommes-terre-tajine, rfissa, pastilla-poulet, pastilla-poisson, seffa, zaalouk, taktouka, briouate-salee, harira, loubia, adass, bissara, hssa, datte-majhoul, dattes-courantes, chebakia, sellou, corne-gazelle, miel-beurre, figues-fraiches, hendiya, atay-sucre, atay-mesouss, jus-orange, jus-avocat, lben.
Sinon mets "foodId":"custom" et précise ses valeurs pour 100g.
Réponds UNIQUEMENT en JSON :
{"items":[{"foodId":"id_ou_custom","customName":"Nom en français","grams":90,"carbs100g":50,"fiber100g":2.5,"gi":65,"x":50,"y":50}]}`;

    const requestBody = JSON.stringify({
      contents: [
        {
          parts: [
            { text: prompt },
            { inlineData: { mimeType, data: base64Data } }
          ]
        }
      ],
      generationConfig: {
        responseMimeType: 'application/json',
        temperature: 0.1,
        thinkingConfig: { thinkingLevel: 'MINIMAL' }
      }
    });

    // 2. Appel rapide avec timeout strict de 6.5 secondes par modèle
    for (const modelName of FAST_VISION_MODELS) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 6500);

      try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${encodeURIComponent(apiKey)}`;
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: requestBody,
          signal: controller.signal
        });
        clearTimeout(timeoutId);

        if (!response.ok) continue;

        const json = await response.json();
        const rawText = json?.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
        const cleanedJson = rawText.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim();
        const parsed = JSON.parse(cleanedJson);

        if (Array.isArray(parsed.items) && parsed.items.length > 0) {
          return parsed.items.map((item, idx) => {
            const dbFood = FoodRepository.getFoodById(item.foodId);
            const fallbackX = 32 + ((idx * 22) % 45);
            const fallbackY = 35 + ((idx * 18) % 40);

            if (dbFood) {
              return {
                foodId: dbFood.id,
                customName: item.customName || dbFood.name,
                grams: Math.max(5, Math.round(Number(item.grams) || dbFood.defaultGrams)),
                carbs100g: dbFood.carbs100g,
                fiber100g: dbFood.fiber100g,
                gi: dbFood.gi,
                refPortion: dbFood.refPortion,
                x: normalizeCoord(item.x, fallbackX),
                y: normalizeCoord(item.y, fallbackY)
              };
            }

            return {
              foodId: `custom_${Date.now()}_${idx}`,
              customName: item.customName || 'Aliment détecté',
              grams: Math.max(5, Math.round(Number(item.grams) || 100)),
              carbs100g: Math.max(0, Number(item.carbs100g) ?? 25),
              fiber100g: Math.max(0, Number(item.fiber100g) ?? 2),
              gi: Math.min(100, Math.max(0, Number(item.gi) ?? 55)),
              refPortion: 'Estimé par IA Vision',
              x: normalizeCoord(item.x, fallbackX),
              y: normalizeCoord(item.y, fallbackY)
            };
          });
        }
      } catch {
        clearTimeout(timeoutId);
      }
    }

    return null;
  },

  createDemoPlateIllustration(title) {
    const safeTitle = String(title || '').replace(/[<>&"]/g, '');
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 450">
      <rect width="600" height="450" fill="#0f172a"/>
      <circle cx="300" cy="225" r="170" fill="#1e293b" stroke="#10b981" stroke-width="3" stroke-dasharray="8 6"/>
      <circle cx="300" cy="225" r="135" fill="#334155"/>
      <text x="300" y="220" text-anchor="middle" fill="#ffffff" font-family="sans-serif" font-size="20" font-weight="bold">${safeTitle}</text>
      <text x="300" y="248" text-anchor="middle" fill="#34d399" font-family="sans-serif" font-size="13">Reconnaissance &amp; Grammage Calibrés</text>
    </svg>`;
    return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
  }
};
