/**
 * Service de persistance locale sécurisée (localStorage avec fallback mémoire)
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

export const StorageService = {
  load(key, fallbackValue) {
    try {
      const raw = isLocalStorageAvailable
        ? window.localStorage.getItem(key)
        : memoryStore[key];
      return raw ? JSON.parse(raw) : fallbackValue;
    } catch {
      return fallbackValue;
    }
  },

  save(key, value) {
    try {
      const serialized = JSON.stringify(value);
      if (isLocalStorageAvailable) {
        window.localStorage.setItem(key, serialized);
      } else {
        memoryStore[key] = serialized;
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
    URL.revokeObjectURL(url);
  }
};
