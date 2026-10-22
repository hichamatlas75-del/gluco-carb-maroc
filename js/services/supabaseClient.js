/**
 * Service Supabase Client (Hybride Invité / Authentifié)
 * Projet: gluco scan maroc (plrqzuwbnuryxtsmimyt)
 */

const STORAGE_KEY_AUTH = 'glucoscan_supabase_auth_v1';
const STORAGE_KEY_CONFIG = 'glucoscan_supabase_config_v1';

const DEFAULT_SUPABASE_URL = 'https://plrqzuwbnuryxtsmimyt.supabase.co';
const DEFAULT_SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBscnF6dXdibnVyeXh0c21pbXl0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI0Mzk2OTcsImV4cCI6MjEwODAxNTY5N30.Wzx1Lsh1GGETK_RidTTND1t4Ix3EjhS3qQvlGn-Xglc';

let supabaseInstance = null;
let supabasePromise = null;

const MEAL_SLOT_TO_ENUM = {
  morning: 'matin',
  matin: 'matin',
  noon: 'midi',
  midi: 'midi',
  evening: 'soir',
  soir: 'soir',
  collation: 'collation'
};

export const SupabaseService = {
  config: {
    url: DEFAULT_SUPABASE_URL,
    anonKey: DEFAULT_SUPABASE_ANON
  },
  currentUser: null,
  session: null,

  init() {
    try {
      const savedConfig = localStorage.getItem(STORAGE_KEY_CONFIG);
      if (savedConfig) {
        const parsed = JSON.parse(savedConfig);
        if (parsed.url && parsed.anonKey) {
          this.config = parsed;
        }
      }
      const savedAuth = localStorage.getItem(STORAGE_KEY_AUTH);
      if (savedAuth) {
        const parsed = JSON.parse(savedAuth);
        this.currentUser = parsed.user || null;
        this.session = parsed.session || null;
      }
    } catch (_) {}

    this.createClientIfNeeded();
  },

  async createClientIfNeeded() {
    if (!this.config.url || !this.config.anonKey) return null;
    if (supabaseInstance) return supabaseInstance;
    if (supabasePromise) return supabasePromise;

    supabasePromise = (async () => {
      try {
        const clientOptions = {
          auth: {
            persistSession: true,
            autoRefreshToken: true,
            detectSessionInUrl: true,
            storage: window.localStorage
          }
        };

        if (window.supabase && window.supabase.createClient) {
          supabaseInstance = window.supabase.createClient(this.config.url, this.config.anonKey, clientOptions);
        } else {
          const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm');
          supabaseInstance = createClient(this.config.url, this.config.anonKey, clientOptions);
        }

        // Écouter les changements d'authentification
        supabaseInstance.auth.onAuthStateChange((event, session) => {
          if (session && session.user) {
            this.currentUser = session.user;
            this.session = session;
            localStorage.setItem(STORAGE_KEY_AUTH, JSON.stringify({ user: session.user, session }));
          } else if (event === 'SIGNED_OUT') {
            this.currentUser = null;
            this.session = null;
            localStorage.removeItem(STORAGE_KEY_AUTH);
          }
        });

        // Synchroniser la session existante
        const { data } = await supabaseInstance.auth.getSession();
        if (data?.session) {
          this.currentUser = data.session.user;
          this.session = data.session;
          localStorage.setItem(STORAGE_KEY_AUTH, JSON.stringify({ user: data.session.user, session: data.session }));
        }

        return supabaseInstance;
      } catch (e) {
        console.warn('Supabase SDK non chargé:', e);
        supabaseInstance = null;
        return null;
      } finally {
        supabasePromise = null;
      }
    })();

    return supabasePromise;
  },

  isConfigured() {
    return Boolean(this.config.url && this.config.anonKey);
  },

  isAuthenticated() {
    return Boolean(this.currentUser && this.session?.access_token);
  },

  getAccessToken() {
    return this.session?.access_token || null;
  },

  async signInWithMagicLink(email) {
    const client = await this.createClientIfNeeded();
    if (!client) throw new Error('Supabase non initialisé');

    const { error } = await client.auth.signInWithOtp({
      email: email.trim(),
      options: { 
        emailRedirectTo: window.location.origin,
        shouldCreateUser: true
      }
    });
    if (error) {
      if (error.status === 429 || error.message?.includes('rate limit')) {
        throw new Error('Limite Supabase atteinte (max 3 emails/heure par défaut). Utilisez la connexion avec mot de passe ou configurez SMTP.');
      }
      throw error;
    }
    return true;
  },

  async signInWithPassword(email, password) {
    const client = await this.createClientIfNeeded();
    if (!client) throw new Error('Supabase non initialisé');

    const { data, error } = await client.auth.signInWithPassword({
      email: email.trim(),
      password
    });
    if (error) throw error;
    if (data?.session) {
      this.currentUser = data.user;
      this.session = data.session;
      localStorage.setItem(STORAGE_KEY_AUTH, JSON.stringify({ user: data.user, session: data.session }));
    }
    return data;
  },

  async signUpWithPassword(email, password) {
    const client = await this.createClientIfNeeded();
    if (!client) throw new Error('Supabase non initialisé');

    const { data, error } = await client.auth.signUp({
      email: email.trim(),
      password
    });
    if (error) {
      if (error.status === 429 || error.message?.includes('rate limit')) {
        throw new Error('Limite email Supabase atteinte. Désactivez "Confirm email" dans Supabase > Auth > Providers > Email pour créer des comptes instantanés.');
      }
      throw error;
    }
    if (data?.session) {
      this.currentUser = data.user;
      this.session = data.session;
      localStorage.setItem(STORAGE_KEY_AUTH, JSON.stringify({ user: data.user, session: data.session }));
    }
    return data;
  },

  async verifyOtp(email, token) {
    const client = await this.createClientIfNeeded();
    if (!client) throw new Error('Supabase non initialisé');

    const { data, error } = await client.auth.verifyOtp({
      email: email.trim(),
      token: token.trim(),
      type: 'email'
    });
    if (error) throw error;
    if (data?.session) {
      this.currentUser = data.user;
      this.session = data.session;
      localStorage.setItem(STORAGE_KEY_AUTH, JSON.stringify({ user: data.user, session: data.session }));
    }
    return data;
  },

  async signInWithOAuth(provider = 'google') {
    const client = await this.createClientIfNeeded();
    if (!client) throw new Error('Supabase non initialisé');

    const { data, error } = await client.auth.signInWithOAuth({
      provider,
      options: { redirectTo: window.location.origin }
    });
    if (error) throw error;
    return data;
  },

  async signOut() {
    const client = await this.createClientIfNeeded();
    if (client) {
      try { await client.auth.signOut(); } catch (_) {}
    }
    this.currentUser = null;
    this.session = null;
    localStorage.removeItem(STORAGE_KEY_AUTH);
  },

  /**
   * Synchronise les repas du journal local (IndexedDB/LocalStorage) vers la table PostgreSQL Supabase
   */
  async syncLocalHistoryToCloud(localHistory) {
    if (!this.isAuthenticated()) return { synced: 0, error: 'Non authentifié' };
    const client = await this.createClientIfNeeded();
    if (!client || !Array.isArray(localHistory) || localHistory.length === 0) return { synced: 0 };

    let count = 0;
    for (const item of localHistory) {
      if (!item) continue;
      const mealRecord = {
        user_id: this.currentUser.id,
        meal_time: MEAL_SLOT_TO_ENUM[item.mealSlot] || 'midi',
        title: item.verdictTag || 'Repas scanné',
        portion_total_weight_g: item.totalGrams || 100,
        net_carbs_g: item.netCarbs || 0,
        proteins_g: item.totalProtein || 0,
        fibers_g: item.totalFiber || 0,
        glycemic_load: item.totalGL || 0,
        bolus_calculated: item.totalBolus || null,
        items: item.items || [],
        created_at: item.timestamp || new Date().toISOString()
      };

      const { error } = await client.from('meals').insert([mealRecord]);
      if (!error) count++;
    }

    return { synced: count };
  }
};

SupabaseService.init();
