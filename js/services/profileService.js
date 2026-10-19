/**
 * Service de Gestion des Profils Utilisateurs (Sans Email)
 * Inspiré du modèle "Workout Home" : Pseudo + Mot de passe
 * Fonctionne 100% hors-ligne (Local-First) avec synchronisation Cloud Supabase optionnelle.
 */

const STORAGE_KEY_PROFILES = 'glucoscan_profiles_db_v1';
const STORAGE_KEY_ACTIVE = 'glucoscan_active_profile_v1';

async function sha256(str) {
  try {
    const buffer = new TextEncoder().encode(str);
    const hash = await crypto.subtle.digest('SHA-256', buffer);
    return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
  } catch (_) {
    // Fallback simple si crypto.subtle n'est pas disponible (ex: contexte non sécurisé)
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

    if (profiles[key]) {
      throw new Error(`Le profil "${cleanUser}" existe déjà. Veuillez vous connecter.`);
    }

    const passwordHash = await sha256(password);
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

    return newProfile;
  },

  async login(username, password) {
    const cleanUser = String(username || '').trim();
    if (!cleanUser) {
      throw new Error('Veuillez saisir votre pseudo');
    }
    if (!password) {
      throw new Error('Veuillez saisir votre mot de passe');
    }

    const key = cleanUser.toLowerCase();
    const profiles = this.getAllProfiles();
    const profile = profiles[key];

    if (!profile) {
      throw new Error(`Aucun profil trouvé pour "${cleanUser}". Créez-le en cliquant sur "Nouveau profil".`);
    }

    const passwordHash = await sha256(password);
    if (profile.passwordHash !== passwordHash) {
      throw new Error('Mot de passe incorrect pour ce profil.');
    }

    profile.lastLogin = new Date().toISOString();
    profiles[key] = profile;
    localStorage.setItem(STORAGE_KEY_PROFILES, JSON.stringify(profiles));

    this.activeProfile = {
      id: profile.id,
      username: profile.username,
      mode: profile.mode || 'insulin',
      createdAt: profile.createdAt
    };
    localStorage.setItem(STORAGE_KEY_ACTIVE, JSON.stringify(this.activeProfile));

    return profile;
  },

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
    }
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
