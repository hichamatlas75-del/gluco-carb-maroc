/**
 * Service de persistance locale sécurisée et résiliente aux dépassements de quota (5 Mo).
 */
const memoryStore = {};

const isLocalStorageAvailable = (() => {
  try {
    const testKey = '__glucoscan_storage_test__';
    window.localStorage.setItem(testKey, '1');
    window.localStorage.removeItem(testKey);
    return true;
  } catch {
    return false;
  }
})();

function stripHeavyImagesFromData(data) {
  if (Array.isArray(data)) {
    return data.map((item, idx) => {
      // Conserver les images uniquement pour les 8 repas les plus récents
      if (idx >= 8 && item && item.imageUrl) {
        return { ...item, imageUrl: null };
      }
      return item;
    });
  }
  return data;
}

export const StorageService = {
  load(key, fallbackValue) {
    try {
      // Priorité à la copie mémoire : elle contient la dernière valeur si localStorage était plein
      const raw = Object.prototype.hasOwnProperty.call(memoryStore, key)
        ? memoryStore[key]
        : (isLocalStorageAvailable ? window.localStorage.getItem(key) : null);
      return raw ? JSON.parse(raw) : fallbackValue;
    } catch {
      return fallbackValue;
    }
  },

  save(key, value) {
    let payload = value;
    try {
      if (!isLocalStorageAvailable) {
        memoryStore[key] = JSON.stringify(payload);
        return;
      }

      try {
        window.localStorage.setItem(key, JSON.stringify(payload));
        delete memoryStore[key];
      } catch (quotaErr) {
        // En cas de dépassement de quota (QuotaExceededError), allègement automatique des images
        console.warn(`[StorageService] Quota warning sur ${key}. Allègement des images anciennes...`, quotaErr);
        payload = stripHeavyImagesFromData(payload);
        try {
          window.localStorage.setItem(key, JSON.stringify(payload));
        } catch (_) {
          // Si toujours plein, réduction de l'historique aux 50 éléments les plus récents
          if (Array.isArray(payload)) {
            payload = payload.slice(0, 50).map(it => ({ ...it, imageUrl: null }));
            window.localStorage.setItem(key, JSON.stringify(payload));
          } else {
            memoryStore[key] = JSON.stringify(value);
          }
        }
      }
    } catch {
      memoryStore[key] = JSON.stringify(value);
    }
  },

  exportJSONBackup(settings, history) {
    const payload = {
      app: 'GlucoScan Maroc',
      exportedAt: new Date().toISOString(),
      settings,
      history
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `glucoscan-maroc-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    // Révocation différée : une révocation immédiate peut annuler le téléchargement (Safari/Firefox)
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }
};
