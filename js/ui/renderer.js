import { FoodRepository } from '../data/foods.js?v=11';
import { MetabolicEngine } from '../services/metabolicEngine.js?v=11';

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

    this.renderPins(state.items);
    this.renderRecognizedList(state.items);

    if (window.lucide) {
      window.lucide.createIcons();
    }
  },

  renderPins(items) {
    const layer = document.getElementById('pinsLayer');
    const hasImage = !document.getElementById('plateImage').classList.contains('hidden');
    if (!hasImage || items.length === 0) {
      layer.innerHTML = '';
      return;
    }

    layer.innerHTML = items.map((item, idx) => {
      const food = MetabolicEngine.resolveFoodEntry(item);
      if (!food) return '';
      const macros = MetabolicEngine.computeFoodPortion(food, item.grams);
      const x = item.x || (25 + (idx * 24) % 55);
      const y = item.y || (28 + (idx * 20) % 50);

      return `
        <div class="absolute -translate-x-1/2 -translate-y-1/2 bg-white/95 text-slate-900 px-2.5 py-1 rounded-full shadow-md border border-emerald-500/40 flex items-center gap-1 text-[11px] font-extrabold whitespace-nowrap"
             style="left:${x}%; top:${y}%;">
          <span class="w-2 h-2 rounded-full bg-emerald-500"></span>
          <span>${escapeHTML(food.name.split('(')[0].trim())}</span>
          <span class="font-mono text-emerald-700">~${item.grams}g</span>
          <span class="text-[10px] font-mono text-slate-500">(${Math.round(macros.netCarbs)}g)</span>
        </div>
      `;
    }).join('');
  },

  renderRecognizedList(items) {
    const container = document.getElementById('recognizedItemsContainer');
    const countEl = document.getElementById('lblDetectedCount');
    const footer = document.getElementById('scanFooterActions');

    countEl.textContent = String(items.length);
    if (items.length === 0) {
      footer.classList.add('hidden');
      container.innerHTML = `
        <div class="text-center py-6 px-4 rounded-2xl bg-slate-50 border border-dashed border-slate-200">
          <p class="text-xs font-bold text-slate-700">Aucun aliment scanné</p>
          <p class="text-[11px] text-slate-500 mt-0.5">Utilisez « Prendre Photo » ou « Galerie Photo » ci-dessus.</p>
        </div>
      `;
      return;
    }

    footer.classList.remove('hidden');
    container.innerHTML = items.map((item, idx) => {
      const food = MetabolicEngine.resolveFoodEntry(item);
      if (!food) return '';
      const macros = MetabolicEngine.computeFoodPortion(food, item.grams);

      return `
        <div class="p-3 rounded-2xl bg-slate-50 border border-slate-200 space-y-2">
          <div class="flex items-start justify-between gap-2">
            <div>
              <h4 class="text-xs font-extrabold text-slate-900">${escapeHTML(food.name)}</h4>
              <p class="text-[11px] text-slate-500">${escapeHTML(food.refPortion)} • IG ${food.gi} • Fibres ${macros.fiber.toFixed(1)}g</p>
            </div>
            <div class="text-right">
              <span class="text-sm font-extrabold font-mono text-emerald-700">${macros.netCarbs.toFixed(1)}g</span>
              <span class="block text-[10px] text-slate-400">nets</span>
            </div>
          </div>
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
              <button type="button" data-remove="${idx}" class="p-1.5 rounded-xl bg-rose-50 text-rose-600 ml-1">
                <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
              </button>
            </div>
          </div>
        </div>
      `;
    }).join('');
  },

  renderCatalogModal(searchQuery) {
    const list = document.getElementById('catalogItemsList');
    const q = (searchQuery || '').toLowerCase().trim();
    const localFoods = FoodRepository.getAllFoods().filter(f =>
      !q || (`${f.name} ${f.darija} ${f.id}`).toLowerCase().includes(q)
    );

    list.innerHTML = localFoods.map(f => {
      const m = MetabolicEngine.computeFoodPortion(f, f.defaultGrams);
      return `
        <div class="p-2.5 rounded-2xl bg-slate-50 border border-slate-200 flex items-center justify-between gap-2">
          <div class="min-w-0 flex-1">
            <p class="text-xs font-extrabold text-slate-900 truncate">${escapeHTML(f.name)}</p>
            <p class="text-[11px] text-slate-500 truncate">${escapeHTML(f.darija)} • ${f.defaultGrams}g (${m.netCarbs.toFixed(1)}g nets)</p>
          </div>
          <button type="button" data-pick-food="${f.id}" class="px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-extrabold flex-shrink-0">
            + ${f.defaultGrams}g
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
