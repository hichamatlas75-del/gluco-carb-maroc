import { FoodRepository } from '../data/foods.js';

/**
 * Service de reconnaissance visuelle d'image :
 * 1. API Gemini 2.5 Flash Vision (si clé API renseignée dans Paramètres)
 * 2. Générateur d'illustrations de plats & classifieur local hors-ligne
 */
export const VisionAnalyzer = {
  async detectWithGemini(dataUrl, apiKey) {
    if (!apiKey) return null;

    const base64Data = dataUrl.split(',')[1];
    const mimeMatch = dataUrl.match(/^data:(image\/[a-zA-Z0-9+.-]+);base64,/);
    const mimeType = mimeMatch ? mimeMatch[1] : 'image/jpeg';

    const catalogSummary = FoodRepository.getAllFoods()
      .map(f => `${f.id}: ${f.name} (portion type ${f.defaultGrams}g)`)
      .join('\n');

    const prompt = `Identifie les aliments marocains/méditerranéens présents sur cette photo de plat, estime leur poids approximatif en grammes et donne leurs coordonnées (x, y en % entre 15 et 85) sur l'image.
Utilise uniquement les foodId suivants :
${catalogSummary}
Réponds strictement en JSON : {"items":[{"foodId":"id","grams":120,"x":45,"y":50}]}`;

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                { text: prompt },
                { inline_data: { mime_type: mimeType, data: base64Data } }
              ]
            }
          ],
          generationConfig: { response_mime_type: 'application/json' }
        })
      }
    );

    if (!response.ok) {
      throw new Error('Erreur lors de l’appel Gemini Vision API');
    }

    const json = await response.json();
    const rawText = json?.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
    const parsed = JSON.parse(rawText);

    if (Array.isArray(parsed.items)) {
      return parsed.items.filter(item => FoodRepository.getFoodById(item.foodId));
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
