import { FoodRepository } from '../data/foods.js?v=31';
import { MetabolicEngine } from '../services/metabolicEngine.js?v=31';

/**
 * Fonctions de rendu DOM, protection XSS et utilitaires de dates
 */
export function escapeHTML(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export function safeImageUrl(url) {
  if (!url || typeof url !== 'string') return null;
  const trimmed = url.trim();
  if (trimmed.startsWith('data:image/') || trimmed.startsWith('https://') || trimmed.startsWith('http://')) {
    return trimmed.replace(/"/g, '&quot;');
  }
  return null;
}

export function getLocalDateString(dateInput = new Date()) {
  const d = dateInput instanceof Date ? dateInput : new Date(dateInput);
  if (isNaN(d.getTime())) return '';
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

let toastTimer = null;
export function showToast(message, actionOptions = null) {
  try {
    if (navigator.vibrate) navigator.vibrate(12);
  } catch (_) {}
  const banner = document.getElementById('toastBanner');
  const label = document.getElementById('toastLabel');
  const actionBtn = document.getElementById('btnToastAction');
  if (!banner || !label) return;
  label.textContent = message;

  if (actionOptions && actionOptions.label && typeof actionOptions.onClick === 'function') {
    if (actionBtn) {
      actionBtn.textContent = actionOptions.label;
      actionBtn.classList.remove('hidden');
      actionBtn.onclick = (e) => {
        e.stopPropagation();
        actionOptions.onClick();
        banner.classList.add('opacity-0', 'translate-y-2', 'pointer-events-none');
        banner.classList.remove('opacity-100', 'translate-y-0', 'pointer-events-auto');
      };
    }
  } else if (actionBtn) {
    actionBtn.classList.add('hidden');
    actionBtn.onclick = null;
  }

  banner.classList.remove('opacity-0', 'translate-y-2', 'pointer-events-none');
  banner.classList.add('opacity-100', 'translate-y-0', 'pointer-events-auto');
  if (toastTimer) clearTimeout(toastTimer);
  const duration = actionOptions ? 5500 : 2800;
  toastTimer = setTimeout(() => {
    banner.classList.add('opacity-0', 'translate-y-2', 'pointer-events-none');
    banner.classList.remove('opacity-100', 'translate-y-0', 'pointer-events-auto');
  }, duration);
}

const FASTING_186_IDS = new Set([
  'oeufs-plat',
  'pain-cereales',
  'jben-huile-olive',
  'huile-olive-pure',
  'olives-marocaines',
  'poulet-grille',
  'sardines-grillees',
  'poisson-blanc',
  'kefta-grillee',
  'brochettes-viande',
  'salade-marocaine',
  'khobz-complet',
  'khobz-ch3ir',
  'khobz-blanc',
  'avocat-nature'
]);

export const UIRenderer = {
  renderDashboard(state, evaluation) {
    // Badge moteur IA
    const badgeEl = document.getElementById('engineBadge');
    if (badgeEl) badgeEl.textContent = 'IA Vision';

    // Boutons Matin / Midi / Soir
    document.querySelectorAll('.slot-btn').forEach(btn => {
      const isCurrent = btn.getAttribute('data-slot') === state.activeSlot;
      btn.className = isCurrent
        ? 'slot-btn px-2.5 py-1 rounded-lg text-[11px] font-extrabold bg-white dark:bg-slate-800 text-emerald-700 dark:text-emerald-400 shadow-xs transition-all'
        : 'slot-btn px-2 py-1 rounded-lg text-[11px] font-bold text-slate-500 dark:text-slate-400 transition-all';
    });

    // Carte Verdict
    const vBox = document.getElementById('verdictBox');
    const vIcon = document.getElementById('verdictBadgeIcon');
    if (vBox && vIcon) {
      vBox.className = `rounded-2xl p-3.5 border flex items-start gap-3 transition-all ${evaluation.verdict.boxClass}`;
      vIcon.className = `w-10 h-10 rounded-2xl flex items-center justify-center flex-shrink-0 ${evaluation.verdict.iconClass}`;
      vIcon.innerHTML = `<i data-lucide="${evaluation.verdict.iconName}" class="w-5 h-5"></i>`;
    }

    const tagEl = document.getElementById('verdictStatusTag');
    if (tagEl) tagEl.textContent = evaluation.verdict.tag;
    const pillEl = document.getElementById('verdictMetricsPill');
    if (pillEl) pillEl.textContent = `IG ${evaluation.avgGI} • CG ${evaluation.totalGL}`;
    const headEl = document.getElementById('verdictHeadline');
    if (headEl) headEl.textContent = evaluation.verdict.headline;
    const descEl = document.getElementById('verdictDescription');
    if (descEl) descEl.textContent = evaluation.verdict.description;

    // Compteurs et Anneau SVG
    const netCarbsEl = document.getElementById('outNetCarbs');
    if (netCarbsEl) netCarbsEl.textContent = String(evaluation.netCarbs);

    const nItems = state.items.length;
    const totGramsEl = document.getElementById('outTotalGrams');
    if (totGramsEl) {
      totGramsEl.textContent = nItems > 1
        ? `${evaluation.totalGrams}g (${nItems} aliments)`
        : (nItems === 1 ? `${evaluation.totalGrams}g pesés` : '0g');
    }

    const totCarbsEl = document.getElementById('outTotalCarbs');
    if (totCarbsEl) totCarbsEl.textContent = String(evaluation.totalCarbs);
    const totFibEl = document.getElementById('outTotalFiber');
    if (totFibEl) totFibEl.textContent = String(evaluation.totalFiber);
    const totFatEl = document.getElementById('outTotalFat');
    if (totFatEl) totFatEl.textContent = (evaluation.totalFat || 0).toFixed(1);
    const totCalEl = document.getElementById('outTotalCalories');
    if (totCalEl) totCalEl.textContent = String(evaluation.totalCalories || 0);

    const ring = document.getElementById('carbRingCircle');
    if (ring) {
      const circumference = 301.59;
      const pct = Math.min(1, evaluation.netCarbs / 80);
      ring.style.strokeDashoffset = (circumference * (1 - pct)).toFixed(2);
      ring.style.stroke = evaluation.verdict.ringColor;
    }

    // Bloc Protéines & Indice Satiété / Anabolisme
    const outProt = document.getElementById('outTotalProtein');
    if (outProt) outProt.textContent = evaluation.totalProtein.toFixed(1);

    const lblBadge = document.getElementById('lblProteinIndexBadge');
    if (lblBadge && evaluation.proteinIndex) {
      lblBadge.textContent = evaluation.proteinIndex.label;
      lblBadge.className = `inline-block text-[10px] font-extrabold px-2 py-0.5 rounded-full border ${evaluation.proteinIndex.badgeClass}`;
    }

    const lblRatio = document.getElementById('lblProteinIndexRatio');
    if (lblRatio && evaluation.proteinIndex) {
      lblRatio.textContent = evaluation.proteinIndex.ratioText;
    }

    const lblDesc = document.getElementById('lblProteinIndexDesc');
    if (lblDesc && evaluation.proteinIndex) {
      lblDesc.textContent = evaluation.proteinIndex.desc;
    }

    const barProt = document.getElementById('barProteinProgress');
    if (barProt && evaluation.proteinIndex) {
      barProt.style.width = `${evaluation.proteinIndex.pct}%`;
      barProt.className = `h-full rounded-full transition-all duration-500 ${evaluation.proteinIndex.barColor}`;
    }

    // Indicateur Intelligent : Amorti Énergétique (Ratio Protéines+Fibres / Glucides)
    const amorti = evaluation.amorti;
    const badgeAmorti = document.getElementById('lblAmortiBadge');
    if (badgeAmorti && amorti) {
      badgeAmorti.textContent = amorti.badgeText;
      badgeAmorti.className = `inline-block text-[10px] font-extrabold px-2 py-0.5 rounded-full border transition-all ${amorti.badgeClass}`;
    }

    const valRatio = document.getElementById('lblAmortiRatioValue');
    if (valRatio && amorti) {
      valRatio.textContent = amorti.ratioText;
    }

    const descAmorti = document.getElementById('lblAmortiDesc');
    if (descAmorti && amorti) {
      descAmorti.textContent = amorti.desc;
    }

    const barAmorti = document.getElementById('barAmortiProgress');
    if (barAmorti && amorti) {
      barAmorti.style.width = `${amorti.pct}%`;
      barAmorti.className = `h-full rounded-full transition-all duration-500 ${amorti.barColor}`;
    }

    this.renderPins(state.items, state.selectedPinIndex, state.pinsVisible !== false);
    this.renderRecognizedList(state.items, state.selectedPinIndex);

    if (window.lucide) {
      window.lucide.createIcons();
    }
  },

  renderDailySynthesis(todayTotals, settings) {
    const targetProt = Math.max(30, Number(settings.dailyTargetProtein) || 150);
    const targetCarbs = Math.max(30, Number(settings.dailyTargetCarbs) || 150);
    const targetFat = Math.max(15, Number(settings.dailyTargetFat) || 80);
    const targetCal = Math.max(800, Number(settings.dailyTargetCalories) || 1950);

    const protConsumed = Math.round(todayTotals.protein);
    const carbsConsumed = Math.round(todayTotals.carbs);
    const fatConsumed = Math.round(todayTotals.fat || 0);
    const calConsumed = Math.round(todayTotals.calories || (protConsumed * 4 + carbsConsumed * 4 + fatConsumed * 9));

    const protPct = Math.round((protConsumed / targetProt) * 100);
    const carbsPct = Math.round((carbsConsumed / targetCarbs) * 100);
    const fatPct = Math.round((fatConsumed / targetFat) * 100);
    const calPct = Math.round((calConsumed / targetCal) * 100);

    const protText = `${protConsumed}g / ${targetProt}g (${protPct}%)`;
    const carbsText = `${carbsConsumed}g / ${targetCarbs}g (${carbsPct}%)`;
    const fatText = `${fatConsumed}g / ${targetFat}g (${fatPct}%)`;
    const calText = `${calConsumed} / ${targetCal} kcal (${calPct}%)`;

    const elProtText = document.getElementById('dailyOutProteinText');
    if (elProtText) elProtText.textContent = protText;

    const elCarbsText = document.getElementById('dailyOutCarbsText');
    if (elCarbsText) elCarbsText.textContent = carbsText;

    const elFatText = document.getElementById('dailyOutFatText');
    if (elFatText) elFatText.textContent = fatText;

    const elCalText = document.getElementById('dailyOutCaloriesText');
    if (elCalText) elCalText.textContent = calText;

    const qProt = document.getElementById('quickDailyProtText');
    if (qProt) qProt.textContent = protText;

    const qCarbs = document.getElementById('quickDailyCarbsText');
    if (qCarbs) qCarbs.textContent = carbsText;

    const qFat = document.getElementById('quickDailyFatText');
    if (qFat) qFat.textContent = fatText;

    const qCal = document.getElementById('quickDailyCalText');
    if (qCal) qCal.textContent = `${calConsumed}/${targetCal} kcal`;

    const barProt = document.getElementById('dailyBarProtein');
    if (barProt) {
      barProt.style.width = `${Math.min(100, protPct)}%`;
      barProt.className = `h-full rounded-full transition-all duration-500 ${
        protPct >= 100 ? 'bg-emerald-600' : 'bg-emerald-500'
      }`;
    }

    const barCarbs = document.getElementById('dailyBarCarbs');
    if (barCarbs) {
      barCarbs.style.width = `${Math.min(100, carbsPct)}%`;
      barCarbs.className = `h-full rounded-full transition-all duration-500 ${
        carbsPct > 100 ? 'bg-rose-500' : (carbsPct >= 85 ? 'bg-amber-500' : 'bg-cyan-600')
      }`;
    }

    const barFat = document.getElementById('dailyBarFat');
    if (barFat) {
      barFat.style.width = `${Math.min(100, fatPct)}%`;
      barFat.className = `h-full rounded-full transition-all duration-500 ${
        fatPct > 100 ? 'bg-rose-500' : (fatPct >= 85 ? 'bg-amber-500' : 'bg-amber-600')
      }`;
    }

    const barCal = document.getElementById('dailyBarCalories');
    if (barCal) {
      barCal.style.width = `${Math.min(100, calPct)}%`;
      barCal.className = `h-full rounded-full transition-all duration-500 ${
        calPct > 105 ? 'bg-rose-500' : (calPct >= 90 ? 'bg-emerald-600' : 'bg-emerald-500')
      }`;
    }

    const remProt = document.getElementById('dailyProteinRemaining');
    if (remProt) {
      const diff = targetProt - protConsumed;
      remProt.textContent = diff > 0 ? `Reste ${diff}g` : `Objectif atteint ! 🎉`;
    }

    const remCarbs = document.getElementById('dailyCarbsRemaining');
    if (remCarbs) {
      const diff = targetCarbs - carbsConsumed;
      remCarbs.textContent = diff >= 0 ? `Reste ${diff}g` : `Plafond dépassé (+${Math.abs(diff)}g)`;
    }

    const remFat = document.getElementById('dailyFatRemaining');
    if (remFat) {
      const diff = targetFat - fatConsumed;
      remFat.textContent = diff >= 0 ? `Reste ${diff}g` : `Plafond dépassé (+${Math.abs(diff)}g)`;
    }

    const remCal = document.getElementById('dailyCaloriesRemaining');
    if (remCal) {
      const diff = targetCal - calConsumed;
      remCal.textContent = diff >= 0 ? `Reste ${diff} kcal` : `Plafond dépassé (+${Math.abs(diff)} kcal)`;
    }

    const badgeCount = document.getElementById('lblDailyMealCountBadge');
    if (badgeCount) {
      badgeCount.textContent = `${todayTotals.mealCount} repas aujourd'hui`;
    }

    const lblDate = document.getElementById('lblDailyTodayDate');
    if (lblDate) {
      const options = { weekday: 'long', day: 'numeric', month: 'long' };
      lblDate.textContent = new Date().toLocaleDateString('fr-FR', options);
    }
  },

  renderPins(items, selectedPinIdx = null, pinsVisible = true) {
    const layer = document.getElementById('pinsLayer');
    const hasImage = !document.getElementById('plateImage').classList.contains('hidden');
    const arrangeBtn = document.getElementById('btnAutoArrangePins');
    const toggleBtn = document.getElementById('btnTogglePins');
    const toggleLbl = document.getElementById('lblTogglePins');
    const hintBanner = document.getElementById('pinsHintBanner');

    if (!hasImage) {
      layer.innerHTML = '';
      if (arrangeBtn) arrangeBtn.classList.add('hidden');
      if (toggleBtn) toggleBtn.classList.add('hidden');
      if (hintBanner) hintBanner.classList.add('hidden');
      return;
    }

    if (items.length === 0) {
      layer.innerHTML = '';
      if (arrangeBtn) arrangeBtn.classList.add('hidden');
      if (toggleBtn) toggleBtn.classList.add('hidden');
      if (hintBanner) {
        hintBanner.textContent = '👆 Touchez la photo pour ajouter un aliment';
        hintBanner.classList.remove('hidden');
      }
      return;
    }

    if (arrangeBtn) arrangeBtn.classList.toggle('hidden', items.length < 2);
    if (toggleBtn) toggleBtn.classList.remove('hidden');
    if (toggleLbl) toggleLbl.textContent = pinsVisible ? 'Masquer' : 'Afficher';

    if (!pinsVisible) {
      layer.innerHTML = '';
      if (hintBanner) hintBanner.classList.add('hidden');
      return;
    }

    if (hintBanner) hintBanner.classList.remove('hidden');

    layer.innerHTML = items.map((item, idx) => {
      const food = MetabolicEngine.resolveFoodEntry(item);
      if (!food) return '';
      const macros = MetabolicEngine.computeFoodPortion(food, item.grams);
      const x = Math.min(86, Math.max(14, Number(item.x) || 50));
      const y = Math.min(84, Math.max(16, Number(item.y) || (24 + idx * 18)));
      const isSelected = selectedPinIdx === idx;
      const shortLabel = food.name.split('(')[0].trim();

      // Fond transparent vitré (glassmorphism) : n'obstrue pas l'image du plat derrière
      const glassStyle = isSelected
        ? 'backdrop-blur-md bg-emerald-950/75 border-emerald-400 ring-2 ring-emerald-400 text-white z-30 scale-105 shadow-xl'
        : 'backdrop-blur-md bg-slate-950/50 border-white/30 text-white z-10 hover:z-20 hover:bg-slate-950/65 shadow-lg';

      return `
        <div data-pin-index="${idx}"
             class="food-pin food-pin-node pointer-events-auto cursor-grab active:cursor-grabbing select-none absolute -translate-x-1/2 -translate-y-1/2 px-2.5 py-1 rounded-full border flex items-center gap-1.5 text-[10.5px] font-extrabold whitespace-nowrap transition-all ${glassStyle} ${isSelected ? 'food-pin-selected' : ''}"
             style="left:${x}%; top:${y}%; touch-action:none; -webkit-backdrop-filter:blur(8px); backdrop-filter:blur(8px);">
          <span class="text-white/50 text-[10px] leading-none font-mono pr-0.5" title="Glisser pour déplacer">⋮⋮</span>
          <span class="w-1.5 h-1.5 rounded-full bg-emerald-400 flex-shrink-0 shadow-[0_0_6px_rgba(52,211,153,0.9)]"></span>
          <span class="max-w-[125px] truncate text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)]">${escapeHTML(shortLabel)}</span>
          <span class="font-mono text-emerald-300 drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)]">~${item.grams}g</span>
          <span class="text-[9.5px] font-mono text-cyan-200/90 drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)]">(${Math.round(macros.netCarbs)}g)</span>
          <button type="button" data-edit-pin="${idx}" title="Modifier cette étiquette"
            class="ml-0.5 w-4 h-4 rounded-full bg-white/20 hover:bg-white/35 text-white flex items-center justify-center text-[9px] leading-none border border-white/20">
            ✎
          </button>
          <button type="button" data-remove-pin="${idx}" title="Supprimer cet aliment"
            class="w-4 h-4 rounded-full bg-rose-500/40 hover:bg-rose-500/70 text-rose-100 flex items-center justify-center text-[10px] font-extrabold leading-none border border-rose-300/30">
            ×
          </button>
        </div>
      `;
    }).join('');
  },

  renderRecognizedList(items, selectedPinIdx = null) {
    const container = document.getElementById('recognizedItemsContainer');
    const countEl = document.getElementById('lblDetectedCount');
    const footer = document.getElementById('scanFooterActions');
    const clearAllBtn = document.getElementById('btnClearAllRecognized');

    countEl.textContent = String(items.length);
    if (clearAllBtn) {
      clearAllBtn.classList.toggle('hidden', items.length === 0);
      clearAllBtn.classList.toggle('flex', items.length > 0);
    }

    if (items.length === 0) {
      footer.classList.add('hidden');
      container.innerHTML = `
        <div class="text-center py-5 px-4 rounded-2xl bg-slate-50 border border-dashed border-slate-200 space-y-2.5">
          <div>
            <p class="text-xs font-bold text-slate-700">Aucun aliment dans l'assiette</p>
            <p class="text-[11px] text-slate-500 mt-0.5">Prenez une photo ou ajoutez vos aliments manuellement ci-dessous.</p>
          </div>
          <button type="button" data-open-add-food="true" class="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-extrabold shadow-xs">
            <i data-lucide="plus-circle" class="w-4 h-4"></i>
            Ajouter un aliment manuellement
          </button>
        </div>
      `;
      return;
    }

    footer.classList.remove('hidden');
    const cardsHTML = items.map((item, idx) => {
      const food = MetabolicEngine.resolveFoodEntry(item);
      if (!food) return '';
      const macros = MetabolicEngine.computeFoodPortion(food, item.grams);
      const isSelected = selectedPinIdx === idx;
      const cardBorder = isSelected
        ? 'bg-emerald-50/60 border-emerald-400 ring-1 ring-emerald-400'
        : 'bg-slate-50 border-slate-200';

      return `
        <div class="p-3 rounded-2xl border space-y-2 transition-all ${cardBorder}">
          <div class="flex items-start justify-between gap-2">
            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-1">
                <input type="text" data-direct-name="${idx}" value="${escapeHTML(food.name)}"
                  title="Touchez pour modifier le nom de l'aliment"
                  class="w-full bg-transparent hover:bg-white focus:bg-white border border-transparent hover:border-slate-300 focus:border-emerald-500 rounded-lg px-1.5 py-0.5 -ml-1.5 text-xs font-extrabold text-slate-900 focus:outline-none transition-all" />
              </div>
              <p class="text-[11px] text-slate-500">${escapeHTML(food.refPortion)} • <span class="font-bold text-emerald-800">${macros.protein.toFixed(1)}g prot</span> • <span class="font-bold text-amber-700">${(macros.fat || 0).toFixed(1)}g lip</span> • <span class="font-mono font-bold text-slate-600">${macros.calories || 0} kcal</span> • IG ${food.gi}</p>
            </div>
            <div class="text-right flex-shrink-0">
              <span class="text-sm font-extrabold font-mono text-emerald-700">${macros.netCarbs.toFixed(1)}g</span>
              <span class="block text-[10px] text-slate-400">nets</span>
            </div>
          </div>

          <!-- Barre de Correction Manuelle Rapide : Remplacer l'aliment erroné ou le Supprimer -->
          <div class="flex items-center justify-between gap-1.5 pt-1">
            <button type="button" data-replace="${idx}" class="flex-1 py-1.5 px-2.5 rounded-xl bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-200/90 text-[11px] font-extrabold flex items-center justify-center gap-1 transition-all">
              <i data-lucide="refresh-cw" class="w-3.5 h-3.5 text-amber-600"></i>
              Changer d'aliment
            </button>
            <button type="button" data-remove="${idx}" class="py-1.5 px-3 rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200/90 text-[11px] font-extrabold flex items-center justify-center gap-1 transition-all">
              <i data-lucide="trash-2" class="w-3.5 h-3.5 text-rose-600"></i>
              Supprimer
            </button>
          </div>

          <!-- Ajustement précis du poids en grammes -->
          <div class="flex items-center justify-between pt-1.5 border-t border-slate-200/60">
            <div class="flex items-center gap-1">
              <button type="button" data-delta="-20" data-index="${idx}" class="px-2.5 py-1 rounded-xl bg-white border border-slate-200 text-xs font-mono font-extrabold text-slate-700">-20g</button>
              <button type="button" data-delta="-5" data-index="${idx}" class="px-2 py-1 rounded-xl bg-white border border-slate-200 text-xs font-mono font-bold text-slate-700">-5</button>
            </div>
            <div class="flex items-center gap-1 bg-white border border-slate-300 rounded-xl px-2.5 py-1">
              <input type="number" data-direct-grams="${idx}" value="${item.grams}" min="5" max="1500"
                class="w-14 text-center font-mono font-extrabold text-xs text-slate-900 focus:outline-none" />
              <span class="text-[11px] font-mono text-slate-400">g</span>
            </div>
            <div class="flex items-center gap-1">
              <button type="button" data-delta="5" data-index="${idx}" class="px-2 py-1 rounded-xl bg-white border border-slate-200 text-xs font-mono font-bold text-slate-700">+5</button>
              <button type="button" data-delta="20" data-index="${idx}" class="px-2.5 py-1 rounded-xl bg-white border border-slate-200 text-xs font-mono font-extrabold text-slate-700">+20g</button>
            </div>
          </div>
        </div>
      `;
    }).join('');

    const addBottomButtonHTML = `
      <button type="button" data-open-add-food="true" class="w-full py-2.5 px-3 rounded-2xl bg-emerald-50/70 hover:bg-emerald-100/80 border border-dashed border-emerald-300 text-emerald-800 text-xs font-extrabold flex items-center justify-center gap-1.5 transition-all">
        <i data-lucide="plus-circle" class="w-4 h-4 text-emerald-600"></i>
        + Ajouter un autre aliment (Correction manuelle)
      </button>
    `;

    container.innerHTML = cardsHTML + addBottomButtonHTML;
  },

  renderCatalogModal(searchQuery, categoryFilter = 'all', replaceIndex = null) {
    const list = document.getElementById('catalogItemsList');
    const q = (searchQuery || '').toLowerCase().trim();
    const isReplacing = replaceIndex !== null && replaceIndex >= 0;

    const localFoods = FoodRepository.getAllFoods().filter(f => {
      if (categoryFilter === '186' && !FASTING_186_IDS.has(f.id)) return false;
      if (categoryFilter === 'patisseries' && f.category !== 'patisseries' && f.category !== 'fruits') return false;
      if (categoryFilter !== 'all' && categoryFilter !== '186' && categoryFilter !== 'patisseries' && f.category !== categoryFilter) {
        return false;
      }
      if (!q) return true;
      return (`${f.name} ${f.darija} ${f.id}`).toLowerCase().includes(q);
    });

    if (localFoods.length === 0) {
      list.innerHTML = `
        <div class="text-center py-6 px-4 rounded-2xl bg-slate-50 border border-dashed border-slate-200">
          <p class="text-xs font-bold text-slate-700">Aucun aliment trouvé dans cette catégorie</p>
          <p class="text-[11px] text-slate-500 mt-0.5">Utilisez le bloc « Saisir manuellement un autre aliment (libre) » juste au-dessus.</p>
        </div>
      `;
      return;
    }

    list.innerHTML = localFoods.map(f => {
      const m = MetabolicEngine.computeFoodPortion(f, f.defaultGrams);
      const btnClass = isReplacing
        ? 'px-3 py-1.5 rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-xs font-extrabold flex-shrink-0'
        : 'px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-extrabold flex-shrink-0';
      const btnLabel = isReplacing
        ? `🔄 Remplacer (${f.defaultGrams}g)`
        : `+ ${f.defaultGrams}g`;

      return `
        <div data-pick-food="${f.id}" class="p-2.5 rounded-2xl bg-slate-50 hover:bg-emerald-50/80 border border-slate-200 hover:border-emerald-300 flex items-center justify-between gap-2 cursor-pointer transition-all active:scale-[0.99]">
          <div class="min-w-0 flex-1 pointer-events-none">
            <p class="text-xs font-extrabold text-slate-900 truncate">${escapeHTML(f.name)}</p>
            <p class="text-[11px] text-slate-500 truncate">${escapeHTML(f.darija)} • ${f.defaultGrams}g (${m.netCarbs.toFixed(1)}g nets • ${m.protein.toFixed(1)}g prot)</p>
          </div>
          <button type="button" class="${btnClass} pointer-events-none">
            ${btnLabel}
          </button>
        </div>
      `;
    }).join('');
  },

  renderHistoryView(history, settings = null) {
    const chart = document.getElementById('chartSevenDays');
    const list = document.getElementById('historyLogsContainer');
    const avg = document.getElementById('lblWeeklyAverage');

    const days = [];
    const now = new Date();
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(now.getDate() - i);
      days.push({
        key: getLocalDateString(d),
        label: d.toLocaleDateString('fr-FR', { weekday: 'short' }),
        netCarbs: 0
      });
    }

    for (const h of history) {
      const k = getLocalDateString(h.timestamp);
      const day = days.find(d => d.key === k);
      if (day) day.netCarbs += Number(h.netCarbs) || 0;
    }

    const maxDay = Math.max(120, ...days.map(d => d.netCarbs));
    const sumWeek = days.reduce((acc, d) => acc + d.netCarbs, 0);
    avg.textContent = `Moyenne : ${Math.round(sumWeek / 7)}g/j`;

    chart.innerHTML = days.map(d => {
      const hPct = Math.max(8, Math.min(100, Math.round((d.netCarbs / maxDay) * 100)));
      return `
        <div class="flex flex-col items-center justify-end h-full gap-1">
          <span class="text-[9px] font-mono font-bold text-slate-600">${Math.round(d.netCarbs)}g</span>
          <div class="w-full max-w-[24px] bg-slate-200/70 rounded-t-lg h-16 flex items-end overflow-hidden">
            <div class="w-full bg-emerald-500 rounded-t-lg" style="height:${hPct}%"></div>
          </div>
          <span class="text-[9px] font-bold uppercase text-slate-400">${escapeHTML(d.label)}</span>
        </div>
      `;
    }).join('');

    if (history.length === 0) {
      list.innerHTML = `<div class="surface-card rounded-3xl p-6 text-center text-xs text-slate-500">Aucun repas enregistré.</div>`;
      return;
    }

    // Trier les repas par ordre chronologique décroissant (plus récents en premier)
    const sortedHistory = [...history].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    // Grouper les repas par date locale (YYYY-MM-DD)
    const groups = new Map();
    for (const h of sortedHistory) {
      const dayKey = getLocalDateString(h.timestamp) || 'inconnu';
      if (!groups.has(dayKey)) {
        groups.set(dayKey, []);
      }
      groups.get(dayKey).push(h);
    }

    const todayKey = getLocalDateString(now);
    const yesterdayDate = new Date(now);
    yesterdayDate.setDate(now.getDate() - 1);
    const yesterdayKey = getLocalDateString(yesterdayDate);

    let html = '';
    groups.forEach((meals, dayKey) => {
      let dayProtein = 0;
      let dayCarbs = 0;
      let dayFat = 0;
      let dayCalories = 0;
      let dayGrams = 0;

      for (const m of meals) {
        const prot = Number(m.totalProtein) || 0;
        const carbs = Number(m.netCarbs) || 0;
        const fat = Number(m.totalFat) || 0;
        const cal = m.totalCalories ? Number(m.totalCalories) : (prot * 4 + carbs * 4 + fat * 9);
        const gr = Number(m.totalGrams) || 0;

        dayProtein += prot;
        dayCarbs += carbs;
        dayFat += fat;
        dayCalories += cal;
        dayGrams += gr;
      }

      let dayTitle = '';
      let subTitle = '';
      if (dayKey === todayKey) {
        dayTitle = "Aujourd'hui";
        subTitle = now.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });
      } else if (dayKey === yesterdayKey) {
        dayTitle = 'Hier';
        subTitle = yesterdayDate.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });
      } else if (dayKey.includes('-')) {
        const [year, month, day] = dayKey.split('-').map(Number);
        const groupDate = new Date(year, month - 1, day);
        const fullDayName = groupDate.toLocaleDateString('fr-FR', { weekday: 'long' });
        dayTitle = fullDayName.charAt(0).toUpperCase() + fullDayName.slice(1);
        subTitle = groupDate.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
      } else {
        dayTitle = 'Autre date';
        subTitle = dayKey;
      }

      const mealCountText = meals.length > 1 ? `${meals.length} repas` : '1 repas';
      const roundedProt = Math.round(dayProtein * 10) / 10;
      const roundedCarbs = Math.round(dayCarbs * 10) / 10;
      const roundedFat = Math.round(dayFat * 10) / 10;
      const roundedCal = Math.round(dayCalories);

      const mealsHtml = meals.map(h => {
        const mealDate = new Date(h.timestamp);
        const timeStr = !isNaN(mealDate.getTime())
          ? mealDate.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
          : '--:--';
        const names = (h.items || []).map(i => `${escapeHTML(i.name)} (${Number(i.grams) || 0}g)`).join(', ');
        const itemId = escapeHTML(h.id || h.timestamp);
        const proteinVal = h.totalProtein ? Math.round(Number(h.totalProtein) * 10) / 10 : 0;
        const totalGramsVal = Math.round(Number(h.totalGrams) || 0);
        const netCarbsVal = Math.round(Number(h.netCarbs) * 10 || 0) / 10;

        const giVal = Number(h.avgGI);
        const giBadge = giVal > 0 ? (
          giVal <= 55
            ? `<span class="text-[9.5px] font-extrabold text-emerald-800 bg-emerald-50 px-1.5 py-0.5 rounded-md border border-emerald-200">IG ${Math.round(giVal)}</span>`
            : giVal <= 69
              ? `<span class="text-[9.5px] font-extrabold text-amber-800 bg-amber-50 px-1.5 py-0.5 rounded-md border border-amber-200">IG ${Math.round(giVal)}</span>`
              : `<span class="text-[9.5px] font-extrabold text-rose-800 bg-rose-50 px-1.5 py-0.5 rounded-md border border-rose-200">IG ${Math.round(giVal)}</span>`
        ) : '';

        const validImg = safeImageUrl(h.imageUrl);
        const imageThumb = validImg
          ? `<img src="${validImg}" alt="Repas" class="w-12 h-12 object-cover rounded-xl border border-slate-200 shadow-2xs shrink-0">`
          : `<div class="w-12 h-12 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-700 flex items-center justify-center shrink-0 text-base font-bold">🍽️</div>`;

        const fatVal = h.totalFat ? Math.round(Number(h.totalFat) * 10) / 10 : 0;
        const calVal = h.totalCalories ? Math.round(Number(h.totalCalories)) : Math.round(proteinVal * 4 + netCarbsVal * 4 + fatVal * 9);

        return `
          <div class="surface-card rounded-2xl p-3 space-y-2 border border-slate-200/70 hover:border-slate-300 transition-all">
            <div class="flex items-start gap-2.5">
              ${imageThumb}
              <div class="flex-1 min-w-0">
                <div class="flex items-center justify-between gap-1 mb-0.5">
                  <div class="flex items-center gap-1.5">
                    <span class="text-xs font-black text-slate-900">🕒 ${escapeHTML(timeStr)}</span>
                  </div>
                  <div class="flex items-center gap-1">
                    ${giBadge}
                    <span class="text-[9.5px] font-extrabold text-emerald-800 bg-emerald-50 px-1.5 py-0.5 rounded-md border border-emerald-200">
                      ${escapeHTML(h.verdictTag || 'Repas')}
                    </span>
                    <button type="button" class="btn-copy-samsung-meal p-1 rounded-lg text-slate-400 hover:text-sky-600 hover:bg-sky-50 active:scale-90 transition-all flex items-center justify-center"
                      data-title="${escapeHTML(h.verdictTag || 'Repas')} (${escapeHTML(timeStr)})"
                      data-cal="${calVal}"
                      data-prot="${proteinVal}"
                      data-carbs="${netCarbsVal}"
                      data-fat="${fatVal}"
                      title="Copier pour Samsung Health">
                      <i data-lucide="smartphone" class="w-3.5 h-3.5"></i>
                    </button>
                    <button type="button" class="btn-delete-history-item p-1 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 active:scale-90 transition-all flex items-center justify-center" data-id="${itemId}" title="Supprimer ce repas du journal">
                      <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
                    </button>
                  </div>
                </div>
                <p class="text-[11px] text-slate-600 leading-snug line-clamp-2">${names}</p>
              </div>
            </div>
            <div class="flex flex-wrap items-center justify-between gap-1 pt-1.5 border-t border-slate-100 text-[10.5px] font-mono font-bold text-slate-700">
              <span class="text-emerald-800 bg-emerald-50 px-1.5 py-0.5 rounded-md border border-emerald-200">🥩 ${proteinVal}g prot</span>
              <span class="text-cyan-800 bg-cyan-50 px-1.5 py-0.5 rounded-md border border-cyan-200">🌾 ${netCarbsVal}g gluc</span>
              <span class="text-amber-800 bg-amber-50 px-1.5 py-0.5 rounded-md border border-amber-200">🥑 ${fatVal}g lip</span>
              <span class="text-slate-700 bg-slate-100 px-1.5 py-0.5 rounded-md">🔥 ${calVal} kcal</span>
              <span class="text-slate-400 ml-auto">⚖️ ${totalGramsVal}g</span>
            </div>
          </div>
        `;
      }).join('');

      html += `
        <div class="day-group space-y-2 pt-2 first:pt-0">
          <div class="sticky top-2 z-10 bg-slate-50/95 dark:bg-slate-900/95 backdrop-blur-md rounded-2xl p-2.5 border border-slate-200/80 shadow-2xs space-y-1.5">
            <div class="flex items-center justify-between">
              <div class="flex items-center gap-2">
                <span class="w-2.5 h-2.5 rounded-full ${dayKey === todayKey ? 'bg-emerald-500 ring-2 ring-emerald-200 animate-pulse' : (dayKey === yesterdayKey ? 'bg-cyan-500' : 'bg-slate-400')}"></span>
                <span class="text-xs font-black text-slate-900 tracking-wide">${escapeHTML(dayTitle)}</span>
                <span class="text-[10.5px] text-slate-500 font-semibold">• ${escapeHTML(subTitle)}</span>
              </div>
              <span class="text-[10px] font-extrabold px-2 py-0.5 rounded-full bg-white border border-slate-200 text-slate-700 shadow-2xs">
                ${mealCountText}
              </span>
            </div>
            <div class="flex flex-wrap items-center justify-between gap-1.5 pt-0.5">
              <div class="flex flex-wrap items-center gap-1.5 text-[10px] font-mono font-bold">
                <span class="text-slate-800 bg-white border border-slate-200 px-1.5 py-0.5 rounded-md shadow-2xs">🔥 ${roundedCal} kcal</span>
                <span class="text-emerald-800 bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 rounded-md">🥩 ${roundedProt}g prot</span>
                <span class="text-cyan-800 bg-cyan-50 border border-cyan-200 px-1.5 py-0.5 rounded-md">🌾 ${roundedCarbs}g gluc</span>
                <span class="text-amber-800 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded-md">🥑 ${roundedFat}g lip</span>
              </div>
              <button type="button" class="btn-copy-samsung-day text-[10px] font-extrabold px-2 py-0.5 rounded-full bg-sky-50 border border-sky-200 text-sky-800 hover:bg-sky-100 active:scale-95 transition-all flex items-center gap-1 shadow-2xs"
                data-day="${escapeHTML(dayKey)}"
                data-cal="${roundedCal}"
                data-prot="${roundedProt}"
                data-carbs="${roundedCarbs}"
                data-fat="${roundedFat}"
                data-title="${escapeHTML(dayTitle)}"
                title="Copier le total de cette journée pour Samsung Health">
                <i data-lucide="smartphone" class="w-3 h-3 text-sky-600"></i>
                <span>Samsung Health</span>
              </button>
            </div>
          </div>
          <div class="space-y-2">
            ${mealsHtml}
          </div>
        </div>
      `;
    });

    list.innerHTML = html;

    if (window.lucide) {
      window.lucide.createIcons();
    }
  },

  renderCircularFastingClock(elapsedMin, remainMin, isEatingWindow, phaseData) {
    const circle = document.getElementById('fastingCircleProgress');
    const titleEl = document.getElementById('fastingCirclePhase');
    const timeEl = document.getElementById('fastingCircleTime');
    const subEl = document.getElementById('fastingCircleSub');
    const tipEl = document.getElementById('fastingCircleTip');

    if (!circle || !titleEl || !timeEl) return;

    const totalWindowMin = isEatingWindow ? 360 : 1080;
    const pct = Math.min(100, Math.max(0, Math.round((elapsedMin / totalWindowMin) * 100)));
    const circumference = 314.16;
    const offset = circumference * (1 - pct / 100);

    const color = phaseData ? phaseData.color : (isEatingWindow ? '#059669' : '#6366f1');

    circle.style.strokeDashoffset = offset.toFixed(2);
    circle.style.stroke = color;
    circle.style.filter = `drop-shadow(0 0 6px ${color}88)`;

    const h = Math.floor(remainMin / 60);
    const m = remainMin % 60;
    timeEl.textContent = `${String(h).padStart(2, '0')}h ${String(m).padStart(2, '0')}m`;

    if (phaseData) {
      titleEl.textContent = phaseData.shortName;
      titleEl.style.color = color;
      if (subEl) {
        subEl.textContent = phaseData.sub;
      }
      if (tipEl) {
        tipEl.textContent = phaseData.tip;
        tipEl.style.color = color;
      }
    } else {
      if (isEatingWindow) {
        titleEl.textContent = 'Fenêtre 6h';
        titleEl.style.color = '#059669';
        if (subEl) subEl.textContent = 'avant fermeture';
      } else {
        titleEl.textContent = 'Jeûne 18h';
        titleEl.style.color = '#6366f1';
        if (subEl) subEl.textContent = 'avant ouverture';
      }
    }
  },

  exportMedicalReport(history, settings) {
    if (!Array.isArray(history) || history.length === 0) {
      showToast('Aucun repas dans le journal à exporter');
      return;
    }

    const totalCarbs = history.reduce((sum, h) => sum + (Number(h.netCarbs) || 0), 0);
    const totalProt = history.reduce((sum, h) => sum + (Number(h.totalProtein) || 0), 0);
    const totalFat = history.reduce((sum, h) => sum + (Number(h.totalFat) || 0), 0);
    const totalCal = history.reduce((sum, h) => sum + (Number(h.totalCalories) || ((Number(h.totalProtein) || 0) * 4 + (Number(h.netCarbs) || 0) * 4 + (Number(h.totalFat) || 0) * 9)), 0);
    const totalGL = history.reduce((sum, h) => sum + (Number(h.totalGL) || 0), 0);
    const avgCarbs = Math.round(totalCarbs / history.length);
    const avgProt = Math.round(totalProt / history.length);
    const avgFat = Math.round(totalFat / history.length);
    const avgCal = Math.round(totalCal / history.length);
    const avgGL = Math.round((totalGL / history.length) * 10) / 10;

    const rows = history.slice(0, 40).map(h => {
      const d = new Date(h.timestamp).toLocaleDateString('fr-FR', {
        day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'
      });
      const names = (h.items || []).map(i => `${escapeHTML(i.name)} (${Number(i.grams) || 0}g)`).join(', ');
      const totalG = Math.round(Number(h.totalGrams) || 0);
      const netC = Math.round(Number(h.netCarbs) * 10 || 0) / 10;
      const protVal = h.totalProtein ? (Math.round(Number(h.totalProtein) * 10) / 10) : 0;
      const fatVal = h.totalFat ? (Math.round(Number(h.totalFat) * 10) / 10) : 0;
      const calVal = h.totalCalories ? Math.round(Number(h.totalCalories)) : Math.round(protVal * 4 + netC * 4 + fatVal * 9);
      return `
        <tr style="border-bottom: 1px solid #e2e8f0; font-size: 11px;">
          <td style="padding: 8px 6px;"><strong>${escapeHTML(d)}</strong></td>
          <td style="padding: 8px 6px;">${names}</td>
          <td style="padding: 8px 6px; text-align: right;">${totalG}g</td>
          <td style="padding: 8px 6px; text-align: right; color: #0f172a;"><strong>${calVal} kcal</strong></td>
          <td style="padding: 8px 6px; text-align: right; color: #059669;"><strong>${protVal}g</strong></td>
          <td style="padding: 8px 6px; text-align: right;"><strong>${netC}g</strong></td>
          <td style="padding: 8px 6px; text-align: right; color: #d97706;"><strong>${fatVal}g</strong></td>
          <td style="padding: 8px 6px; text-align: right;">${h.totalGL || '--'}</td>
          <td style="padding: 8px 6px; text-align: center;">${escapeHTML(h.verdictTag || 'Normal')}</td>
        </tr>
      `;
    }).join('');

    const html = `
      <!DOCTYPE html>
      <html lang="fr">
      <head>
        <meta charset="UTF-8">
        <title>Bilan Nutritionnel Sportif &amp; Jeûne Intermittent — MacroScan Maroc</title>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; color: #0f172a; margin: 24px; line-height: 1.4; }
          .header { border-bottom: 2px solid #059669; padding-bottom: 12px; margin-bottom: 20px; display: flex; justify-content: space-between; align-items: flex-end; }
          .badge { background: #ecfdf5; color: #065f46; border: 1px solid #a7f3d0; padding: 4px 8px; border-radius: 6px; font-weight: bold; font-size: 12px; }
          .kpi-grid { display: grid; grid-template-columns: repeat(5, 1fr); gap: 10px; margin-bottom: 24px; }
          .kpi-card { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 10px; text-align: center; }
          .kpi-val { font-size: 18px; font-weight: 800; color: #0f172a; font-family: monospace; }
          .kpi-lbl { font-size: 10px; color: #64748b; font-weight: bold; margin-top: 4px; }
          table { width: 100%; border-collapse: collapse; margin-top: 10px; }
          th { background: #f1f5f9; padding: 8px 6px; text-align: left; font-size: 11px; text-transform: uppercase; color: #475569; }
          .footer { margin-top: 40px; border-top: 1px dashed #cbd5e1; padding-top: 12px; font-size: 11px; color: #64748b; display: flex; justify-content: space-between; }
          @media print { button { display: none !important; } body { margin: 0; } }
        </style>
      </head>
      <body>
        <div class="header">
          <div>
            <h1 style="margin: 0; font-size: 22px; color: #0f172a;">🏋️ Bilan Nutritionnel Sportif &amp; Jeûne 18/6</h1>
            <p style="margin: 4px 0 0; font-size: 12px; color: #64748b;">Protocole 85 kg (18-6) : 1920-2000 kcal • 150g P • 150g G • 80g L</p>
          </div>
          <div style="text-align: right;">
            <span class="badge">Rapport Nutrition Sportive</span>
            <p style="margin: 4px 0 0; font-size: 11px; color: #64748b;">Date: ${new Date().toLocaleDateString('fr-FR')}</p>
          </div>
        </div>

        <div class="kpi-grid">
          <div class="kpi-card">
            <div class="kpi-val">${history.length}</div>
            <div class="kpi-lbl">Repas</div>
          </div>
          <div class="kpi-card">
            <div class="kpi-val" style="color: #0f172a;">~${avgCal}</div>
            <div class="kpi-lbl">Calories Moy.</div>
          </div>
          <div class="kpi-card">
            <div class="kpi-val" style="color: #059669;">${avgProt}g</div>
            <div class="kpi-lbl">Protéines Moy.</div>
          </div>
          <div class="kpi-card">
            <div class="kpi-val" style="color: #0284c7;">${avgCarbs}g</div>
            <div class="kpi-lbl">Glucides Moy.</div>
          </div>
          <div class="kpi-card">
            <div class="kpi-val" style="color: #d97706;">${avgFat}g</div>
            <div class="kpi-lbl">Lipides Moy.</div>
          </div>
        </div>

        <h3 style="font-size: 14px; margin-bottom: 8px;">Historique des repas &amp; apports en macronutriments</h3>
        <table>
          <thead>
            <tr>
              <th>Date &amp; Heure</th>
              <th>Composition du Plat</th>
              <th style="text-align: right;">Poids</th>
              <th style="text-align: right;">Calories</th>
              <th style="text-align: right; color:#059669;">Protéines</th>
              <th style="text-align: right; color:#0284c7;">Glucides</th>
              <th style="text-align: right; color:#d97706;">Lipides</th>
              <th style="text-align: right;">CG</th>
              <th style="text-align: center;">Verdict</th>
            </tr>
          </thead>
          <tbody>
            ${rows}
          </tbody>
        </table>

        <div class="footer">
          <div>Protocole : Jeûne Intermittent 18/6 (Fenêtre 10h-16h) • Recomposition Corporelle</div>
          <div>Généré par MacroScan Maroc</div>
        </div>

        <div style="margin-top: 24px; display: flex; gap: 12px; justify-content: center;">
          <button onclick="window.print()" style="padding: 10px 20px; background: #059669; color: white; border: none; border-radius: 10px; font-weight: bold; cursor: pointer;">
            🖨️ Imprimer ou Enregistrer en PDF
          </button>
        </div>
      </body>
      </html>
    `;

    const printWin = window.open('', '_blank');
    if (printWin) {
      printWin.document.write(html);
      printWin.document.close();
    } else {
      showToast('Autorisez les fenêtres pop-up pour afficher le PDF');
    }
  },

  exportHistoryCSV(history) {
    if (!Array.isArray(history) || history.length === 0) {
      showToast('Aucun repas à exporter');
      return;
    }
    const sanitizeCSV = (str) => {
      let s = String(str ?? '');
      if (/^[=+\-@\t\r]/.test(s)) {
        s = `'` + s;
      }
      return `"${s.replace(/"/g, '""')}"`;
    };

    const headers = ['Date', 'Heure', 'Aliments', 'Poids_Total_g', 'Calories_kcal', 'Proteines_g', 'Glucides_Nets_g', 'Lipides_g', 'Fibres_g', 'Index_Glycemique', 'Charge_Glycemique', 'Verdict'];
    const rows = history.map(h => {
      const d = new Date(h.timestamp);
      const dateStr = getLocalDateString(d);
      const timeStr = d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
      const names = (h.items || []).map(i => `${i.name || ''} (${Number(i.grams) || 0}g)`).join(' + ').replace(/;/g, ' ');
      const p = Math.round(Number(h.totalProtein) * 10 || 0) / 10;
      const c = Math.round(Number(h.netCarbs) * 10 || 0) / 10;
      const f = Math.round(Number(h.totalFat) * 10 || 0) / 10;
      const cal = Math.round(Number(h.totalCalories) || (p * 4 + c * 4 + f * 9));
      return [
        sanitizeCSV(dateStr),
        sanitizeCSV(timeStr),
        sanitizeCSV(names),
        Math.round(Number(h.totalGrams) || 0),
        cal,
        p,
        c,
        f,
        Math.round(Number(h.totalFiber) * 10 || 0) / 10,
        Math.round(Number(h.avgGI) || 0),
        Math.round(Number(h.totalGL) * 10 || 0) / 10,
        sanitizeCSV(h.verdictTag || '')
      ].join(';');
    });

    const csvContent = '\uFEFF' + [headers.join(';'), ...rows].join('\r\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `macroscan-repas-${getLocalDateString()}.csv`;
    link.click();
    // Révocation différée : une révocation immédiate peut annuler le téléchargement (Safari/Firefox)
    setTimeout(() => URL.revokeObjectURL(url), 1500);
    showToast('📊 Export CSV généré (compatible Excel & Suivi Sportif) !');
  }
};
