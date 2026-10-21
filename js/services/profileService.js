/**
 * Service de Gestion des Profils Utilisateurs (Sans Email)
 * Inspiré du modèle "Workout Home" : Pseudo + Mot de passe
 * Fonctionne 100% hors-ligne (Local-First) avec synchronisation Cloud Supabase bidirectionnelle (Mobile ⇄ PC).
 */

const STORAGE_KEY_PROFILES = 'glucoscan_profiles_db_v1';
const STORAGE_KEY_ACTIVE = 'glucoscan_active_profile_v1';
const STORAGE_KEY_DELETED = 'glucoscan_deleted_meals_v1';

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
    try {
      const set = this.getDeletedMealIds();
      set.add(String(id));
      localStorage.setItem(STORAGE_KEY_DELETED, JSON.stringify([...set].slice(-300)));
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
   * Requête directe REST vers Supabase pour récupérer le compte utilisateur
   */
  async fetchAccountFromCloud(username) {
    if (!username) return null;
    const clean = String(username).toLowerCase().trim();
    try {
      const res = await fetch(`${SUPABASE_REST_URL}/app_accounts?username=eq.${encodeURIComponent(clean)}&select=*`, {
        method: 'GET',
        headers: {
          'apikey': SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
        }
      });
      if (!res.ok) return null;
      const list = await res.json();
      return Array.isArray(list) ? (list[0] || null) : null;
    } catch (e) {
      console.warn('Erreur lecture Cloud Supabase:', e);
      return null;
    }
  },

  /**
   * Requête directe REST vers Supabase pour enregistrer/mettre à jour le compte utilisateur
   */
  async upsertAccountToCloud(record) {
    if (!record || !record.username) return { success: false, error: 'Compte invalide' };
    try {
      const res = await fetch(`${SUPABASE_REST_URL}/app_accounts?on_conflict=username`, {
        method: 'POST',
        headers: {
          'apikey': SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
          'Content-Type': 'application/json',
          'Prefer': 'resolution=merge-duplicates'
        },
        body: JSON.stringify(record)
      });
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
   * Inscription d'un nouveau profil avec sauvegarde locale et Cloud
   */
  async register(username, password, mode = 'insulin', currentSettings = null, currentHistory = []) {
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
    const cloudAccount = await this.fetchAccountFromCloud(key);
    if (profiles[key] || cloudAccount) {
      throw new Error(`Le profil "${cleanUser}" existe déjà. Veuillez vous connecter pour synchroniser vos données.`);
    }

    const passwordHash = await this.hashPassword(cleanUser, password);
    const newProfile = {
      id: 'usr_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
      username: cleanUser,
      passwordHash,
      mode: mode === 'wellness' ? 'wellness' : 'insulin',
      settings: currentSettings ? { ...currentSettings, userMode: mode } : null,
      history: Array.isArray(currentHistory) ? currentHistory : [],
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
    await this.upsertAccountToCloud({
      username: key,
      display_name: cleanUser,
      password_hash: passwordHash,
      user_mode: newProfile.mode,
      settings: newProfile.settings || {},
      history: newProfile.history || [],
      updated_at: new Date().toISOString()
    });

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
    const profiles = this.getAllProfiles();
    let profile = profiles[key];

    // Vérification auprès du Cloud Supabase en priorité pour récupérer les repas pris sur un autre appareil
    const cloudAccount = await this.fetchAccountFromCloud(key);

    if (cloudAccount) {
      const isCloudMatch = await this.verifyPassword(cleanUser, password, cloudAccount.password_hash);
      if (!isCloudMatch) {
        throw new Error('Mot de passe incorrect pour ce profil.');
      }

      // Fusionner les données locales et cloud (prend le dessus sur le profil local ancien)
      const mergedHistory = this.mergeHistories(profile?.history || [], cloudAccount.history || []);
      const mergedSettings = { ...(profile?.settings || {}), ...(cloudAccount.settings || {}) };
      const mode = cloudAccount.user_mode || profile?.mode || 'insulin';

      profile = {
        id: profile?.id || ('usr_' + Date.now()),
        username: cloudAccount.display_name || cleanUser,
        passwordHash: cloudAccount.password_hash,
        mode,
        settings: mergedSettings,
        history: mergedHistory,
        createdAt: cloudAccount.created_at || profile?.createdAt || new Date().toISOString(),
        lastLogin: new Date().toISOString()
      };

      profiles[key] = profile;
      localStorage.setItem(STORAGE_KEY_PROFILES, JSON.stringify(profiles));
    } else {
      // Si pas de connexion Cloud, vérifier localement
      if (!profile) {
        throw new Error(`Aucun profil trouvé pour "${cleanUser}". Créez-le en cliquant sur "Nouveau profil".`);
      }
      const isLocalMatch = await this.verifyPassword(cleanUser, password, profile.passwordHash);
      if (!isLocalMatch) {
        throw new Error('Mot de passe incorrect pour ce profil.');
      }
      profile.lastLogin = new Date().toISOString();
      profiles[key] = profile;
      localStorage.setItem(STORAGE_KEY_PROFILES, JSON.stringify(profiles));
    }

    this.activeProfile = {
      id: profile.id,
      username: profile.username,
      mode: profile.mode || 'insulin',
      createdAt: profile.createdAt
    };
    localStorage.setItem(STORAGE_KEY_ACTIVE, JSON.stringify(this.activeProfile));

    return profile;
  },

  /**
   * Sauvegarde les données du profil actif et déclenche la synchronisation Cloud
   */
  saveProfileData(settings, history) {
    if (!this.isLoggedIn()) return;
    const key = this.activeProfile.username.toLowerCase();
    const profiles = this.getAllProfiles();
    if (profiles[key]) {
      if (settings) {
        profiles[key].settings = { ...settings };
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

      // Synchronisation Cloud automatique en arrière-plan
      this.syncToCloud(settings, history).catch(() => {});
    }
  },

  /**
   * Envoi et fusion bidirectionnelle avec le Cloud Supabase
   */
  async syncToCloud(explicitSettings = null, explicitHistory = null) {
    if (!this.isLoggedIn()) return { success: false, error: 'Non connecté' };

    const key = this.activeProfile.username.toLowerCase();
    const profiles = this.getAllProfiles();
    const profile = profiles[key];
    if (!profile) return { success: false, error: 'Profil introuvable' };

    const settingsToSave = explicitSettings || profile.settings || {};
    const historyToSave = Array.isArray(explicitHistory) ? explicitHistory : (profile.history || []);

    // 1. Récupérer l'état actuel du Cloud pour fusionner sans écraser les repas d'un autre appareil
    const cloudAccount = await this.fetchAccountFromCloud(key);
    let finalHistory = historyToSave;
    let finalSettings = settingsToSave;
    let finalMode = profile.mode || 'insulin';

    if (cloudAccount) {
      finalHistory = this.mergeHistories(historyToSave, cloudAccount.history || []);
      finalSettings = { ...(cloudAccount.settings || {}), ...settingsToSave };
      if (cloudAccount.user_mode && !explicitSettings?.userMode) {
        finalMode = cloudAccount.user_mode;
      }
    }

    // 2. Mettre à jour le profil local
    profile.history = finalHistory;
    profile.settings = finalSettings;
    profile.mode = finalMode;
    profiles[key] = profile;
    localStorage.setItem(STORAGE_KEY_PROFILES, JSON.stringify(profiles));

    // 3. Envoyer le paquet fusionné vers Supabase
    const record = {
      username: key,
      display_name: profile.username,
      password_hash: profile.passwordHash,
      user_mode: finalMode,
      settings: finalSettings,
      history: finalHistory,
      updated_at: new Date().toISOString()
    };

    const res = await this.upsertAccountToCloud(record);
    if (!res.success) {
      return res;
    }

    return {
      success: true,
      count: finalHistory.length,
      history: finalHistory,
      settings: finalSettings,
      mode: finalMode
    };
  },

  /**
   * Récupération automatique des dernières données du Cloud Supabase (Mobile ⇄ PC)
   */
  async pullFromCloud() {
    if (!this.isLoggedIn()) return { success: false, error: 'Non connecté' };

    const key = this.activeProfile.username.toLowerCase();
    const profiles = this.getAllProfiles();
    const profile = profiles[key];
    if (!profile) return { success: false, error: 'Profil introuvable' };

    const cloudAccount = await this.fetchAccountFromCloud(key);
    if (!cloudAccount) return { success: false, error: 'Aucun compte distant' };

    const mergedHistory = this.mergeHistories(profile.history || [], cloudAccount.history || []);
    const mergedSettings = { ...(profile.settings || {}), ...(cloudAccount.settings || {}) };
    const mode = cloudAccount.user_mode || profile.mode || 'insulin';

    profile.history = mergedHistory;
    profile.settings = mergedSettings;
    profile.mode = mode;
    profiles[key] = profile;
    localStorage.setItem(STORAGE_KEY_PROFILES, JSON.stringify(profiles));

    return {
      success: true,
      updated: true,
      count: mergedHistory.length,
      history: mergedHistory,
      settings: mergedSettings,
      mode
    };
  },

  getProfileData() {
    if (!this.isLoggedIn()) return null;
    const key = this.activeProfile.username.toLowerCase();
    const profiles = this.getAllProfiles();
    return profiles[key] || null;
  },

  logout() {
    this.activeProfile = null;
    localStorage.removeItem(STORAGE_KEY_ACTIVE);
  }
};

ProfileService.init();
