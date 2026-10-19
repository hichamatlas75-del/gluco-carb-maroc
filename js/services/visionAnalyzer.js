import { FoodRepository } from '../data/foods.js?v=6';

/**
 * Service de Reconnaissance Alimentaire & Plan de Secours OpenFoodFacts Maroc :
 * 1. Course parallèle (Promise.any) entre Gemini 3.5 Flash, Gemma 4 26B et Gemini 3.5 Flash-Lite
 *    avec MEDIA_RESOLUTION_LOW (266 tokens au lieu de 1064) -> Le premier qui répond gagne !
 * 2. Plan de Secours & Recherche en direct OpenFoodFacts Maroc (world.openfoodfacts.org)
 */

function normalizeCoord(val, fallback) {
  const n = Number(val);
  if (Number.isNaN(n) || n <= 0) return fallback;
  const pct = n > 100 ? n / 10 : n;
  return Math.min(82, Math.max(18, Math.round(pct)));
}

export const VisionAnalyzer = {
  /**
   * Compresse directement un File/Blob ou une URL en JPEG 320px (~14 Ko) en < 15ms.
   */
  compressImageSource(source, maxDim = 320, quality = 0.65) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Timeout compression image')), 2500);
      const img = new Image();
      let objectUrl = null;

      img.onload = () => {
        clearTimeout(timer);
        if (objectUrl) URL.revokeObjectURL(objectUrl);

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
        if (objectUrl) URL.revokeObjectURL(objectUrl);
        reject(new Error('Image illisible'));
      };

      if (source instanceof Blob) {
        objectUrl = URL.createObjectURL(source);
        img.src = objectUrl;
      } else {
        img.src = String(source);
      }
    });
  },

  /**
   * MOTEUR 1 : LogMeal Food AI API
   */
  async detectWithLogMeal(compressedDataUrl, logmealToken) {
    const resBlob = await fetch(compressedDataUrl).then(r => r.blob());
    const formData = new FormData();
    formData.append('image', resBlob, 'plate.jpg');

    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 5500);

    try {
      const segRes = await fetch('https://api.logmeal.com/v2/image/segmentation/complete', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${logmealToken}` },
        body: formData,
        signal: controller.signal
      });
      if (!segRes.ok) throw new Error('LogMeal segmentation error');
      const segData = await segRes.json();

      const nutRes = await fetch('https://api.logmeal.com/v2/nutrition/recipe/nutritionalInfo', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${logmealToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ imageId: segData.imageId }),
        signal: controller.signal
      });
      clearTimeout(t);
      if (!nutRes.ok) throw new Error('LogMeal nutrition error');
      const nutData = await nutRes.json();

      const items = (nutData.nutritional_info_per_item || []).map((item, idx) => {
        const grams = Math.round(item.serving_size || 100);
        const totalCarbsItem = item.nutritional_info?.totalNutrients?.CHOCDF?.quantity || 20;
        const fiberItem = item.nutritional_info?.totalNutrients?.FIBTG?.quantity || 2;
        const factor = grams > 0 ? 100 / grams : 1;

        return {
          foodId: `logmeal_${idx}`,
          customName: item.food_name || nutData.foodName?.[idx] || 'Aliment détecté (LogMeal)',
          grams,
          carbs100g: Math.round(totalCarbsItem * factor * 10) / 10,
          fiber100g: Math.round(fiberItem * factor * 10) / 10,
          gi: 55,
          refPortion: 'Portion mesurée LogMeal AI',
          x: 35 + ((idx * 22) % 45),
          y: 35 + ((idx * 18) % 40)
        };
      });

      return items.length > 0 ? items : null;
    } finally {
      clearTimeout(t);
    }
  },

  /**
   * Interroge un modèle Vision donné et retourne les items parsés (ou lève une erreur pour Promise.any)
   */
  async callSingleVisionModel(modelName, base64Data, apiKey, signal) {
    const prompt = `Expert nutritionniste. Identifie TOUS les aliments, gateaux, patisseries ou plats visibles sur cette photo et estime leur poids en grammes. Reponds uniquement en JSON: {"items":[{"foodId":"id_ou_custom","customName":"Nom precis en francais","grams":130,"carbs100g":22.5,"fiber100g":0.5,"gi":52,"x":50,"y":50}]}`;

    const generationConfig = modelName.startsWith('gemini')
      ? {
          responseMimeType: 'application/json',
          temperature: 0.1,
          mediaResolution: 'MEDIA_RESOLUTION_LOW',
          thinkingConfig: { thinkingLevel: 'MINIMAL' }
        }
      : {
          temperature: 0.1
        };

    const requestBody = JSON.stringify({
      contents: [
        {
          parts: [
            { text: prompt },
            { inlineData: { mimeType: 'image/jpeg', data: base64Data } }
          ]
        }
      ],
      generationConfig
    });

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${encodeURIComponent(apiKey)}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: requestBody,
      signal
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const json = await response.json();
    const rawText = json?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON');

    const parsed = JSON.parse(jsonMatch[0]);
    if (!Array.isArray(parsed.items) || parsed.items.length === 0) {
      throw new Error('Empty items');
    }

    return parsed.items.map((item, idx) => {
      const dbFood = FoodRepository.getFoodById(item.foodId)
        || this.findLocalByName(item.customName)
        || this.findLocalByName(item.foodId);
      const fallbackX = 28 + ((idx * 22) % 48);
      const fallbackY = 30 + ((idx * 18) % 45);

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
        grams: Math.max(5, Math.round(Number(item.grams) || 110)),
        carbs100g: Math.max(0, Number(item.carbs100g) ?? 22),
        fiber100g: Math.max(0, Number(item.fiber100g) ?? 1),
        gi: Math.min(100, Math.max(0, Number(item.gi) ?? 55)),
        refPortion: 'Estimé par IA Vision',
        isCustom: true,
        x: normalizeCoord(item.x, fallbackX),
        y: normalizeCoord(item.y, fallbackY)
      };
    });
  },

  /**
   * MOTEUR 2 : Course parallèle (Promise.any) entre Gemini 3.5 Flash et Gemma 4 26B Vision
   * Dès que le modèle le plus rapide répond (~1.5s à 4s), les autres sont annulés !
   */
  async detectWithGemini(compressedDataUrl, apiKey) {
    if (!apiKey) return null;

    const base64Data = compressedDataUrl.split(',')[1];
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 11000);

    try {
      const winner = await Promise.any([
        this.callSingleVisionModel('gemini-3.5-flash', base64Data, apiKey, controller.signal),
        this.callSingleVisionModel('gemma-4-26b-a4b-it', base64Data, apiKey, controller.signal)
      ]);
      clearTimeout(timeoutId);
      controller.abort(); // Annule immédiatement la requête restante
      return winner;
    } catch {
      clearTimeout(timeoutId);
      return null;
    }
  },

  /**
   * Associe intelligemment le nom reconnu par l'IA avec notre base locale calibrée
   */
  findLocalByName(name) {
    if (!name) return null;
    const q = String(name).toLowerCase().trim();
    if (q.includes('san sebastian') || q.includes('cheesecake') || q.includes('basque') || q.includes('fromage blanc')) {
      return FoodRepository.getFoodById('cheesecake-san-sebastian');
    }
    if (q.includes('mille-feuille') || q.includes('millefeuille') || q.includes('mille feuille')) {
      return FoodRepository.getFoodById('mille-feuille');
    }
    if (q.includes('tiramisu')) return FoodRepository.getFoodById('tiramisu');
    if (q.includes('croissant') || q.includes('petit pain') || q.includes('pain au chocolat')) {
      return FoodRepository.getFoodById('croissant-petit-pain');
    }
    if (q.includes('khobz') || q.includes('pain blanc') || q.includes('pain marocain')) {
      return FoodRepository.getFoodById('khobz-blanc');
    }
    if (q.includes('msemen')) return FoodRepository.getFoodById('msemen');
    if (q.includes('baghrir')) return FoodRepository.getFoodById('baghrir');
    if (q.includes('harcha')) return FoodRepository.getFoodById('harcha');
    if (q.includes('harira')) return FoodRepository.getFoodById('harira');
    if (q.includes('couscous')) return FoodRepository.getFoodById('couscous-semoule');
    if (q.includes('loubia')) return FoodRepository.getFoodById('loubia');
    if (q.includes('lentille') || q.includes('adass')) return FoodRepository.getFoodById('adass');
    if (q.includes('bissara')) return FoodRepository.getFoodById('bissara');
    if (q.includes('chebakia')) return FoodRepository.getFoodById('chebakia');
    if (q.includes('tacos')) return FoodRepository.getFoodById('tacos-marocain');
    if (q.includes('pizza')) return FoodRepository.getFoodById('pizza-part');
    return null;
  },

  /**
   * PLAN DE SECOURS : Recherche en direct sur OpenFoodFacts Maroc + Monde
   */
  async searchOpenFoodFactsMaroc(queryText, timeoutMs = 4000) {
    const q = String(queryText || '').trim();
    if (q.length < 2) return [];

    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const url = `https://world.openfoodfacts.org/cgi/search.pl?search_terms=${encodeURIComponent(q)}&search_simple=1&action=process&json=1&page_size=10&fields=code,product_name,product_name_fr,brands,nutriments,serving_size,quantity`;
      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(t);
      if (!res.ok) return [];

      const data = await res.json();
      return (data.products || [])
        .filter(p => (p.product_name_fr || p.product_name) && p.nutriments && p.nutriments.carbohydrates_100g !== undefined)
        .slice(0, 6)
        .map((p, idx) => {
          const carbs = Math.max(0, Math.round((Number(p.nutriments.carbohydrates_100g) || 0) * 10) / 10);
          const fiber = Math.max(0, Math.round((Number(p.nutriments.fiber_100g) || 0) * 10) / 10);
          const parsedServing = parseInt(String(p.serving_size || ''), 10);
          const defaultGrams = (!Number.isNaN(parsedServing) && parsedServing >= 15 && parsedServing <= 400)
            ? parsedServing
            : 100;

          return {
            id: `off_${p.code || idx}`,
            name: p.product_name_fr || p.product_name,
            darija: p.brands ? `OpenFoodFacts • ${p.brands}` : 'OpenFoodFacts Maroc',
            category: 'openfoodfacts',
            carbs100g: carbs,
            fiber100g: fiber,
            gi: carbs > 40 ? 68 : carbs > 15 ? 55 : 35,
            defaultGrams,
            refPortion: p.serving_size ? `Portion ${p.serving_size}` : '100g (OpenFoodFacts)'
          };
        });
    } catch {
      clearTimeout(t);
      return [];
    }
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
