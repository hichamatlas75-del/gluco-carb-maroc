import { FoodRepository } from '../data/foods.js?v=16';
import { SupabaseService } from './supabaseClient.js?v=17';

/**
 * Service de Reconnaissance Alimentaire Haute Définition (v11) :
 * - Image d'affichage 100% Haute Définition (aucune dégradation visuelle à l'écran)
 * - Image d'analyse IA en 720px (qualité 0.82) : conserve tous les détails
 * - Modèles Gemini 3 : gemini-3.5-flash-lite, gemini-3.8-flash, gemini-3.5-flash
 * - Fallback résilient : Cloudflare Pages /api/scan -> Direct Client Google Generative API
 * - Clé par défaut intégrée + Support des clés personnalisées
 */

const DEFAULT_GEMINI_KEY = 'AQ.Ab8RN6IcD0t6smDPSNTKH1wEPUYRFjYuSCUU5FwipEkAAHmRsg';
const VISION_MODELS = ['gemini-3.5-flash-lite', 'gemini-3.8-flash', 'gemini-3.5-flash'];

function normalizeCoord(val, fallback) {
  const n = Number(val);
  if (Number.isNaN(n) || n <= 0) return fallback;
  const pct = n > 100 ? n / 10 : n;
  return Math.min(82, Math.max(18, Math.round(pct)));
}

export const VisionAnalyzer = {
  /**
   * Prépare une image nette pour l'IA tout en gardant une excellente définition
   */
  compressImageSource(source, maxDim = 800, quality = 0.85) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Timeout image')), 3500);
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
   * Normalise et enrichit les items bruts retournés par l'IA avec notre base calibrée
   */
  mapRawItems(rawItems) {
    if (!Array.isArray(rawItems) || rawItems.length === 0) {
      return [];
    }

    // Filtrer l'eau pure ou objets non caloriques s'ils ont été retournés par inadvertance
    const validItems = rawItems.filter(it => {
      const name = String(it.customName || it.foodId || '').toLowerCase();
      const isWater = (name.includes('eau') || name.includes('water')) && !name.includes('gateau') && !name.includes('chapeau');
      const isZeroCal = Number(it.carbs100g || 0) === 0 && Number(it.fiber100g || 0) === 0 && isWater;
      return !isZeroCal;
    });

    const itemsToProcess = validItems.length > 0 ? validItems : rawItems;

    return itemsToProcess.map((item, idx) => {
      const dbFood = FoodRepository.getFoodById(item.foodId)
        || this.findLocalByName(item.customName)
        || this.findLocalByName(item.foodId);
      const fallbackX = 28 + ((idx * 22) % 48);
      const fallbackY = 30 + ((idx * 18) % 45);

      if (dbFood) {
        // Garde-fou portion marocaine individuelle (max 90g pour le pain)
        let grams = Math.max(5, Math.round(Number(item.grams) || dbFood.defaultGrams));
        if (dbFood.category === 'pains' && grams > 120) {
          grams = Math.min(grams, 85);
        }

        return {
          foodId: dbFood.id,
          customName: item.customName || dbFood.name,
          grams,
          carbs100g: dbFood.carbs100g,
          protein100g: typeof item.protein100g === 'number' ? item.protein100g : (dbFood.protein100g || 0),
          fiber100g: dbFood.fiber100g,
          gi: dbFood.gi,
          refPortion: dbFood.refPortion,
          x: normalizeCoord(item.x, fallbackX),
          y: normalizeCoord(item.y, fallbackY),
          portionWarning: item.portionWarning || null
        };
      }

      return {
        foodId: `custom_${Date.now()}_${idx}`,
        customName: item.customName || 'Aliment détecté',
        grams: Math.max(5, Math.round(Number(item.grams) || 100)),
        carbs100g: Math.max(0, Number(item.carbs100g) ?? 22),
        protein100g: Math.max(0, Number(item.protein100g) ?? 0),
        fiber100g: Math.max(0, Number(item.fiber100g) ?? 1),
        gi: Math.min(100, Math.max(0, Number(item.gi) ?? 55)),
        refPortion: 'Estimé par IA Vision',
        x: normalizeCoord(item.x, fallbackX),
        y: normalizeCoord(item.y, fallbackY),
        portionWarning: item.portionWarning || null
      };
    });
  },

  /**
   * Appel via le Proxy Serverless Cloudflare Pages Functions (/api/scan ou fallback /api/analyze)
   */
  async callEdgeProxy(base64Data, apiKey, signal) {
    const headers = { 'Content-Type': 'application/json' };
    const token = SupabaseService.getAccessToken();
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    let scanRes = null;
    try {
      scanRes = await fetch('/api/scan', {
        method: 'POST',
        headers,
        body: JSON.stringify({ imageBase64: base64Data, apiKey }),
        signal
      });
    } catch (e) {
      if (signal?.aborted) throw e;
    }

    if (scanRes) {
      if (scanRes.status === 404) {
        const err = new Error('Endpoint /api/scan non disponible (hébergement statique)');
        err.code = 'PROXY_404';
        throw err;
      }
      if (scanRes.ok) {
        const data = await scanRes.json();
        return this.mapRawItems(data.items || []);
      }
      if (scanRes.status === 401) {
        const errData = await scanRes.json().catch(() => ({}));
        const err = new Error(errData.error || 'Clé API Gemini requise ou invalide');
        err.code = 'UNAUTHORIZED';
        throw err;
      }
    }

    // Fallback sur /api/analyze si /api/scan a renvoyé 500/502
    const res2 = await fetch('/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imageBase64: base64Data, apiKey }),
      signal
    });

    if (res2.status === 404) {
      const err = new Error('Endpoint /api/analyze non disponible');
      err.code = 'PROXY_404';
      throw err;
    }
    if (!res2.ok) {
      const err = new Error(`Edge HTTP ${res2.status}`);
      err.code = res2.status === 401 ? 'UNAUTHORIZED' : 'EDGE_ERROR';
      throw err;
    }
    const data2 = await res2.json();
    return this.mapRawItems(data2.items || []);
  },

  /**
   * Appel direct au service Google Generative Language API
   */
  async callSingleVisionModel(modelName, base64Data, apiKey, signal) {
    const prompt = `Tu es un expert en nutrition clinique et diabétologie. Analyse cette photo de repas :
1. Identifie uniquement les aliments et boissons caloriques consommés par UNE SEULE personne.
2. EXCLUSION OBLIGATOIRE : NE PAS inclure l'eau pure (bouteille d'eau, verre d'eau minérale, carafe), ni les théières vides, couverts, serviettes ou objets sans calories.
3. PORTION INDIVIDUELLE : Estime la portion réelle consommée par une personne pour son repas. Ne compte JAMAIS une corbeille entière de pain : pour le pain (Khobz, pain céréales, baguette), compte la portion d'une personne soit 1 morceau (~60g à 80g max). Pour les œufs (omelette, khlii), compte la portion d'une personne (~120g à 180g max).
4. Pour le pain aux céréales ou complet, les glucides nets sont de ~35g/100g (car riche en fibres).

Réponds UNIQUEMENT en JSON strict avec ce format :
{"items":[{"foodId":"id_court","customName":"Nom précis en français","grams":70,"carbs100g":42,"protein100g":10,"fiber100g":7,"gi":52,"x":50,"y":50}]}`;

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
        temperature: 0.1,
        responseMimeType: 'application/json'
      }
    });

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${encodeURIComponent(apiKey)}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: requestBody,
      signal
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      const err = new Error(errData?.error?.message || `HTTP ${response.status}`);
      err.code = response.status === 401 || response.status === 400 || response.status === 403 ? 'UNAUTHORIZED' : (response.status === 429 ? 'RATE_LIMIT' : `HTTP_${response.status}`);
      throw err;
    }

    const json = await response.json();
    const parts = json?.candidates?.[0]?.content?.parts || [];
    // Récupérer la partie texte sans inclure les réflexions / reasoning thought
    const rawText = parts.find(p => !p.thought && p.text)?.text || parts[0]?.text || '';
    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('Format JSON non trouvé');

    const parsed = JSON.parse(jsonMatch[0]);
    return this.mapRawItems(parsed.items || []);
  },

  /**
   * Détection principale : Edge Proxy Cloudflare (/api/scan) avec basculement automatique
   * direct client vers Google Generative AI (gemini-3.5-flash-lite / gemini-3.8-flash)
   */
  async detectWithGemini(compressedDataUrl, userApiKey) {
    const base64Data = compressedDataUrl.includes(',') ? compressedDataUrl.split(',')[1] : compressedDataUrl;
    const effectiveKey = (userApiKey && typeof userApiKey === 'string' && userApiKey.trim().length >= 15)
      ? userApiKey.trim()
      : DEFAULT_GEMINI_KEY;

    // 1. Essayer le proxy Cloudflare en premier lieu
    const edgeCtrl = new AbortController();
    const edgeTimer = setTimeout(() => edgeCtrl.abort(), 12000);

    try {
      const items = await this.callEdgeProxy(base64Data, userApiKey || '', edgeCtrl.signal);
      clearTimeout(edgeTimer);
      return { success: true, items, source: 'edge' };
    } catch (proxyErr) {
      clearTimeout(edgeTimer);
      console.warn('Proxy Edge non disponible, basculement vers appel direct Gemini :', proxyErr.message);
    }

    // 2. Basculement direct client avec la clé effective
    let lastError = null;
    for (const model of VISION_MODELS) {
      const clientCtrl = new AbortController();
      const clientTimer = setTimeout(() => clientCtrl.abort(), 14000);
      try {
        const items = await this.callSingleVisionModel(model, base64Data, effectiveKey, clientCtrl.signal);
        clearTimeout(clientTimer);
        return { success: true, items, source: `client-${model}` };
      } catch (err) {
        clearTimeout(clientTimer);
        lastError = err;
        console.warn(`Modèle direct ${model} échoué :`, err.message);
        // Si la clé est déclarée invalide (401/403), inutile de tester les autres modèles avec la même clé
        if (err.code === 'UNAUTHORIZED') break;
      }
    }

    return {
      success: false,
      items: [],
      error: lastError?.message || 'Reconnaissance IA indisponible',
      code: lastError?.code || 'FAILED'
    };
  },

  /**
   * Test de connectivité en direct pour les paramètres utilisateur
   */
  async testConnection(customKey) {
    const key = (customKey && typeof customKey === 'string' && customKey.trim().length >= 15)
      ? customKey.trim()
      : DEFAULT_GEMINI_KEY;

    for (const model of VISION_MODELS) {
      try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`;
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contents: [{ parts: [{ text: 'ping' }] }] })
        });
        if (res.ok) {
          return { success: true, model };
        }
        if (res.status === 404) continue;
        const data = await res.json().catch(() => ({}));
        return { success: false, status: res.status, message: data?.error?.message || `HTTP ${res.status}` };
      } catch (e) {
        return { success: false, message: e.message };
      }
    }
    return { success: false, message: 'Tous les modèles testés sont indisponibles' };
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
    if (q.includes('céréale') || q.includes('cereale') || q.includes('graine') || (q.includes('pain') && q.includes('noir'))) {
      return FoodRepository.getFoodById('pain-cereales');
    }
    if (q.includes('complet') || q.includes('zraa') || q.includes('intégral') || q.includes('integral')) {
      return FoodRepository.getFoodById('khobz-complet');
    }
    if (q.includes('orge') || q.includes('ch3ir') || q.includes('chayir')) {
      return FoodRepository.getFoodById('khobz-ch3ir');
    }
    if (q.includes('oeuf') || q.includes('œuf') || q.includes('egg') || q.includes('baid') || q.includes('khlii') || q.includes('khlea') || q.includes('omelette')) {
      return FoodRepository.getFoodById('oeufs-plat');
    }
    if (q.includes('jben') || q.includes('fromage frais') || q.includes('fromage blanc')) {
      return FoodRepository.getFoodById('jben-huile-olive');
    }
    if (q.includes('sardine')) {
      return FoodRepository.getFoodById('sardines-grillees');
    }
    if (q.includes('poulet') || q.includes('djaj')) {
      return FoodRepository.getFoodById('poulet-grille');
    }
    if (q.includes('kefta') || q.includes('viande hachée')) {
      return FoodRepository.getFoodById('kefta-grillee');
    }
    if (q.includes('salade') && (q.includes('marocaine') || q.includes('tomate') || q.includes('concombre'))) {
      return FoodRepository.getFoodById('salade-marocaine');
    }
    if (q.includes('khobz') || q.includes('pain blanc') || q.includes('pain marocain') || q.includes('pain')) {
      return FoodRepository.getFoodById('khobz-blanc');
    }
    if (q.includes('msemen') || q.includes('msmen') || q.includes('rghaif')) return FoodRepository.getFoodById('msemen');
    if (q.includes('meloui') || q.includes('mloui')) return FoodRepository.getFoodById('meloui');
    if (q.includes('baghrir') || q.includes('mille trous')) return FoodRepository.getFoodById('baghrir');
    if (q.includes('harcha')) return FoodRepository.getFoodById('harcha');
    if (q.includes('harira')) return FoodRepository.getFoodById('harira');
    if (q.includes('couscous')) return FoodRepository.getFoodById('couscous-semoule');
    if (q.includes('loubia')) return FoodRepository.getFoodById('loubia');
    if (q.includes('lentille') || q.includes('adass')) return FoodRepository.getFoodById('adass');
    if (q.includes('bissara')) return FoodRepository.getFoodById('bissara');
    if (q.includes('chebakia')) return FoodRepository.getFoodById('chebakia');
    if (q.includes('miel') || q.includes('honey') || q.includes('amlou')) return FoodRepository.getFoodById('miel-beurre');
    if (q.includes('jus d\'orange') || q.includes('orange_juice') || q.includes('orange juice') || q.includes('jus orange')) return FoodRepository.getFoodById('jus-orange');
    if (q.includes('atay') || q.includes('thé à la menthe') || q.includes('the a la menthe') || q.includes('mint tea')) return FoodRepository.getFoodById('atay-sucre');
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
