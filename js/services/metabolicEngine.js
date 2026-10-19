import { FoodRepository } from '../data/foods.js';

/**
 * Moteur de calcul des glucides nets, de la charge glycémique, du bolus d'insuline
 * et génération du Verdict Métabolique.
 */
export const MetabolicEngine = {
  computeFoodPortion(food, grams) {
    const factor = Math.max(0, Number(grams) || 0) / 100;
    const totalCarbs = food.carbs100g * factor;
    const fiber = food.fiber100g * factor;
    const netCarbs = Math.max(0, totalCarbs - fiber);
    const glycemicLoad = (netCarbs * food.gi) / 100;
    return { totalCarbs, fiber, netCarbs, glycemicLoad };
  },

  evaluatePlate(items, settings, activeSlot, currentBGMgDl) {
    let totalGrams = 0;
    let totalCarbs = 0;
    let totalFiber = 0;
    let netCarbs = 0;
    let weightedGISum = 0;
    let totalGL = 0;
    let highestCarbContributor = null;

    for (const entry of items) {
      const food = FoodRepository.getFoodById(entry.foodId);
      if (!food) continue;
      const grams = Math.max(0, Number(entry.grams) || 0);
      const macros = this.computeFoodPortion(food, grams);

      totalGrams += grams;
      totalCarbs += macros.totalCarbs;
      totalFiber += macros.fiber;
      netCarbs += macros.netCarbs;
      weightedGISum += macros.netCarbs * food.gi;
      totalGL += macros.glycemicLoad;

      if (!highestCarbContributor || macros.netCarbs > highestCarbContributor.netCarbs) {
        highestCarbContributor = { food, grams, netCarbs: macros.netCarbs };
      }
    }

    const avgGI = netCarbs > 0 ? Math.round(weightedGISum / netCarbs) : 0;

    // Sélection du ratio Insuline / Glucides selon la période
    const ratioBySlot = {
      morning: settings.ratioMorning,
      noon: settings.ratioNoon,
      evening: settings.ratioEvening
    };
    const activeRatio = Math.max(1, Number(ratioBySlot[activeSlot]) || 10);
    const mealBolus = netCarbs / activeRatio;

    // Calcul de la dose de correction selon la glycémie actuelle
    let corrBolus = 0;
    if (currentBGMgDl !== null && (currentBGMgDl > settings.targetBG || currentBGMgDl < 80)) {
      corrBolus = (currentBGMgDl - settings.targetBG) / Math.max(5, Number(settings.isf) || 50);
    }

    const totalBolus = Math.max(0, mealBolus + corrBolus);

    // Arbre de décision du Verdict Métabolique
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

      if (totalGL < 14 && netCarbs <= 35 && avgGI < 58) {
        verdict = {
          boxClass: 'bg-emerald-50/90 border-emerald-200',
          iconClass: 'bg-emerald-600 text-white',
          iconName: 'shield-check',
          ringColor: '#10b981',
          tag: '🟢 VERDICT : FEU VERT MÉTABOLIQUE',
          headline: 'Assiette équilibrée à libération lente',
          description: `Charge glycémique faible et bon apport en fibres (${totalFiber.toFixed(1)}g). Courbe glycémique post-repas stable.`
        };
      } else if (totalGL < 26 && netCarbs <= 65) {
        verdict = {
          boxClass: 'bg-amber-50/90 border-amber-200',
          iconClass: 'bg-amber-500 text-white',
          iconName: 'alert-circle',
          ringColor: '#f59e0b',
          tag: '🟠 VERDICT : IMPACT MODÉRÉ',
          headline: 'Hausse glycémique modérée prévue',
          description: `Dominante glucidique : ${topName} (~${Math.round(highestCarbContributor.netCarbs)}g nets). Conseil : réduisez légèrement la portion de pain/semoule.`
        };
      } else {
        verdict = {
          boxClass: 'bg-rose-50/95 border-rose-200',
          iconClass: 'bg-rose-600 text-white',
          iconName: 'flame',
          ringColor: '#ef4444',
          tag: '🔴 VERDICT : ALERTE PIC GLYCÉMIQUE',
          headline: 'Charge glucidique élevée détectée',
          description: `Attention : ${Math.round(netCarbs)}g de glucides nets (principalement ${topName}). Réduisez le grammage de moitié ou validez un pré-bolus.`
        };
      }
    }

    return {
      totalGrams: Math.round(totalGrams),
      totalCarbs: Math.round(totalCarbs * 10) / 10,
      totalFiber: Math.round(totalFiber * 10) / 10,
      netCarbs: Math.round(netCarbs * 10) / 10,
      avgGI,
      totalGL: Math.round(totalGL * 10) / 10,
      mealBolus: Math.round(mealBolus * 10) / 10,
      corrBolus: Math.round(corrBolus * 10) / 10,
      totalBolus: Math.round(totalBolus * 10) / 10,
      verdict
    };
  }
};
