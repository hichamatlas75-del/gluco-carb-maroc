import { FoodRepository } from './data/foods.js?v=10';
import { StorageService } from './services/storage.js?v=10';
import { MetabolicEngine } from './services/metabolicEngine.js?v=10';
import { VisionAnalyzer } from './services/visionAnalyzer.js?v=10';
import { UIRenderer, showToast } from './ui/renderer.js?v=10';

/**
 * Contrôleur principal GlucoScan Maroc (v10 - Guide Nutrition & Besoins Journaliers Adultes)
 */
const EMBEDDED_API_KEY = 'AQ.Ab8RN6IcD0t6smDPSNTKH1wEPUYRFjYuSCUU5FwipEkAAHmRsg';

const DEFAULT_SETTINGS = {
  ratioMorning: 8,
  ratioNoon: 10,
  ratioEvening: 10,
  isf: 50,
  targetBG: 100,
  bgUnit: 'mg/dL',
  geminiKey: EMBEDDED_API_KEY
};

function detectDefaultSlot() {
  const hour = new Date().getHours();
  if (hour >= 5 && hour < 11) return 'morning';
  if (hour >= 11 && hour < 17) return 'noon';
  return 'evening';
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
  catalogFilter: ''
};

function getCurrentBGMgDl() {
  const el = document.getElementById('inputBloodGlucose');
  if (!el || !el.value.trim()) return null;
  const val = parseFloat(el.value);
  if (Number.isNaN(val) || val <= 0) return null;
  return state.settings.bgUnit === 'g/L' ? Math.round(val * 100) : Math.round(val);
}

function updateUI() {
  const evaluation = MetabolicEngine.evaluatePlate(
    state.items,
    state.settings,
    state.activeSlot,
    getCurrentBGMgDl()
  );
  UIRenderer.renderDashboard(state, evaluation);
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
      state.items = detected;
      StorageService.save('glucoscan_items_v3', state.items);
      updateUI();
      showToast(`${detected.length} aliment(s) reconnu(s) sur la photo !`);
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

  state.items = plate.items.map(i => ({ ...i }));
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

  // Grammes de glucides nets par kg de poids corporel selon le profil adulte
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

function bindEvents() {
  // Navigation entre les 4 onglets (Scanner, Journal 7j, Guide & Besoins, Paramètres)
  document.querySelectorAll('.nav-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      const target = btn.getAttribute('data-view');
      ['scanner', 'history', 'guide', 'settings'].forEach(v => {
        const el = document.getElementById(`view-${v}`);
        if (el) el.classList.toggle('hidden', v !== target);
      });
      document.querySelectorAll('.nav-tab').forEach(b => {
        const active = b.getAttribute('data-view') === target;
        b.classList.toggle('text-emerald-600', active);
        b.classList.toggle('text-slate-400', !active);
      });
      if (target === 'history') {
        UIRenderer.renderHistoryView(state.history);
      }
      if (target === 'guide') {
        updateDailyCarbCalculator();
        if (window.lucide) window.lucide.createIcons();
      }
      if (target === 'settings') {
        document.getElementById('inpRatioMorning').value = state.settings.ratioMorning;
        document.getElementById('inpRatioNoon').value = state.settings.ratioNoon;
        document.getElementById('inpRatioEvening').value = state.settings.ratioEvening;
        document.getElementById('inpISF').value = state.settings.isf;
        document.getElementById('inpTargetBG').value = state.settings.targetBG;
        document.getElementById('inpGeminiKey').value = state.settings.geminiKey || '';
      }
    });
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

  // Ajustement des grammages (-20g, -5g, +5g, +20g, suppression)
  document.getElementById('recognizedItemsContainer').addEventListener('click', (e) => {
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
      state.items.splice(idx, 1);
      StorageService.save('glucoscan_items_v3', state.items);
      updateUI();
    }
  });

  document.getElementById('recognizedItemsContainer').addEventListener('input', (e) => {
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

  // Catalogue d'ajout manuel (+ Ajouter)
  document.getElementById('btnOpenCatalogModal').addEventListener('click', () => {
    UIRenderer.renderCatalogModal(state.catalogFilter);
    const modal = document.getElementById('modalFoodCatalog');
    modal.classList.remove('hidden');
    modal.classList.add('flex');
  });

  document.getElementById('btnCloseCatalog').addEventListener('click', () => {
    const modal = document.getElementById('modalFoodCatalog');
    modal.classList.add('hidden');
    modal.classList.remove('flex');
  });

  document.getElementById('inpCatalogSearch').addEventListener('input', (e) => {
    state.catalogFilter = e.target.value;
    UIRenderer.renderCatalogModal(state.catalogFilter);
  });

  document.getElementById('catalogItemsList').addEventListener('click', (e) => {
    const pick = e.target.closest('[data-pick-food]');
    if (!pick) return;
    const food = FoodRepository.getFoodById(pick.getAttribute('data-pick-food'));
    if (!food) return;
    state.items.push({
      foodId: food.id,
      grams: food.defaultGrams,
      x: 28 + Math.round(Math.random() * 44),
      y: 28 + Math.round(Math.random() * 44)
    });
    StorageService.save('glucoscan_items_v3', state.items);
    updateUI();
    showToast(`${food.name.split('(')[0].trim()} ajouté`);
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
      totalBolus: ev.totalBolus,
      items: state.items.map(i => {
        const f = MetabolicEngine.resolveFoodEntry(i);
        return { name: f ? f.name.split('(')[0].trim() : i.foodId, grams: i.grams };
      })
    });
    state.history = state.history.slice(0, 150);
    StorageService.save('glucoscan_history_v3', state.history);
    showToast('Repas enregistré dans le journal 7j');
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
      const m = f ? MetabolicEngine.computeFoodPortion(f, i.grams) : { netCarbs: 0 };
      return `• ${f ? f.name.split('(')[0].trim() : i.foodId} (~${i.grams}g) : ${m.netCarbs.toFixed(1)}g nets`;
    }).join('\n');

    const text = `📸 *GlucoScan Maroc*\n${ev.verdict.tag}\n${lines}\n⚖️ Poids: ${ev.totalGrams}g | 🥗 *Glucides Nets: ${ev.netCarbs}g*\n💉 *Bolus Estimé: ${ev.totalBolus.toFixed(1)} UI*`;
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
    state.settings.ratioMorning = Math.max(1, parseFloat(document.getElementById('inpRatioMorning').value) || 8);
    state.settings.ratioNoon = Math.max(1, parseFloat(document.getElementById('inpRatioNoon').value) || 10);
    state.settings.ratioEvening = Math.max(1, parseFloat(document.getElementById('inpRatioEvening').value) || 10);
    state.settings.isf = Math.max(5, parseFloat(document.getElementById('inpISF').value) || 50);
    state.settings.targetBG = Math.max(70, parseFloat(document.getElementById('inpTargetBG').value) || 100);
    const enteredKey = document.getElementById('inpGeminiKey').value.trim();
    state.settings.geminiKey = enteredKey.length > 20 ? enteredKey : EMBEDDED_API_KEY;
    StorageService.save('glucoscan_settings_v3', state.settings);
    updateUI();
    showToast('Paramètres enregistrés');
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
  bindEvents();
  updateUI();
});
