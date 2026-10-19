import { FoodRepository } from '../data/foods.js?v=17';
import { MetabolicEngine } from '../services/metabolicEngine.js?v=17';

/**
 * Fonctions de rendu DOM et protection XSS
 */
export function escapeHTML(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

let toastTimer = null;
export function showToast(message) {
  const banner = document.getElementById('toastBanner');
  const label = document.getElementById('toastLabel');
  if (!banner || !label) return;
  label.textContent = message;
  banner.classList.remove('opacity-0', 'translate-y-2');
  banner.classList.add('opacity-100', 'translate-y-0');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    banner.classList.add('opacity-0', 'translate-y-2');
    banner.classList.remove('opacity-100', 'translate-y-0');
  }, 2600);
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
  renderUserMode(userMode = 'insulin') {
    const isInsulin = userMode === 'insulin';
    const btnInsulin = document.getElementById('btnModeInsulin');
    const btnWellness = document.getElementById('btnModeWellness');

    if (btnInsulin && btnWellness) {
      if (isInsulin) {
        btnInsulin.className = 'flex-1 py-1 px-1.5 rounded-xl text-[10.5px] font-extrabold flex items-center justify-center gap-1 transition-all bg-white text-emerald-800 shadow-xs';
        btnWellness.className = 'flex-1 py-1 px-1.5 rounded-xl text-[10.5px] font-bold flex items-center justify-center gap-1 transition-all text-slate-500 hover:text-slate-900';
      } else {
        btnWellness.className = 'flex-1 py-1 px-1.5 rounded-xl text-[10.5px] font-extrabold flex items-center justify-center gap-1 transition-all bg-white text-emerald-800 shadow-xs';
        btnInsulin.className = 'flex-1 py-1 px-1.5 rounded-xl text-[10.5px] font-bold flex items-center justify-center gap-1 transition-all text-slate-500 hover:text-slate-900';
      }
    }

    document.querySelectorAll('.mode-insulin-only').forEach(el => {
      el.classList.toggle('hidden', !isInsulin);
    });

    document.querySelectorAll('.mode-wellness-only').forEach(el => {
      el.classList.toggle('hidden', isInsulin);
    });
  },

  renderDashboard(state, evaluation) {
    // Mode d'utilisation (Diabète & Insuline vs Santé & 18/6)
    this.renderUserMode(state.settings.userMode || 'insulin');

    // Badge moteur IA
    document.getElementById('engineBadge').textContent = 'IA Vision';

    // Boutons Matin / Midi / Soir
    document.querySelectorAll('.slot-btn').forEach(btn => {
      const isCurrent = btn.getAttribute('data-slot') === state.activeSlot;
      btn.className = isCurrent
        ? 'slot-btn px-2.5 py-1 rounded-lg text-[11px] font-extrabold bg-white text-emerald-700 shadow-xs transition-all'
        : 'slot-btn px-2 py-1 rounded-lg text-[11px] font-bold text-slate-500 transition-all';
    });

    // Carte Verdict
    const vBox = document.getElementById('verdictBox');
    const vIcon = document.getElementById('verdictBadgeIcon');
    vBox.className = `rounded-2xl p-3.5 border flex items-start gap-3 transition-all ${evaluation.verdict.boxClass}`;
    vIcon.className = `w-10 h-10 rounded-2xl flex items-center justify-center flex-shrink-0 ${evaluation.verdict.iconClass}`;
    vIcon.innerHTML = `<i data-lucide="${evaluation.verdict.iconName}" class="w-5 h-5"></i>`;

    document.getElementById('verdictStatusTag').textContent = evaluation.verdict.tag;
    document.getElementById('verdictMetricsPill').textContent = `IG ${evaluation.avgGI} • CG ${evaluation.totalGL}`;
    document.getElementById('verdictHeadline').textContent = evaluation.verdict.headline;
    document.getElementById('verdictDescription').textContent = evaluation.verdict.description;

    // Compteurs et Anneau SVG (affichage sans équivoque du nombre d'aliments et poids global)
    document.getElementById('outNetCarbs').textContent = String(evaluation.netCarbs);
    const nItems = state.items.length;
    document.getElementById('outTotalGrams').textContent = nItems > 1
      ? `${evaluation.totalGrams}g (${nItems} aliments)`
      : (nItems === 1 ? `${evaluation.totalGrams}g pesés` : '0g');
    document.getElementById('outTotalCarbs').textContent = String(evaluation.totalCarbs);
    document.getElementById('outTotalFiber').textContent = String(evaluation.totalFiber);
    document.getElementById('outTotalBolus').textContent = evaluation.totalBolus.toFixed(1);
    document.getElementById('outMealBolus').textContent = evaluation.mealBolus.toFixed(1);
    document.getElementById('outCorrBolus').textContent = `${evaluation.corrBolus >= 0 ? '+' : ''}${evaluation.corrBolus.toFixed(1)}`;

    const ring = document.getElementById('carbRingCircle');
    const circumference = 301.59;
    const pct = Math.min(1, evaluation.netCarbs / 80);
    ring.style.strokeDashoffset = (circumference * (1 - pct)).toFixed(2);
    ring.style.stroke = evaluation.verdict.ringColor;

    // Bloc Protéines & Indice Satiété
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

    // Indicateur Intelligent : Amorti Glycémique (Ratio Protéines+Fibres / Glucides)
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

    document.getElementById('lblBGUnit').textContent = state.settings.bgUnit;
    document.getElementById('lblBGSuffix').textContent = state.settings.bgUnit;

    this.renderPins(state.items, state.selectedPinIndex, state.pinsVisible !== false);
    this.renderRecognizedList(state.items, state.selectedPinIndex);

    if (window.lucide) {
      window.lucide.createIcons();
    }
  },

  renderDailySynthesis(todayTotals, settings) {
    const targetProt = Math.max(30, Number(settings.dailyTargetProtein) || 100);
    const targetCarbs = Math.max(30, Number(settings.dailyTargetCarbs) || 120);

    const protConsumed = Math.round(todayTotals.protein);
    const carbsConsumed = Math.round(todayTotals.carbs);

    const protPct = Math.round((protConsumed / targetProt) * 100);
    const carbsPct = Math.round((carbsConsumed / targetCarbs) * 100);

    const protText = `${protConsumed}g / ${targetProt}g (${protPct}%)`;
    const carbsText = `${carbsConsumed}g / ${targetCarbs}g (${carbsPct}%)`;

    const elProtText = document.getElementById('dailyOutProteinText');
    if (elProtText) elProtText.textContent = protText;

    const elCarbsText = document.getElementById('dailyOutCarbsText');
    if (elCarbsText) elCarbsText.textContent = carbsText;

    const qProt = document.getElementById('quickDailyProtText');
    if (qProt) qProt.textContent = protText;

    const qCarbs = document.getElementById('quickDailyCarbsText');
    if (qCarbs) qCarbs.textContent = carbsText;

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

    if (!hasImage || items.length === 0) {
      layer.innerHTML = '';
      if (arrangeBtn) arrangeBtn.classList.add('hidden');
      if (toggleBtn) toggleBtn.classList.add('hidden');
      if (hintBanner) hintBanner.classList.add('hidden');
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
             class="food-pin pointer-events-auto cursor-grab active:cursor-grabbing select-none absolute -translate-x-1/2 -translate-y-1/2 px-2.5 py-1 rounded-full border flex items-center gap-1.5 text-[10.5px] font-extrabold whitespace-nowrap transition-all ${glassStyle}"
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
              <p class="text-[11px] text-slate-500">${escapeHTML(food.refPortion)} • <span class="font-bold text-emerald-800">${macros.protein.toFixed(1)}g prot</span> • IG ${food.gi} • Fibres ${macros.fiber.toFixed(1)}g</p>
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
        <div class="p-2.5 rounded-2xl bg-slate-50 border border-slate-200 flex items-center justify-between gap-2">
          <div class="min-w-0 flex-1">
            <p class="text-xs font-extrabold text-slate-900 truncate">${escapeHTML(f.name)}</p>
            <p class="text-[11px] text-slate-500 truncate">${escapeHTML(f.darija)} • ${f.defaultGrams}g (${m.netCarbs.toFixed(1)}g nets • ${m.protein.toFixed(1)}g prot)</p>
          </div>
          <button type="button" data-pick-food="${f.id}" class="${btnClass}">
            ${btnLabel}
          </button>
        </div>
      `;
    }).join('');
  },

  renderHistoryView(history) {
    const chart = document.getElementById('chartSevenDays');
    const list = document.getElementById('historyLogsContainer');
    const avg = document.getElementById('lblWeeklyAverage');

    const days = [];
    const now = new Date();
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(now.getDate() - i);
      days.push({
        key: d.toISOString().slice(0, 10),
        label: d.toLocaleDateString('fr-FR', { weekday: 'short' }),
        netCarbs: 0
      });
    }

    for (const h of history) {
      const k = String(h.timestamp || '').slice(0, 10);
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

    list.innerHTML = history.map(h => {
      const dateStr = new Date(h.timestamp).toLocaleDateString('fr-FR', {
        day: '2-digit',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit'
      });
      const names = (h.items || []).map(i => `${escapeHTML(i.name)} (${i.grams}g)`).join(', ');
      return `
        <div class="surface-card rounded-2xl p-3.5 space-y-1">
          <div class="flex items-center justify-between">
            <span class="text-xs font-extrabold text-slate-900">${escapeHTML(dateStr)}</span>
            <span class="text-[10px] font-bold text-emerald-700">${escapeHTML(h.verdictTag || '')}</span>
          </div>
          <p class="text-xs text-slate-600">${names}</p>
          <div class="flex items-center justify-between pt-1.5 border-t border-slate-100 text-xs font-mono font-bold">
            <span>Poids: ${h.totalGrams}g • Nets: ${h.netCarbs}g</span>
            <span class="text-cyan-700">Bolus: ${Number(h.totalBolus).toFixed(1)} UI</span>
          </div>
        </div>
      `;
    }).join('');
  },

  renderCircularFastingClock(elapsedMin, remainMin, isEatingWindow) {
    const circle = document.getElementById('fastingCircleProgress');
    const titleEl = document.getElementById('fastingCirclePhase');
    const timeEl = document.getElementById('fastingCircleTime');
    const subEl = document.getElementById('fastingCircleSub');

    if (!circle || !titleEl || !timeEl) return;

    const totalWindowMin = isEatingWindow ? 360 : 1080;
    const pct = Math.min(100, Math.max(0, Math.round((elapsedMin / totalWindowMin) * 100)));
    const circumference = 314.16;
    const offset = circumference * (1 - pct / 100);

    circle.style.strokeDashoffset = offset.toFixed(2);
    circle.style.stroke = isEatingWindow ? '#059669' : '#6366f1';

    const h = Math.floor(remainMin / 60);
    const m = remainMin % 60;
    timeEl.textContent = `${String(h).padStart(2, '0')}h ${String(m).padStart(2, '0')}m`;

    if (isEatingWindow) {
      titleEl.textContent = 'Fenêtre 6h';
      titleEl.className = 'text-[9px] font-extrabold uppercase tracking-wider text-emerald-800';
      if (subEl) subEl.textContent = 'avant fermeture';
    } else {
      titleEl.textContent = 'Jeûne 18h';
      titleEl.className = 'text-[9px] font-extrabold uppercase tracking-wider text-indigo-700';
      if (subEl) subEl.textContent = 'avant ouverture';
    }
  },

  exportMedicalReport(history, settings) {
    if (!Array.isArray(history) || history.length === 0) {
      showToast('Aucun repas dans le journal à exporter');
      return;
    }

    const totalCarbs = history.reduce((sum, h) => sum + (Number(h.netCarbs) || 0), 0);
    const totalProt = history.reduce((sum, h) => sum + (Number(h.totalProtein) || 0), 0);
    const totalBolus = history.reduce((sum, h) => sum + (Number(h.totalBolus) || 0), 0);
    const avgCarbs = Math.round(totalCarbs / history.length);
    const avgProt = Math.round(totalProt / history.length);
    const avgBolus = (totalBolus / history.length).toFixed(1);

    const rows = history.slice(0, 30).map(h => {
      const d = new Date(h.timestamp).toLocaleDateString('fr-FR', {
        day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'
      });
      const names = (h.items || []).map(i => `${i.name} (${i.grams}g)`).join(', ');
      return `
        <tr style="border-bottom: 1px solid #e2e8f0; font-size: 11px;">
          <td style="padding: 8px 6px;"><strong>${d}</strong></td>
          <td style="padding: 8px 6px;">${escapeHTML(names)}</td>
          <td style="padding: 8px 6px; text-align: right;">${h.totalGrams}g</td>
          <td style="padding: 8px 6px; text-align: right;"><strong>${h.netCarbs}g</strong></td>
          <td style="padding: 8px 6px; text-align: right;">${h.totalProtein || '--'}g</td>
          <td style="padding: 8px 6px; text-align: right; color: #0284c7;"><strong>${Number(h.totalBolus || 0).toFixed(1)} UI</strong></td>
          <td style="padding: 8px 6px; text-align: center;">${escapeHTML(h.verdictTag || 'Normal')}</td>
        </tr>
      `;
    }).join('');

    const html = `
      <!DOCTYPE html>
      <html lang="fr">
      <head>
        <meta charset="UTF-8">
        <title>Rapport Médical Glycémique &amp; Nutritionnel — GlucoScan Maroc</title>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; color: #0f172a; margin: 24px; line-height: 1.4; }
          .header { border-bottom: 2px solid #059669; padding-bottom: 12px; margin-bottom: 20px; display: flex; justify-content: space-between; align-items: flex-end; }
          .badge { background: #ecfdf5; color: #065f46; border: 1px solid #a7f3d0; padding: 4px 8px; border-radius: 6px; font-weight: bold; font-size: 12px; }
          .kpi-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 24px; }
          .kpi-card { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 12px; text-align: center; }
          .kpi-val { font-size: 20px; font-weight: 800; color: #0f172a; font-family: monospace; }
          .kpi-lbl { font-size: 11px; color: #64748b; font-weight: bold; margin-top: 4px; }
          table { width: 100%; border-collapse: collapse; margin-top: 10px; }
          th { background: #f1f5f9; padding: 8px 6px; text-align: left; font-size: 11px; text-transform: uppercase; color: #475569; }
          .footer { margin-top: 40px; border-top: 1px dashed #cbd5e1; padding-top: 12px; font-size: 11px; color: #64748b; display: flex; justify-content: space-between; }
          @media print { button { display: none !important; } body { margin: 0; } }
        </style>
      </head>
      <body>
        <div class="header">
          <div>
            <h1 style="margin: 0; font-size: 22px; color: #0f172a;">🩺 Rapport Médical Glycémique &amp; Nutritionnel</h1>
            <p style="margin: 4px 0 0; font-size: 12px; color: #64748b;">Généré par GlucoScan Maroc • Dossier Patient</p>
          </div>
          <div style="text-align: right;">
            <span class="badge">Export Médical Officiel</span>
            <p style="margin: 4px 0 0; font-size: 11px; color: #64748b;">Date: ${new Date().toLocaleDateString('fr-FR')}</p>
          </div>
        </div>

        <div class="kpi-grid">
          <div class="kpi-card">
            <div class="kpi-val">${history.length}</div>
            <div class="kpi-lbl">Repas Scannés</div>
          </div>
          <div class="kpi-card">
            <div class="kpi-val">${avgCarbs}g</div>
            <div class="kpi-lbl">Glucides Moy. / Repas</div>
          </div>
          <div class="kpi-card">
            <div class="kpi-val">${avgProt}g</div>
            <div class="kpi-lbl">Protéines Moy. / Repas</div>
          </div>
          <div class="kpi-card">
            <div class="kpi-val" style="color: #0284c7;">${avgBolus} UI</div>
            <div class="kpi-lbl">Bolus Moyen Estimé</div>
          </div>
        </div>

        <h3 style="font-size: 14px; margin-bottom: 8px;">Détail chronologique des repas journalisés</h3>
        <table>
          <thead>
            <tr>
              <th>Date &amp; Heure</th>
              <th>Composition du Plat</th>
              <th style="text-align: right;">Poids</th>
              <th style="text-align: right;">Glucides</th>
              <th style="text-align: right;">Protéines</th>
              <th style="text-align: right;">Bolus</th>
              <th style="text-align: center;">Verdict</th>
            </tr>
          </thead>
          <tbody>
            ${rows}
          </tbody>
        </table>

        <div class="footer">
          <div>Observations du Médecin / Diabétologue : _________________________________</div>
          <div>Signature &amp; Cachet :</div>
        </div>

        <div style="margin-top: 24px; text-align: center;">
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
  }
};
