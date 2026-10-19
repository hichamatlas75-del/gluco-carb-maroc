import { FoodRepository } from '../data/foods.js';

/**
 * Service de reconnaissance visuelle d'image :
 * - Compression automatique de la photo mobile (max 1024px JPEG) pour un envoi ultra-rapide
 * - Chaîne de modèles Gemini Vision résiliente (gemini-3.6-flash -> gemini-3.5-flash -> gemini-3.1-flash-lite -> gemini-3.8-flash)
 * - Support des aliments du catalogue marocain ET de tout autre aliment libre photographié
 */
const GEMINI_VISION_MODELS = [
  'gemini-3.6-flash',
  'gemini-3.5-flash',
  'gemini-3.1-flash-lite',
  'gemini-3.8-flash'
];

export const VisionAnalyzer = {
  /**
   * Redimensionne et compresse une image DataURL en JPEG (max 960px) pour éviter les payloads lourds sur mobile
   */
  compressImageDataUrl(dataUrl, maxDim = 960, quality = 0.82) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
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
      img.onerror = () => resolve(dataUrl);
      img.src = dataUrl;
    });
  },

  async detectWithGemini(rawDataUrl, apiKey) {
    if (!apiKey) return null;

    // 1. Compression rapide de la photo
    const compressedUrl = await this.compressImageDataUrl(rawDataUrl);
    const base64Data = compressedUrl.split(',')[1];
    const mimeMatch = compressedUrl.match(/^data:(image\/[a-zA-Z0-9+.-]+);base64,/);
    const mimeType = mimeMatch ? mimeMatch[1] : 'image/jpeg';

    const catalogSummary = FoodRepository.getAllFoods()
      .map(f => `${f.id}: ${f.name} (portion type ${f.defaultGrams}g, glucides ${f.carbs100g}g/100g, fibres ${f.fiber100g}g/100g, IG ${f.gi})`)
      .join('\n');

    const prompt = `Tu es un expert nutritionniste et diabétologue au Maroc.
Analyse cette photo d'aliment ou de plat.
1. Identifie chaque aliment visible sur la photo (même s'il n'y a qu'un seul morceau de pain, gâteau, fruit ou plat complet).
2. Estime son grammage approximatif réel visible sur la photo en grammes (champ "grams").
3. Si l'aliment correspond à l'un des identifiants de cette liste, utilise son "foodId" exact :
${catalogSummary}
4. Si l'aliment n'est pas dans la liste (ou est une variante spécifique), utilise "foodId": "custom" et renseigne obligatoirement son nom précis en français ("customName"), ses glucides totaux pour 100g ("carbs100g"), ses fibres pour 100g ("fiber100g") et son index glycémique ("gi").
5. Donne les coordonnées (x, y en pourcentage entre 20 et 80) du centre de chaque aliment sur l'image.

Réponds UNIQUEMENT avec un objet JSON valide suivant ce schéma :
{
  "items": [
    {
      "foodId": "khobz-blanc",
      "customName": "Morceau de pain blanc (Khobz)",
      "grams": 75,
      "carbs100g": 52.0,
      "fiber100g": 2.8,
      "gi": 75,
      "x": 50,
      "y": 50
    }
  ]
}`;

    const requestBody = JSON.stringify({
      contents: [
        {
          parts: [
            { text: prompt },
            { inline_data: { mime_type: mimeType, data: base64Data } }
          ]
        }
      ],
      generationConfig: {
        response_mime_type: 'application/json',
        temperature: 0.2
      }
    });

    // 2. Essai séquentiel sur les modèles Gemini 3.x Flash disponibles
    for (const modelName of GEMINI_VISION_MODELS) {
      try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${encodeURIComponent(apiKey)}`;
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: requestBody
        });

        if (!response.ok) continue;

        const json = await response.json();
        const rawText = json?.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
        const cleanedJson = rawText.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim();
        const parsed = JSON.parse(cleanedJson);

        if (Array.isArray(parsed.items) && parsed.items.length > 0) {
          return parsed.items.map((item, idx) => {
            const dbFood = FoodRepository.getFoodById(item.foodId);
            if (dbFood) {
              return {
                foodId: dbFood.id,
                customName: item.customName || dbFood.name,
                grams: Math.max(5, Math.round(Number(item.grams) || dbFood.defaultGrams)),
                carbs100g: dbFood.carbs100g,
                fiber100g: dbFood.fiber100g,
                gi: dbFood.gi,
                refPortion: dbFood.refPortion,
                x: Number(item.x) || (35 + idx * 15),
                y: Number(item.y) || (45 + idx * 12)
              };
            }
            // Aliment libre détecté par Gemini hors catalogue
            return {
              foodId: `custom_${Date.now()}_${idx}`,
              customName: item.customName || 'Aliment détecté',
              grams: Math.max(5, Math.round(Number(item.grams) || 100)),
              carbs100g: Math.max(0, Number(item.carbs100g) || 25),
              fiber100g: Math.max(0, Number(item.fiber100g) || 2),
              gi: Math.min(100, Math.max(0, Number(item.gi) || 55)),
              refPortion: 'Estimé par IA Vision',
              x: Number(item.x) || 50,
              y: Number(item.y) || 50
            };
          });
        }
      } catch {
        // Passe au modèle suivant de la liste en cas d'indisponibilité temporaire (503)
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
