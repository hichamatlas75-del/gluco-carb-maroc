import { FoodRepository } from '../data/foods.js?v=16';

/**
 * Convertit une valeur en nombre fini, sinon retourne la valeur par défaut.
 * Évite toute propagation de NaN dans les calculs de glucides / bolus.
 */
function finiteOr(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Moteur de calcul des glucides nets, protéines, charge glycémique, bolus d'insuline
 * et génération de l'Indice Protéique et du Verdict Métabolique.
 * Supporte à la fois les aliments du catalogue marocain et tout aliment libre reconnu par IA.
 */
export const MetabolicEngine = {
  resolveFoodEntry(entry) {
    const dbFood = FoodRepository.getFoodById(entry.foodId);
    if (dbFood) {
      return {
        ...dbFood,
        name: entry.customName || dbFood.name,
        protein100g: Math.max(0, finiteOr(entry.protein100g, dbFood.protein100g || 0))
      };
    }
    if (entry && Number.isFinite(Number(entry.carbs100g)) && entry.carbs100g !== null && entry.carbs100g !== '') {
      return {
        id: entry.foodId || 'custom',
        name: entry.customName || 'Aliment détecté par IA',
        carbs100g: Math.max(0, finiteOr(entry.carbs100g, 0)),
        protein100g: Math.max(0, finiteOr(entry.protein100g, 0)),
        fiber100g: Math.max(0, finiteOr(entry.fiber100g, 0)),
        gi: Math.min(100, Math.max(0, finiteOr(entry.gi, 55))),
        refPortion: entry.refPortion || 'Portion estimée sur photo'
      };
    }
    return null;
  },

  computeFoodPortion(food, grams) {
    const factor = Math.max(0, finiteOr(grams, 0)) / 100;
    const carbs100g = Math.max(0, finiteOr(food.carbs100g, 0));
    const fiber100g = Math.max(0, finiteOr(food.fiber100g, 0));
    const protein100g = Math.max(0, finiteOr(food.protein100g, 0));
    const gi = Math.min(100, Math.max(0, finiteOr(food.gi, 55)));
    const totalCarbs = carbs100g * factor;
    const fiber = fiber100g * factor;
    const netCarbs = Math.max(0, totalCarbs - fiber);
    const protein = protein100g * factor;
    const glycemicLoad = (netCarbs * gi) / 100;
    return { totalCarbs, fiber, netCarbs, protein, glycemicLoad, gi };
  },

  evaluatePlate(items, settings, activeSlot, currentBGMgDl) {
    let totalGrams = 0;
    let totalCarbs = 0;
    let totalFiber = 0;
    let netCarbs = 0;
    let totalProtein = 0;
    let weightedGISum = 0;
    let totalGL = 0;
    let highestCarbContributor = null;

    for (const entry of items) {
      const food = this.resolveFoodEntry(entry);
      if (!food) continue;
      const grams = Math.max(0, finiteOr(entry.grams, 0));
      const macros = this.computeFoodPortion(food, grams);

      totalGrams += grams;
      totalCarbs += macros.totalCarbs;
      totalFiber += macros.fiber;
      netCarbs += macros.netCarbs;
      totalProtein += macros.protein;
      weightedGISum += macros.netCarbs * macros.gi;
      totalGL += macros.glycemicLoad;

      if (!highestCarbContributor || macros.netCarbs > highestCarbContributor.netCarbs) {
        highestCarbContributor = { food, grams, netCarbs: macros.netCarbs };
      }
    }

    const roundedProtein = Math.round(totalProtein * 10) / 10;
    const roundedFiber = Math.round(totalFiber * 10) / 10;
    const roundedNetCarbs = Math.round(netCarbs * 10) / 10;
    const ratioPG = roundedNetCarbs > 0
      ? (roundedProtein / roundedNetCarbs)
      : (roundedProtein > 0 ? 2.5 : 0);

    // Score d'amorti glycémique = (Protéines + Fibres) / Glucides Nets
    const bufferNutrients = roundedProtein + roundedFiber;
    const amortiRatio = roundedNetCarbs > 0
      ? (bufferNutrients / roundedNetCarbs)
      : (bufferNutrients > 0 ? 3.0 : 0);

    let amorti = {
      status: 'none',
      score: 0,
      ratio: amortiRatio,
      ratioText: '(P+F)/G : --',
      badgeText: 'En attente',
      badgeClass: 'bg-slate-100 text-slate-500 border-slate-200',
      barColor: 'bg-slate-300',
      pct: 0,
      headline: 'Amorti en attente',
      desc: 'Ajoutez ou scannez vos aliments pour évaluer le score d’amorti glycémique.'
    };

    if (items.length > 0) {
      const pct = Math.min(100, Math.round((amortiRatio / 1.0) * 100));
      if (roundedNetCarbs === 0 && bufferNutrients > 0) {
        amorti = {
          status: 'optimal',
          score: 100,
          ratio: amortiRatio,
          ratioText: '(P+F)/G : Maximal',
          badgeText: '🟢 Pic glycémique amorti',
          badgeClass: 'bg-emerald-100 text-emerald-800 border-emerald-300',
          barColor: 'bg-emerald-500',
          pct: 100,
          headline: 'Amorti maximal (Zéro pic)',
          desc: 'Repas sans glucides nets. Les protéines et lipides assurent une glycémie parfaitement stable.'
        };
      } else if (amortiRatio >= 0.70) {
        amorti = {
          status: 'optimal',
          score: Math.min(100, Math.round(amortiRatio * 75)),
          ratio: amortiRatio,
          ratioText: `(P+F)/G : ${amortiRatio.toFixed(2)}`,
          badgeText: '🟢 Pic glycémique amorti',
          badgeClass: 'bg-emerald-100 text-emerald-800 border-emerald-300',
          barColor: 'bg-emerald-500',
          pct: Math.min(100, Math.max(70, pct)),
          headline: 'Amorti optimal : Pic de glucose évité',
          desc: `La matrice de protéines (${roundedProtein}g) et de fibres (${roundedFiber}g) freine fortement l'absorption des ${roundedNetCarbs}g de glucides. La montée glycémique est progressive et amortie.`
        };
      } else if (amortiRatio >= 0.35) {
        amorti = {
          status: 'moderate',
          score: Math.round(amortiRatio * 75),
          ratio: amortiRatio,
          ratioText: `(P+F)/G : ${amortiRatio.toFixed(2)}`,
          badgeText: '🟡 Amorti modéré',
          badgeClass: 'bg-amber-100 text-amber-800 border-amber-300',
          barColor: 'bg-amber-500',
          pct: Math.min(69, Math.max(35, pct)),
          headline: 'Amorti modéré',
          desc: `Freinage partiel de la vidange gastrique. Associez plus de fibres (salade) ou de protéines pour un amorti optimal.`
        };
      } else {
        amorti = {
          status: 'risk',
          score: Math.max(10, Math.round(amortiRatio * 75)),
          ratio: amortiRatio,
          ratioText: `(P+F)/G : ${amortiRatio.toFixed(2)}`,
          badgeText: '🔴 Risque de pic glycémique',
          badgeClass: 'bg-rose-100 text-rose-800 border-rose-300',
          barColor: 'bg-rose-500',
          pct: Math.max(12, Math.min(34, pct)),
          headline: 'Risque de pic glycémique rapide',
          desc: `Le repas contient une forte proportion de glucides pour très peu de protéines/fibres. Le sucre passe vite dans le sang (risque de pic brutal).`
        };
      }
    }

    // Calcul de l'Indice Protéique & Satiété
    let proteinIndex = {
      status: 'none',
      label: 'En attente',
      ratioText: 'P/G --',
      badgeClass: 'bg-slate-100 text-slate-500 border-slate-200',
      barColor: 'bg-slate-300',
      pct: 0,
      desc: 'Ajoutez ou photographiez vos aliments pour calculer le grammage protéique et l’indice satiété.'
    };

    if (items.length > 0) {
      const pct = Math.min(100, Math.round((roundedProtein / 35) * 100));
      if (roundedProtein >= 26 || (roundedProtein >= 20 && ratioPG >= 0.7)) {
        proteinIndex = {
          status: 'optimal',
          label: 'Élevé 🟢',
          ratioText: ratioPG >= 2.5 ? 'Pur Protéines' : `P/G ${ratioPG.toFixed(2)}`,
          badgeClass: 'bg-emerald-100 text-emerald-800 border-emerald-300',
          barColor: 'bg-emerald-500',
          pct,
          desc: 'Satiété longue durée (~5h) et puissant frein glycémique. Idéal pour préserver la masse musculaire et réussir le jeûne 18/6.'
        };
      } else if (roundedProtein >= 14 || ratioPG >= 0.40) {
        proteinIndex = {
          status: 'moderate',
          label: 'Modéré 🟡',
          ratioText: `P/G ${ratioPG.toFixed(2)}`,
          badgeClass: 'bg-amber-100 text-amber-800 border-amber-300',
          barColor: 'bg-amber-500',
          pct,
          desc: 'Apport protéique correct. Ralentit modérément la vidange gastrique et l’assimilation glucidique.'
        };
      } else {
        proteinIndex = {
          status: 'low',
          label: 'Faible ⚪',
          ratioText: `P/G ${ratioPG.toFixed(2)}`,
          badgeClass: 'bg-rose-100 text-rose-800 border-rose-300',
          barColor: 'bg-rose-400',
          pct: Math.max(6, pct),
          desc: 'Dominance glucidique. Risque de faim précoce et d’élévation glycémique rapide. Pensez à compléter avec œufs, volaille, poisson ou jben.'
        };
      }
    }

    const avgGI = netCarbs > 0 ? Math.round(weightedGISum / netCarbs) : 0;

    // Sélection du ratio Insuline / Glucides selon la période
    const ratioBySlot = {
      morning: settings.ratioMorning,
      noon: settings.ratioNoon,
      evening: settings.ratioEvening
    };
    const activeRatio = Math.max(1, finiteOr(ratioBySlot[activeSlot], 10) || 10);
    const mealBolus = netCarbs / activeRatio;
    const targetBG = Math.min(250, Math.max(70, finiteOr(settings.targetBG, 100)));
    const isf = Math.max(5, finiteOr(settings.isf, 50) || 50);

    // Calcul de la dose de correction selon la glycémie actuelle & Garde-fous cliniques
    let glycemiaWarning = null;
    let corrBolus = 0;

    if (currentBGMgDl !== null && !isNaN(currentBGMgDl) && currentBGMgDl > 0) {
      if (currentBGMgDl < 70) {
        glycemiaWarning = {
          level: 'danger',
          type: 'hypo',
          badgeText: '🔴 ALERTE HYPOGLYCÉMIE (< 70 mg/dL)',
          headline: 'Arrêt Bolus — Règle des 15g requise immédiatement',
          description: 'Votre glycémie est inférieure à 70 mg/dL (0.70 g/L). Prenez immédiatement 15g de glucides rapides (3 morceaux de sucre ou 120ml de jus d\'orange). Patientez 15 minutes et recontrôlez avant toute injection.'
        };
      } else if (currentBGMgDl > 250) {
        glycemiaWarning = {
          level: 'warning',
          type: 'hyper',
          badgeText: '🟠 ALERTE HYPERGLYCÉMIE (> 250 mg/dL)',
          headline: 'Hyperglycémie sévère — Hydratation & Cétones',
          description: 'Glycémie très élevée. Buvez de l\'eau plate abondamment et contrôlez votre acétonurie/acétonémie avant tout repas copieux.'
        };
      }

      // Correction continue sur toute la plage non hypoglycémique :
      // positive au-dessus de la cible, négative (réduction du bolus repas) en dessous.
      // (Auparavant : réduction appliquée entre 70-79 mg/dL mais pas entre 80 et la cible.)
      if (currentBGMgDl >= 70) {
        corrBolus = (currentBGMgDl - targetBG) / isf;
      }
    }

    // En cas d'hypoglycémie avérée, neutralisation du bolus pour sécurité vitale
    const totalBolus = (glycemiaWarning && glycemiaWarning.type === 'hypo')
      ? 0
      : Math.max(0, mealBolus + corrBolus);

    // Arbre de décision du Verdict Métabolique (intégrant le Score d'Amorti)
    let verdict = {
      boxClass: 'bg-slate-50 border-slate-200',
      iconClass: 'bg-slate-200 text-slate-600',
      iconName: 'camera',
      ringColor: '#10b981',
      tag: 'En attente de photo',
      headline: 'Photographiez votre plat',
      description: 'Dès la photo prise, GlucoScan estime le grammage de chaque aliment et affiche son verdict.'
    };

    if (items.length > 0) {
      const topName = highestCarbContributor
        ? highestCarbContributor.food.name.split('(')[0].trim()
        : 'féculents';
      const countLabel = items.length > 1 ? `Total repas (${items.length} aliments cumulés)` : `Total aliment`;
      const topDetail = highestCarbContributor
        ? ` (dont ~${Math.round(highestCarbContributor.netCarbs)}g provenant de : ${topName}, portion ${highestCarbContributor.grams}g)`
        : '';

      if (amorti.status === 'optimal' && totalGL < 24) {
        verdict = {
          boxClass: 'bg-emerald-50/90 border-emerald-200',
          iconClass: 'bg-emerald-600 text-white',
          iconName: 'shield-check',
          ringColor: '#10b981',
          tag: '🟢 VERDICT : PIC GLYCÉMIQUE AMORTI',
          headline: 'Repas stabilisé par les protéines & fibres',
          description: `${countLabel} : ${Math.round(netCarbs)}g de glucides nets${topDetail}. Excellent amorti ((P+F)/G: ${amortiRatio.toFixed(2)}) avec ${roundedProtein}g de protéines et ${roundedFiber}g de fibres : le pic est freiné.`
        };
      } else if (amorti.status === 'risk' || totalGL >= 26 || netCarbs > 65) {
        verdict = {
          boxClass: 'bg-rose-50/95 border-rose-200',
          iconClass: 'bg-rose-600 text-white',
          iconName: 'flame',
          ringColor: '#ef4444',
          tag: '🔴 VERDICT : RISQUE DE PIC GLYCÉMIQUE',
          headline: 'Charge glucidique élevée & faible amorti',
          description: `${countLabel} : ${Math.round(netCarbs)}g de glucides nets${topDetail}. Ratio d'amorti insuffisant ((P+F)/G: ${amortiRatio.toFixed(2)}). Ajoutez des protéines (œufs, poulet, sardines) ou réduisez le féculent.`
        };
      } else {
        verdict = {
          boxClass: 'bg-amber-50/90 border-amber-200',
          iconClass: 'bg-amber-500 text-white',
          iconName: 'alert-circle',
          ringColor: '#f59e0b',
          tag: '🟠 VERDICT : IMPACT MODÉRÉ',
          headline: 'Hausse glycémique modérée prévue',
          description: `${countLabel} : ${Math.round(netCarbs)}g de glucides nets${topDetail}. Ratio d'amorti intermédiaire ((P+F)/G: ${amortiRatio.toFixed(2)}). Associez plus de fibres pour freiner encore l'absorption.`
        };
      }
    }

    return {
      totalGrams: Math.round(totalGrams),
      totalCarbs: Math.round(totalCarbs * 10) / 10,
      totalFiber: roundedFiber,
      netCarbs: roundedNetCarbs,
      totalProtein: roundedProtein,
      ratioPG: Math.round(ratioPG * 100) / 100,
      amortiRatio: Math.round(amortiRatio * 100) / 100,
      amorti,
      proteinIndex,
      avgGI,
      totalGL: Math.round(totalGL * 10) / 10,
      mealBolus: Math.round(mealBolus * 10) / 10,
      corrBolus: Math.round(corrBolus * 10) / 10,
      totalBolus: Math.round(totalBolus * 10) / 10,
      glycemiaWarning,
      verdict
    };
  }
};
