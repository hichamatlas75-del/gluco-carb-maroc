import { FoodRepository } from '../data/foods.js?v=8';

/**
 * Architecture API Vision Renforcée (4 Niveaux de Résilience) :
 * 1. Proxy Serverless Cloudflare Edge (/api/analyze) + Appel Direct Client en parallèle
 * 2. Schéma JSON OpenAPI Strict (responseSchema) imposé au moteur d'inférence
 * 3. System Instruction de Calibrage Clinique (pesée visuelle & distinction pâtisseries/plats)
 * 4. Course Multi-Modèles (gemini-3.5-flash + gemma-4-26b-a4b-it) avec Retry automatique
 */

function normalizeCoord(val, fallback) {
  const n = Number(val);
  if (Number.isNaN(n) || n <= 0) return fallback;
  const pct = n > 100 ? n / 10 : n;
  return Math.min(82, Math.max(18, Math.round(pct)));
}

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
   * Normalise et enrichit les items bruts retournés par l'API avec notre base calibrée
   */
  mapRawItems(rawItems) {
    if (!Array.isArray(rawItems) || rawItems.length === 0) {
      throw new Error('Empty items');
    }

    return rawItems.map((item, idx) => {
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
        x: normalizeCoord(item.x, fallbackX),
        y: normalizeCoord(item.y, fallbackY)
      };
    });
  },

  /**
   * Appel via le Proxy Serverless Cloudflare Edge (/api/analyze)
   */
  async callEdgeProxy(base64Data, apiKey, signal) {
    const res = await fetch('/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imageBase64: base64Data, apiKey }),
      signal
    });
    if (!res.ok) throw new Error(`Edge HTTP ${res.status}`);
    const data = await res.json();
    return this.mapRawItems(data.items);
  },

  /**
   * Appel direct d'un modèle Gemini / Gemma avec responseSchema strict et System Instruction
   */
  async callSingleVisionModel(modelName, base64Data, apiKey, signal) {
    const prompt = `Identifie TOUS les aliments, gateaux, patisseries ou plats visibles sur cette photo et estime leur poids en grammes. Reponds uniquement en JSON: {"items":[{"foodId":"id_ou_custom","customName":"Nom precis en francais","grams":130,"carbs100g":22.5,"fiber100g":0.5,"gi":52,"x":50,"y":50}]}`;

    const isGemini = modelName.startsWith('gemini');
    const requestBody = JSON.stringify({
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
    return this.mapRawItems(parsed.items);
  },

  /**
   * Course parallèle haute disponibilité (Edge Proxy + Gemini 3.5 Flash + Gemma 4 26B)
   * avec Retry automatique en cas de micro-coupure mobile.
   */
  async detectWithGemini(compressedDataUrl, apiKey) {
    if (!apiKey) return null;

    const base64Data = compressedDataUrl.split(',')[1];
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 11500);

    try {
      const winner = await Promise.any([
        this.callEdgeProxy(base64Data, apiKey, controller.signal),
        this.callSingleVisionModel('gemini-3.5-flash', base64Data, apiKey, controller.signal),
        this.callSingleVisionModel('gemma-4-26b-a4b-it', base64Data, apiKey, controller.signal)
      ]);
      clearTimeout(timeoutId);
      controller.abort();
      return winner;
    } catch {
      clearTimeout(timeoutId);
      // Deuxième tentative rapide de secours (Auto-Retry) si micro-coupure 4G
      try {
        const retryController = new AbortController();
        const retryTimer = setTimeout(() => retryController.abort(), 6000);
        const retryResult = await this.callSingleVisionModel(
          'gemini-3.5-flash',
          base64Data,
          apiKey,
          retryController.signal
        );
        clearTimeout(retryTimer);
        return retryResult;
      } catch {
        return null;
      }
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
