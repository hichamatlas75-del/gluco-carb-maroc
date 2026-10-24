import { FoodRepository } from './data/foods.js?v=37';
import { StorageService } from './services/storage.js?v=37';
import { MetabolicEngine } from './services/metabolicEngine.js?v=37';
import { VisionAnalyzer } from './services/visionAnalyzer.js?v=37';
import { UIRenderer, showToast, escapeHTML, getLocalDateString, safeImageUrl } from './ui/renderer.js?v=37';
import { ProfileService } from './services/profileService.js?v=37';
import { ImageCropper } from './ui/imageCropper.js?v=37';

/**
 * Contrôleur principal MacroFit Maroc (Nutrition Sportive & Jeûne Intermittent 18/6)
 */
const DEFAULT_SETTINGS = {
  userWeight: 85,            // Poids de référence (85 kg)
  dailyTargetCalories: 1950, // Cible journalière calories (~1920 - 2000 kcal)
  dailyTargetProtein: 150,   // Cible journalière protéines (150g)
  dailyTargetCarbs: 150,     // Cible journalière glucides nets (150g)
  dailyTargetFat: 80,        // Cible journalière lipides (80g)
  theme: 'auto',             // 'light', 'dark', 'auto'
  geminiKey: ''
};

function detectDefaultSlot() {
  const hour = new Date().getHours();
  if (hour >= 5 && hour < 11) return 'morning';
  if (hour >= 11 && hour < 17) return 'noon';
  return 'evening';
}

function getTodayTotals(history) {
  const todayKey = getLocalDateString();
  let consumedCarbs = 0;
  let consumedProtein = 0;
  let consumedFat = 0;
  let consumedCalories = 0;
  let mealCount = 0;

  for (const log of (history || [])) {
    if (!log || !log.timestamp) continue;
    const logDate = getLocalDateString(log.timestamp);
    if (logDate === todayKey) {
      const p = Number(log.totalProtein || log.protein) || 0;
      const c = Number(log.netCarbs) || 0;
      const f = Number(log.totalFat || log.fat) || 0;
      const cal = Number(log.totalCalories || log.calories) || Math.round(p * 4 + c * 4 + f * 9);
      consumedCarbs += c;
      consumedProtein += p;
      consumedFat += f;
      consumedCalories += cal;
      mealCount++;
    }
  }

  return {
    carbs: Math.round(consumedCarbs * 10) / 10,
    protein: Math.round(consumedProtein * 10) / 10,
    fat: Math.round(consumedFat * 10) / 10,
    calories: Math.round(consumedCalories),
    mealCount
  };
}

const savedSettings = StorageService.load('glucoscan_settings_v3', {});
const state = {
  settings: {
    ...DEFAULT_SETTINGS,
    ...savedSettings,
    geminiKey: (savedSettings.geminiKey && savedSettings.geminiKey.trim().length >= 15)
      ? savedSettings.geminiKey.trim()
      : ''
  },
  activeSlot: detectDefaultSlot(),
  items: StorageService.load('glucoscan_items_v3', []),
  history: StorageService.load('glucoscan_history_v3', []),
  mediaStream: null,
  displayObjectUrl: null,
  currentPlateImage: null,
  selectedCalendarDate: getLocalDateString(),
  viewCalendarYear: new Date().getFullYear(),
  viewCalendarMonth: new Date().getMonth(),
  catalogFilter: '',
  catalogCategory: 'all',
  replaceItemIndex: null,
  selectedPinIndex: null,
  pinsVisible: true,
  customPresetGI: 50,
  scanSeq: 0
};

// Restauration du profil utilisateur actif (si connecté)
const activeProfileInit = ProfileService.init();
if (activeProfileInit) {
  const profileRecord = ProfileService.getProfileData();
  if (profileRecord) {
    if (profileRecord.settings) {
      state.settings = { ...state.settings, ...profileRecord.settings };
    }
    if (Array.isArray(profileRecord.history) && profileRecord.history.length > 0) {
      state.history = profileRecord.history;
    }
  }

  // Synchronisation automatique au démarrage avec le Cloud Supabase (Mobile ⇄ PC)
  performGlobalSync({ silent: true });
}

/**
 * Écarte automatiquement les étiquettes (pins) sur la photo de façon aérée et élégante
 * pour éviter toute superposition et dégager la vue sur les aliments.
 */
function spreadPinsAutomatically(items, forceAll = false) {
  if (!Array.isArray(items) || items.length === 0) return;
  if (items.length === 1) {
    items[0].x = Math.min(68, Math.max(32, Number(items[0].x) || 50));
    items[0].y = Math.min(74, Math.max(26, Number(items[0].y) || 50));
    return;
  }

  // Détecte s'il y a collision verticale (< 14% d'écart vertical) entre 2 étiquettes
  let hasCollision = forceAll;
  if (!hasCollision) {
    for (let i = 0; i < items.length; i++) {
      for (let j = i + 1; j < items.length; j++) {
        const dy = Math.abs((Number(items[i].y) || 50) - (Number(items[j].y) || 50));
        const dx = Math.abs((Number(items[i].x) || 50) - (Number(items[j].x) || 50));
        if (dy < 14 && dx < 30) {
          hasCollision = true;
          break;
        }
      }
      if (hasCollision) break;
    }
  }

  if (!hasCollision) return;

  const n = items.length;
  // Répartition aérée en quinconce (alternance gauche-droite) pour ne pas masquer le centre du plat
  const minY = 22;
  const maxY = 78;
  const stepY = (maxY - minY) / Math.max(1, n - 1);

  items.forEach((item, idx) => {
    item.y = Math.round(minY + idx * stepY);
    // Alternance gauche/droite (38% et 62%) pour aérer le centre de l'image
    item.x = idx % 2 === 0 ? 38 : 62;
  });
}

function applyTheme(theme) {
  state.settings.theme = theme || 'auto';
  StorageService.save('glucoscan_settings_v3', state.settings);
  const isDark = theme === 'dark' || (theme === 'auto' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
  if (isDark) {
    document.documentElement.classList.add('dark');
  } else {
    document.documentElement.classList.remove('dark');
  }
  const themeIcon = document.getElementById('iconThemeBtn');
  if (themeIcon) {
    themeIcon.setAttribute('data-lucide', isDark ? 'sun' : 'moon');
    if (window.lucide) window.lucide.createIcons();
  }
}

function syncQuickPinEditor() {
  const editor = document.getElementById('pinQuickEditor');
  if (!editor) return;

  if (state.selectedPinIndex === null || !state.items[state.selectedPinIndex]) {
    state.selectedPinIndex = null;
    editor.classList.add('hidden');
    return;
  }

  const item = state.items[state.selectedPinIndex];
  const food = MetabolicEngine.resolveFoodEntry(item);
  if (!food) {
    editor.classList.add('hidden');
    return;
  }

  editor.classList.remove('hidden');
  const nameInp = document.getElementById('inpQuickPinName');
  const gramsInp = document.getElementById('inpQuickPinGrams');
  if (nameInp && document.activeElement !== nameInp) {
    nameInp.value = food.name.split('(')[0].trim();
  }
  if (gramsInp && document.activeElement !== gramsInp) {
    gramsInp.value = String(item.grams || 100);
  }

  const warnEl = document.getElementById('pinPortionWarning');
  const warnText = document.getElementById('pinPortionWarningText');
  if (warnEl && warnText) {
    const isBread = food.category === 'pains' || (food.name || '').toLowerCase().includes('pain') || (food.name || '').toLowerCase().includes('khobz');
    if (item.portionWarning) {
      warnText.textContent = item.portionWarning;
      warnEl.classList.remove('hidden');
    } else if (isBread && (item.grams || 100) > 180) {
      warnText.textContent = `Portion élevée (${item.grams}g). Un quart de pain individuel pèse environ 65g.`;
      warnEl.classList.remove('hidden');
    } else {
      warnEl.classList.add('hidden');
    }
  }
}

function updateUI() {
  if (state.selectedPinIndex !== null && !state.items[state.selectedPinIndex]) {
    state.selectedPinIndex = null;
  }
  syncQuickPinEditor();
  const evaluation = MetabolicEngine.evaluatePlate(
    state.items,
    state.settings,
    state.activeSlot
  );
  UIRenderer.renderDashboard(state, evaluation);
  const todayTotals = getTodayTotals(state.history);
  UIRenderer.renderDailySynthesis(todayTotals, state.settings);
}

/**
 * Traite une photo (File, Blob ou DataURL) :
 * - Affiche l'image originale en Haute Définition (100% nette) à l'écran
 * - Envoie une version 800px nette à l'IA Vision (~1.2s à 2.1s)
 */
async function handleImageSource(source) {
  stopWebRTC();
  const currentScanSeq = ++state.scanSeq;
  state.currentPlateImage = null;

  const img = document.getElementById('plateImage');
  const empty = document.getElementById('emptyCameraState');
  const clearBtn = document.getElementById('btnClearPhoto');
  const overlay = document.getElementById('scanningOverlay');

  overlay.classList.remove('hidden');
  empty.classList.add('hidden');
  clearBtn.classList.remove('hidden');
  state.selectedPinIndex = null;

  // Affichage immédiat en Haute Définition sans aucune dégradation visuelle
  if (state.displayObjectUrl) {
    URL.revokeObjectURL(state.displayObjectUrl);
    state.displayObjectUrl = null;
  }
  if (source instanceof Blob) {
    state.displayObjectUrl = URL.createObjectURL(source);
    img.src = state.displayObjectUrl;
    img.classList.remove('hidden');
  } else if (typeof source === 'string') {
    img.src = source;
    img.classList.remove('hidden');
  }

  // Filet de sécurité : proxy (28s) + jusqu'à 3 modèles directs (3 × 25s) ≈ 103s
  const watchdog = setTimeout(() => {
    if (currentScanSeq === state.scanSeq) {
      overlay.classList.add('hidden');
    }
  }, 110000);

  try {
    // Image nette calibrée (700px, qualité 0.78) : upload 10x plus rapide et résolution optimale
    const compressedDataUrl = await VisionAnalyzer.compressImageSource(source, 700, 0.78);
    if (currentScanSeq !== state.scanSeq) return;

    // Vignette allégée (180px, qualité 0.6) pour un stockage ultra-léger dans le journal sans saturer le localStorage
    VisionAnalyzer.compressImageSource(source, 180, 0.6)
      .then(thumb => {
        if (currentScanSeq === state.scanSeq) state.currentPlateImage = thumb;
      })
      .catch(() => {
        if (currentScanSeq === state.scanSeq) state.currentPlateImage = null;
      });

    const res = await VisionAnalyzer.detectWithGemini(
      compressedDataUrl,
      state.settings.geminiKey || ''
    );

    if (currentScanSeq !== state.scanSeq) return;
    clearTimeout(watchdog);
    overlay.classList.add('hidden');

    const items = Array.isArray(res) ? res : (res?.items || []);
    const isSuccess = Array.isArray(res) ? (items.length > 0) : Boolean(res?.success);

    if (isSuccess && items.length > 0) {
      spreadPinsAutomatically(items, false);
      state.items = items;
      StorageService.save('glucoscan_items_v3', state.items);
      updateUI();
      showToast(`${items.length} aliment(s) reconnu(s) ! Glissez les étiquettes pour ajuster.`);
      return;
    }

    // Aucun aliment ou analyse échouée : mettre à jour l'UI et proposer l'ajout manuel
    updateUI();
    if (isSuccess && items.length === 0) {
      showToast('Aucun aliment détecté sur cette photo.', {
        label: '+ Ajouter',
        onClick: () => openFoodCatalogModal(null)
      });
      return;
    }

    // Gestion d'erreur explicite et conviviale (jamais de messages techniques bruts)
    const rawErr = String(res?.error || '');
    if (res?.code === 'TIMEOUT' || rawErr.toLowerCase().includes('aborted') || rawErr.toLowerCase().includes('délai') || rawErr.toLowerCase().includes('timeout')) {
      showToast('⏱️ Délai réseau dépassé. Ajoutez vos aliments :', {
        label: '+ Ajouter',
        onClick: () => openFoodCatalogModal(null)
      });
    } else if (res?.code === 'UNAUTHORIZED') {
      showToast('⚠️ Clé API invalide ou expirée. Vérifiez vos Paramètres IA (Synthèse).');
    } else if (res?.code === 'RATE_LIMIT') {
      showToast('⏳ Quota IA temporairement dépassé. Réessayez dans un instant.');
    } else {
      showToast(`⚠️ Analyse impossible : ${rawErr || 'Erreur réseau'}.`, {
        label: '+ Ajouter',
        onClick: () => openFoodCatalogModal(null)
      });
    }
  } catch (err) {
    if (currentScanSeq !== state.scanSeq) return;
    clearTimeout(watchdog);
    overlay.classList.add('hidden');
    console.error('Vision analysis error:', err);
    updateUI();
    showToast('Erreur réseau lors de l’analyse photo', {
      label: '+ Ajouter',
      onClick: () => openFoodCatalogModal(null)
    });
  }
}

function loadPresetPlate(key, replacePhotoWithSVG = false) {
  const plate = FoodRepository.getPlateByKey(key);
  if (!plate) return;

  if (replacePhotoWithSVG) {
    const illu = VisionAnalyzer.createDemoPlateIllustration(plate.title);
    state.currentPlateImage = illu;
    const img = document.getElementById('plateImage');
    img.src = illu;
    img.classList.remove('hidden');
    document.getElementById('emptyCameraState').classList.add('hidden');
    document.getElementById('btnClearPhoto').classList.remove('hidden');
  }

  state.selectedPinIndex = null;
  state.items = plate.items.map(i => ({ ...i }));
  spreadPinsAutomatically(state.items, false);
  StorageService.save('glucoscan_items_v3', state.items);
  updateUI();
  showToast('Aliments détectés & grammages calculés');
}

async function startWebRTC() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    document.getElementById('fileCameraInput').click();
    return;
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' } },
      audio: false
    });
    state.mediaStream = stream;
    const video = document.getElementById('cameraVideo');
    video.srcObject = stream;
    video.classList.remove('hidden');
    video.play().catch(() => {});
    document.getElementById('plateImage').classList.add('hidden');
    document.getElementById('emptyCameraState').classList.add('hidden');
    document.getElementById('primaryCaptureActions').classList.add('hidden');
    document.getElementById('liveStreamActions').classList.remove('hidden');
  } catch {
    document.getElementById('fileCameraInput').click();
  }
}

function stopWebRTC() {
  if (state.mediaStream) {
    state.mediaStream.getTracks().forEach(t => t.stop());
    state.mediaStream = null;
  }
  document.getElementById('cameraVideo').classList.add('hidden');
  document.getElementById('liveStreamActions').classList.add('hidden');
  document.getElementById('primaryCaptureActions').classList.remove('hidden');
}

function updateDailyCarbCalculator() {
  const weightEl = document.getElementById('guideInputWeight');
  const profileEl = document.getElementById('guideSelectProfile');
  if (!weightEl || !profileEl) return;

  const weight = Math.min(180, Math.max(35, parseFloat(weightEl.value) || 85));
  const profile = profileEl.value;

  // Protocole 85 kg (18-6) : ~1920-2000 kcal, 150g Prot, 150g Gluc, 80g Lip
  let carbsPerKg = 1.76;
  let protPerKg = 1.76;
  let fatPerKg = 0.94;
  if (profile === 'hypertrophy') {
    carbsPerKg = 2.4;
    protPerKg = 2.0;
    fatPerKg = 1.0;
  } else if (profile === 'cutting') {
    carbsPerKg = 1.4;
    protPerKg = 2.0;
    fatPerKg = 0.8;
  }

  const dailyCarbs = Math.round((weight * carbsPerKg) / 5) * 5;
  const dailyProt = Math.round((weight * protPerKg) / 5) * 5;
  const dailyFat = Math.round((weight * fatPerKg) / 5) * 5;
  const dailyCal = Math.round(dailyProt * 4 + dailyCarbs * 4 + dailyFat * 9);

  // Répartition 18/6 : 40% Repas 1 (10h), 60% Repas 2 (15h)
  const morningCarbs = Math.round(dailyCarbs * 0.40);
  const noonCarbs = Math.round(dailyCarbs * 0.60);
  const morningProt = Math.round(dailyProt * 0.40);
  const noonProt = Math.round(dailyProt * 0.60);
  const morningFat = Math.round(dailyFat * 0.40);
  const noonFat = Math.round(dailyFat * 0.60);
  const morningCal = Math.round(dailyCal * 0.40);
  const noonCal = Math.round(dailyCal * 0.60);

  const outDaily = document.getElementById('guideOutDailyCarbs');
  if (outDaily) outDaily.textContent = `~${dailyCal} kcal • ${dailyProt}g P • ${dailyCarbs}g G • ${dailyFat}g L`;

  const outMorning = document.getElementById('guideOutMorning');
  if (outMorning) outMorning.textContent = `~${morningCal} kcal (${morningProt}g P • ${morningCarbs}g G • ${morningFat}g L)`;

  const outNoon = document.getElementById('guideOutNoon');
  if (outNoon) outNoon.textContent = `~${noonCal} kcal (${noonProt}g P • ${noonCarbs}g G • ${noonFat}g L)`;

  const outEvening = document.getElementById('guideOutEvening');
  if (outEvening) outEvening.textContent = `Jeûne 18h`;
}

/**
 * Met à jour l'horloge métabolique 18/6 (10h00 - 16h00 alimentation, 16h00 - 10h00 jeûne)
 * ainsi que le calcul en direct des glucides et protéines des 2 repas (10h et 15h).
 */
function updateFasting186View() {
  const now = new Date();
  const h = now.getHours();
  const m = now.getMinutes();
  const timeStr = `${String(h).padStart(2, '0')}h${String(m).padStart(2, '0')}`;

  const timeEl = document.getElementById('fastingCurrentTime');
  if (timeEl) timeEl.textContent = timeStr;

  const totalMinutesNow = h * 60 + m;
  const startEatMin = 10 * 60; // 10h00
  const endEatMin = 16 * 60;   // 16h00

  const cardEl = document.getElementById('fastingStatusCard');
  const badgeEl = document.getElementById('fastingPhaseBadge');
  const countEl = document.getElementById('fastingCountdown');
  const titleEl = document.getElementById('fastingPhaseTitle');
  const descEl = document.getElementById('fastingPhaseDesc');
  const barEl = document.getElementById('fastingProgressBar');

  let activePhaseIndex = 0;
  let phaseData = null;

  if (cardEl && badgeEl && countEl && titleEl && descEl && barEl) {
    if (totalMinutesNow >= startEatMin && totalMinutesNow < endEatMin) {
      // Dans la fenêtre d'alimentation 6h (10h00 -> 16h00)
      const elapsedEat = totalMinutesNow - startEatMin;
      const remainEat = endEatMin - totalMinutesNow;
      const remH = Math.floor(remainEat / 60);
      const remM = remainEat % 60;
      const pct = Math.min(100, Math.max(5, Math.round((elapsedEat / 360) * 100)));

      activePhaseIndex = 0;
      phaseData = {
        phaseIndex: 0,
        name: 'Fenêtre Repas (6h)',
        shortName: 'Fenêtre 6h Active',
        sub: 'avant fermeture (16h)',
        tip: h < 13 ? '🍳 Créneau 10h Ftour' : '🍗 Créneau 15h Déjeuner',
        color: '#059669'
      };

      cardEl.className = 'bg-emerald-50 border border-emerald-300 rounded-2xl p-3.5 mb-2.5 transition-all shadow-xs';
      badgeEl.className = 'text-[10px] font-extrabold uppercase tracking-wider px-2 py-0.5 rounded-full bg-emerald-600 text-white';
      badgeEl.textContent = 'Fenêtre Repas Active (6h)';
      countEl.className = 'text-xs font-extrabold text-emerald-900 tabular-nums';
      countEl.textContent = `Reste ${remH}h${String(remM).padStart(2, '0')} avant jeûne`;
      titleEl.className = 'text-xs font-extrabold text-emerald-950';
      titleEl.textContent = h < 13
        ? 'Créneau Repas n°1 (10h00) : 2 Œufs + Pain Céréales + Jben & Huile d’Olive'
        : 'Créneau Repas n°2 (15h00) : Protéine au choix + Morceau de Khobz';
      descEl.className = 'text-[11px] text-emerald-800 mt-0.5 leading-relaxed';
      descEl.textContent = 'Fenêtre nutritionnelle ouverte de 10h00 à 16h00. Fermeture métabolique à 16h00.';
      barEl.className = 'h-full bg-emerald-500 rounded-full transition-all duration-500';
      barEl.style.width = `${pct}%`;
      UIRenderer.renderCircularFastingClock(elapsedEat, remainEat, true, phaseData);
    } else {
      // Dans la fenêtre de jeûne 18h (16h00 -> 10h00 le lendemain)
      const elapsedFast = totalMinutesNow >= endEatMin
        ? (totalMinutesNow - endEatMin)
        : (24 * 60 - endEatMin + totalMinutesNow);
      const remainFast = Math.max(0, 18 * 60 - elapsedFast);
      const remH = Math.floor(remainFast / 60);
      const remM = remainFast % 60;
      const elapsedH = Math.floor(elapsedFast / 60);
      const pct = Math.min(100, Math.max(5, Math.round((elapsedFast / (18 * 60)) * 100)));

      if (elapsedH < 4) {
        activePhaseIndex = 1;
        phaseData = {
          phaseIndex: 1,
          name: 'Phase 1 : Digestion (0-4h)',
          shortName: '0-4h • Digestion',
          sub: 'Post-Prandiale',
          tip: '⚡ Carburant : Glucose',
          color: '#f59e0b' // Ambre
        };
        cardEl.className = 'bg-amber-50/80 border border-amber-300 rounded-2xl p-3.5 mb-2.5 transition-all shadow-xs';
        badgeEl.className = 'text-[10px] font-extrabold uppercase tracking-wider px-2 py-0.5 rounded-full bg-amber-500 text-white';
        badgeEl.textContent = `Phase 1 : Digestion (${elapsedH}h / 18h)`;
        countEl.className = 'text-xs font-extrabold text-amber-900 tabular-nums';
        titleEl.textContent = 'Phase 1 : Digestion & Assimilation Musculaire (0-4h de jeûne)';
        descEl.textContent = 'L’organisme digère et absorbe les nutriments du dernier repas. Synthèse protéique active.';
        barEl.className = 'h-full bg-amber-500 rounded-full transition-all duration-500';
      } else if (elapsedH < 8) {
        activePhaseIndex = 2;
        phaseData = {
          phaseIndex: 2,
          name: 'Phase 2 : Glycogène (4-8h)',
          shortName: '4-8h • Déstockage Foie',
          sub: 'Post-Absorptive',
          tip: '⚡ Déstockage Foie',
          color: '#3b82f6' // Bleu
        };
        cardEl.className = 'bg-blue-50/80 border border-blue-300 rounded-2xl p-3.5 mb-2.5 transition-all shadow-xs';
        badgeEl.className = 'text-[10px] font-extrabold uppercase tracking-wider px-2 py-0.5 rounded-full bg-blue-600 text-white';
        badgeEl.textContent = `Phase 2 : Déstockage Foie (${elapsedH}h / 18h)`;
        countEl.className = 'text-xs font-extrabold text-blue-900 tabular-nums';
        titleEl.textContent = 'Phase 2 : Déstockage Hépatique & Transition Énergétique (4-8h)';
        descEl.textContent = 'Digestion terminée. Transition énergétique. Le foie mobilise le glycogène pour stabiliser l’énergie.';
        barEl.className = 'h-full bg-blue-600 rounded-full transition-all duration-500';
      } else if (elapsedH < 12) {
        activePhaseIndex = 3;
        phaseData = {
          phaseIndex: 3,
          name: 'Phase 3 : Bascule (8-12h)',
          shortName: '8-12h • Brûlage Graisses',
          sub: 'Lipolyse Active',
          tip: '🔥 Déstockage Lipides',
          color: '#0d9488' // Teal
        };
        cardEl.className = 'bg-teal-50/80 border border-teal-300 rounded-2xl p-3.5 mb-2.5 transition-all shadow-xs';
        badgeEl.className = 'text-[10px] font-extrabold uppercase tracking-wider px-2 py-0.5 rounded-full bg-teal-600 text-white';
        badgeEl.textContent = `Phase 3 : Bascule Métabolique (${elapsedH}h / 18h)`;
        countEl.className = 'text-xs font-extrabold text-teal-900 tabular-nums';
        titleEl.textContent = 'Phase 3 : Bascule Métabolique & Lipolyse (8-12h)';
        descEl.textContent = 'Glycogène hépatique réduit. Le corps active le déstockage des acides gras pour préserver le muscle.';
        barEl.className = 'h-full bg-teal-600 rounded-full transition-all duration-500';
      } else if (elapsedH < 16) {
        activePhaseIndex = 4;
        phaseData = {
          phaseIndex: 4,
          name: 'Phase 4 : Autophagie (12-16h)',
          shortName: '12-16h • Autophagie',
          sub: 'Cétose & Nettoyage',
          tip: '🧠 Cétones cérébrales',
          color: '#7c3aed' // Violet
        };
        cardEl.className = 'bg-purple-50/80 border border-purple-300 rounded-2xl p-3.5 mb-2.5 transition-all shadow-xs';
        badgeEl.className = 'text-[10px] font-extrabold uppercase tracking-wider px-2 py-0.5 rounded-full bg-purple-600 text-white';
        badgeEl.textContent = `Phase 4 : Cétose & Nettoyage (${elapsedH}h / 18h)`;
        countEl.className = 'text-xs font-extrabold text-purple-900 tabular-nums';
        titleEl.textContent = 'Phase 4 : Cétose Douce & Récupération Cellulaire (12-16h)';
        descEl.textContent = 'Corps cétoniques pour le cerveau. Autophagie amorcée pour le recyclage cellulaire.';
        barEl.className = 'h-full bg-purple-600 rounded-full transition-all duration-500';
      } else {
        activePhaseIndex = 5;
        phaseData = {
          phaseIndex: 5,
          name: 'Phase 5 : Zone d\'Or (16-18h)',
          shortName: '16-18h • Zone d\'Or',
          sub: 'Pic d\'Autophagie',
          tip: '✨ Récepteurs Rénovés',
          color: '#10b981' // Vert Émeraude Vif
        };
        cardEl.className = 'bg-emerald-50 border-2 border-emerald-500 rounded-2xl p-3.5 mb-2.5 transition-all shadow-md';
        badgeEl.className = 'text-[10px] font-extrabold uppercase tracking-wider px-2 py-0.5 rounded-full bg-emerald-600 text-white animate-pulse';
        badgeEl.textContent = `Phase 5 : Zone d’Or Finale (${elapsedH}h / 18h)`;
        countEl.className = 'text-xs font-extrabold text-emerald-900 tabular-nums';
        titleEl.textContent = 'Phase 5 : Zone d’Or Finale & Récepteurs Musculaires (16-18h)';
        descEl.textContent = 'Sensibilité maximale à l’absorption des nutriments. Muscles réceptifs pour le repas de rupture (10h00).';
        barEl.className = 'h-full bg-emerald-500 rounded-full transition-all duration-500';
      }

      countEl.textContent = `Prochain repas (10h) dans ${remH}h${String(remM).padStart(2, '0')}`;
      barEl.style.width = `${pct}%`;
      UIRenderer.renderCircularFastingClock(elapsedFast, remainFast, false, phaseData);
    }

    // Mise en surbrillance dynamique de la carte correspondante dans la Timeline des 5 phases
    for (let i = 1; i <= 5; i++) {
      const card = document.getElementById('fastingPhaseCard' + i);
      const badge = document.getElementById('fastingActiveBadge' + i);
      if (card && badge) {
        if (i === activePhaseIndex) {
          card.classList.add('border-2', 'border-emerald-500', 'bg-white', 'shadow-md', 'scale-[1.01]');
          card.classList.remove('bg-slate-50', 'border-slate-200');
          badge.classList.remove('hidden');
        } else {
          card.classList.remove('border-2', 'border-emerald-500', 'bg-white', 'shadow-md', 'scale-[1.01]');
          card.classList.add('bg-slate-50', 'border-slate-200');
          badge.classList.add('hidden');
        }
      }
    }
  }

  // Calcul dynamique du Repas n°2 (15h00) et du Bilan Total Journalier (Objectif 85 kg / 18-6)
  const protSel = document.getElementById('fastingSelectProtein15h');
  const breadSel = document.getElementById('fastingSelectBread15h');
  const breadGramsInp = document.getElementById('fastingInputBreadGrams');
  if (!protSel || !breadSel || !breadGramsInp) return;

  const protKey = protSel.value;
  const breadId = breadSel.value;
  const breadGrams = Math.min(350, Math.max(0, parseFloat(breadGramsInp.value) || 210));

  // Calcul via le moteur métabolique (calibré pour l'objectif 85 kg / 18-6)
  const PROTEIN_SOURCES = {
    poulet: { foodId: 'poulet-grille', grams: 300 },
    sardine: { foodId: 'sardines-grillees', grams: 320 },
    kefta: { foodId: 'kefta-grillee', grams: 320 }
  };
  const protSource = PROTEIN_SOURCES[protKey] || PROTEIN_SOURCES.poulet;
  const oilGrams = protKey === 'sardine' ? 10 : (protKey === 'kefta' ? 5 : 25);
  const meal15hItems = [
    protSource,
    { foodId: 'salade-marocaine', grams: 180 },
    { foodId: 'huile-olive-pure', grams: oilGrams },
    { foodId: FoodRepository.getFoodById(breadId) ? breadId : 'khobz-complet', grams: breadGrams }
  ];
  const meal15h = MetabolicEngine.evaluatePlate(meal15hItems);
  const meal10hPlate = FoodRepository.getPlateByKey('jeune_10h');
  const meal10h = MetabolicEngine.evaluatePlate(meal10hPlate ? meal10hPlate.items : []);

  const totalDayCarbs = Math.round((meal10h.netCarbs + meal15h.netCarbs) * 10) / 10;
  const totalDayProtein = Math.round(meal10h.totalProtein + meal15h.totalProtein);
  const totalDayFat = Math.round((meal10h.totalFat + meal15h.totalFat) * 10) / 10;
  const totalDayCalories = Math.round(meal10h.totalCalories + meal15h.totalCalories);

  const out10hMacros = document.getElementById('fastingOut10hMacros');
  if (out10hMacros) {
    out10hMacros.textContent = `~${meal10h.totalCalories} kcal • ${Math.round(meal10h.totalProtein)}g P • ${Math.round(meal10h.netCarbs)}g G • ${Math.round(meal10h.totalFat)}g L`;
  }

  const out15hMacros = document.getElementById('fastingOut15hMacros');
  if (out15hMacros) {
    out15hMacros.textContent = `~${meal15h.totalCalories} kcal • ${Math.round(meal15h.totalProtein)}g P • ${Math.round(meal15h.netCarbs)}g G • ${Math.round(meal15h.totalFat)}g L`;
  }

  const out15h = document.getElementById('fastingOut15hCarbs');
  if (out15h) out15h.textContent = `${meal15h.netCarbs.toFixed(1)}g nets (${meal15h.totalFat}g lip)`;

  const outTotalCal = document.getElementById('fastingTotalDayCalories');
  if (outTotalCal) outTotalCal.textContent = `~${totalDayCalories} kcal`;

  const outTotalCarbs = document.getElementById('fastingTotalDayCarbs');
  if (outTotalCarbs) outTotalCarbs.textContent = `${totalDayCarbs.toFixed(1)}g nets`;

  const outTotalProt = document.getElementById('fastingTotalDayProtein');
  if (outTotalProt) outTotalProt.textContent = `~${totalDayProtein}g`;

  const outTotalFat = document.getElementById('fastingTotalDayFat');
  if (outTotalFat) outTotalFat.textContent = `~${totalDayFat}g lipides`;
}

// Ouverture / Fermeture du Catalogue d'Ajout ou de Correction (Remplacement)
// Déclarées au niveau du module : elles sont aussi appelées depuis handleImageSource (toasts d'erreur).
function syncCatalogModalHeader() {
  const banner = document.getElementById('catalogReplaceBanner');
  const lblName = document.getElementById('lblReplacingFoodName');
  const titleEl = document.getElementById('modalCatalogTitle');
  const submitCustomBtn = document.getElementById('btnSubmitCustomFood');

  const isReplacing = state.replaceItemIndex !== null && state.items[state.replaceItemIndex];
  if (isReplacing) {
    const targetFood = MetabolicEngine.resolveFoodEntry(state.items[state.replaceItemIndex]);
    const targetName = targetFood ? targetFood.name.split('(')[0].trim() : 'cet aliment';
    if (banner) {
      banner.classList.remove('hidden');
      banner.classList.add('flex');
    }
    if (lblName) lblName.textContent = targetName;
    if (titleEl) titleEl.textContent = `🔄 Remplacer « ${targetName} »`;
    if (submitCustomBtn) submitCustomBtn.textContent = 'Valider & Remplacer';
    const customGramsInp = document.getElementById('inpCustomFoodGrams');
    if (customGramsInp) customGramsInp.value = String(state.items[state.replaceItemIndex].grams || 100);
  } else {
    if (banner) {
      banner.classList.add('hidden');
      banner.classList.remove('flex');
    }
    if (titleEl) titleEl.textContent = 'Ajouter un aliment à l’assiette';
    if (submitCustomBtn) submitCustomBtn.textContent = 'Valider & Ajouter';
  }
}

function openFoodCatalogModal(replaceIdx = null, coords = null) {
  state.replaceItemIndex = (typeof replaceIdx === 'number' && state.items[replaceIdx]) ? replaceIdx : null;
  if (coords && typeof coords.x === 'number' && typeof coords.y === 'number') {
    state.pendingPinCoords = coords;
  } else if (state.replaceItemIndex === null) {
    state.pendingPinCoords = null;
  }
  syncCatalogModalHeader();
  UIRenderer.renderCatalogModal(state.catalogFilter, state.catalogCategory, state.replaceItemIndex);
  const modal = document.getElementById('modalFoodCatalog');
  if (!modal) return;
  modal.classList.remove('hidden');
  modal.classList.add('flex');
  if (window.lucide) window.lucide.createIcons();
}

function closeFoodCatalogModal() {
  state.replaceItemIndex = null;
  state.pendingPinCoords = null;
  const modal = document.getElementById('modalFoodCatalog');
  if (!modal) return;
  modal.classList.add('hidden');
  modal.classList.remove('flex');
}

function switchToTab(target) {
  ['scanner', 'fasting', 'history', 'guide', 'settings'].forEach(v => {
    const el = document.getElementById(`view-${v}`);
    if (el) el.classList.toggle('hidden', v !== target);
  });
  document.querySelectorAll('.nav-tab').forEach(b => {
    const active = b.getAttribute('data-view') === target;
    b.classList.toggle('text-emerald-600', active);
    b.classList.toggle('text-slate-400', !active);
  });
  if (target === 'fasting') {
    updateFasting186View();
    if (window.lucide) window.lucide.createIcons();
  }
  if (target === 'history') {
    UIRenderer.renderHistoryView(state.history, state.settings);
  }
  if (target === 'guide') {
    updateDailyCarbCalculator();
    if (window.lucide) window.lucide.createIcons();
  }
  if (target === 'settings') {
    const pInp = document.getElementById('inpDailyTargetProtein');
    if (pInp) pInp.value = state.settings.dailyTargetProtein || 150;
    const cInp = document.getElementById('inpDailyTargetCarbs');
    if (cInp) cInp.value = state.settings.dailyTargetCarbs || 150;
    const fInp = document.getElementById('inpDailyTargetFat');
    if (fInp) fInp.value = state.settings.dailyTargetFat || 80;
    const calInp = document.getElementById('inpDailyTargetCalories');
    if (calInp) calInp.value = state.settings.dailyTargetCalories || 1950;
    const wInp = document.getElementById('inpUserWeight');
    if (wInp) wInp.value = state.settings.userWeight || 85;

    const todayTotals = getTodayTotals(state.history);
    UIRenderer.renderDailySynthesis(todayTotals, state.settings);

    document.getElementById('inpGeminiKey').value = state.settings.geminiKey || '';
    if (window.lucide) window.lucide.createIcons();
  }
}

function bindEvents() {
  // Navigation entre les 5 onglets (Scanner, Mon 18/6, Journal 7j, Guide, Synthèse/Paramètres)
  document.querySelectorAll('.nav-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      switchToTab(btn.getAttribute('data-view'));
    });
  });

  document.querySelectorAll('[data-switch-to-settings]').forEach(el => {
    el.addEventListener('click', () => switchToTab('settings'));
  });

  // Bascule Mode Sombre / Mode Clair
  document.getElementById('btnToggleTheme')?.addEventListener('click', () => {
    const isDark = document.documentElement.classList.contains('dark');
    applyTheme(isDark ? 'light' : 'dark');
    showToast(isDark ? '☀️ Thème clair activé' : '🌙 Thème sombre activé');
  });

  // Rapport Médical (PDF / Impression)
  document.getElementById('btnExportMedicalReport')?.addEventListener('click', () => {
    UIRenderer.exportMedicalReport(state.history, state.settings);
  });

  // Export Tableur CSV (Excel / DMP Médecin)
  document.getElementById('btnExportHistoryCSV')?.addEventListener('click', () => {
    UIRenderer.exportHistoryCSV(state.history);
  });

  // Suppression d'un repas de l'historique (Journal & Profil) avec persistance Tombstone
  const deleteMealFromHistory = (targetId) => {
    if (!targetId) return;
    try {
      if (navigator.vibrate) navigator.vibrate([15, 30, 15]);
    } catch (_) {}
    ProfileService.recordDeletedMeal(targetId);
    const countBefore = state.history.length;
    state.history = state.history.filter(h => String(h.id || h.timestamp) !== String(targetId));

    if (state.history.length < countBefore) {
      StorageService.save('glucoscan_history_v3', state.history);
      ProfileService.saveProfileData(state.settings, state.history);
      UIRenderer.renderHistoryView(state.history, state.settings);
      renderProfileCalendar();
      renderProfileDateMeals();
      updateUI();
      showToast('🗑️ Repas supprimé');
    }
  };

  // Suppression d'un repas du Journal 7j
  document.getElementById('historyLogsContainer')?.addEventListener('click', (e) => {
    const btn = e.target.closest('.btn-delete-history-item');
    if (!btn) return;
    deleteMealFromHistory(btn.getAttribute('data-id'));
  });

  // Suppression d'un repas depuis le calendrier / profil
  document.getElementById('containerProfileDateMeals')?.addEventListener('click', (e) => {
    const btn = e.target.closest('.btn-delete-profile-meal');
    if (!btn) return;
    deleteMealFromHistory(btn.getAttribute('data-id'));
  });

  // Rendu du calendrier interactif dans le profil utilisateur
  const renderProfileCalendar = () => {
    const grid = document.getElementById('gridCalendarDays');
    const monthYearLabel = document.getElementById('lblCalMonthYear');
    if (!grid || !monthYearLabel) return;

    const year = state.viewCalendarYear;
    const month = state.viewCalendarMonth;

    // Libellé mois et année (ex: "Octobre 2026")
    const monthDate = new Date(year, month, 1);
    const monthName = monthDate.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
    monthYearLabel.textContent = monthName.charAt(0).toUpperCase() + monthName.slice(1);

    // Décalage pour le premier jour du mois (Lundi = 0, Dimanche = 6)
    const firstDay = new Date(year, month, 1);
    const startDayOffset = (firstDay.getDay() + 6) % 7;
    const totalDaysInMonth = new Date(year, month + 1, 0).getDate();

    // Dictionnaire des repas par jour (format local YYYY-MM-DD)
    const mealsByDate = new Map();
    for (const h of state.history) {
      if (!h.timestamp) continue;
      const dateStr = getLocalDateString(h.timestamp);
      mealsByDate.set(dateStr, (mealsByDate.get(dateStr) || 0) + 1);
    }

    const todayStr = getLocalDateString();

    let html = '';
    // Cases vides avant le 1er du mois
    for (let i = 0; i < startDayOffset; i++) {
      html += `<div class="h-8"></div>`;
    }

    // Jours du mois courant
    for (let day = 1; day <= totalDaysInMonth; day++) {
      const dayStr = String(day).padStart(2, '0');
      const monthStr = String(month + 1).padStart(2, '0');
      const dateKey = `${year}-${monthStr}-${dayStr}`;

      const mealCount = mealsByDate.get(dateKey) || 0;
      const isSelected = (dateKey === state.selectedCalendarDate);
      const isToday = (dateKey === todayStr);

      let btnClasses = 'relative h-8 rounded-xl font-bold text-xs flex flex-col items-center justify-center transition-all ';
      if (isSelected) {
        btnClasses += 'bg-emerald-600 text-white shadow-xs font-black ring-2 ring-emerald-300';
      } else if (isToday) {
        btnClasses += 'bg-emerald-50 text-emerald-900 border border-emerald-300 font-extrabold';
      } else {
        btnClasses += 'hover:bg-slate-100 text-slate-700';
      }

      const dotHtml = mealCount > 0
        ? `<span class="w-1.5 h-1.5 rounded-full ${isSelected ? 'bg-white' : 'bg-emerald-500'} absolute bottom-1"></span>`
        : '';

      html += `
        <button type="button" class="btn-cal-day ${btnClasses}" data-date="${dateKey}" title="${day} ${monthDate.toLocaleDateString('fr-FR', { month: 'short' })} : ${mealCount} repas">
          <span class="${mealCount > 0 ? '-mt-1' : ''}">${day}</span>
          ${dotHtml}
        </button>
      `;
    }

    grid.innerHTML = html;
  };

  // Rendu de la liste des repas pour la date sélectionnée dans le profil
  const renderProfileDateMeals = () => {
    const container = document.getElementById('containerProfileDateMeals');
    const header = document.getElementById('lblProfileSelectedDateHeader');
    const countLabel = document.getElementById('lblProfileSelectedDateCount');
    if (!container) return;

    const selectedDate = state.selectedCalendarDate || getLocalDateString();
    const [y, m, d] = selectedDate.split('-');
    const dateObj = new Date(Number(y), Number(m) - 1, Number(d));
    const isToday = selectedDate === getLocalDateString();

    const formattedDate = isToday
      ? `Aujourd'hui (${dateObj.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })})`
      : dateObj.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' });

    if (header) {
      header.innerHTML = `
        <i data-lucide="utensils" class="w-3.5 h-3.5 text-emerald-600"></i>
        <span class="capitalize">Repas du ${formattedDate}</span>
      `;
    }

    // Filtrer les repas de la date choisie (format local)
    const meals = state.history.filter(h => getLocalDateString(h.timestamp) === selectedDate);

    if (countLabel) {
      countLabel.textContent = `${meals.length} repas`;
    }

    if (meals.length === 0) {
      container.innerHTML = `
        <div class="bg-white rounded-2xl p-4 text-center border border-slate-200/80 text-xs text-slate-400 space-y-1">
          <p class="font-bold text-slate-500">Aucun repas enregistré pour ce jour</p>
          <p class="text-[10px] text-slate-400">Prenez une photo de votre assiette pour l'enregistrer ici.</p>
        </div>
      `;
      if (window.lucide) window.lucide.createIcons();
      return;
    }

    container.innerHTML = meals.map(h => {
      const timeStr = new Date(h.timestamp).toLocaleTimeString('fr-FR', {
        hour: '2-digit',
        minute: '2-digit'
      });
      const names = (h.items || []).map(i => `${escapeHTML(i.name)} (${i.grams}g)`).join(', ');
      const itemId = escapeHTML(h.id || h.timestamp);
      const proteinVal = h.totalProtein ? Math.round(Number(h.totalProtein) * 10) / 10 : 0;
      const giVal = Number(h.avgGI);
      let giColorClass = 'bg-slate-100 text-slate-700 border-slate-200';
      if (giVal > 0) {
        if (giVal <= 55) giColorClass = 'bg-emerald-50 text-emerald-800 border-emerald-200';
        else if (giVal <= 69) giColorClass = 'bg-amber-50 text-amber-800 border-amber-200';
        else giColorClass = 'bg-rose-50 text-rose-800 border-rose-200';
      }

      const giBadge = giVal > 0
        ? `<span class="text-[9.5px] font-extrabold px-1.5 py-0.5 rounded-md border ${giColorClass}">IG ${Math.round(giVal)}</span>`
        : '';

      const glBadge = h.totalGL
        ? `<span class="text-[9.5px] font-bold text-slate-600 bg-slate-100 px-1.5 py-0.5 rounded-md border border-slate-200">CG ${h.totalGL}</span>`
        : '';

      const validImg = safeImageUrl(h.imageUrl);
      const imageThumb = validImg
        ? `<img src="${validImg}" alt="Repas" class="w-13 h-13 object-cover rounded-xl border border-slate-200 shadow-2xs shrink-0">`
        : `<div class="w-13 h-13 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-700 flex items-center justify-center shrink-0 text-lg font-bold">🍽️</div>`;

      const fatVal = h.totalFat ? Math.round(Number(h.totalFat) * 10) / 10 : 0;
      const calVal = h.totalCalories ? Math.round(Number(h.totalCalories)) : Math.round(proteinVal * 4 + Number(h.netCarbs || 0) * 4 + fatVal * 9);

      return `
        <div class="surface-card rounded-2xl p-3 border border-slate-200/80 shadow-2xs space-y-2 hover:border-emerald-300 transition-all">
          <div class="flex items-start gap-2.5">
            ${imageThumb}
            <div class="flex-1 min-w-0">
              <div class="flex items-center justify-between gap-1 mb-0.5">
                <span class="text-xs font-black text-slate-900">${timeStr}</span>
                <div class="flex items-center gap-1">
                  ${giBadge}
                  ${glBadge}
                  <button type="button" class="btn-delete-profile-meal p-1 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 active:scale-90 transition-all flex items-center justify-center" data-id="${itemId}" title="Supprimer ce repas">
                    <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
                  </button>
                </div>
              </div>
              <p class="text-[11px] text-slate-600 leading-snug line-clamp-2">${names}</p>
            </div>
          </div>
          <div class="flex flex-wrap items-center justify-between gap-1 pt-1.5 border-t border-slate-100 text-[10px] font-mono font-bold text-slate-700">
            <div class="flex items-center gap-1.5">
              <span class="text-emerald-800 bg-emerald-50 px-1.5 py-0.5 rounded-md border border-emerald-200 font-extrabold">🥩 ${proteinVal}g prot</span>
              <span class="text-cyan-800 bg-cyan-50 px-1.5 py-0.5 rounded-md border border-cyan-200">🌾 ${h.netCarbs}g nets</span>
              <span class="text-amber-800 bg-amber-50 px-1.5 py-0.5 rounded-md border border-amber-200">🥑 ${fatVal}g lip</span>
              <span class="text-slate-700 bg-slate-100 px-1.5 py-0.5 rounded-md">🔥 ${calVal} kcal</span>
            </div>
            <span class="text-slate-400">⚖️ ${Number(h.totalGrams) || 0}g</span>
          </div>
        </div>
      `;
    }).join('');

    if (window.lucide) window.lucide.createIcons();
  };

  // Événements navigation calendrier du profil
  document.getElementById('btnCalPrevMonth')?.addEventListener('click', () => {
    if (state.viewCalendarMonth === 0) {
      state.viewCalendarMonth = 11;
      state.viewCalendarYear--;
    } else {
      state.viewCalendarMonth--;
    }
    renderProfileCalendar();
  });

  document.getElementById('btnCalNextMonth')?.addEventListener('click', () => {
    if (state.viewCalendarMonth === 11) {
      state.viewCalendarMonth = 0;
      state.viewCalendarYear++;
    } else {
      state.viewCalendarMonth++;
    }
    renderProfileCalendar();
  });

  document.getElementById('btnCalToday')?.addEventListener('click', () => {
    const today = new Date();
    state.viewCalendarYear = today.getFullYear();
    state.viewCalendarMonth = today.getMonth();
    state.selectedCalendarDate = getLocalDateString(today);
    renderProfileCalendar();
    renderProfileDateMeals();
  });

  document.getElementById('gridCalendarDays')?.addEventListener('click', (e) => {
    const btn = e.target.closest('.btn-cal-day');
    if (!btn) return;
    const date = btn.getAttribute('data-date');
    if (date) {
      state.selectedCalendarDate = date;
      renderProfileCalendar();
      renderProfileDateMeals();
    }
  });

  // Notifications Locales PWA pour le Jeûne 18/6
  document.getElementById('btnToggleFastingNotifications')?.addEventListener('click', async () => {
    if (!('Notification' in window)) {
      showToast('Notifications non supportées par ce navigateur');
      return;
    }
    const perm = await Notification.requestPermission();
    if (perm === 'granted') {
      showToast('🔔 Rappels 10h (repas) et 15h45 (fin de fenêtre) activés !');
      try {
        const appIconSvg = "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><rect width='100' height='100' rx='24' fill='%2310b981'/><circle cx='50' cy='50' r='28' fill='none' stroke='%23ffffff' stroke-width='8'/><circle cx='50' cy='50' r='12' fill='%23ffffff'/></svg>";
        new Notification('GlucoScan Maroc — Mon 18/6', {
          body: 'Rappels actifs pour votre protocole 10h & 15h.',
          icon: appIconSvg
        });
      } catch (_) {}
    } else {
      showToast('Autorisation de notification refusée');
    }
  });

  // Gestion du Profil Utilisateur (Modèle Workout Home - Pseudo & Mot de passe sans email)
  const updateAuthUI = () => {
    const isLogged = ProfileService.isLoggedIn();
    const activeProfile = ProfileService.getActiveProfile();
    const badge = document.getElementById('lblAuthStatusBadge');

    const panelActive = document.getElementById('panelProfileActive');
    const panelAuth = document.getElementById('panelProfileAuth');

    if (isLogged && activeProfile) {
      if (badge) badge.textContent = activeProfile.username;
      panelActive?.classList.remove('hidden');
      panelAuth?.classList.add('hidden');

      const avatar = document.getElementById('activeProfileAvatar');
      const name = document.getElementById('activeProfileName');
      const modeBadge = document.getElementById('activeProfileModeBadge');
      const countLabel = document.getElementById('activeProfileMealsCount');

      if (avatar) avatar.textContent = (activeProfile.username[0] || 'U').toUpperCase();
      if (name) name.textContent = activeProfile.username;
      if (modeBadge) {
        modeBadge.textContent = '⚡ Nutrition Sportive & Jeûne 18/6';
      }
      if (countLabel) {
        countLabel.textContent = `${state.history.length} repas dans votre journal`;
      }

      renderProfileCalendar();
      renderProfileDateMeals();
    } else {
      if (badge) badge.textContent = 'Invité';
      panelActive?.classList.add('hidden');
      panelAuth?.classList.remove('hidden');
    }
  };

  updateAuthUI();

  document.getElementById('btnOpenAuthModal')?.addEventListener('click', () => {
    updateAuthUI();
    document.getElementById('modalSupabaseAuth')?.classList.remove('hidden');
    document.getElementById('modalSupabaseAuth')?.classList.add('flex');
    if (window.lucide) window.lucide.createIcons();

    // Synchronisation automatique des données Cloud lors de l'ouverture du profil
    if (ProfileService.isLoggedIn()) {
      performGlobalSync({ silent: true });
    }
  });

  document.getElementById('btnCloseAuthModal')?.addEventListener('click', () => {
    document.getElementById('modalSupabaseAuth')?.classList.add('hidden');
    document.getElementById('modalSupabaseAuth')?.classList.remove('flex');
  });

  // Basculement onglets : Se connecter vs Nouveau profil
  const tabProfileLogin = document.getElementById('tabProfileLogin');
  const tabProfileRegister = document.getElementById('tabProfileRegister');
  const formProfileLogin = document.getElementById('formProfileLogin');
  const formProfileRegister = document.getElementById('formProfileRegister');

  tabProfileLogin?.addEventListener('click', () => {
    tabProfileLogin.classList.add('bg-white', 'text-slate-900', 'shadow-2xs');
    tabProfileLogin.classList.remove('text-slate-500');
    tabProfileRegister.classList.remove('bg-white', 'text-slate-900', 'shadow-2xs');
    tabProfileRegister.classList.add('text-slate-500');
    formProfileLogin?.classList.remove('hidden');
    formProfileRegister?.classList.add('hidden');
  });

  tabProfileRegister?.addEventListener('click', () => {
    tabProfileRegister.classList.add('bg-white', 'text-slate-900', 'shadow-2xs');
    tabProfileRegister.classList.remove('text-slate-500');
    tabProfileLogin.classList.remove('bg-white', 'text-slate-900', 'shadow-2xs');
    tabProfileLogin.classList.add('text-slate-500');
    formProfileRegister?.classList.remove('hidden');
    formProfileLogin?.classList.add('hidden');
  });

  // Connexion au profil existant avec synchronisation Cloud prioritaire (Mobile ⇄ PC)
  formProfileLogin?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = document.getElementById('inpLoginUsername').value.trim();
    const password = document.getElementById('inpLoginPassword').value;
    if (!username || !password) return;

    const btnSubmit = formProfileLogin.querySelector('button[type="submit"]');
    const originalBtnText = btnSubmit ? btnSubmit.innerHTML : '';
    if (btnSubmit) {
      btnSubmit.disabled = true;
      btnSubmit.innerHTML = `<i data-lucide="loader" class="w-4 h-4 animate-spin inline-block"></i> Connexion &amp; Synchronisation...`;
    }

    try {
      const profile = await ProfileService.login(username, password);
      // Charger réglages et historique fusionnés du cloud (en conservant les repas saisis en mode invité)
      if (profile.settings) {
        state.settings = { ...state.settings, ...profile.settings };
      }
      const guestHistory = Array.isArray(state.history) ? state.history : [];
      state.history = ProfileService.mergeHistories(
        Array.isArray(profile.history) ? profile.history : [],
        guestHistory
      );
      if (guestHistory.length > 0) {
        ProfileService.saveProfileData(state.settings, state.history);
      }
      StorageService.save('glucoscan_settings_v3', state.settings);
      StorageService.save('glucoscan_history_v3', state.history);

      updateAuthUI();
      updateUI();
      UIRenderer.renderHistoryView(state.history, state.settings);
      renderProfileCalendar();
      renderProfileDateMeals();
      document.getElementById('modalSupabaseAuth')?.classList.add('hidden');
      document.getElementById('modalSupabaseAuth')?.classList.remove('flex');
      showToast(`👋 Bonjour ${profile.username} ! (${state.history.length} repas synchronisés)`);
    } catch (err) {
      showToast(err.message || 'Erreur lors de la connexion');
    } finally {
      if (btnSubmit) {
        btnSubmit.disabled = false;
        btnSubmit.innerHTML = originalBtnText;
        if (window.lucide) window.lucide.createIcons();
      }
    }
  });

  // Création d'un nouveau profil (sans email)
  formProfileRegister?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = document.getElementById('inpRegUsername').value.trim();
    const password = document.getElementById('inpRegPassword').value;

    if (!username || !password) return;

    try {
      const profile = await ProfileService.register(username, password, 'sport', state.settings, state.history);
      StorageService.save('glucoscan_settings_v3', state.settings);

      updateAuthUI();
      updateUI();
      document.getElementById('modalSupabaseAuth')?.classList.add('hidden');
      document.getElementById('modalSupabaseAuth')?.classList.remove('flex');
      showToast(`🎉 Profil créé avec succès ! Bienvenue ${profile.username}.`);
    } catch (err) {
      showToast(err.message || 'Erreur lors de la création du profil');
    }
  });

  /**
   * Synchronisation globale bidirectionnelle avec Supabase (PC ⇄ Mobile)
   * Gère les conflits, le re-rendu de toutes les vues, et le retour d'état visuel.
   */
  async function performGlobalSync({ silent = true, forceToast = false } = {}) {
    if (!ProfileService.isLoggedIn()) return;

    const quickIcon = document.getElementById('iconQuickSync');
    const profileSyncBtn = document.getElementById('btnSyncProfileData');

    if (quickIcon) quickIcon.classList.add('animate-spin');
    if (!silent && profileSyncBtn) {
      profileSyncBtn.disabled = true;
      profileSyncBtn.innerHTML = `<i data-lucide="loader" class="w-4 h-4 animate-spin inline-block"></i> Synchronisation en cours...`;
    }

    try {
      const prevIds = state.history.map(h => String(h.id || h.timestamp)).join(',');
      const prevSettingsJson = JSON.stringify(state.settings || {});
      const res = await ProfileService.syncToCloud(state.settings, state.history);

      if (res && res.success) {
        let changed = false;
        if (Array.isArray(res.history)) {
          const newIds = res.history.map(h => String(h.id || h.timestamp)).join(',');
          if (newIds !== prevIds) changed = true;
          state.history = res.history;
          StorageService.save('glucoscan_history_v3', state.history);
        }
        if (res.settings) {
          const newSettingsJson = JSON.stringify(res.settings || {});
          if (newSettingsJson !== prevSettingsJson) changed = true;
          state.settings = { ...state.settings, ...res.settings };
          StorageService.save('glucoscan_settings_v3', state.settings);
        }

        updateAuthUI();
        updateUI();
        UIRenderer.renderHistoryView(state.history, state.settings);
        renderProfileCalendar();
        renderProfileDateMeals();

        if (forceToast || (!silent && changed)) {
          showToast(`☁️ Synchronisation PC ⇄ Mobile réussie (${state.history.length} repas à jour)`);
        } else if (!silent) {
          showToast(`☁️ Vos données sont déjà parfaitement synchronisées`);
        } else if (changed) {
          showToast(`☁️ Repas synchronisés depuis votre autre appareil`);
        }
      } else if (!silent) {
        showToast(res?.error ? `Info synchro : ${res.error}` : 'Erreur de synchronisation Cloud');
      }
    } catch (e) {
      if (!silent) showToast('Connexion Cloud momentanément indisponible');
    } finally {
      if (quickIcon) quickIcon.classList.remove('animate-spin');
      if (profileSyncBtn) {
        profileSyncBtn.disabled = false;
        profileSyncBtn.innerHTML = `<i data-lucide="refresh-cw" class="w-4 h-4"></i> Synchroniser mes repas (Mobile ⇄ PC)`;
        if (window.lucide) window.lucide.createIcons();
      }
    }
  }

  // Bouton de synchronisation rapide dans la barre supérieure
  document.getElementById('btnQuickSyncCloud')?.addEventListener('click', () => {
    if (!ProfileService.isLoggedIn()) {
      showToast('Connectez-vous à votre profil pour synchroniser PC et Mobile');
      document.getElementById('modalSupabaseAuth')?.classList.remove('hidden');
      document.getElementById('modalSupabaseAuth')?.classList.add('flex');
      if (window.lucide) window.lucide.createIcons();
      return;
    }
    performGlobalSync({ silent: false, forceToast: true });
  });

  // Sauvegarde / Synchronisation Cloud manuelle bidirectionnelle (Mobile ⇄ PC)
  document.getElementById('btnSyncProfileData')?.addEventListener('click', () => {
    performGlobalSync({ silent: false, forceToast: true });
  });

  // Auto-synchronisation intelligente lors du retour sur l'onglet ou mise au premier plan (Mobile & PC)
  let lastVisibilitySync = 0;
  const triggerAutoSyncIfVisible = () => {
    if (document.visibilityState === 'visible' && ProfileService.isLoggedIn()) {
      const now = Date.now();
      if (now - lastVisibilitySync > 5000) {
        lastVisibilitySync = now;
        performGlobalSync({ silent: true });
      }
    }
  };

  document.addEventListener('visibilitychange', triggerAutoSyncIfVisible);
  window.addEventListener('focus', triggerAutoSyncIfVisible);
  window.addEventListener('pageshow', triggerAutoSyncIfVisible);

  // Auto-synchronisation lors de la reconnexion à Internet (Offline -> Online)
  window.addEventListener('online', () => {
    if (ProfileService.isLoggedIn()) {
      showToast('🌐 Connexion rétablie : synchronisation Cloud...');
      performGlobalSync({ silent: true, forceToast: true });
    }
  });

  // Battement de cœur périodique (toutes les 60 secondes si l'écran est actif)
  setInterval(() => {
    if (document.visibilityState === 'visible' && navigator.onLine && ProfileService.isLoggedIn()) {
      performGlobalSync({ silent: true });
    }
  }, 60000);

  // Écoute des synchronisations inter-onglets et Cloud instantanées
  ProfileService.onSyncUpdate((data) => {
    if (data && Array.isArray(data.history)) {
      state.history = data.history;
      StorageService.save('glucoscan_history_v3', state.history);
    }
    if (data && data.settings) {
      state.settings = { ...state.settings, ...data.settings };
      StorageService.save('glucoscan_settings_v3', state.settings);
    }
    updateAuthUI();
    updateUI();
    UIRenderer.renderHistoryView(state.history, state.settings);
    renderProfileCalendar();
    renderProfileDateMeals();
  });

  // Déconnexion / Changer de profil
  document.getElementById('btnLogoutProfile')?.addEventListener('click', () => {
    ProfileService.logout();
    state.history = [];
    state.items = [];
    state.settings = { ...DEFAULT_SETTINGS, geminiKey: state.settings.geminiKey || '' };
    state.currentPlateImage = null;
    state.selectedPinIndex = null;
    StorageService.save('glucoscan_history_v3', []);
    StorageService.save('glucoscan_items_v3', []);
    StorageService.save('glucoscan_settings_v3', state.settings);
    updateAuthUI();
    updateUI();
    UIRenderer.renderHistoryView(state.history, state.settings);
    renderProfileCalendar();
    renderProfileDateMeals();
    showToast('Déconnecté. Vous êtes maintenant en mode invité.');
  });

  // Événements de l'onglet Mon 18/6 (Jeûne Intermittent 10h & 15h)
  document.getElementById('fastingSelectProtein15h')?.addEventListener('change', updateFasting186View);
  document.getElementById('fastingSelectBread15h')?.addEventListener('change', updateFasting186View);
  document.getElementById('fastingInputBreadGrams')?.addEventListener('input', updateFasting186View);

  document.getElementById('btnLoadMeal10h')?.addEventListener('click', () => {
    state.activeSlot = 'morning';
    loadPresetPlate('jeune_10h', true);
    switchToTab('scanner');
    showToast('Repas 1 (10h00) Rupture avec 4 œufs (~60g P • ~60g G • ~47g L) chargé !');
  });

  document.getElementById('btnLoadMeal15h')?.addEventListener('click', () => {
    state.activeSlot = 'noon';
    const protKey = document.getElementById('fastingSelectProtein15h')?.value || 'poulet';
    const breadId = document.getElementById('fastingSelectBread15h')?.value || 'khobz-complet';
    const breadGrams = Math.min(350, Math.max(5, parseInt(document.getElementById('fastingInputBreadGrams')?.value, 10) || 210));

    let protFoodId = 'poulet-grille';
    let protGrams = 300;
    let oilGrams = 25;
    let titleLabel = 'Repas 2 (15h00) Clôture [60%] : Poulet + Khobz + Huile d’Olive';
    if (protKey === 'sardine') {
      protFoodId = 'sardines-grillees';
      protGrams = 320;
      oilGrams = 10;
      titleLabel = 'Repas 2 (15h00) Clôture [60%] : Sardines Grillées + Khobz';
    } else if (protKey === 'kefta') {
      protFoodId = 'kefta-grillee';
      protGrams = 320;
      oilGrams = 5;
      titleLabel = 'Repas 2 (15h00) Clôture [60%] : Kefta Grillée + Khobz';
    }

    const illu = VisionAnalyzer.createDemoPlateIllustration(titleLabel);
    state.currentPlateImage = illu;
    const img = document.getElementById('plateImage');
    img.src = illu;
    img.classList.remove('hidden');
    document.getElementById('emptyCameraState').classList.add('hidden');
    document.getElementById('btnClearPhoto').classList.remove('hidden');

    state.items = [
      { foodId: protFoodId, grams: protGrams, x: 42, y: 46 },
      { foodId: 'salade-marocaine', grams: 180, x: 72, y: 40 },
      { foodId: 'huile-olive-pure', grams: oilGrams, x: 50, y: 80 },
      { foodId: breadId, grams: breadGrams, x: 25, y: 74 }
    ];
    StorageService.save('glucoscan_items_v3', state.items);
    updateUI();
    switchToTab('scanner');
    showToast(`${titleLabel} chargé (~1150 kcal • 90g P • 90g G • 48g L) !`);
  });

  // Simulateur de besoin journalier en glucides dans l'onglet Guide
  document.getElementById('guideInputWeight')?.addEventListener('input', updateDailyCarbCalculator);
  document.getElementById('guideSelectProfile')?.addEventListener('change', updateDailyCarbCalculator);

  // Sélection Matin / Midi / Soir
  document.querySelectorAll('.slot-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      state.activeSlot = btn.getAttribute('data-slot');
      updateUI();
    });
  });

  // Clic direct sur le viseur vide pour lancer la caméra
  document.getElementById('emptyCameraState')?.addEventListener('click', () => {
    document.getElementById('fileCameraInput')?.click();
  });

  const handleFileInput = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    ImageCropper.open(
      file,
      (processedSource) => handleImageSource(processedSource)
    );
    e.target.value = '';
  };

  document.getElementById('fileCameraInput')?.addEventListener('change', handleFileInput);
  document.getElementById('fileGalleryInput')?.addEventListener('change', handleFileInput);

  // Viseur WebRTC en direct
  document.getElementById('btnStartWebRTC')?.addEventListener('click', startWebRTC);
  document.getElementById('btnCloseStream')?.addEventListener('click', stopWebRTC);
  document.getElementById('btnCaptureFrame')?.addEventListener('click', () => {
    const video = document.getElementById('cameraVideo');
    const canvas = document.getElementById('analysisCanvas');
    if (!video || !canvas) return;
    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;
    canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
    const frameDataUrl = canvas.toDataURL('image/jpeg', 0.85);
    stopWebRTC();
    ImageCropper.open(
      frameDataUrl,
      (processedSource) => handleImageSource(processedSource)
    );
  });

  // Réinitialiser la photo
  document.getElementById('btnClearPhoto')?.addEventListener('click', () => {
    stopWebRTC();
    state.currentPlateImage = null;
    document.getElementById('plateImage')?.classList.add('hidden');
    document.getElementById('emptyCameraState')?.classList.remove('hidden');
    document.getElementById('btnClearPhoto')?.classList.add('hidden');
    state.items = [];
    StorageService.save('glucoscan_items_v3', []);
    updateUI();
  });

  // Clic direct sur la photo pour ajouter un aliment à cet endroit précis
  const viewportBox = document.getElementById('viewportBox');
  viewportBox?.addEventListener('click', (e) => {
    // Ne pas déclencher si on clique sur un bouton de contrôle ou une étiquette existante
    if (e.target.closest('button')) return;
    if (e.target.closest('[data-pin-index]')) return;
    const img = document.getElementById('plateImage');
    if (!img || img.classList.contains('hidden')) return;

    const rect = viewportBox.getBoundingClientRect();
    if (!rect.width || !rect.height) return;

    const x = Math.min(85, Math.max(15, Math.round(((e.clientX - rect.left) / rect.width) * 100)));
    const y = Math.min(85, Math.max(15, Math.round(((e.clientY - rect.top) / rect.height) * 100)));

    openFoodCatalogModal(null, { x, y });
    showToast(`📍 Touchez un aliment pour le placer à cet endroit (${x}%, ${y}%)`);
  });

  // Scénarios de démonstration rapides
  document.querySelectorAll('.demo-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      loadPresetPlate(btn.getAttribute('data-demo'), true);
    });
  });

  // Boutons Réorganiser et Masquer/Afficher les étiquettes
  document.getElementById('btnAutoArrangePins')?.addEventListener('click', () => {
    spreadPinsAutomatically(state.items, true);
    StorageService.save('glucoscan_items_v3', state.items);
    updateUI();
    showToast('↕️ Étiquettes réorganisées pour une lecture claire');
  });

  document.getElementById('btnTogglePins')?.addEventListener('click', () => {
    state.pinsVisible = state.pinsVisible === false ? true : false;
    updateUI();
  });

  // Déplacement au doigt / souris (Drag & Drop) et sélection des étiquettes sur la photo
  const pinsLayer = document.getElementById('pinsLayer');
  let activeDrag = null;

  pinsLayer?.addEventListener('pointerdown', (e) => {
    // Si clic sur le bouton supprimer (×) d'une étiquette
    const rmPin = e.target.closest('[data-remove-pin]');
    if (rmPin) {
      e.stopPropagation();
      const idx = parseInt(rmPin.getAttribute('data-remove-pin'), 10);
      if (state.items[idx]) {
        const removedFood = MetabolicEngine.resolveFoodEntry(state.items[idx]);
        state.items.splice(idx, 1);
        if (state.selectedPinIndex === idx) {
          state.selectedPinIndex = null;
        } else if (state.selectedPinIndex > idx) {
          state.selectedPinIndex--;
        }
        StorageService.save('glucoscan_items_v3', state.items);
        updateUI();
        showToast(`🗑️ ${removedFood ? removedFood.name.split('(')[0].trim() : 'Aliment'} supprimé`);
      }
      return;
    }

    // Si clic sur le bouton éditer (✎) d'une étiquette
    const editPin = e.target.closest('[data-edit-pin]');
    if (editPin) {
      e.stopPropagation();
      const idx = parseInt(editPin.getAttribute('data-edit-pin'), 10);
      state.selectedPinIndex = idx;
      updateUI();
      setTimeout(() => document.getElementById('inpQuickPinName')?.focus(), 50);
      return;
    }

    const pinEl = e.target.closest('[data-pin-index]');
    if (!pinEl) return;

    const idx = parseInt(pinEl.getAttribute('data-pin-index'), 10);
    if (!state.items[idx]) return;

    const rect = pinsLayer.getBoundingClientRect();
    activeDrag = {
      idx,
      pinEl,
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      origX: Number(state.items[idx].x) || 50,
      origY: Number(state.items[idx].y) || 50,
      rectWidth: rect.width || 320,
      rectHeight: rect.height || 240,
      moved: false
    };

    try {
      pinEl.setPointerCapture(e.pointerId);
    } catch {}
    pinEl.classList.add('z-40', 'scale-105', 'ring-2', 'ring-emerald-500');
  });

  pinsLayer?.addEventListener('pointermove', (e) => {
    if (!activeDrag || e.pointerId !== activeDrag.pointerId) return;
    const dx = e.clientX - activeDrag.startX;
    const dy = e.clientY - activeDrag.startY;
    if (!activeDrag.moved && Math.hypot(dx, dy) < 4) return;

    activeDrag.moved = true;
    const newX = Math.min(86, Math.max(14, activeDrag.origX + (dx / activeDrag.rectWidth) * 100));
    const newY = Math.min(85, Math.max(15, activeDrag.origY + (dy / activeDrag.rectHeight) * 100));

    activeDrag.pinEl.style.left = `${newX.toFixed(1)}%`;
    activeDrag.pinEl.style.top = `${newY.toFixed(1)}%`;
    if (state.items[activeDrag.idx]) {
      state.items[activeDrag.idx].x = Math.round(newX);
      state.items[activeDrag.idx].y = Math.round(newY);
    }
  });

  const endPinDrag = (e) => {
    if (!activeDrag || (e.pointerId !== undefined && e.pointerId !== activeDrag.pointerId)) return;
    const { idx, moved, pinEl } = activeDrag;
    try {
      pinEl.releasePointerCapture(activeDrag.pointerId);
    } catch {}
    activeDrag = null;

    state.selectedPinIndex = idx;
    StorageService.save('glucoscan_items_v3', state.items);
    updateUI();
    if (!moved) {
      // Un simple toucher sur l'étiquette ouvre l'éditeur rapide sous la photo
      showToast('✏️ Étiquette sélectionnée : modifiez son nom ou son poids ci-dessous');
    }
  };

  pinsLayer?.addEventListener('pointerup', endPinDrag);
  pinsLayer?.addEventListener('pointercancel', endPinDrag);

  // Contrôles de l'Éditeur Rapide d'Étiquette (#pinQuickEditor sous la photo)
  document.getElementById('btnCloseQuickPinEditor')?.addEventListener('click', () => {
    state.selectedPinIndex = null;
    updateUI();
  });

  document.getElementById('inpQuickPinName')?.addEventListener('input', (e) => {
    const idx = state.selectedPinIndex;
    if (idx === null || !state.items[idx]) return;
    const val = e.target.value.trim();
    if (val) {
      state.items[idx].customName = val;
      StorageService.save('glucoscan_items_v3', state.items);
      updateUI();
    }
  });

  document.getElementById('inpQuickPinGrams')?.addEventListener('input', (e) => {
    const idx = state.selectedPinIndex;
    if (idx === null || !state.items[idx]) return;
    state.items[idx].grams = Math.min(1500, Math.max(5, parseInt(e.target.value, 10) || 5));
    StorageService.save('glucoscan_items_v3', state.items);
    updateUI();
  });

  document.getElementById('btnQuickPinMinus10')?.addEventListener('click', () => {
    const idx = state.selectedPinIndex;
    if (idx === null || !state.items[idx]) return;
    state.items[idx].grams = Math.max(5, (state.items[idx].grams || 50) - 10);
    StorageService.save('glucoscan_items_v3', state.items);
    updateUI();
  });

  document.getElementById('btnQuickPinPlus10')?.addEventListener('click', () => {
    const idx = state.selectedPinIndex;
    if (idx === null || !state.items[idx]) return;
    state.items[idx].grams = Math.min(1500, (state.items[idx].grams || 50) + 10);
    StorageService.save('glucoscan_items_v3', state.items);
    updateUI();
  });

  // Raccourcis de portion marocaine calibrée (1/4 pain 65g, 1/2 pain 130g, msemen 85g, etc.)
  document.querySelectorAll('.quick-gram-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const g = parseInt(btn.getAttribute('data-set-grams'), 10);
      const idx = state.selectedPinIndex;
      if (idx !== null && state.items[idx] && g > 0) {
        state.items[idx].grams = g;
        StorageService.save('glucoscan_items_v3', state.items);
        updateUI();
        showToast(`Portion ajustée à ${g}g`);
      }
    });
  });

  document.getElementById('btnQuickPinReplace')?.addEventListener('click', () => {
    if (state.selectedPinIndex !== null && state.items[state.selectedPinIndex]) {
      openFoodCatalogModal(state.selectedPinIndex);
    }
  });

  document.getElementById('btnQuickPinDelete')?.addEventListener('click', () => {
    const idx = state.selectedPinIndex;
    if (idx === null || !state.items[idx]) return;
    const removedFood = MetabolicEngine.resolveFoodEntry(state.items[idx]);
    state.items.splice(idx, 1);
    state.selectedPinIndex = null;
    StorageService.save('glucoscan_items_v3', state.items);
    updateUI();
    showToast(`🗑️ ${removedFood ? removedFood.name.split('(')[0].trim() : 'Aliment'} supprimé`);
  });

  // Tout vider dans la liste des aliments reconnus
  document.getElementById('btnClearAllRecognized')?.addEventListener('click', () => {
    state.items = [];
    state.selectedPinIndex = null;
    StorageService.save('glucoscan_items_v3', []);
    updateUI();
    showToast('Liste des aliments vidée');
  });

  // Ajustement des grammages (-20g, -5g, +5g, +20g), Remplacement et Suppression
  document.getElementById('recognizedItemsContainer')?.addEventListener('click', (e) => {
    const openAddBtn = e.target.closest('[data-open-add-food]');
    if (openAddBtn) {
      openFoodCatalogModal(null);
      return;
    }

    const replaceBtn = e.target.closest('[data-replace]');
    if (replaceBtn) {
      const idx = parseInt(replaceBtn.getAttribute('data-replace'), 10);
      openFoodCatalogModal(idx);
      return;
    }

    const deltaBtn = e.target.closest('[data-delta]');
    if (deltaBtn) {
      try { if (navigator.vibrate) navigator.vibrate(10); } catch (_) {}
      const idx = parseInt(deltaBtn.getAttribute('data-index'), 10);
      const delta = parseInt(deltaBtn.getAttribute('data-delta'), 10);
      if (state.items[idx]) {
        state.items[idx].grams = Math.min(1500, Math.max(5, (Number(state.items[idx].grams) || 0) + delta));
        StorageService.save('glucoscan_items_v3', state.items);
        updateUI();
      }
      return;
    }

    const rmBtn = e.target.closest('[data-remove]');
    if (rmBtn) {
      const idx = parseInt(rmBtn.getAttribute('data-remove'), 10);
      if (state.items[idx]) {
        const removedFood = MetabolicEngine.resolveFoodEntry(state.items[idx]);
        state.items.splice(idx, 1);
        if (state.selectedPinIndex === idx) {
          state.selectedPinIndex = null;
        } else if (state.selectedPinIndex > idx) {
          state.selectedPinIndex--;
        }
        StorageService.save('glucoscan_items_v3', state.items);
        updateUI();
        showToast(`🗑️ ${removedFood ? removedFood.name.split('(')[0].trim() : 'Aliment'} supprimé`);
      }
    }
  });

  document.getElementById('recognizedItemsContainer')?.addEventListener('input', (e) => {
    const nameInp = e.target.closest('[data-direct-name]');
    if (nameInp) {
      const idx = parseInt(nameInp.getAttribute('data-direct-name'), 10);
      if (state.items[idx] && nameInp.value.trim()) {
        state.items[idx].customName = nameInp.value.trim();
        StorageService.save('glucoscan_items_v3', state.items);
        UIRenderer.renderPins(state.items, state.selectedPinIndex);
        syncQuickPinEditor();
      }
      return;
    }

    const inp = e.target.closest('[data-direct-grams]');
    if (!inp) return;
    const idx = parseInt(inp.getAttribute('data-direct-grams'), 10);
    if (state.items[idx]) {
      state.items[idx].grams = Math.min(1500, Math.max(5, parseInt(inp.value, 10) || 5));
      StorageService.save('glucoscan_items_v3', state.items);
      updateUI();
    }
  });

  function applyFoodChoice(newEntry, shortName) {
    if (state.replaceItemIndex !== null && state.items[state.replaceItemIndex]) {
      const oldItem = state.items[state.replaceItemIndex];
      state.items[state.replaceItemIndex] = {
        ...newEntry,
        x: oldItem.x || newEntry.x,
        y: oldItem.y || newEntry.y
      };
      state.replaceItemIndex = null;
      StorageService.save('glucoscan_items_v3', state.items);
      updateUI();
      closeFoodCatalogModal();
      showToast(`🔄 Corrigé par : ${shortName}`);
    } else {
      if (state.pendingPinCoords) {
        newEntry.x = state.pendingPinCoords.x;
        newEntry.y = state.pendingPinCoords.y;
        state.pendingPinCoords = null;
      }
      state.items.push(newEntry);
      StorageService.save('glucoscan_items_v3', state.items);
      updateUI();
      closeFoodCatalogModal();
      showToast(`✅ ${shortName} ajouté à l'assiette`);
    }
  }

  document.getElementById('btnOpenCatalogModal')?.addEventListener('click', () => {
    openFoodCatalogModal(null);
  });

  document.getElementById('btnCloseCatalog')?.addEventListener('click', closeFoodCatalogModal);

  // Fermeture du catalogue en cliquant sur le fond semi-transparent
  document.getElementById('modalFoodCatalog')?.addEventListener('click', (e) => {
    if (e.target.id === 'modalFoodCatalog') {
      closeFoodCatalogModal();
    }
  });

  // Fermeture du modal profil/auth en cliquant sur le fond semi-transparent
  document.getElementById('modalSupabaseAuth')?.addEventListener('click', (e) => {
    if (e.target.id === 'modalSupabaseAuth') {
      document.getElementById('modalSupabaseAuth').classList.add('hidden');
      document.getElementById('modalSupabaseAuth').classList.remove('flex');
    }
  });

  document.getElementById('btnCancelReplaceMode')?.addEventListener('click', () => {
    state.replaceItemIndex = null;
    syncCatalogModalHeader();
    UIRenderer.renderCatalogModal(state.catalogFilter, state.catalogCategory, null);
  });

  document.getElementById('inpCatalogSearch')?.addEventListener('input', (e) => {
    state.catalogFilter = e.target.value;
    UIRenderer.renderCatalogModal(state.catalogFilter, state.catalogCategory, state.replaceItemIndex);
  });

  // Filtres de catégories dans la fenêtre d'ajout/correction
  document.querySelectorAll('.cat-filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      state.catalogCategory = btn.getAttribute('data-cat-filter') || 'all';
      document.querySelectorAll('.cat-filter-btn').forEach(b => {
        const active = b.getAttribute('data-cat-filter') === state.catalogCategory;
        b.className = active
          ? 'cat-filter-btn px-2.5 py-1 rounded-full bg-slate-900 text-white text-[10px] font-extrabold whitespace-nowrap'
          : 'cat-filter-btn px-2.5 py-1 rounded-full bg-slate-100 text-slate-600 text-[10px] font-bold whitespace-nowrap';
      });
      UIRenderer.renderCatalogModal(state.catalogFilter, state.catalogCategory, state.replaceItemIndex);
    });
  });

  // Boutons préréglés pour la saisie manuelle libre d'un aliment
  document.querySelectorAll('.custom-preset-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const carbs = btn.getAttribute('data-preset-carbs') || '15';
      const protein = btn.getAttribute('data-preset-protein') || '5';
      const gi = parseInt(btn.getAttribute('data-preset-gi') || '50', 10);
      const inp = document.getElementById('inpCustomFoodCarbs100');
      const inpProt = document.getElementById('inpCustomFoodProtein100');
      if (inp) inp.value = carbs;
      if (inpProt) inpProt.value = protein;
      state.customPresetGI = gi;
      document.querySelectorAll('.custom-preset-btn').forEach(b => {
        b.classList.toggle('border-emerald-600', b === btn);
        b.classList.toggle('bg-emerald-50', b === btn);
      });
    });
  });

  // Validation d'un aliment saisi manuellement (libre)
  document.getElementById('btnSubmitCustomFood')?.addEventListener('click', () => {
    const nameInp = document.getElementById('inpCustomFoodName');
    const gramsInp = document.getElementById('inpCustomFoodGrams');
    const carbsInp = document.getElementById('inpCustomFoodCarbs100');
    const protInp = document.getElementById('inpCustomFoodProtein100');

    const rawName = (nameInp?.value || '').trim() || 'Aliment personnalisé';
    const grams = Math.min(1500, Math.max(5, parseInt(gramsInp?.value || '100', 10) || 100));
    const carbs100g = Math.min(100, Math.max(0, parseFloat(carbsInp?.value || '0') || 0));
    const protein100g = Math.min(100, Math.max(0, parseFloat(protInp?.value || '0') || 0));

    const customEntry = {
      foodId: 'custom_' + Date.now(),
      customName: rawName,
      grams,
      carbs100g,
      protein100g,
      fiber100g: 0,
      gi: carbs100g === 0 ? 0 : (state.customPresetGI || 50),
      refPortion: `Saisie manuelle (${carbs100g}g glu • ${protein100g}g prot)`,
      x: 30 + Math.round(Math.random() * 40),
      y: 30 + Math.round(Math.random() * 40)
    };

    if (nameInp) nameInp.value = '';
    applyFoodChoice(customEntry, rawName);
  });

  document.getElementById('catalogItemsList')?.addEventListener('click', (e) => {
    const pick = e.target.closest('[data-pick-food]');
    if (!pick) return;
    const food = FoodRepository.getFoodById(pick.getAttribute('data-pick-food'));
    if (!food) return;
    applyFoodChoice({
      foodId: food.id,
      grams: food.defaultGrams,
      x: 28 + Math.round(Math.random() * 44),
      y: 28 + Math.round(Math.random() * 44)
    }, food.name.split('(')[0].trim());
  });

  // Enregistrement dans le journal & Partage WhatsApp
  function logCurrentPlate(successMessage = 'Repas enregistré') {
    if (state.items.length === 0) {
      showToast('Assiette vide : ajoutez d’abord des aliments');
      return false;
    }
    const ev = MetabolicEngine.evaluatePlate(
      state.items,
      state.settings,
      state.activeSlot
    );
    const newLog = {
      id: 'log_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
      timestamp: new Date().toISOString(),
      mealSlot: state.activeSlot || 'noon',
      verdictTag: ev.verdict.tag,
      totalGrams: ev.totalGrams,
      netCarbs: ev.netCarbs,
      totalProtein: ev.totalProtein,
      totalFiber: ev.totalFiber || 0,
      proteinIndexLabel: ev.proteinIndex.label,
      avgGI: ev.avgGI || 50,
      totalGL: ev.totalGL || 0,
      imageUrl: state.currentPlateImage || null,
      items: state.items.map(i => {
        const f = MetabolicEngine.resolveFoodEntry(i);
        return { name: f ? f.name.split('(')[0].trim() : (i.customName || i.foodId), grams: Number(i.grams) || 100 };
      })
    };
    state.history.unshift(newLog);
    state.history = state.history.slice(0, 150);
    StorageService.save('glucoscan_history_v3', state.history);
    ProfileService.saveProfileData(state.settings, state.history);
    updateUI();
    renderProfileCalendar();
    renderProfileDateMeals();
    showToast(successMessage);
    return true;
  }

  document.getElementById('btnSaveMealLog')?.addEventListener('click', () => {
    logCurrentPlate('Repas enregistré dans le journal 7j');
  });

  // Bouton d'ajout direct du repas actuel à la synthèse journalière
  document.getElementById('btnLogCurrentMealToDay')?.addEventListener('click', () => {
    logCurrentPlate('Repas comptabilisé dans la synthèse du jour !');
  });

  // Réinitialiser les repas comptabilisés aujourd'hui
  document.getElementById('btnResetTodayLogs')?.addEventListener('click', () => {
    const todayKey = getLocalDateString();
    const countBefore = state.history.length;
    const removedItems = state.history.filter(item => getLocalDateString(item?.timestamp) === todayKey);
    removedItems.forEach(it => ProfileService.recordDeletedMeal(it.id || it.timestamp));
    state.history = state.history.filter(item => getLocalDateString(item?.timestamp) !== todayKey);
    const removedCount = countBefore - state.history.length;
    StorageService.save('glucoscan_history_v3', state.history);
    ProfileService.saveProfileData(state.settings, state.history);
    updateUI();
    renderProfileCalendar();
    renderProfileDateMeals();
    showToast(removedCount > 0 ? `Réinitialisé (${removedCount} repas retiré(s))` : 'Aucun repas à réinitialiser aujourd’hui');
  });

  document.getElementById('btnShareSummary')?.addEventListener('click', async () => {
    const ev = MetabolicEngine.evaluatePlate(
      state.items,
      state.settings,
      state.activeSlot
    );
    const lines = state.items.map(i => {
      const f = MetabolicEngine.resolveFoodEntry(i);
      const m = f ? MetabolicEngine.computeFoodPortion(f, i.grams) : { netCarbs: 0, protein: 0 };
      return `• ${f ? f.name.split('(')[0].trim() : i.foodId} (~${i.grams}g) : ${m.netCarbs.toFixed(1)}g nets • ${m.protein.toFixed(1)}g prot`;
    }).join('\n');

    const text = `📸 *MacroFit Maroc*\n${ev.verdict.tag}\n${lines}\n⚖️ Poids: ${ev.totalGrams}g | 🥗 *Glucides Nets: ${ev.netCarbs}g*\n🥩 *Protéines: ${ev.totalProtein}g (${ev.proteinIndex.label})*\n⚡ *Buffer Satiété (P+F)/G: ${ev.amortiRatio}*`;
    try {
      if (navigator.clipboard) await navigator.clipboard.writeText(text);
      showToast('Résumé copié !');
    } catch {}
    if (navigator.share) {
      try {
        await navigator.share({ text });
      } catch {}
    }
  });

  // Sauvegarde des paramètres
  document.getElementById('formSettings')?.addEventListener('submit', (e) => {
    e.preventDefault();
    state.settings.userWeight = Math.max(35, parseFloat(document.getElementById('inpUserWeight')?.value) || 85);
    state.settings.dailyTargetCalories = Math.max(800, parseFloat(document.getElementById('inpDailyTargetCalories')?.value) || 1950);
    state.settings.dailyTargetProtein = Math.max(30, parseFloat(document.getElementById('inpDailyTargetProtein').value) || 150);
    state.settings.dailyTargetCarbs = Math.max(30, parseFloat(document.getElementById('inpDailyTargetCarbs').value) || 150);
    state.settings.dailyTargetFat = Math.max(15, parseFloat(document.getElementById('inpDailyTargetFat')?.value) || 80);

    const enteredKey = document.getElementById('inpGeminiKey').value.trim();
    state.settings.geminiKey = enteredKey.length >= 15 ? enteredKey : '';
    StorageService.save('glucoscan_settings_v3', state.settings);
    ProfileService.saveProfileData(state.settings, state.history);
    updateUI();
    showToast('Paramètres & Objectifs (18/6 - 85 kg) enregistrés !');
  });

  // Bouton Tester l'API IA
  const btnTestGeminiKey = document.getElementById('btnTestGeminiKey');
  if (btnTestGeminiKey) {
    btnTestGeminiKey.addEventListener('click', async () => {
      const statusEl = document.getElementById('geminiKeyStatus');
      const enteredKey = document.getElementById('inpGeminiKey').value.trim();
      if (statusEl) {
        statusEl.textContent = 'Test en cours...';
        statusEl.className = 'text-[10px] font-bold text-amber-600 animate-pulse';
      }
      try {
        const result = await VisionAnalyzer.testConnection(enteredKey);
        if (statusEl) {
          if (result.success) {
            statusEl.textContent = `✅ Opérationnel (${result.model})`;
            statusEl.className = 'text-[10px] font-bold text-emerald-600';
            showToast(`Connexion IA réussie (${result.model})`);
          } else {
            statusEl.textContent = `❌ ${result.message || 'Erreur API'}`;
            statusEl.className = 'text-[10px] font-bold text-rose-600';
            showToast(`Échec du test IA : ${result.message || 'Erreur'}`);
          }
        }
      } catch (err) {
        if (statusEl) {
          statusEl.textContent = `❌ ${err.message}`;
          statusEl.className = 'text-[10px] font-bold text-rose-600';
        }
      }
    });
  }

  // Export & Import JSON
  document.getElementById('btnExportBackup')?.addEventListener('click', () => {
    StorageService.exportJSONBackup(state.settings, state.history);
  });

  document.getElementById('fileImportBackup')?.addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(String(reader.result));
        if (data.settings && typeof data.settings === 'object') {
          state.settings = {
            ...DEFAULT_SETTINGS,
            ...state.settings,
            userWeight: Math.max(35, Number(data.settings.userWeight) || DEFAULT_SETTINGS.userWeight),
            dailyTargetCalories: Math.max(800, Number(data.settings.dailyTargetCalories) || DEFAULT_SETTINGS.dailyTargetCalories),
            dailyTargetProtein: Math.max(30, Number(data.settings.dailyTargetProtein) || DEFAULT_SETTINGS.dailyTargetProtein),
            dailyTargetCarbs: Math.max(30, Number(data.settings.dailyTargetCarbs) || DEFAULT_SETTINGS.dailyTargetCarbs),
            dailyTargetFat: Math.max(15, Number(data.settings.dailyTargetFat) || DEFAULT_SETTINGS.dailyTargetFat),
            theme: data.settings.theme || 'auto'
          };
        }
        if (Array.isArray(data.history)) {
          const sanitizedHistory = data.history.filter(h => h && typeof h === 'object').map(h => ({
            id: String(h.id || 'log_' + Date.now()),
            timestamp: h.timestamp && !isNaN(Date.parse(h.timestamp)) ? new Date(h.timestamp).toISOString() : new Date().toISOString(),
            mealSlot: String(h.mealSlot || 'noon'),
            verdictTag: String(h.verdictTag || 'Repas'),
            totalGrams: Math.round(Number(h.totalGrams) || 0),
            netCarbs: Math.round(Number(h.netCarbs) * 10 || 0) / 10,
            totalProtein: Math.round(Number(h.totalProtein || h.protein) * 10 || 0) / 10,
            totalFat: Math.round(Number(h.totalFat || h.fat) * 10 || 0) / 10,
            totalCalories: Math.round(Number(h.totalCalories || h.calories) || 0),
            totalFiber: Math.round(Number(h.totalFiber || h.fiber) * 10 || 0) / 10,
            proteinIndexLabel: String(h.proteinIndexLabel || 'Modéré'),
            avgGI: Math.round(Number(h.avgGI) || 50),
            totalGL: Math.round(Number(h.totalGL) * 10 || 0) / 10,
            imageUrl: safeImageUrl(h.imageUrl),
            items: Array.isArray(h.items) ? h.items.map(it => ({
              name: String(it?.name || 'Aliment').slice(0, 100),
              grams: Math.round(Math.max(5, Math.min(1500, Number(it?.grams) || 100)))
            })) : []
          }));
          state.history = sanitizedHistory.slice(0, 150);
        }
        StorageService.save('glucoscan_settings_v3', state.settings);
        StorageService.save('glucoscan_history_v3', state.history);
        ProfileService.saveProfileData(state.settings, state.history);
        UIRenderer.renderHistoryView(state.history, state.settings);
        renderProfileCalendar();
        renderProfileDateMeals();
        updateUI();
        showToast('Sauvegarde importée et vérifiée !');
      } catch {
        showToast('Fichier JSON invalide');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  });

  // Fermeture des modales avec la touche Échap (Accessibilité clavier)
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (ImageCropper.isOpen()) {
        ImageCropper.cancel();
        return;
      }
      document.getElementById('modalSupabaseAuth')?.classList.add('hidden');
      document.getElementById('modalSupabaseAuth')?.classList.remove('flex');
      closeFoodCatalogModal();
      state.selectedPinIndex = null;
      updateUI();
    }
  });
}

/**
 * Initialisation sécurisée de l'application
 * Compatible chargement asynchrone / différé de module ES6
 */
function init() {
  try {
    spreadPinsAutomatically(state.items, false);
    applyTheme(state.settings.theme || 'auto');
    if (window.matchMedia) {
      window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
        if (state.settings.theme === 'auto') {
          applyTheme('auto');
        }
      });
    }
    bindEvents();
    ImageCropper.init();
    updateUI();
    updateFasting186View();
    setInterval(updateFasting186View, 30000);
    if (window.lucide) window.lucide.createIcons();

    // Enregistrement du Service Worker PWA pour le mode hors-ligne
    if ('serviceWorker' in navigator && (window.location.protocol === 'https:' || window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')) {
      navigator.serviceWorker.register('./sw.js').catch(() => {});
    }
  } catch (err) {
    console.error('Erreur initialisation MacroFit:', err);
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
