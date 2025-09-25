/**
 * Chrome storage wrapper with schema validation
 */

const STORAGE_KEYS = {
  SETTINGS: 'settings',
  USAGE_TODAY: 'usageToday',
  FLAGS: 'flags'
};

const DEFAULT_SETTINGS = {
  dailyLimitMin: 30,
  resetHourLocal: 4,
  mode: 'softlock',
  allowSnooze: true,
  theme: 'system',
  tone: 'classic',
  passcodeHash: null,
  cooldownMin: 5,
  enabled: false,
  overlayCustomization: {
    enabled: false,
    customMessage: '',
    customImage: null,
    template: 'default'
  }
};

const DEFAULT_USAGE = {
  millisActive: 0,
  lastTickAt: Date.now(),
  dateKey: getDateKey()
};

const DEFAULT_FLAGS = {
  nudged: false,
  locked: false,
  pausedToday: false,
  
  snoozed: false, 
  snoozeUsedToday: false, 
};

function getDateKey() {
  return new Date().toISOString().split('T')[0]; 
}

class StorageManager {
  constructor() {
    this.cache = new Map();
    this.backoffUntil = 0; 
    this.pending = new Map(); 
    this.flushTimer = null;
  }

  scheduleFlush(delayMs = 2000) {
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(async () => {
      this.flushTimer = null;
      const now = Date.now();
      if (now < this.backoffUntil) {
        this.scheduleFlush(this.backoffUntil - now + 50);
        return;
      }
      const entries = Array.from(this.pending.entries());
      this.pending.clear();
      for (const [key, value] of entries) {
        try {
          await chrome.storage.local.set({ [key]: value });
          this.cache.set(key, value);
        } catch (err) {
          
          this.backoffUntil = Date.now() + 5000;
          const existing = this.pending.get(key) || {};
          this.pending.set(key, { ...existing, ...value });
          this.scheduleFlush(5000);
        }
      }
    }, delayMs);
  }

  async get(key) {
    if (this.cache.has(key)) {
      return this.cache.get(key);
    }

    const result = await chrome.storage.local.get(key);
    const value = result[key];
    
    
    if (value === undefined) {
      let defaultValue;
      switch (key) {
        case STORAGE_KEYS.SETTINGS:
          defaultValue = DEFAULT_SETTINGS;
          break;
        case STORAGE_KEYS.USAGE_TODAY:
          defaultValue = DEFAULT_USAGE;
          break;
        case STORAGE_KEYS.FLAGS:
          defaultValue = DEFAULT_FLAGS;
          break;
        default:
          defaultValue = null;
      }
      
      await this.set(key, defaultValue);
      this.cache.set(key, defaultValue);
      return defaultValue;
    }

    this.cache.set(key, value);
    return value;
  }

  async set(key, value) {
    const now = Date.now();
    if (now < this.backoffUntil) {
      const existing = this.pending.get(key) || {};
      this.pending.set(key, { ...existing, ...value });
      this.cache.set(key, { ...(this.cache.get(key) || {}), ...value });
      this.scheduleFlush(this.backoffUntil - now + 50);
      return;
    }
    try {
      await chrome.storage.local.set({ [key]: value });
      this.cache.set(key, value);
    } catch (err) {
      
      this.backoffUntil = Date.now() + 5000;
      const existing = this.pending.get(key) || {};
      this.pending.set(key, { ...existing, ...value });
      this.cache.set(key, { ...(this.cache.get(key) || {}), ...value });
      this.scheduleFlush(5000);
    }
  }

  async update(key, updates) {
    
    let current = this.cache.get(key);
    
    
    if (!current) {
      const result = await chrome.storage.local.get(key);
      current = result[key];
      
      
      if (current === undefined) {
        let defaultValue;
        switch (key) {
          case STORAGE_KEYS.SETTINGS:
            defaultValue = DEFAULT_SETTINGS;
            break;
          case STORAGE_KEYS.USAGE_TODAY:
            defaultValue = DEFAULT_USAGE;
            break;
          case STORAGE_KEYS.FLAGS:
            defaultValue = DEFAULT_FLAGS;
            break;
          case STORAGE_KEYS.NOTIFICATIONS:
            defaultValue = DEFAULT_NOTIFICATIONS;
            break;
          default:
            defaultValue = null;
        }
        current = defaultValue;
      }
      
      this.cache.set(key, current);
    }
    
    const updated = { ...current, ...updates };
    const now = Date.now();
    if (now < this.backoffUntil) {
      const pendingExisting = this.pending.get(key) || {};
      const merged = { ...pendingExisting, ...updated };
      this.pending.set(key, merged);
      this.cache.set(key, updated);
      this.scheduleFlush(this.backoffUntil - now + 50);
      return updated;
    }

    try {
      await chrome.storage.local.set({ [key]: updated });
      this.cache.set(key, updated);
      return updated;
    } catch (err) {
      
      this.backoffUntil = Date.now() + 5000;
      const pendingExisting = this.pending.get(key) || {};
      const merged = { ...pendingExisting, ...updated };
      this.pending.set(key, merged);
      this.cache.set(key, updated);
      this.scheduleFlush(5000);
      return updated;
    }
  }

  async clear() {
    await chrome.storage.local.clear();
    this.cache.clear();
  }

  
  async getSettings() {
    return this.get(STORAGE_KEYS.SETTINGS);
  }

  async updateSettings(updates) {
    return this.update(STORAGE_KEYS.SETTINGS, updates);
  }

  async getUsageToday() {
    return this.get(STORAGE_KEYS.USAGE_TODAY);
  }

  async updateUsageToday(updates) {
    return this.update(STORAGE_KEYS.USAGE_TODAY, updates);
  }

  async getFlags() {
    return this.get(STORAGE_KEYS.FLAGS);
  }

  async updateFlags(updates) {
    return this.update(STORAGE_KEYS.FLAGS, updates);
  }

  
  async getCustomImage() {
    const result = await chrome.storage.local.get('customOverlayImage');
    return result.customOverlayImage || null;
  }

  async setCustomImage(imageData) {
    await chrome.storage.local.set({ customOverlayImage: imageData });
  }

  async clearCustomImage() {
    await chrome.storage.local.remove('customOverlayImage');
  }

  
  async checkDailyReset() {
    const usage = await this.getUsageToday();
    const currentDateKey = getDateKey();
    
    if (usage.dateKey !== currentDateKey) {
      console.log('📅 Daily reset detected - resetting usage');
      
      
      await this.set(STORAGE_KEYS.USAGE_TODAY, {
        ...DEFAULT_USAGE,
        dateKey: currentDateKey
      });
      await this.set(STORAGE_KEYS.FLAGS, {
        ...DEFAULT_FLAGS,
        snoozeUsedToday: false,
        snoozed: false,
        locked: false,
        nudged: false,
        pausedToday: false
      });
      
      
      if (typeof timekeeper !== 'undefined' && timekeeper) {
        timekeeper.currentUsageMs = 0;
        timekeeper.isInitialized = true;
        console.log('🔄 TimeKeeper usage reset for new day');
      }
      
      return true;
    }
    return false;
  }

  
  onChanged(callback) {
    chrome.storage.onChanged.addListener((changes, namespace) => {
      if (namespace === 'local') {
        Object.keys(changes).forEach(key => {
          this.cache.set(key, changes[key].newValue);
        });
        callback(changes, namespace);
      }
    });
  }
}


export const storage = new StorageManager();
export { STORAGE_KEYS, DEFAULT_SETTINGS, DEFAULT_USAGE, DEFAULT_FLAGS };
