import { FoodRepository } from '../data/foods.js?v=13';
import { MetabolicEngine } from '../services/metabolicEngine.js?v=13';

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
  renderDashboard(state, evaluation) {
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

    // Compteurs et Anneau SVG
    document.getElementById('outNetCarbs').textContent = String(evaluation.netCarbs);
    document.getElementById('outTotalGrams').textContent = `${evaluation.totalGrams}g pesés`;
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

    document.getElementById('lblBGUnit').textContent = state.settings.bgUnit;
    document.getElementById('lblBGSuffix').textContent = state.settings.bgUnit;

    this.renderPins(state.items, state.selectedPinIndex);
    this.renderRecognizedList(state.items, state.selectedPinIndex);

    if (window.lucide) {
      window.lucide.createIcons();
    }
  },

  renderPins(items, selectedPinIdx = null) {
    const layer = document.getElementById('pinsLayer');
    const hasImage = !document.getElementById('plateImage').classList.contains('hidden');
    const arrangeBtn = document.getElementById('btnAutoArrangePins');
    const hintBanner = document.getElementById('pinsHintBanner');

    if (!hasImage || items.length === 0) {
      layer.innerHTML = '';
      if (arrangeBtn) arrangeBtn.classList.add('hidden');
      if (hintBanner) hintBanner.classList.add('hidden');
      return;
    }

    if (arrangeBtn) arrangeBtn.classList.toggle('hidden', items.length < 2);
    if (hintBanner) hintBanner.classList.remove('hidden');

    layer.innerHTML = items.map((item, idx) => {
      const food = MetabolicEngine.resolveFoodEntry(item);
      if (!food) return '';
      const macros = MetabolicEngine.computeFoodPortion(food, item.grams);
      const x = Math.min(86, Math.max(14, Number(item.x) || 50));
      const y = Math.min(84, Math.max(16, Number(item.y) || (24 + idx * 18)));
      const isSelected = selectedPinIdx === idx;
      const shortLabel = food.name.split('(')[0].trim();

      const borderStyle = isSelected
        ? 'bg-emerald-50 text-slate-950 ring-2 ring-emerald-500 border-emerald-600 z-30 scale-105'
        : 'bg-white/95 text-slate-900 border-emerald-500/50 z-10 hover:z-20';

      return `
        <div data-pin-index="${idx}"
             class="food-pin pointer-events-auto cursor-grab active:cursor-grabbing select-none absolute -translate-x-1/2 -translate-y-1/2 px-2 py-1 rounded-full shadow-lg border flex items-center gap-1 text-[11px] font-extrabold whitespace-nowrap transition-shadow ${borderStyle}"
             style="left:${x}%; top:${y}%; touch-action:none;">
          <span class="text-slate-400 text-[10px] leading-none font-mono pr-0.5" title="Glisser pour déplacer">⋮⋮</span>
          <span class="w-2 h-2 rounded-full bg-emerald-500 flex-shrink-0"></span>
          <span class="max-w-[135px] truncate">${escapeHTML(shortLabel)}</span>
          <span class="font-mono text-emerald-700">~${item.grams}g</span>
          <span class="text-[10px] font-mono text-slate-500">(${Math.round(macros.netCarbs)}g)</span>
          <button type="button" data-edit-pin="${idx}" title="Modifier cette étiquette"
            class="ml-0.5 w-4 h-4 rounded-full bg-amber-100 hover:bg-amber-200 text-amber-800 flex items-center justify-center text-[9px] leading-none">
            ✎
          </button>
          <button type="button" data-remove-pin="${idx}" title="Supprimer cet aliment"
            class="w-4 h-4 rounded-full bg-rose-100 hover:bg-rose-200 text-rose-700 flex items-center justify-center text-[10px] font-extrabold leading-none">
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
              <p class="text-[11px] text-slate-500">${escapeHTML(food.refPortion)} • IG ${food.gi} • Fibres ${macros.fiber.toFixed(1)}g</p>
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
            <p class="text-[11px] text-slate-500 truncate">${escapeHTML(f.darija)} • ${f.defaultGrams}g (${m.netCarbs.toFixed(1)}g nets)</p>
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
  }
};
