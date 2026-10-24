/**
 * Service de Gestion des Profils Utilisateurs (Sans Email)
 * Inspiré du modèle "Workout Home" : Pseudo + Mot de passe
 * Fonctionne 100% hors-ligne (Local-First) avec synchronisation Cloud Supabase bidirectionnelle (Mobile ⇄ PC).
 */

const STORAGE_KEY_PROFILES = 'glucoscan_profiles_db_v1';
const STORAGE_KEY_ACTIVE = 'glucoscan_active_profile_v1';
const STORAGE_KEY_DELETED = 'glucoscan_deleted_meals_v1';

// Métadonnées de synchronisation stockées dans app_accounts.settings (aucune migration SQL requise)
const META_DELETED_IDS = '__deletedMealIds';
const META_SETTINGS_UPDATED_AT = '__settingsUpdatedAt';
// Réglages strictement locaux : jamais envoyés dans le Cloud
const LOCAL_ONLY_SETTINGS = ['geminiKey'];
const MAX_TOMBSTONES = 500;
const SYNC_DEBOUNCE_MS = 1500;

// Bus de synchronisation temps réel inter-onglets (PC / Multi-fenêtres)
const syncChannel = typeof window !== 'undefined' && 'BroadcastChannel' in window
  ? new BroadcastChannel('glucoscan_sync_bus')
  : null;

function notifyCrossTab(msg = {}) {
  try {
    if (syncChannel) {
      syncChannel.postMessage(msg);
    }
  } catch (_) {}
}

/** Retire les métadonnées de synchro d'un objet de réglages */
function stripMeta(settings) {
  const out = { ...(settings || {}) };
  delete out[META_DELETED_IDS];
  delete out[META_SETTINGS_UPDATED_AT];
  return out;
}

/** Réglages comparables / publiables (sans méta ni clés locales) */
function cloudSafeSettings(settings) {
  const out = stripMeta(settings);
  for (const k of LOCAL_ONLY_SETTINGS) delete out[k];
  return out;
}

function stableJSON(obj) {
  const o = obj || {};
  return JSON.stringify(Object.keys(o).sort().reduce((acc, k) => { acc[k] = o[k]; return acc; }, {}));
}

function toTime(v) {
  const t = typeof v === 'number' ? v : Date.parse(v || 0);
  return Number.isFinite(t) ? t : 0;
}

const SUPABASE_REST_URL = 'https://plrqzuwbnuryxtsmimyt.supabase.co/rest/v1';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBscnF6dXdibnVyeXh0c21pbXl0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI0Mzk2OTcsImV4cCI6MjEwODAxNTY5N30.Wzx1Lsh1GGETK_RidTTND1t4Ix3EjhS3qQvlGn-Xglc';

async function sha256(str) {
  try {
    const buffer = new TextEncoder().encode(str);
    const hash = await crypto.subtle.digest('SHA-256', buffer);
    return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
  } catch (_) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) - hash) + str.charCodeAt(i);
      hash |= 0;
    }
    return 'h_' + Math.abs(hash);
  }
}

export const ProfileService = {
  activeProfile: null,

  async hashPassword(username, password) {
    const cleanUser = String(username || '').toLowerCase().trim();
    return sha256(`${cleanUser}:${password}:glucomaroc_salt_v2`);
  },

  async verifyPassword(username, password, storedHash) {
    const salted = await this.hashPassword(username, password);
    if (salted === storedHash) return true;
    const legacy = await sha256(password);
    return legacy === storedHash;
  },

  getDeletedMealIds() {
    try {
      const data = localStorage.getItem(STORAGE_KEY_DELETED);
      return new Set(data ? JSON.parse(data) : []);
    } catch (_) {
      return new Set();
    }
  },

  recordDeletedMeal(id) {
    if (!id) return;
    this.addDeletedMealIds([id]);
  },

  /** Fusionne des identifiants supprimés (tombstones) dans le stockage local */
  addDeletedMealIds(ids) {
    if (!Array.isArray(ids) || ids.length === 0) return;
    try {
      const list = [...this.getDeletedMealIds()];
      const set = new Set(list);
      for (const id of ids) {
        const k = String(id || '');
        if (k && !set.has(k)) {
          set.add(k);
          list.push(k);
        }
      }
      localStorage.setItem(STORAGE_KEY_DELETED, JSON.stringify(list.slice(-MAX_TOMBSTONES)));
    } catch (_) {}
  },

  init() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY_ACTIVE);
      if (saved) {
        this.activeProfile = JSON.parse(saved);
      }
    } catch (_) {
      this.activeProfile = null;
    }

    // Envoi immédiat d'une synchro en attente si l'onglet passe en arrière-plan / se ferme
    if (!this._visibilityBound && typeof document !== 'undefined') {
      this._visibilityBound = true;
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') this.flushPendingSync();
      });
    }
    return this.activeProfile;
  },

  getAllProfiles() {
    try {
      const data = localStorage.getItem(STORAGE_KEY_PROFILES);
      return data ? JSON.parse(data) : {};
    } catch (_) {
      return {};
    }
  },

  isLoggedIn() {
    return Boolean(this.activeProfile && this.activeProfile.username);
  },

  getActiveProfile() {
    return this.activeProfile;
  },

  /**
   * Fusion intelligente des repas locaux et distants (déduplication par ID/timestamp, tri antéchronologique)
   * Élimine les repas supprimés localement (Tombstones) pour éviter le problème des "repas zombies".
   */
  mergeHistories(localHist, cloudHist) {
    const deletedIds = this.getDeletedMealIds();
    const map = new Map();
    const all = [...(cloudHist || []), ...(localHist || [])];
    for (const item of all) {
      if (!item) continue;
      const key = String(item.id || item.timestamp || '');
      if (!key || deletedIds.has(key)) continue;
      if (!map.has(key)) {
        map.set(key, item);
      } else {
        const existing = map.get(key);
        // Si l'un des deux a la photo miniature et l'autre non, conserver la photo
        if (!existing.imageUrl && item.imageUrl) {
          map.set(key, item);
        }
      }
    }
    return Array.from(map.values()).sort((a, b) => {
      const tA = new Date(a.timestamp || 0).getTime();
      const tB = new Date(b.timestamp || 0).getTime();
      return tB - tA;
    }).slice(0, 150);
  },

  /**
   * Requête REST Supabase distinguant « compte absent » et « erreur réseau ».
   * @returns {Promise<{ok: boolean, account: object|null, error?: string}>}
   */
  async fetchCloudAccountSafe(username) {
    if (!username) return { ok: false, account: null, error: 'Pseudo manquant' };
    const clean = String(username).toLowerCase().trim();
    try {
      const res = await fetch(`${SUPABASE_REST_URL}/app_accounts?username=eq.${encodeURIComponent(clean)}&select=*`, {
        method: 'GET',
        headers: {
          'apikey': SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
        }
      });
      if (!res.ok) return { ok: false, account: null, error: `HTTP ${res.status}` };
      const list = await res.json();
      return { ok: true, account: Array.isArray(list) ? (list[0] || null) : null };
    } catch (e) {
      console.warn('Erreur lecture Cloud Supabase:', e);
      return { ok: false, account: null, error: e.message || 'Réseau indisponible' };
    }
  },

  /**
   * Requête directe REST vers Supabase pour récupérer le compte utilisateur
   * (compatibilité : retourne null en cas d'absence OU d'erreur)
   */
  async fetchAccountFromCloud(username) {
    const res = await this.fetchCloudAccountSafe(username);
    return res.account;
  },

  /**
   * Requête directe REST vers Supabase pour enregistrer/mettre à jour le compte utilisateur
   */
  async upsertAccountToCloud(record) {
    if (!record || !record.username) return { success: false, error: 'Compte invalide' };
    const bodyStr = JSON.stringify(record);
    const useKeepalive = typeof bodyStr === 'string' && bodyStr.length < 60000;
    try {
      let res;
      try {
        res = await fetch(`${SUPABASE_REST_URL}/app_accounts?on_conflict=username`, {
          method: 'POST',
          headers: {
            'apikey': SUPABASE_ANON_KEY,
            'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
            'Content-Type': 'application/json',
            'Prefer': 'resolution=merge-duplicates'
          },
          body: bodyStr,
          keepalive: useKeepalive
        });
      } catch (keepaliveErr) {
        if (useKeepalive) {
          res = await fetch(`${SUPABASE_REST_URL}/app_accounts?on_conflict=username`, {
            method: 'POST',
            headers: {
              'apikey': SUPABASE_ANON_KEY,
              'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
              'Content-Type': 'application/json',
              'Prefer': 'resolution=merge-duplicates'
            },
            body: bodyStr
          });
        } else {
          throw keepaliveErr;
        }
      }
      if (!res.ok) {
        const txt = await res.text();
        return { success: false, error: `HTTP ${res.status}: ${txt}` };
      }
      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  },

  /**
   * Applique des réglages au profil local et horodate uniquement s'ils ont réellement changé.
   */
  applyLocalSettings(profile, settings) {
    if (!profile || !settings) return;
    const next = stripMeta(settings);
    const changed = stableJSON(cloudSafeSettings(next)) !== stableJSON(cloudSafeSettings(profile.settings));
    profile.settings = next;
    if (changed || !profile.settingsUpdatedAt) {
      profile.settingsUpdatedAt = changed ? new Date().toISOString() : (profile.settingsUpdatedAt || new Date(0).toISOString());
    }
  },

  /**
   * Résolution déterministe des réglages local ⇄ Cloud : le plus récent gagne (last-write-wins).
   * Les clés locales (ex: geminiKey) sont toujours conservées depuis l'appareil.
   */
  resolveSettings(profile, cloudAccount) {
    const localSettings = stripMeta(profile?.settings || {});
    const localTs = toTime(profile?.settingsUpdatedAt);
    const cloudRaw = cloudAccount?.settings || {};
    const cloudSettings = cloudSafeSettings(cloudRaw);
    const cloudTs = toTime(cloudRaw[META_SETTINGS_UPDATED_AT]);

    let settings;
    let source;
    if (localTs > cloudTs) {
      settings = { ...cloudSettings, ...localSettings };
      source = 'local';
    } else {
      settings = { ...localSettings, ...cloudSettings };
      for (const k of LOCAL_ONLY_SETTINGS) {
        if (localSettings[k] !== undefined) settings[k] = localSettings[k];
      }
      source = 'cloud';
    }

    const mode = (source === 'local'
      ? (settings.userMode || profile?.mode || cloudAccount?.user_mode)
      : (cloudAccount?.user_mode || settings.userMode || profile?.mode)) || 'sport';
    settings.userMode = mode;

    return {
      settings,
      mode,
      updatedAt: new Date(Math.max(localTs, cloudTs)).toISOString()
    };
  },

  /**
   * Fusion complète (tombstones + historique + réglages) entre un profil local et le compte Cloud.
   * Ne modifie pas le stockage ; retourne le profil fusionné.
   */
  mergeWithCloud(profile, cloudAccount) {
    if (cloudAccount) {
      const cloudDeleted = cloudAccount.settings?.[META_DELETED_IDS];
      if (Array.isArray(cloudDeleted)) this.addDeletedMealIds(cloudDeleted);
    }
    const history = this.mergeHistories(profile?.history || [], cloudAccount?.history || []);
    if (!cloudAccount) {
      return { history, settings: stripMeta(profile?.settings || {}), mode: profile?.mode || 'sport', updatedAt: profile?.settingsUpdatedAt || new Date(0).toISOString() };
    }
    const resolved = this.resolveSettings(profile, cloudAccount);
    return { history, ...resolved };
  },

  /** Construit l'enregistrement Cloud (réglages publiables + méta de synchro) */
  buildCloudRecord(key, profile) {
    return {
      username: key,
      display_name: profile.username,
      password_hash: profile.passwordHash,
      user_mode: profile.mode || 'sport',
      settings: {
        ...cloudSafeSettings(profile.settings),
        [META_SETTINGS_UPDATED_AT]: profile.settingsUpdatedAt || new Date(0).toISOString(),
        [META_DELETED_IDS]: [...this.getDeletedMealIds()].slice(-MAX_TOMBSTONES)
      },
      history: profile.history || [],
      updated_at: new Date().toISOString()
    };
  },

  /**
   * Inscription d'un nouveau profil avec sauvegarde locale et Cloud
   */
  async register(username, password, mode = 'sport', currentSettings = null, currentHistory = []) {
    const cleanUser = String(username || '').trim();
    if (cleanUser.length < 2) {
      throw new Error('Le pseudo doit contenir au moins 2 caractères');
    }
    if (!password || password.length < 4) {
      throw new Error('Le mot de passe doit comporter au moins 4 caractères');
    }

    const key = cleanUser.toLowerCase();
    const profiles = this.getAllProfiles();

    // Vérifier si le profil existe déjà localement ou sur le Cloud
    const cloudRes = await this.fetchCloudAccountSafe(key);
    if (profiles[key] || cloudRes.account) {
      throw new Error(`Le profil "${cleanUser}" existe déjà. Veuillez vous connecter pour synchroniser vos données.`);
    }
    if (!cloudRes.ok && typeof navigator !== 'undefined' && navigator.onLine) {
      throw new Error(`Impossible de vérifier l'unicité du profil (${cloudRes.error || 'erreur réseau'}). Vérifiez votre connexion.`);
    }

    const passwordHash = await this.hashPassword(cleanUser, password);
    const safeMode = 'sport';
    const newProfile = {
      id: 'usr_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
      username: cleanUser,
      passwordHash,
      mode: safeMode,
      settings: currentSettings ? { ...stripMeta(currentSettings), userMode: safeMode } : { userMode: safeMode },
      settingsUpdatedAt: new Date().toISOString(),
      history: this.mergeHistories(Array.isArray(currentHistory) ? currentHistory : [], []),
      createdAt: new Date().toISOString(),
      lastLogin: new Date().toISOString()
    };

    profiles[key] = newProfile;
    localStorage.setItem(STORAGE_KEY_PROFILES, JSON.stringify(profiles));

    this.activeProfile = {
      id: newProfile.id,
      username: newProfile.username,
      mode: newProfile.mode,
      createdAt: newProfile.createdAt
    };
    localStorage.setItem(STORAGE_KEY_ACTIVE, JSON.stringify(this.activeProfile));

    // Sauvegarde immédiate dans le Cloud Supabase
    await this.upsertAccountToCloud(this.buildCloudRecord(key, newProfile));

    return newProfile;
  },

  /**
   * Connexion à un profil existant avec synchronisation Cloud prioritaire (Mobile ⇄ PC)
   */
  async login(username, password) {
    const cleanUser = String(username || '').trim();
    if (!cleanUser) throw new Error('Veuillez saisir votre pseudo');
    if (!password) throw new Error('Veuillez saisir votre mot de passe');

    const key = cleanUser.toLowerCase();

    // Vérification auprès du Cloud Supabase en priorité pour récupérer les repas pris sur un autre appareil
    const cloudRes = await this.fetchCloudAccountSafe(key);
    const cloudAccount = cloudRes.account;

    // Relecture du stockage local APRÈS l'appel réseau (évite d'écraser une écriture concurrente)
    const profiles = this.getAllProfiles();
    let profile = profiles[key];

    if (cloudAccount) {
      const isCloudMatch = await this.verifyPassword(cleanUser, password, cloudAccount.password_hash);
      if (!isCloudMatch) {
        throw new Error('Mot de passe incorrect pour ce profil.');
      }

      const merged = this.mergeWithCloud(profile, cloudAccount);

      profile = {
        id: profile?.id || ('usr_' + Date.now()),
        username: cloudAccount.display_name || cleanUser,
        passwordHash: cloudAccount.password_hash,
        mode: merged.mode,
        settings: merged.settings,
        settingsUpdatedAt: merged.updatedAt,
        history: merged.history,
        createdAt: cloudAccount.created_at || profile?.createdAt || new Date().toISOString(),
        lastLogin: new Date().toISOString()
      };

      profiles[key] = profile;
      localStorage.setItem(STORAGE_KEY_PROFILES, JSON.stringify(profiles));
    } else {
      // Si pas de compte Cloud (ou Cloud injoignable), vérifier localement
      if (!profile) {
        throw new Error(cloudRes.ok
          ? `Aucun profil trouvé pour "${cleanUser}". Créez-le en cliquant sur "Nouveau profil".`
          : `Cloud injoignable et aucun profil local pour "${cleanUser}". Vérifiez votre connexion.`);
      }
      const isLocalMatch = await this.verifyPassword(cleanUser, password, profile.passwordHash);
      if (!isLocalMatch) {
        throw new Error('Mot de passe incorrect pour ce profil.');
      }
      profile.lastLogin = new Date().toISOString();
      profile.history = this.mergeHistories(profile.history || [], []);
      profiles[key] = profile;
      localStorage.setItem(STORAGE_KEY_PROFILES, JSON.stringify(profiles));
    }

    this.activeProfile = {
      id: profile.id,
      username: profile.username,
      mode: profile.mode || 'sport',
      createdAt: profile.createdAt
    };
    localStorage.setItem(STORAGE_KEY_ACTIVE, JSON.stringify(this.activeProfile));

    return profile;
  },

  /**
   * Sauvegarde locale immédiate du profil actif + synchronisation Cloud différée (debounce)
   * pour éviter les écritures concurrentes qui s'écrasent mutuellement.
   */
  saveProfileData(settings, history) {
    if (!this.isLoggedIn()) return;
    const key = this.activeProfile.username.toLowerCase();
    const profiles = this.getAllProfiles();
    if (profiles[key]) {
      if (settings) {
        this.applyLocalSettings(profiles[key], settings);
        if (settings.userMode) {
          profiles[key].mode = settings.userMode;
          this.activeProfile.mode = settings.userMode;
          localStorage.setItem(STORAGE_KEY_ACTIVE, JSON.stringify(this.activeProfile));
        }
      }
      if (Array.isArray(history)) {
        profiles[key].history = history;
      }
      localStorage.setItem(STORAGE_KEY_PROFILES, JSON.stringify(profiles));

      notifyCrossTab({ source: 'local_save', timestamp: Date.now() });
      this.scheduleSync();
    }
  },

  /** Programme une synchronisation Cloud groupée (debounce) */
  scheduleSync() {
    if (this._syncTimer) clearTimeout(this._syncTimer);
    this._syncTimer = setTimeout(() => {
      this._syncTimer = null;
      this.syncToCloud().catch(() => {});
    }, SYNC_DEBOUNCE_MS);
  },

  /** Déclenche immédiatement une synchro en attente (fermeture d'onglet, etc.) */
  flushPendingSync() {
    if (!this._syncTimer) return;
    clearTimeout(this._syncTimer);
    this._syncTimer = null;
    this.syncToCloud().catch(() => {});
  },

  /**
   * Envoi et fusion bidirectionnelle avec le Cloud Supabase.
   * Les appels sont sérialisés (file d'attente) : jamais deux synchros en parallèle.
   */
  syncToCloud(explicitSettings = null, explicitHistory = null) {
    if (this._syncTimer) {
      clearTimeout(this._syncTimer);
      this._syncTimer = null;
    }
    const run = () => this._doSyncToCloud(explicitSettings, explicitHistory);
    this._syncChain = (this._syncChain || Promise.resolve()).then(run, run);
    return this._syncChain;
  },

  async _doSyncToCloud(explicitSettings = null, explicitHistory = null) {
    if (!this.isLoggedIn()) return { success: false, error: 'Non connecté' };
    const key = this.activeProfile.username.toLowerCase();

    // Appliquer d'abord les données explicites au profil local
    if (explicitSettings || Array.isArray(explicitHistory)) {
      const pre = this.getAllProfiles();
      if (pre[key]) {
        if (explicitSettings) this.applyLocalSettings(pre[key], explicitSettings);
        if (Array.isArray(explicitHistory)) pre[key].history = explicitHistory;
        localStorage.setItem(STORAGE_KEY_PROFILES, JSON.stringify(pre));
      }
    }

    // 1. Lire l'état Cloud. En cas d'erreur réseau : NE PAS écraser le Cloud avec les seules données locales.
    const cloudRes = await this.fetchCloudAccountSafe(key);
    if (!cloudRes.ok) {
      return { success: false, error: `Cloud injoignable (${cloudRes.error || 'erreur'}). Données conservées localement.` };
    }

    // 2. Relire le profil local APRÈS l'appel réseau (prend en compte les modifications faites entre-temps)
    const profiles = this.getAllProfiles();
    const profile = profiles[key];
    if (!profile) return { success: false, error: 'Profil introuvable' };

    // Garde-fou sécurité : ne pas synchroniser si le mot de passe distant ne correspond pas
    if (cloudRes.account && cloudRes.account.password_hash) {
      if (cloudRes.account.password_hash !== profile.passwordHash) {
        return {
          success: false,
          error: 'Conflit de compte Cloud : le mot de passe ne correspond pas au compte distant.'
        };
      }
    }

    const merged = this.mergeWithCloud(profile, cloudRes.account);
    profile.history = merged.history;
    profile.settings = merged.settings;
    profile.settingsUpdatedAt = merged.updatedAt;
    profile.mode = merged.mode;
    profiles[key] = profile;
    localStorage.setItem(STORAGE_KEY_PROFILES, JSON.stringify(profiles));

    // 3. Envoyer le paquet fusionné (avec tombstones) vers Supabase
    const res = await this.upsertAccountToCloud(this.buildCloudRecord(key, profile));
    if (!res.success) {
      return res;
    }

    const payload = {
      success: true,
      count: merged.history.length,
      history: merged.history,
      settings: merged.settings,
      mode: merged.mode
    };
    this._notifyListeners({ source: 'cloud_sync', ...payload });
    notifyCrossTab({ source: 'cloud_sync', timestamp: Date.now() });

    return payload;
  },

  _syncListeners: new Set(),
  _lastPullTime: 0,

  /** Enregistre un observateur appelé lors de toute mise à jour Cloud ou inter-onglets */
  onSyncUpdate(callback) {
    if (typeof callback === 'function') {
      this._syncListeners.add(callback);
      return () => this._syncListeners.delete(callback);
    }
    return () => {};
  },

  _notifyListeners(data) {
    this._syncListeners.forEach(cb => {
      try { cb(data); } catch (_) {}
    });
  },

  /** Récupération Cloud avec protection anti-spam (4s min entre 2 requêtes) */
  async pullFromCloudThrottled(minIntervalMs = 4000) {
    const now = Date.now();
    if (now - this._lastPullTime < minIntervalMs) {
      return { success: true, throttled: true };
    }
    this._lastPullTime = now;
    return this.pullFromCloud();
  },

  /**
   * Récupération automatique des dernières données du Cloud Supabase (Mobile ⇄ PC)
   */
  async pullFromCloud() {
    if (!this.isLoggedIn()) return { success: false, error: 'Non connecté' };
    const key = this.activeProfile.username.toLowerCase();

    const cloudRes = await this.fetchCloudAccountSafe(key);
    if (!cloudRes.ok) return { success: false, error: cloudRes.error || 'Cloud injoignable' };
    if (!cloudRes.account) return { success: false, error: 'Aucun compte distant' };

    // Relecture locale après l'appel réseau
    const profiles = this.getAllProfiles();
    const profile = profiles[key];
    if (!profile) return { success: false, error: 'Profil introuvable' };

    const merged = this.mergeWithCloud(profile, cloudRes.account);
    profile.history = merged.history;
    profile.settings = merged.settings;
    profile.settingsUpdatedAt = merged.updatedAt;
    profile.mode = merged.mode;
    profiles[key] = profile;
    localStorage.setItem(STORAGE_KEY_PROFILES, JSON.stringify(profiles));

    // Propager vers le Cloud les éléments uniquement locaux (repas hors-ligne, suppressions, réglages récents)
    this.scheduleSync();

    const payload = {
      success: true,
      updated: true,
      count: merged.history.length,
      history: merged.history,
      settings: merged.settings,
      mode: merged.mode
    };
    this._notifyListeners({ source: 'cloud_pull', ...payload });
    notifyCrossTab({ source: 'cloud_pull', timestamp: Date.now() });

    return payload;
  },

  getProfileData() {
    if (!this.isLoggedIn()) return null;
    const key = this.activeProfile.username.toLowerCase();
    const profiles = this.getAllProfiles();
    return profiles[key] || null;
  },

  logout() {
    // Envoyer la synchro en attente AVANT de quitter le profil (la vérification de connexion
    // de _doSyncToCloud est synchrone, la clé du profil est donc capturée avant la déconnexion)
    if (this._syncTimer) {
      clearTimeout(this._syncTimer);
      this._syncTimer = null;
      this._doSyncToCloud().catch(() => {});
    }
    this.activeProfile = null;
    localStorage.removeItem(STORAGE_KEY_ACTIVE);
  }
};

if (syncChannel) {
  syncChannel.onmessage = (ev) => {
    if (ev && ev.data && ProfileService.isLoggedIn()) {
      const activeRecord = ProfileService.getProfileData();
      if (activeRecord) {
        ProfileService._notifyListeners({
          source: 'crosstab',
          history: activeRecord.history || [],
          settings: activeRecord.settings || {},
          mode: activeRecord.mode || 'sport'
        });
      }
    }
  };
}

ProfileService.init();
