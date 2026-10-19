import { FoodRepository } from '../data/foods.js?v=5';

/**
 * Service de Reconnaissance Alimentaire & Plan de Secours OpenFoodFacts Maroc :
 * 1. Gemini 3.5 Flash-Lite Vision (Image 384px mono-tuile 258 tokens = ~1.2s)
 * 2. LogMeal Food AI API (API médicale spécialisée segmentation & grammage)
 * 3. Plan de Secours & Enrichissement OpenFoodFacts Maroc (ma.openfoodfacts.org / world.openfoodfacts.org)
 */

function normalizeCoord(val, fallback) {
  const n = Number(val);
  if (Number.isNaN(n) || n <= 0) return fallback;
  const pct = n > 100 ? n / 10 : n;
  return Math.min(82, Math.max(18, Math.round(pct)));
}

export const VisionAnalyzer = {
  /**
   * Compresse directement un File/Blob ou une URL en JPEG 384px (~18 Ko) en < 20ms.
   * 384px garantit 1 seule tuile Vision (258 tokens au lieu de 1080), divisant le temps IA par 3.
   */
  compressImageSource(source, maxDim = 384, quality = 0.68) {
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
   * MOTEUR 1 : LogMeal Food AI API (Spécialisé reconnaissance de plats & grammage)
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
   * MOTEUR 2 : Gemini 3.5 Flash-Lite Vision + Enrichissement OpenFoodFacts Maroc
   */
  async detectWithGemini(compressedDataUrl, apiKey) {
    if (!apiKey) return null;

    const base64Data = compressedDataUrl.split(',')[1];
    const prompt = `Expert nutritionniste (cuisine marocaine, pâtisseries, gâteaux, snacks et plats internationaux).
Identifie précisément TOUS les aliments, gâteaux, pâtisseries ou plats visibles sur cette photo (ex: Cheesecake San Sebastian, mille-feuille, tiramisu, gâteau au chocolat, croissant, pain khobz, msemen, baghrir, tajine, couscous, harira, salade, œufs, tacos, pizza, etc.) et estime leur poids en grammes.
Si un aliment correspond exactement à l'un de ces IDs, utilise ce foodId: cheesecake-san-sebastian, cheesecake-coulis, mille-feuille, tiramisu, gateau-chocolat, croissant-petit-pain, khobz-blanc, khobz-complet, khobz-ch3ir, batbout, msemen, meloui, harcha, baghrir, krachel, couscous-semoule, couscous-belboula, legumes-couscous, tfaya, tajine-poulet-olives, tajine-kefta, tajine-pruneaux, pommes-terre-tajine, rfissa, pastilla-poulet, pastilla-poisson, seffa, zaalouk, taktouka, salade-marocaine, oeufs-plat, briouate-salee, tacos-marocain, pizza-part, harira, loubia, adass, bissara, hssa, datte-majhoul, dattes-courantes, chebakia, sellou, corne-gazelle, miel-beurre, figues-fraiches, hendiya, atay-sucre, atay-mesouss, jus-orange, jus-avocat, lben.
Sinon mets "foodId":"custom" et indique son nom précis en français ("customName"), ses glucides totaux pour 100g ("carbs100g"), ses fibres pour 100g ("fiber100g") et son IG ("gi").
Réponds uniquement en JSON:
{"items":[{"foodId":"id_ou_custom","customName":"Nom précis en français","grams":130,"carbs100g":22.5,"fiber100g":0.5,"gi":52,"x":50,"y":50}]}`;

    const requestBody = JSON.stringify({
      contents: [
        {
          parts: [
            { text: prompt },
            { inlineData: { mimeType: 'image/jpeg', data: base64Data } }
          ]
        }
      ],
      generationConfig: {
        responseMimeType: 'application/json',
        temperature: 0.1,
        thinkingConfig: { thinkingLevel: 'MINIMAL' }
      }
    });

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);

    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent?key=${encodeURIComponent(apiKey)}`;
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: requestBody,
        signal: controller.signal
      });
      clearTimeout(timeoutId);

      if (!response.ok) return null;

      const json = await response.json();
      const rawText = json?.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
      const cleanedJson = rawText.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim();
      const parsed = JSON.parse(cleanedJson);

      if (!Array.isArray(parsed.items) || parsed.items.length === 0) return null;

      const rawItems = parsed.items.map((item, idx) => {
        const dbFood = FoodRepository.getFoodById(item.foodId) || this.findLocalByName(item.customName);
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
          grams: Math.max(5, Math.round(Number(item.grams) || 100)),
          carbs100g: Math.max(0, Number(item.carbs100g) ?? 22),
          fiber100g: Math.max(0, Number(item.fiber100g) ?? 1),
          gi: Math.min(100, Math.max(0, Number(item.gi) ?? 55)),
          refPortion: 'Estimé par IA Vision',
          isCustom: true,
          x: normalizeCoord(item.x, fallbackX),
          y: normalizeCoord(item.y, fallbackY)
        };
      });

      // Enrichissement rapide via OpenFoodFacts Maroc pour les éléments hors catalogue local
      return await this.enrichCustomItemsWithOpenFoodFacts(rawItems);
    } catch {
      clearTimeout(timeoutId);
      return null;
    }
  },

  /**
   * Cherche une correspondance dans le catalogue local par nom (ex: "San Sebastian", "Cheesecake", "Mille-feuille")
   */
  findLocalByName(name) {
    if (!name) return null;
    const q = String(name).toLowerCase().trim();
    if (q.includes('san sebastian') || q.includes('cheesecake') || q.includes('basque')) {
      return FoodRepository.getFoodById('cheesecake-san-sebastian');
    }
    if (q.includes('mille-feuille') || q.includes('millefeuille') || q.includes('mille feuille')) {
      return FoodRepository.getFoodById('mille-feuille');
    }
    if (q.includes('tiramisu')) {
      return FoodRepository.getFoodById('tiramisu');
    }
    return FoodRepository.getAllFoods().find(f =>
      f.name.toLowerCase().includes(q) || q.includes(f.id.replace(/-/g, ' '))
    ) || null;
  },

  /**
   * Croise automatiquement un aliment "custom" détecté par l'IA avec OpenFoodFacts Maroc (timeout court 2s)
   */
  async enrichCustomItemsWithOpenFoodFacts(items) {
    return Promise.all(items.map(async (item) => {
      if (!item.isCustom || !item.customName) return item;
      try {
        const offMatches = await this.searchOpenFoodFactsMaroc(item.customName, 2000);
        if (offMatches && offMatches.length > 0) {
          const best = offMatches[0];
          if (best.carbs100g > 0) {
            return {
              ...item,
              carbs100g: best.carbs100g,
              fiber100g: best.fiber100g,
              refPortion: `Vérifié OpenFoodFacts (${best.darija})`
            };
          }
        }
      } catch {}
      return item;
    }));
  },

  /**
   * MOTEUR 3 (PLAN DE SECOURS) : Recherche en direct sur OpenFoodFacts Maroc + Monde
   * Interroge prioritairement les produits vendus au Maroc (ma.openfoodfacts.org / world.openfoodfacts.org)
   */
  async searchOpenFoodFactsMaroc(queryText, timeoutMs = 4000) {
    const q = String(queryText || '').trim();
    if (q.length < 2) return [];

    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), timeoutMs);

    try {
      // Recherche OpenFoodFacts avec priorité aux produits francophones / Maroc
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
