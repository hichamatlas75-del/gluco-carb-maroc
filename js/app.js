import { FoodRepository } from './data/foods.js?v=18';
import { StorageService } from './services/storage.js?v=18';
import { MetabolicEngine } from './services/metabolicEngine.js?v=18';
import { VisionAnalyzer } from './services/visionAnalyzer.js?v=18';
import { UIRenderer, showToast } from './ui/renderer.js?v=18';
import { SupabaseService } from './services/supabaseClient.js?v=18';

/**
 * Contrôleur principal GlucoScan Maroc (v18 - Double Profil, Supabase Cloud & Garde-fous Maroc)
 */
const EMBEDDED_API_KEY = 'AQ.Ab8RN6IcD0t6smDPSNTKH1wEPUYRFjYuSCUU5FwipEkAAHmRsg';

const DEFAULT_SETTINGS = {
  userMode: 'insulin',     // 'insulin' (Diabète & Insuline) ou 'wellness' (Santé & 18/6)
  ratioMorning: 8,
  ratioNoon: 10,
  ratioEvening: 10,
  isf: 50,
  targetBG: 100,
  bgUnit: 'mg/dL',
  dailyTargetProtein: 100, // Cible journalière protéines (ex: 100g)
  dailyTargetCarbs: 120,   // Cible journalière glucides nets (ex: 120g)
  geminiKey: EMBEDDED_API_KEY
};

function detectDefaultSlot() {
  const hour = new Date().getHours();
  if (hour >= 5 && hour < 11) return 'morning';
  if (hour >= 11 && hour < 17) return 'noon';
  return 'evening';
}

function getTodayTotals(history) {
  const todayStr = new Date().toDateString();
  let consumedCarbs = 0;
  let consumedProtein = 0;
  let mealCount = 0;

  for (const log of (history || [])) {
    if (!log.timestamp) continue;
    const logDate = new Date(log.timestamp).toDateString();
    if (logDate === todayStr) {
      consumedCarbs += Number(log.netCarbs) || 0;
      consumedProtein += Number(log.totalProtein || log.protein) || 0;
      mealCount++;
    }
  }

  return {
    carbs: Math.round(consumedCarbs * 10) / 10,
    protein: Math.round(consumedProtein * 10) / 10,
    mealCount
  };
}

const savedSettings = StorageService.load('glucoscan_settings_v3', {});
const state = {
  settings: {
    ...DEFAULT_SETTINGS,
    ...savedSettings,
    geminiKey: (savedSettings.geminiKey && savedSettings.geminiKey.trim().length > 20)
      ? savedSettings.geminiKey.trim()
      : EMBEDDED_API_KEY
  },
  activeSlot: detectDefaultSlot(),
  items: StorageService.load('glucoscan_items_v3', []),
  history: StorageService.load('glucoscan_history_v3', []),
  mediaStream: null,
  displayObjectUrl: null,
  catalogFilter: '',
  catalogCategory: 'all',
  replaceItemIndex: null,
  selectedPinIndex: null,
  pinsVisible: true,
  customPresetGI: 50
};

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

function getCurrentBGMgDl() {
  const el = document.getElementById('inputBloodGlucose');
  if (!el || !el.value.trim()) return null;
  const val = parseFloat(el.value);
  if (Number.isNaN(val) || val <= 0) return null;
  return state.settings.bgUnit === 'g/L' ? Math.round(val * 100) : Math.round(val);
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
    state.activeSlot,
    getCurrentBGMgDl()
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

  const watchdog = setTimeout(() => {
    overlay.classList.add('hidden');
  }, 12000);

  try {
    // Image 800px nette (qualité 0.85) pour l'analyse IA Vision
    const compressedDataUrl = await VisionAnalyzer.compressImageSource(source, 800, 0.85);

    const detected = await VisionAnalyzer.detectWithGemini(
      compressedDataUrl,
      state.settings.geminiKey || EMBEDDED_API_KEY
    );

    clearTimeout(watchdog);
    overlay.classList.add('hidden');

    if (detected && detected.length > 0) {
      spreadPinsAutomatically(detected, false);
      state.items = detected;
      StorageService.save('glucoscan_items_v3', state.items);
      updateUI();
      showToast(`${detected.length} aliment(s) reconnu(s) ! Glissez les étiquettes pour ajuster.`);
      return;
    }

    showToast('Aucun aliment détecté, réessayez ou cliquez sur + Ajouter');
  } catch {
    clearTimeout(watchdog);
    overlay.classList.add('hidden');
    showToast('Erreur réseau lors de l’analyse photo');
  }
}

function loadPresetPlate(key, replacePhotoWithSVG = false) {
  const plate = FoodRepository.getPlateByKey(key);
  if (!plate) return;

  if (replacePhotoWithSVG) {
    const img = document.getElementById('plateImage');
    img.src = VisionAnalyzer.createDemoPlateIllustration(plate.title);
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

  const weight = Math.min(180, Math.max(35, parseFloat(weightEl.value) || 72));
  const profile = profileEl.value;

  let factorPerKg = 2.1; // Diabète / Équilibre glycémique (~130-175g/j)
  if (profile === 'standard') factorPerKg = 3.0; // Adulte actif standard (~180-250g/j)
  if (profile === 'lowcarb') factorPerKg = 1.3;  // Low-Carb modéré (~85-120g/j)

  const dailyTotal = Math.round((weight * factorPerKg) / 5) * 5;
  const morning = Math.round(dailyTotal * 0.26);
  const noon = Math.round(dailyTotal * 0.40);
  const evening = Math.max(15, dailyTotal - morning - noon);

  document.getElementById('guideOutDailyCarbs').textContent = `${dailyTotal} g / jour`;
  document.getElementById('guideOutMorning').textContent = `~${morning}g`;
  document.getElementById('guideOutNoon').textContent = `~${noon}g`;
  document.getElementById('guideOutEvening').textContent = `~${evening}g`;
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

  if (cardEl && badgeEl && countEl && titleEl && descEl && barEl) {
    if (totalMinutesNow >= startEatMin && totalMinutesNow < endEatMin) {
      // Dans la fenêtre d'alimentation 6h (10h00 -> 16h00)
      const elapsedEat = totalMinutesNow - startEatMin;
      const remainEat = endEatMin - totalMinutesNow;
      const remH = Math.floor(remainEat / 60);
      const remM = remainEat % 60;
      const pct = Math.min(100, Math.max(5, Math.round((elapsedEat / 360) * 100)));

      cardEl.className = 'bg-emerald-50 border border-emerald-200 rounded-xl p-3 mb-2.5 transition-all';
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
      UIRenderer.renderCircularFastingClock(elapsedEat, remainEat, true);
    } else {
      // Dans la fenêtre de jeûne 18h (16h00 -> 10h00 le lendemain)
      const elapsedFast = totalMinutesNow >= endEatMin
        ? (totalMinutesNow - endEatMin)
        : (24 * 60 - endEatMin + totalMinutesNow);
      const remainFast = 18 * 60 - elapsedFast;
      const remH = Math.floor(remainFast / 60);
      const remM = remainFast % 60;
      const elapsedH = Math.floor(elapsedFast / 60);
      const pct = Math.min(100, Math.max(5, Math.round((elapsedFast / (18 * 60)) * 100)));

      cardEl.className = 'bg-indigo-50 border border-indigo-200 rounded-xl p-3 mb-2.5 transition-all';
      badgeEl.className = 'text-[10px] font-extrabold uppercase tracking-wider px-2 py-0.5 rounded-full bg-indigo-600 text-white';
      badgeEl.textContent = `En Jeûne Actif (${elapsedH}h / 18h)`;
      countEl.className = 'text-xs font-extrabold text-indigo-900 tabular-nums';
      countEl.textContent = `Prochain repas (10h) dans ${remH}h${String(remM).padStart(2, '0')}`;
      titleEl.className = 'text-xs font-extrabold text-indigo-950';
      titleEl.textContent = elapsedH >= 12
        ? 'Phase Cétose & Autophagie Maximale (>12h de jeûne)'
        : 'Phase Repos Pancréatique & Baisse de l’Insuline';
      descEl.className = 'text-[11px] text-indigo-800 mt-0.5 leading-relaxed';
      descEl.textContent = 'Hydratation autorisée sans glucides : eau, thé ou café sans sucre, tisane.';
      barEl.className = 'h-full bg-indigo-600 rounded-full transition-all duration-500';
      barEl.style.width = `${pct}%`;
      UIRenderer.renderCircularFastingClock(elapsedFast, remainFast, false);
    }
  }

  // Calcul dynamique du Repas n°2 (15h00) et du Bilan Total Journalier
  const protSel = document.getElementById('fastingSelectProtein15h');
  const breadSel = document.getElementById('fastingSelectBread15h');
  const breadGramsInp = document.getElementById('fastingInputBreadGrams');
  if (!protSel || !breadSel || !breadGramsInp) return;

  const protKey = protSel.value;
  const breadId = breadSel.value;
  const breadGrams = Math.min(250, Math.max(0, parseFloat(breadGramsInp.value) || 70));

  const breadFood = FoodRepository.getFoodById(breadId);
  const breadNetPer100 = breadFood ? Math.max(0, breadFood.carbs100g - breadFood.fiber100g) : 35.5;
  const breadCarbs = (breadNetPer100 * breadGrams) / 100;
  const saladCarbs = 3.1; // 140g salade marocaine
  const keftaCarbs = protKey === 'kefta' ? 1.4 : 0;
  const meal15hCarbs = Math.round((breadCarbs + saladCarbs + keftaCarbs) * 10) / 10;

  let meal15hProtein = 52; // Poulet 200g (~54g) + pain (~6g)
  if (protKey === 'sardine') meal15hProtein = 48;
  if (protKey === 'kefta') meal15hProtein = 44;

  const meal10hCarbs = 24.9; // 65g pain céréales (22g) + 2 oeufs (0.8g) + jben/huile (2.1g)
  const meal10hProtein = 30; // 2 oeufs (15g) + pain céréales (6g) + jben (9g)

  const totalDayCarbs = Math.round((meal10hCarbs + meal15hCarbs) * 10) / 10;
  const totalDayProtein = meal10hProtein + meal15hProtein + Math.round(breadGrams * 0.085);

  const out15h = document.getElementById('fastingOut15hCarbs');
  if (out15h) out15h.textContent = `${meal15hCarbs.toFixed(1)} g nets`;

  const outTotalCarbs = document.getElementById('fastingTotalDayCarbs');
  if (outTotalCarbs) outTotalCarbs.textContent = `${totalDayCarbs.toFixed(1)} g nets`;

  const outTotalProt = document.getElementById('fastingTotalDayProtein');
  if (outTotalProt) outTotalProt.textContent = `~${totalDayProtein} g`;
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
    UIRenderer.renderHistoryView(state.history);
  }
  if (target === 'guide') {
    updateDailyCarbCalculator();
    if (window.lucide) window.lucide.createIcons();
  }
  if (target === 'settings') {
    const pInp = document.getElementById('inpDailyTargetProtein');
    if (pInp) pInp.value = state.settings.dailyTargetProtein || 100;
    const cInp = document.getElementById('inpDailyTargetCarbs');
    if (cInp) cInp.value = state.settings.dailyTargetCarbs || 120;
    const todayTotals = getTodayTotals(state.history);
    UIRenderer.renderDailySynthesis(todayTotals, state.settings);
    UIRenderer.renderUserMode(state.settings.userMode || 'insulin');

    document.getElementById('inpRatioMorning').value = state.settings.ratioMorning;
    document.getElementById('inpRatioNoon').value = state.settings.ratioNoon;
    document.getElementById('inpRatioEvening').value = state.settings.ratioEvening;
    document.getElementById('inpISF').value = state.settings.isf;
    document.getElementById('inpTargetBG').value = state.settings.targetBG;
    document.getElementById('inpGeminiKey').value = state.settings.geminiKey || '';
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

  // Double Profil : Diabète & Insuline vs Santé & Jeûne 18/6
  document.getElementById('btnModeInsulin')?.addEventListener('click', () => {
    state.settings.userMode = 'insulin';
    StorageService.save('glucoscan_settings_v3', state.settings);
    UIRenderer.renderUserMode('insulin');
    updateUI();
    showToast('Mode Diabète & Insuline actif');
  });

  document.getElementById('btnModeWellness')?.addEventListener('click', () => {
    state.settings.userMode = 'wellness';
    StorageService.save('glucoscan_settings_v3', state.settings);
    UIRenderer.renderUserMode('wellness');
    updateUI();
    showToast('Mode Santé & 18/6 actif (Insuline masquée)');
  });

  // Rapport Médical (PDF / Impression)
  document.getElementById('btnExportMedicalReport')?.addEventListener('click', () => {
    UIRenderer.exportMedicalReport(state.history, state.settings);
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
        new Notification('GlucoScan Maroc — Mon 18/6', {
          body: 'Rappels actifs pour votre protocole 10h & 15h.',
          icon: './manifest.json'
        });
      } catch (_) {}
    } else {
      showToast('Autorisation de notification refusée');
    }
  });

  // Gestion du Compte Supabase & Synchronisation Cloud
  const updateAuthUI = () => {
    const isAuth = SupabaseService.isAuthenticated();
    const user = SupabaseService.currentUser;
    const badge = document.getElementById('lblAuthStatusBadge');
    const modalState = document.getElementById('lblAuthModalState');
    const modalSub = document.getElementById('lblAuthModalSub');
    const signOutBtn = document.getElementById('btnSignOutAuth');

    if (isAuth && user) {
      if (badge) badge.textContent = user.email ? user.email.split('@')[0] : 'Connecté';
      if (modalState) {
        modalState.textContent = 'Connecté (Cloud)';
        modalState.className = 'font-extrabold font-mono text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-lg border border-emerald-200';
      }
      if (modalSub) modalSub.textContent = `Connecté avec ${user.email}. Synchronisation active.`;
      if (signOutBtn) signOutBtn.classList.remove('hidden');
    } else {
      if (badge) badge.textContent = 'Invité';
      if (modalState) {
        modalState.textContent = 'Mode Invité (Local)';
        modalState.className = 'font-extrabold font-mono text-amber-700 bg-amber-50 px-2 py-0.5 rounded-lg border border-amber-200';
      }
      if (modalSub) modalSub.textContent = 'Vos repas sont stockés sur votre téléphone. Connectez-vous pour sauvegarder dans le Cloud Supabase.';
      if (signOutBtn) signOutBtn.classList.add('hidden');
    }
  };

  document.getElementById('btnOpenAuthModal')?.addEventListener('click', () => {
    updateAuthUI();
    document.getElementById('modalSupabaseAuth')?.classList.remove('hidden');
    document.getElementById('modalSupabaseAuth')?.classList.add('flex');
    if (window.lucide) window.lucide.createIcons();
  });

  document.getElementById('btnCloseAuthModal')?.addEventListener('click', () => {
    document.getElementById('modalSupabaseAuth')?.classList.add('hidden');
    document.getElementById('modalSupabaseAuth')?.classList.remove('flex');
  });

  document.getElementById('btnGoogleSignIn')?.addEventListener('click', async () => {
    try {
      await SupabaseService.signInWithOAuth('google');
    } catch (_) {
      showToast('Supabase non configuré pour Google OAuth');
    }
  });

  // Basculement onglets Magic Link vs Mot de passe
  const tabAuthMagic = document.getElementById('tabAuthMagic');
  const tabAuthPassword = document.getElementById('tabAuthPassword');
  const panelAuthMagic = document.getElementById('panelAuthMagic');
  const panelAuthPassword = document.getElementById('panelAuthPassword');

  tabAuthMagic?.addEventListener('click', () => {
    tabAuthMagic.classList.add('bg-white', 'text-slate-800', 'shadow-2xs');
    tabAuthMagic.classList.remove('text-slate-500');
    tabAuthPassword.classList.remove('bg-white', 'text-slate-800', 'shadow-2xs');
    tabAuthPassword.classList.add('text-slate-500');
    panelAuthMagic?.classList.remove('hidden');
    panelAuthPassword?.classList.add('hidden');
  });

  tabAuthPassword?.addEventListener('click', () => {
    tabAuthPassword.classList.add('bg-white', 'text-slate-800', 'shadow-2xs');
    tabAuthPassword.classList.remove('text-slate-500');
    tabAuthMagic.classList.remove('bg-white', 'text-slate-800', 'shadow-2xs');
    tabAuthMagic.classList.add('text-slate-500');
    panelAuthPassword?.classList.remove('hidden');
    panelAuthMagic?.classList.add('hidden');
  });

  document.getElementById('formMagicLink')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('inpMagicLinkEmail').value.trim();
    if (!email) return;
    try {
      await SupabaseService.signInWithMagicLink(email);
      showToast(`✉️ Email envoyé à ${email} !`);
      const otpForm = document.getElementById('formVerifyOtp');
      if (otpForm) otpForm.classList.remove('hidden');
    } catch (err) {
      console.error('Supabase magic link error:', err);
      showToast(err?.message || 'Erreur Supabase lors de l’envoi');
    }
  });

  document.getElementById('formVerifyOtp')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('inpMagicLinkEmail').value.trim();
    const code = document.getElementById('inpOtpCode').value.trim();
    if (!email || !code) return;
    try {
      await SupabaseService.verifyOtp(email, code);
      updateAuthUI();
      document.getElementById('modalSupabaseAuth')?.classList.add('hidden');
      document.getElementById('modalSupabaseAuth')?.classList.remove('flex');
      showToast('✅ Connecté avec succès pour toujours !');
    } catch (err) {
      console.error('Supabase OTP error:', err);
      showToast(err?.message || 'Code invalide ou expiré');
    }
  });

  // Connexion avec mot de passe
  document.getElementById('formPasswordAuth')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('inpPasswordEmail').value.trim();
    const password = document.getElementById('inpPasswordVal').value;
    if (!email || !password) return;
    try {
      await SupabaseService.signInWithPassword(email, password);
      updateAuthUI();
      document.getElementById('modalSupabaseAuth')?.classList.add('hidden');
      document.getElementById('modalSupabaseAuth')?.classList.remove('flex');
      showToast('✅ Connecté avec succès !');
    } catch (err) {
      console.error('Supabase password sign in error:', err);
      showToast(err?.message || 'Email ou mot de passe incorrect');
    }
  });

  // Inscription avec mot de passe
  document.getElementById('btnSubmitPasswordSignUp')?.addEventListener('click', async () => {
    const email = document.getElementById('inpPasswordEmail').value.trim();
    const password = document.getElementById('inpPasswordVal').value;
    if (!email || !password) {
      showToast('Veuillez renseigner votre email et mot de passe');
      return;
    }
    if (password.length < 6) {
      showToast('Le mot de passe doit comporter au moins 6 caractères');
      return;
    }
    try {
      const res = await SupabaseService.signUpWithPassword(email, password);
      updateAuthUI();
      if (SupabaseService.isAuthenticated()) {
        document.getElementById('modalSupabaseAuth')?.classList.add('hidden');
        document.getElementById('modalSupabaseAuth')?.classList.remove('flex');
        showToast('✅ Compte créé et connecté !');
      } else {
        showToast('Compte créé ! Veuillez vous connecter.');
      }
    } catch (err) {
      console.error('Supabase signup error:', err);
      showToast(err?.message || 'Erreur lors de la création du compte');
    }
  });

  document.getElementById('btnSyncLocalHistory')?.addEventListener('click', async () => {
    if (!SupabaseService.isAuthenticated()) {
      showToast('Connectez-vous d’abord pour envoyer vos repas sur Supabase');
      return;
    }
    const res = await SupabaseService.syncLocalHistoryToCloud(state.history);
    showToast(`☁️ ${res.synced} repas synchronisé(s) vers Supabase !`);
  });

  document.getElementById('btnSignOutAuth')?.addEventListener('click', async () => {
    await SupabaseService.signOut();
    updateAuthUI();
    showToast('Déconnecté. Mode invité réactivé.');
  });

  // Événements de l'onglet Mon 18/6 (Jeûne Intermittent 10h & 15h)
  document.getElementById('fastingSelectProtein15h')?.addEventListener('change', updateFasting186View);
  document.getElementById('fastingSelectBread15h')?.addEventListener('change', updateFasting186View);
  document.getElementById('fastingInputBreadGrams')?.addEventListener('input', updateFasting186View);

  document.getElementById('btnLoadMeal10h')?.addEventListener('click', () => {
    state.activeSlot = 'morning';
    loadPresetPlate('jeune_10h', true);
    switchToTab('scanner');
    showToast('Repas 10h00 (2 œufs, pain céréales, jben & huile d’olive) chargé !');
  });

  document.getElementById('btnLoadMeal15h')?.addEventListener('click', () => {
    state.activeSlot = 'noon';
    const protKey = document.getElementById('fastingSelectProtein15h')?.value || 'poulet';
    const breadId = document.getElementById('fastingSelectBread15h')?.value || 'khobz-complet';
    const breadGrams = Math.min(250, Math.max(5, parseInt(document.getElementById('fastingInputBreadGrams')?.value, 10) || 70));

    let protFoodId = 'poulet-grille';
    let protGrams = 200;
    let titleLabel = 'Repas 15h00 (Poulet + Khobz)';
    if (protKey === 'sardine') {
      protFoodId = 'sardines-grillees';
      protGrams = 200;
      titleLabel = 'Repas 15h00 (Sardines + Khobz)';
    } else if (protKey === 'kefta') {
      protFoodId = 'kefta-grillee';
      protGrams = 180;
      titleLabel = 'Repas 15h00 (Viande Hachée + Khobz)';
    }

    const img = document.getElementById('plateImage');
    img.src = VisionAnalyzer.createDemoPlateIllustration(titleLabel);
    img.classList.remove('hidden');
    document.getElementById('emptyCameraState').classList.add('hidden');
    document.getElementById('btnClearPhoto').classList.remove('hidden');

    state.items = [
      { foodId: protFoodId, grams: protGrams, x: 42, y: 46 },
      { foodId: 'salade-marocaine', grams: 140, x: 72, y: 40 },
      { foodId: breadId, grams: breadGrams, x: 25, y: 74 }
    ];
    StorageService.save('glucoscan_items_v3', state.items);
    updateUI();
    switchToTab('scanner');
    showToast(`${titleLabel} chargé dans le calculateur !`);
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

  // Boutons Appareil Photo & Galerie
  document.getElementById('btnTakePhoto').addEventListener('click', () => {
    document.getElementById('fileCameraInput').click();
  });
  document.getElementById('btnUploadPhoto').addEventListener('click', () => {
    document.getElementById('fileGalleryInput').click();
  });

  const handleFileInput = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    handleImageSource(file);
    e.target.value = '';
  };

  document.getElementById('fileCameraInput').addEventListener('change', handleFileInput);
  document.getElementById('fileGalleryInput').addEventListener('change', handleFileInput);

  // Viseur WebRTC en direct
  document.getElementById('btnStartWebRTC').addEventListener('click', startWebRTC);
  document.getElementById('btnCloseStream').addEventListener('click', stopWebRTC);
  document.getElementById('btnCaptureFrame').addEventListener('click', () => {
    const video = document.getElementById('cameraVideo');
    const canvas = document.getElementById('analysisCanvas');
    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;
    canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
    handleImageSource(canvas.toDataURL('image/jpeg', 0.72));
  });

  // Réinitialiser la photo
  document.getElementById('btnClearPhoto').addEventListener('click', () => {
    stopWebRTC();
    document.getElementById('plateImage').classList.add('hidden');
    document.getElementById('emptyCameraState').classList.remove('hidden');
    document.getElementById('btnClearPhoto').classList.add('hidden');
    state.items = [];
    StorageService.save('glucoscan_items_v3', []);
    updateUI();
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
        if (state.selectedPinIndex === idx) state.selectedPinIndex = null;
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
    state.items[idx].grams = Math.max(5, parseInt(e.target.value, 10) || 5);
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
  document.getElementById('recognizedItemsContainer').addEventListener('click', (e) => {
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
      const idx = parseInt(deltaBtn.getAttribute('data-index'), 10);
      const delta = parseInt(deltaBtn.getAttribute('data-delta'), 10);
      if (state.items[idx]) {
        state.items[idx].grams = Math.max(5, state.items[idx].grams + delta);
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
        if (state.selectedPinIndex === idx) state.selectedPinIndex = null;
        StorageService.save('glucoscan_items_v3', state.items);
        updateUI();
        showToast(`🗑️ ${removedFood ? removedFood.name.split('(')[0].trim() : 'Aliment'} supprimé`);
      }
    }
  });

  document.getElementById('recognizedItemsContainer').addEventListener('input', (e) => {
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
      state.items[idx].grams = Math.max(5, parseInt(inp.value, 10) || 5);
      StorageService.save('glucoscan_items_v3', state.items);
      updateUI();
    }
  });

  // Glycémie actuelle & bascule mg/dL ⇄ g/L
  document.getElementById('inputBloodGlucose').addEventListener('input', updateUI);
  document.getElementById('btnSwitchBGUnit').addEventListener('click', () => {
    const inp = document.getElementById('inputBloodGlucose');
    const v = parseFloat(inp.value);
    if (state.settings.bgUnit === 'mg/dL') {
      state.settings.bgUnit = 'g/L';
      if (!Number.isNaN(v) && v > 0) inp.value = (v / 100).toFixed(2);
    } else {
      state.settings.bgUnit = 'mg/dL';
      if (!Number.isNaN(v) && v > 0) inp.value = String(Math.round(v * 100));
    }
    StorageService.save('glucoscan_settings_v3', state.settings);
    updateUI();
  });

  // Ouverture / Fermeture du Catalogue d'Ajout ou de Correction (Remplacement)
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

  function openFoodCatalogModal(replaceIdx = null) {
    state.replaceItemIndex = (typeof replaceIdx === 'number' && state.items[replaceIdx]) ? replaceIdx : null;
    syncCatalogModalHeader();
    UIRenderer.renderCatalogModal(state.catalogFilter, state.catalogCategory, state.replaceItemIndex);
    const modal = document.getElementById('modalFoodCatalog');
    modal.classList.remove('hidden');
    modal.classList.add('flex');
    if (window.lucide) window.lucide.createIcons();
  }

  function closeFoodCatalogModal() {
    state.replaceItemIndex = null;
    const modal = document.getElementById('modalFoodCatalog');
    modal.classList.add('hidden');
    modal.classList.remove('flex');
  }

  function applyFoodChoice(newEntry, shortName) {
    if (state.replaceItemIndex !== null && state.items[state.replaceItemIndex]) {
      const oldItem = state.items[state.replaceItemIndex];
      state.items[state.replaceItemIndex] = {
        ...newEntry,
        x: oldItem.x || newEntry.x,
        y: oldItem.y || newEntry.y
      };
      StorageService.save('glucoscan_items_v3', state.items);
      updateUI();
      closeFoodCatalogModal();
      showToast(`🔄 Corrigé par : ${shortName}`);
    } else {
      state.items.push(newEntry);
      StorageService.save('glucoscan_items_v3', state.items);
      updateUI();
      closeFoodCatalogModal();
      showToast(`✅ ${shortName} ajouté à l'assiette`);
    }
  }

  document.getElementById('btnOpenCatalogModal').addEventListener('click', () => {
    openFoodCatalogModal(null);
  });

  document.getElementById('btnCloseCatalog').addEventListener('click', closeFoodCatalogModal);

  document.getElementById('btnCancelReplaceMode')?.addEventListener('click', () => {
    state.replaceItemIndex = null;
    syncCatalogModalHeader();
    UIRenderer.renderCatalogModal(state.catalogFilter, state.catalogCategory, null);
  });

  document.getElementById('inpCatalogSearch').addEventListener('input', (e) => {
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

  document.getElementById('catalogItemsList').addEventListener('click', (e) => {
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
  document.getElementById('btnSaveMealLog').addEventListener('click', () => {
    if (state.items.length === 0) return;
    const ev = MetabolicEngine.evaluatePlate(
      state.items,
      state.settings,
      state.activeSlot,
      getCurrentBGMgDl()
    );
    state.history.unshift({
      id: 'log_' + Date.now(),
      timestamp: new Date().toISOString(),
      verdictTag: ev.verdict.tag,
      totalGrams: ev.totalGrams,
      netCarbs: ev.netCarbs,
      totalProtein: ev.totalProtein,
      proteinIndexLabel: ev.proteinIndex.label,
      totalBolus: ev.totalBolus,
      items: state.items.map(i => {
        const f = MetabolicEngine.resolveFoodEntry(i);
        return { name: f ? f.name.split('(')[0].trim() : i.foodId, grams: i.grams };
      })
    });
    state.history = state.history.slice(0, 150);
    StorageService.save('glucoscan_history_v3', state.history);
    updateUI();
    showToast('Repas enregistré dans le journal 7j');
  });

  // Bouton d'ajout direct du repas actuel à la synthèse journalière
  document.getElementById('btnLogCurrentMealToDay')?.addEventListener('click', () => {
    if (state.items.length === 0) {
      showToast('Assiette vide : ajoutez d’abord des aliments');
      return;
    }
    const ev = MetabolicEngine.evaluatePlate(
      state.items,
      state.settings,
      state.activeSlot,
      getCurrentBGMgDl()
    );
    state.history.unshift({
      id: 'log_' + Date.now(),
      timestamp: new Date().toISOString(),
      verdictTag: ev.verdict.tag,
      totalGrams: ev.totalGrams,
      netCarbs: ev.netCarbs,
      totalProtein: ev.totalProtein,
      proteinIndexLabel: ev.proteinIndex.label,
      totalBolus: ev.totalBolus,
      items: state.items.map(i => {
        const f = MetabolicEngine.resolveFoodEntry(i);
        return { name: f ? f.name.split('(')[0].trim() : i.foodId, grams: i.grams };
      })
    });
    state.history = state.history.slice(0, 150);
    StorageService.save('glucoscan_history_v3', state.history);
    updateUI();
    showToast('Repas comptabilisé dans la synthèse du jour !');
  });

  // Réinitialiser les repas comptabilisés aujourd'hui
  document.getElementById('btnResetTodayLogs')?.addEventListener('click', () => {
    const todayStr = new Date().toDateString();
    const countBefore = state.history.length;
    state.history = state.history.filter(item => {
      if (!item || !item.timestamp) return true;
      return new Date(item.timestamp).toDateString() !== todayStr;
    });
    const removedCount = countBefore - state.history.length;
    StorageService.save('glucoscan_history_v3', state.history);
    updateUI();
    showToast(removedCount > 0 ? `Réinitialisé (${removedCount} repas retiré(s))` : 'Aucun repas à réinitialiser aujourd’hui');
  });

  document.getElementById('btnShareSummary').addEventListener('click', async () => {
    const ev = MetabolicEngine.evaluatePlate(
      state.items,
      state.settings,
      state.activeSlot,
      getCurrentBGMgDl()
    );
    const lines = state.items.map(i => {
      const f = MetabolicEngine.resolveFoodEntry(i);
      const m = f ? MetabolicEngine.computeFoodPortion(f, i.grams) : { netCarbs: 0, protein: 0 };
      return `• ${f ? f.name.split('(')[0].trim() : i.foodId} (~${i.grams}g) : ${m.netCarbs.toFixed(1)}g nets • ${m.protein.toFixed(1)}g prot`;
    }).join('\n');

    const text = `📸 *GlucoScan Maroc*\n${ev.verdict.tag}\n${lines}\n⚖️ Poids: ${ev.totalGrams}g | 🥗 *Glucides Nets: ${ev.netCarbs}g*\n🥩 *Protéines: ${ev.totalProtein}g (${ev.proteinIndex.label})*\n💉 *Bolus Estimé: ${ev.totalBolus.toFixed(1)} UI*`;
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
  document.getElementById('formSettings').addEventListener('submit', (e) => {
    e.preventDefault();
    state.settings.dailyTargetProtein = Math.max(30, parseFloat(document.getElementById('inpDailyTargetProtein').value) || 100);
    state.settings.dailyTargetCarbs = Math.max(30, parseFloat(document.getElementById('inpDailyTargetCarbs').value) || 120);
    state.settings.ratioMorning = Math.max(1, parseFloat(document.getElementById('inpRatioMorning').value) || 8);
    state.settings.ratioNoon = Math.max(1, parseFloat(document.getElementById('inpRatioNoon').value) || 10);
    state.settings.ratioEvening = Math.max(1, parseFloat(document.getElementById('inpRatioEvening').value) || 10);
    state.settings.isf = Math.max(5, parseFloat(document.getElementById('inpISF').value) || 50);
    state.settings.targetBG = Math.max(70, parseFloat(document.getElementById('inpTargetBG').value) || 100);
    const enteredKey = document.getElementById('inpGeminiKey').value.trim();
    state.settings.geminiKey = enteredKey.length > 20 ? enteredKey : EMBEDDED_API_KEY;
    StorageService.save('glucoscan_settings_v3', state.settings);
    updateUI();
    showToast('Paramètres & Objectifs enregistrés');
  });

  // Export & Import JSON
  document.getElementById('btnExportBackup').addEventListener('click', () => {
    StorageService.exportJSONBackup(state.settings, state.history);
  });

  document.getElementById('fileImportBackup').addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(String(reader.result));
        if (data.settings) state.settings = { ...DEFAULT_SETTINGS, ...data.settings };
        if (Array.isArray(data.history)) state.history = data.history;
        StorageService.save('glucoscan_settings_v3', state.settings);
        StorageService.save('glucoscan_history_v3', state.history);
        UIRenderer.renderHistoryView(state.history);
        updateUI();
        showToast('Sauvegarde importée');
      } catch {
        showToast('Fichier JSON invalide');
      }
    };
    reader.readAsText(file);
  });
}

document.addEventListener('DOMContentLoaded', () => {
  spreadPinsAutomatically(state.items, false);
  bindEvents();
  updateUI();
  updateFasting186View();
  setInterval(updateFasting186View, 30000);
});
