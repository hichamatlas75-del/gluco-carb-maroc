import { FoodRepository } from '../data/foods.js?v=31';
import { SupabaseService } from './supabaseClient.js?v=31';

/**
 * Service de Reconnaissance Alimentaire Haute Définition (v11) :
 * - Image d'affichage 100% Haute Définition (aucune dégradation visuelle à l'écran)
 * - Image d'analyse IA en 720px (qualité 0.82) : conserve tous les détails
 * - Modèles Gemini 3 : gemini-3.5-flash-lite, gemini-3.8-flash, gemini-3.5-flash
 * - Fallback résilient : Cloudflare Pages /api/scan -> Direct Client Google Generative API
 * - Sécurité : aucune clé API n'est embarquée dans le code client. Le proxy utilise la variable
 *   d'environnement GEMINI_API_KEY ; l'appel direct n'est possible qu'avec une clé personnelle.
 */

const VISION_MODELS = ['gemini-3.5-flash-lite', 'gemini-3.8-flash', 'gemini-3.5-flash'];

/** Détecte l'eau pure par mot entier (évite de filtrer veau, agneau, poireau, gâteau...) */
const WATER_WORD_RE = /(^|[^a-zà-öø-ÿ])(eau|eaux|water)([^a-zà-öø-ÿ]|$)/i;
function isPlainWaterName(name) {
  return WATER_WORD_RE.test(String(name || '').toLowerCase());
}

function hasValidKey(key) {
  return Boolean(key && typeof key === 'string' && key.trim().length >= 15);
}

function normalizeCoord(val, fallback) {
  const n = Number(val);
  if (Number.isNaN(n) || n <= 0) return fallback;
  const pct = n > 100 ? n / 10 : n;
  return Math.min(82, Math.max(18, Math.round(pct)));
}

/**
 * Convertit une valeur IA en nombre fini borné, sinon valeur par défaut.
 * (Number(undefined) ?? x ne fonctionne pas : Number(undefined) vaut NaN, pas undefined.)
 */
function safeNum(val, fallback, min = 0, max = Infinity) {
  if (val === null || val === undefined || val === '') return fallback;
  const n = Number(val);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

export const VisionAnalyzer = {
  /**
   * Prépare une image nette pour l'IA tout en gardant une excellente définition
   */
  compressImageSource(source, maxDim = 800, quality = 0.85) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Délai de chargement de l\'image dépassé')), 10000);
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
      const isWater = isPlainWaterName(it.customName || it.foodId);
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
        let grams = Math.round(safeNum(item.grams, dbFood.defaultGrams || 100, 5, 1500));
        if (dbFood.category === 'pains' && grams > 120) {
          grams = Math.min(grams, 85);
        }

        return {
          foodId: dbFood.id,
          customName: item.customName || dbFood.name,
          grams,
          carbs100g: dbFood.carbs100g,
          protein100g: safeNum(item.protein100g, dbFood.protein100g || 0, 0, 100),
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
        grams: Math.round(safeNum(item.grams, 100, 5, 1500)),
        carbs100g: safeNum(item.carbs100g, 22, 0, 100),
        protein100g: safeNum(item.protein100g, 0, 0, 100),
        fiber100g: safeNum(item.fiber100g, 1, 0, 100),
        gi: Math.round(safeNum(item.gi, 55, 0, 100)),
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
      if (signal?.aborted) {
        const err = new Error('Délai d\'analyse dépassé');
        err.code = 'TIMEOUT';
        throw err;
      }
      throw e;
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
    try {
      const res2 = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageBase64: base64Data, apiKey }),
        signal
      });
      if (res2.ok) {
        const data2 = await res2.json();
        return this.mapRawItems(data2.items || []);
      }
      if (res2.status === 404) {
        const err = new Error('Endpoint /api/analyze non disponible');
        err.code = 'PROXY_404';
        throw err;
      }
      if (res2.status === 401) {
        const err = new Error('Clé API non autorisée');
        err.code = 'UNAUTHORIZED';
        throw err;
      }
    } catch (e2) {
      if (signal?.aborted) {
        const err = new Error('Délai d\'analyse dépassé');
        err.code = 'TIMEOUT';
        throw err;
      }
      // Conserver les erreurs qualifiées (PROXY_404, UNAUTHORIZED) levées ci-dessus
      if (e2 && e2.code) throw e2;
    }

    throw new Error('Le serveur proxy n\'a pas pu analyser l\'image');
  },

  /**
   * Appel direct au service Google Generative Language API
   */
  async callSingleVisionModel(modelName, base64Data, apiKey, signal) {
    const prompt = `Tu es un médecin nutritionniste expert en diabétologie, nutrition sportive et gastronomie marocaine et méditerranéenne.
Analyse la photo de ce repas :
1. Identifie uniquement les aliments et boissons caloriques consommés par UNE SEULE personne.
2. EXCLUSION OBLIGATOIRE : NE PAS inclure l'eau pure (bouteille d'eau, verre d'eau minérale, carafe), ni les théières sans sucre, couverts, serviettes ou objets sans calories.
3. PORTION INDIVIDUELLE : Estime la portion réelle consommée par une personne pour son repas. Ne compte JAMAIS une corbeille entière de pain : pour le pain (Khobz, pain céréales, baguette), compte la portion d'une personne soit 1 morceau (~60g à 80g max). Pour les œufs (omelette, au plat), compte la portion d'une personne (~120g à 180g max).
4. PETIT-DÉJEUNER MAROCAIN & CONDIMENTS (ATTENTION CONFUSIONS FRÉQUENTES) :
   - HUILE D'OLIVE (Zit Zitoun) vs MIEL : Dans un repas avec des œufs (omelette, au plat), du pain ou du salé, toute coupelle, ramequin ou saucière contenant un liquide huileux (doré, ambré, vert) est de l'HUILE D'OLIVE ("huile-olive-pure", 0g glucides, 100g lipides), JAMAIS du miel ni de la confiture ! Ne compte du miel que si le plat est explicitement une crêpe sucrée (baghrir au miel, msemen sucré, chebakia).
   - JBEN BELDI (Fromage frais) vs BEURRE : La pâte blanche ou fromage servi avec le pain ou dans l'huile est du "Jben beldi" ou "Jben & Huile d'olive" ("jben-huile-olive" : ~14g protéines/100g, 2.5g glucides), JAMAIS du beurre de table.
   - OMELETTE / ŒUFS : ~13g protéines/100g, ~1.1g glucides (portion 2 œufs = ~120g).
   - PAIN AUX CÉRÉALES / COMPLET : ~35g glucides nets/100g, 10g protéines, 7g fibres.
5. foodId recommandés : "oeufs-plat", "pain-cereales", "khobz-complet", "khobz-blanc", "jben-huile-olive", "huile-olive-pure", "olives-marocaines", "poulet-grille", "sardines-grillees", "kefta-grillee", "salade-marocaine".

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
    const userKey = hasValidKey(userApiKey) ? userApiKey.trim() : '';

    // 1. Essayer le proxy Cloudflare en premier lieu avec un délai robuste de 28 secondes
    const edgeCtrl = new AbortController();
    const edgeTimer = setTimeout(() => {
      try { edgeCtrl.abort('TIMEOUT'); } catch (_) {}
    }, 28000);

    let proxyError = null;
    try {
      const items = await this.callEdgeProxy(base64Data, userKey, edgeCtrl.signal);
      clearTimeout(edgeTimer);
      return { success: true, items, source: 'edge' };
    } catch (proxyErr) {
      clearTimeout(edgeTimer);
      proxyError = proxyErr;
      console.warn('Proxy Edge non disponible ou timeout, tentative direct client :', proxyErr?.message);

      if (proxyErr?.code === 'TIMEOUT' || proxyErr?.name === 'AbortError' || proxyErr === 'TIMEOUT') {
        return {
          success: false,
          items: [],
          error: 'Délai d\'analyse dépassé. Veuillez vérifier votre connexion.',
          code: 'TIMEOUT'
        };
      }
    }

    // 2. Basculement direct client : uniquement avec une clé personnelle (aucune clé embarquée)
    if (!userKey) {
      return {
        success: false,
        items: [],
        error: proxyError?.code === 'UNAUTHORIZED'
          ? (proxyError.message || 'Clé API Gemini requise ou invalide')
          : 'Serveur d\'analyse indisponible. Ajoutez votre clé Gemini dans Synthèse > Paramètres IA pour l\'analyse directe.',
        code: proxyError?.code || 'FAILED'
      };
    }

    let lastError = null;
    for (const model of VISION_MODELS) {
      const clientCtrl = new AbortController();
      const clientTimer = setTimeout(() => {
        try { clientCtrl.abort('TIMEOUT'); } catch (_) {}
      }, 25000);
      try {
        const items = await this.callSingleVisionModel(model, base64Data, userKey, clientCtrl.signal);
        clearTimeout(clientTimer);
        return { success: true, items, source: `client-${model}` };
      } catch (err) {
        clearTimeout(clientTimer);
        lastError = err;
        console.warn(`Modèle direct ${model} échoué :`, err?.message || err);
        if (err?.code === 'UNAUTHORIZED') break;
        if (err?.name === 'AbortError' || err === 'TIMEOUT' || err?.code === 'TIMEOUT') {
          lastError = new Error('Délai d\'analyse dépassé');
          lastError.code = 'TIMEOUT';
          break;
        }
      }
    }

    const finalMsg = lastError?.code === 'TIMEOUT'
      ? 'Délai d\'analyse dépassé. Veuillez vérifier votre connexion et réessayez.'
      : (lastError?.message || 'Reconnaissance IA indisponible');

    return {
      success: false,
      items: [],
      error: finalMsg,
      code: lastError?.code || 'FAILED'
    };
  },

  /**
   * Test de connectivité en direct pour les paramètres utilisateur
   */
  async testConnection(customKey) {
    if (!hasValidKey(customKey)) {
      return { success: false, message: 'Saisissez une clé Gemini personnelle (≥ 15 caractères) pour tester l\'appel direct.' };
    }
    const key = customKey.trim();

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

    // 1. Tajines composés (à tester avant les ingrédients isolés comme oeuf, kefta, poulet)
    if (q.includes('tajine') || q.includes('tagine')) {
      if (q.includes('kefta') || q.includes('viande hachée')) return FoodRepository.getFoodById('tajine-kefta');
      if (q.includes('pruneau') || q.includes('barqouq')) return FoodRepository.getFoodById('tajine-pruneaux');
      if (q.includes('poulet') || q.includes('djaj')) return FoodRepository.getFoodById('tajine-poulet-olives');
      return FoodRepository.getFoodById('tajine-poulet-olives');
    }

    // 2. Desserts & viennoiseries
    if (q.includes('san sebastian') || q.includes('cheesecake') || q.includes('basque')) {
      return FoodRepository.getFoodById('cheesecake-san-sebastian');
    }
    if (q.includes('mille-feuille') || q.includes('millefeuille') || q.includes('mille feuille')) {
      return FoodRepository.getFoodById('mille-feuille');
    }
    if (q.includes('tiramisu')) return FoodRepository.getFoodById('tiramisu');
    if (q.includes('croissant') || q.includes('petit pain') || q.includes('pain au chocolat')) {
      return FoodRepository.getFoodById('croissant-petit-pain');
    }

    // 3. Pains et féculents (attention aux collisions ex: "riz complet" != "pain complet")
    if (q.includes('riz') || q.includes('rouz') || q.includes('rice')) {
      return FoodRepository.getFoodById('riz-cuit');
    }
    if (q.includes('frite') || q.includes('fries') || q.includes('pomme de terre fritte')) {
      return FoodRepository.getFoodById('frites-maison');
    }

    if (q.includes('céréale') || q.includes('cereale') || q.includes('graine') || (q.includes('pain') && q.includes('noir'))) {
      return FoodRepository.getFoodById('pain-cereales');
    }
    if ((q.includes('pain') || q.includes('khobz')) && (q.includes('complet') || q.includes('zraa') || q.includes('intégral') || q.includes('integral'))) {
      return FoodRepository.getFoodById('khobz-complet');
    }
    if (q.includes('orge') || q.includes('ch3ir') || q.includes('chayir')) {
      return FoodRepository.getFoodById('khobz-ch3ir');
    }
    if (q.includes('batbout')) return FoodRepository.getFoodById('batbout');
    if (q.includes('msemen') || q.includes('msmen') || q.includes('rghaif')) return FoodRepository.getFoodById('msemen');
    if (q.includes('meloui') || q.includes('mloui')) return FoodRepository.getFoodById('meloui');
    if (q.includes('baghrir') || q.includes('mille trous')) return FoodRepository.getFoodById('baghrir');
    if (q.includes('harcha')) return FoodRepository.getFoodById('harcha');
    if (q.includes('khobz') || q.includes('pain blanc') || q.includes('pain marocain') || q.includes('pain')) {
      return FoodRepository.getFoodById('khobz-blanc');
    }

    // 4. Protéines & Fromages
    if (q.includes('jben') || q.includes('fromage frais') || q.includes('fromage blanc')) {
      return FoodRepository.getFoodById('jben-huile-olive');
    }
    if ((q.includes('beurre') || q.includes('butter') || q.includes('zebda')) && !q.includes('miel') && !q.includes('honey')) {
      return FoodRepository.getFoodById('beurre-doux');
    }
    if (q.includes('oeuf') || q.includes('œuf') || q.includes('egg') || q.includes('baid') || q.includes('khlii') || q.includes('khlea') || q.includes('omelette')) {
      return FoodRepository.getFoodById('oeufs-plat');
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
    if (q.includes('brochette') || q.includes('qotban') || q.includes('kotban')) {
      return FoodRepository.getFoodById('brochettes-viande');
    }
    if (q.includes('poisson') || q.includes('hout') || q.includes('merlan') || q.includes('sole') || q.includes('dorade') || q.includes('thon')) {
      return FoodRepository.getFoodById('poisson-blanc');
    }

    // 5. Salades et légumes
    if (q.includes('salade') && (q.includes('marocaine') || q.includes('tomate') || q.includes('concombre'))) {
      return FoodRepository.getFoodById('salade-marocaine');
    }
    if (q.includes('zaalouk')) return FoodRepository.getFoodById('zaalouk');
    if (q.includes('taktouka')) return FoodRepository.getFoodById('taktouka');
    if (q.includes('avocat') || q.includes('avocado')) return FoodRepository.getFoodById('avocat-nature');
    if (q.includes('olive') && !q.includes('huile')) return FoodRepository.getFoodById('olives-marocaines');
    if (q.includes('huile') || q.includes('zit') || q.includes('olive oil')) {
      return FoodRepository.getFoodById('huile-olive-pure');
    }

    // 6. Plats traditionnels & Soupes
    if (q.includes('harira')) return FoodRepository.getFoodById('harira');
    if (q.includes('couscous')) return FoodRepository.getFoodById('couscous-semoule');
    if (q.includes('loubia')) return FoodRepository.getFoodById('loubia');
    if (q.includes('lentille') || q.includes('adass')) return FoodRepository.getFoodById('adass');
    if (q.includes('bissara')) return FoodRepository.getFoodById('bissara');
    if (q.includes('rfissa')) return FoodRepository.getFoodById('rfissa');
    if (q.includes('pastilla') || q.includes('bastila')) {
      return q.includes('poisson') || q.includes('hout') ? FoodRepository.getFoodById('pastilla-poisson') : FoodRepository.getFoodById('pastilla-poulet');
    }
    if (q.includes('seffa')) return FoodRepository.getFoodById('seffa');

    // 7. Douceurs & Boissons
    if (q.includes('chebakia')) return FoodRepository.getFoodById('chebakia');
    if (q.includes('datte') || q.includes('tmar')) return FoodRepository.getFoodById('datte-majhoul');
    if (q.includes('miel') || q.includes('honey') || q.includes('amlou')) return FoodRepository.getFoodById('miel-beurre');
    if (q.includes('jus d\'orange') || q.includes('orange_juice') || q.includes('orange juice') || q.includes('jus orange')) return FoodRepository.getFoodById('jus-orange');
    if (q.includes('jus d\'avocat') || q.includes('jus avocat')) return FoodRepository.getFoodById('jus-avocat');
    if (q.includes('atay') || q.includes('thé à la menthe') || q.includes('the a la menthe') || q.includes('mint tea')) return FoodRepository.getFoodById('atay-sucre');
    if (q.includes('lben') || q.includes('babeurre')) return FoodRepository.getFoodById('lben');
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
