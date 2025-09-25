/**
 * Service Worker - Background logic for timing and rules
 * Note: ES6 imports are not supported in service workers, so we include the library code directly
 */

;(() => {
  const DISABLE_CONSOLE_LOGS = true
  if (DISABLE_CONSOLE_LOGS && typeof console !== 'undefined') {
    const originalLog = console.log
    const originalInfo = console.info
    const originalDebug = console.debug
    const originalTrace = console.trace

    const noop = function () {}
    console.log = noop
    console.info = noop
    console.debug = noop
    console.trace = noop
  }
})()
class RulesEngine {
  constructor() {
    this.twitterDomains = [
      'twitter.com',
      'x.com',
      'pro.x.com',
      'www.twitter.com',
      'www.x.com',
    ]
    this.mobileDomains = ['m.twitter.com', 'mobile.twitter.com', 'm.x.com']
  }

  getMessage(
    tone,
    type = 'limit',
    timeLeft = null,
    overlayCustomization = null
  ) {
    if (overlayCustomization && overlayCustomization.enabled) {
      if (
        overlayCustomization.template === 'custom' &&
        overlayCustomization.customMessage
      ) {
        return overlayCustomization.customMessage
      } else if (overlayCustomization.template === 'family') {
        return "That's enough Twitter for you daddy, go play with your kids"
      } else if (overlayCustomization.template === 'wife') {
        return 'Enough is enough, your wife will be mad'
      }
    }

    const timeLeftText = timeLeft ? this.formatTimeLeft(timeLeft) : 'time'

    const messages = {
      gentle: {
        limit: "Let's call it a day 🫶",
        nudge: `Just ${timeLeftText} left! Take a break?`,
        cooldown: 'Take a breather for a few minutes',
      },
      classic: {
        limit: "That's enough Twitter for today, mate.",
        nudge: `${timeLeftText} left • snooze once?`,
        cooldown: 'Back in a few minutes',
      },
      drill: {
        limit: 'Session terminated. Go touch grass.',
        nudge: `${timeLeftText} remaining. Prepare for shutdown.`,
        cooldown: 'Standby mode activated',
      },
    }

    return messages[tone]?.[type] || messages.classic[type]
  }

  formatTimeLeft(milliseconds) {
    const totalSeconds = Math.floor(milliseconds / 1000)
    const minutes = Math.floor(totalSeconds / 60)
    const seconds = totalSeconds % 60

    if (minutes > 0) {
      return `${minutes}m ${seconds}s`
    } else {
      return `${seconds}s`
    }
  }

  isTwitterUrl(url) {
    try {
      const urlObj = new URL(url)
      return (
        this.twitterDomains.includes(urlObj.hostname) ||
        this.mobileDomains.includes(urlObj.hostname)
      )
    } catch {
      return false
    }
  }

  async shouldBlockTab(tabId, url) {
    if (!this.isTwitterUrl(url)) return false

    const settings = await storage.getSettings()
    const flags = await storage.getFlags()

    if (!settings.enabled) return false

    return flags.locked
  }

  async shouldStartTracking(tabId, url) {
    if (!this.isTwitterUrl(url)) return false

    const settings = await storage.getSettings()
    const flags = await storage.getFlags()

    if (!settings.enabled) return false

    return !flags.pausedToday
  }

  async handleTabActivated(tabId) {
    const tab = await chrome.tabs.get(tabId)
    if (!this.isTwitterUrl(tab.url)) return

    const shouldBlock = await this.shouldBlockTab(tabId, tab.url)
    if (shouldBlock) {
      await this.blockTab(tabId)
    } else {
      await this.allowTab(tabId)
    }
  }

  async handleTabUpdated(tabId, changeInfo, tab) {
    if (changeInfo.status !== 'complete') return
    if (!this.isTwitterUrl(tab.url)) return

    const shouldBlock = await this.shouldBlockTab(tabId, tab.url)
    if (shouldBlock) {
      await this.blockTab(tabId)
    }
  }

  async blockTab(tabId) {
    const settings = await storage.getSettings()

    if (settings.mode === 'close') {
      chrome.tabs.remove(tabId)
    } else {
      chrome.tabs
        .sendMessage(tabId, {
          type: 'SHOW_SOFT_LOCK',
          settings,
        })
        .catch(() => {})
    }
  }

  async allowTab(tabId) {
    chrome.tabs
      .sendMessage(tabId, {
        type: 'HIDE_OVERLAY',
      })
      .catch(() => {})
  }

  async closeAllTwitterTabs() {
    const tabs = await chrome.tabs.query({
      url: ['*://twitter.com/*', '*://x.com/*', '*://pro.x.com/*'],
    })

    const tabIds = tabs.map((tab) => tab.id)
    if (tabIds.length > 0) {
      chrome.tabs.remove(tabIds)
    }
  }

  async blockAllTwitterTabs() {
    console.log('🚫 blockAllTwitterTabs called')
    const tabs = await chrome.tabs.query({
      url: ['*://twitter.com/*', '*://x.com/*', '*://pro.x.com/*'],
    })

    console.log('🚫 Found', tabs.length, 'X.com tabs to block')
    const settings = await storage.getSettings()

    tabs.forEach((tab) => {
      chrome.tabs
        .sendMessage(tab.id, {
          type: 'SHOW_SOFT_LOCK',
          settings,
        })
        .catch(() => {})
    })
  }

  async scheduleDailyReset() {
    const settings = await storage.getSettings()
    const now = new Date()
    const resetTime = new Date()

    resetTime.setHours(settings.resetHourLocal, 0, 0, 0)

    if (resetTime <= now) {
      resetTime.setDate(resetTime.getDate() + 1)
    }

    chrome.alarms.clear('dailyReset')

    chrome.alarms.create('dailyReset', {
      when: resetTime.getTime(),
    })
  }

  async getNextResetTime() {
    const settings = await storage.getSettings()
    const now = new Date()
    const resetTime = new Date()

    resetTime.setHours(settings.resetHourLocal, 0, 0, 0)

    if (resetTime <= now) {
      resetTime.setDate(resetTime.getDate() + 1)
    }

    return resetTime.toISOString()
  }

  async validatePasscode(inputPasscode) {
    const settings = await storage.getSettings()
    if (!settings.passcodeHash) return false

    return settings.passcodeHash === inputPasscode
  }

  async setPasscode(passcode) {
    await storage.updateSettings({ passcodeHash: passcode })
  }

  async clearPasscode() {
    await storage.updateSettings({ passcodeHash: null })
  }
}
const STORAGE_KEYS = {
  SETTINGS: 'settings',
  USAGE_TODAY: 'usageToday',
  FLAGS: 'flags',
  NOTIFICATIONS: 'notifications',
}

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
    template: 'default',
  },
}

const DEFAULT_USAGE = {
  millisActive: 0,
  lastTickAt: Date.now(),
  dateKey: getDateKey(),
}

const DEFAULT_FLAGS = {
  nudged: false,
  locked: false,
  pausedToday: false,
  snoozed: false,
}

const DEFAULT_NOTIFICATIONS = {
  enabled: false,
  filterType: 'posts',
  checkInterval: 1,
  lastSeenTweetId: null,
  processedTweetIds: [],
}

const BEARER_TOKEN =
  'Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA'

function getDateKey() {
  return new Date().toISOString().split('T')[0]
}

class StorageManager {
  constructor() {
    this.cache = new Map()
    this.pendingWrites = new Map()
    this.writeTimeout = null
  }

  async get(key) {
    if (this.cache.has(key)) {
      return this.cache.get(key)
    }

    const result = await chrome.storage.local.get(key)
    const value = result[key]

    if (value === undefined) {
      let defaultValue
      switch (key) {
        case STORAGE_KEYS.SETTINGS:
          defaultValue = DEFAULT_SETTINGS
          break
        case STORAGE_KEYS.USAGE_TODAY:
          defaultValue = DEFAULT_USAGE
          break
        case STORAGE_KEYS.FLAGS:
          defaultValue = DEFAULT_FLAGS
          break
        case STORAGE_KEYS.NOTIFICATIONS:
          defaultValue = DEFAULT_NOTIFICATIONS
          break
        default:
          defaultValue = null
      }

      await this.set(key, defaultValue)
      this.cache.set(key, defaultValue)
      return defaultValue
    }

    this.cache.set(key, value)
    return value
  }

  async set(key, value) {
    await chrome.storage.local.set({ [key]: value })
    this.cache.set(key, value)
  }

  setBatched(key, value) {
    this.cache.set(key, value)
    this.pendingWrites.set(key, value)

    if (this.writeTimeout) {
      clearTimeout(this.writeTimeout)
    }

    this.writeTimeout = setTimeout(async () => {
      if (this.pendingWrites.size > 0) {
        const writes = Object.fromEntries(this.pendingWrites)
        this.pendingWrites.clear()

        try {
          await chrome.storage.local.set(writes)
          console.log('💾 Batched write completed:', Object.keys(writes))
        } catch (error) {
          console.error('❌ Batched write failed:', error)
        }
      }
    }, 5000)
  }

  async update(key, updates) {
    const current = await this.get(key)
    const updated = { ...current, ...updates }
    await this.set(key, updated)
    return updated
  }

  async clear() {
    await chrome.storage.local.clear()
    this.cache.clear()
  }

  async getSettings() {
    return this.get(STORAGE_KEYS.SETTINGS)
  }

  async updateSettings(updates) {
    const oldSettings = await this.get(STORAGE_KEYS.SETTINGS)
    const newSettings = await this.update(STORAGE_KEYS.SETTINGS, updates)

    await this.handleSettingsChange(oldSettings, newSettings)

    return newSettings
  }

  async getUsageToday() {
    return this.get(STORAGE_KEYS.USAGE_TODAY)
  }

  async updateUsageToday(updates) {
    return this.update(STORAGE_KEYS.USAGE_TODAY, updates)
  }

  async getFlags() {
    return this.get(STORAGE_KEYS.FLAGS)
  }

  async updateFlags(updates) {
    return this.update(STORAGE_KEYS.FLAGS, updates)
  }

  async getNotifications() {
    return this.get(STORAGE_KEYS.NOTIFICATIONS)
  }

  async updateNotifications(updates) {
    return this.update(STORAGE_KEYS.NOTIFICATIONS, updates)
  }

  async getCustomImage() {
    const result = await chrome.storage.local.get('customOverlayImage')
    return result.customOverlayImage || null
  }

  async setCustomImage(imageData) {
    await chrome.storage.local.set({ customOverlayImage: imageData })
  }

  async clearCustomImage() {
    await chrome.storage.local.remove('customOverlayImage')
  }

  async checkDailyReset() {
    const usage = await this.getUsageToday()
    const currentDateKey = getDateKey()

    if (usage.dateKey !== currentDateKey) {
      await this.set(STORAGE_KEYS.USAGE_TODAY, {
        ...DEFAULT_USAGE,
        dateKey: currentDateKey,
      })
      await this.set(STORAGE_KEYS.FLAGS, {
        ...DEFAULT_FLAGS,
      })
      return true
    }
    return false
  }

  onChanged(callback) {
    chrome.storage.onChanged.addListener((changes, namespace) => {
      if (namespace === 'sync') {
        Object.keys(changes).forEach((key) => {
          this.cache.set(key, changes[key].newValue)
        })
        callback(changes, namespace)
      }
    })
  }

  async handleSettingsChange(oldSettings, newSettings) {
    if (
      oldSettings &&
      oldSettings.dailyLimitMin !== newSettings.dailyLimitMin
    ) {
      const usage = await this.getUsageToday()
      const currentUsageMin = usage.millisActive / 1000 / 60

      if (currentUsageMin > newSettings.dailyLimitMin) {
        await this.set(STORAGE_KEYS.USAGE_TODAY, {
          millisActive: 0,
          lastTickAt: Date.now(),
          dateKey: getDateKey(),
        })

        await this.set(STORAGE_KEYS.FLAGS, {
          nudged: false,
          locked: false,
          pausedToday: false,
          snoozed: false,
          frozenTimeUsed: undefined,
        })

        return true
      }
    }
    return false
  }
}
class TimeKeeper {
  constructor() {
    this.isActive = false
    this.lastTickTime = null
    this.tickInterval = null
    this.idleThreshold = 60
    this.tickFrequency = 1000

    this.usageSaveInterval = 60000 + Math.floor(Math.random() * 30000)
    this.lastUsageSave = 0

    this.popupConnections = new Set()
    this.popupUpdateInterval = null
    this.popupStartTimeout = null

    this.currentUsageMs = 0
    this.isInitialized = false
    this.isPaused = false
    this.isLocked = false
    this.lastActiveChange = 0
    this.lastIdleTime = 0

    this.startInProgress = false
    this.stopInProgress = false

    this.writeBackoffUntil = 0
  }

  async syncWithStorage() {
    if (!this.isInitialized) {
      const [usage, flags] = await Promise.all([
        storage.getUsageToday(),
        storage.getFlags(),
      ])

      this.currentUsageMs = usage.millisActive
      this.isPaused = flags.pausedToday
      this.isLocked = flags.locked
      this.isInitialized = true

      if (this.currentUsageMs === 0) {
        this.lastTickTime = null
      }

      console.log('🔄 TimeKeeper synced with storage:', {
        usage: this.currentUsageMs + 'ms',
        paused: this.isPaused,
      })
    }
  }

  async getFreshData() {
    const [settings, flags, usage] = await Promise.all([
      storage.getSettings(),
      storage.getFlags(),
      storage.getUsageToday(),
    ])

    return { settings, flags, usage }
  }

  async saveUsageDirectly(newUsage) {
    const now = Date.now()

    if (now - this.lastUsageSave >= 30000) {
      storage.setBatched(STORAGE_KEYS.USAGE_TODAY, newUsage)
      this.lastUsageSave = now
      console.log(
        '💾 Usage queued for batched save:',
        newUsage.millisActive + 'ms'
      )
    }
  }

  addPopupConnection(port) {
    console.log('Popup connected for real-time updates')
    this.popupConnections.add(port)

    if (this.popupConnections.size === 1) {
      clearTimeout(this.popupStartTimeout)
      this.popupStartTimeout = setTimeout(() => {
        if (this.popupConnections.size > 0) {
          this.startPopupUpdates()
        }
      }, 100)
    }

    port.onDisconnect.addListener(() => {
      console.log('Popup disconnected from real-time updates')
      this.popupConnections.delete(port)

      if (this.popupConnections.size === 0) {
        this.stopPopupUpdates()
      }
    })
  }

  startPopupUpdates() {
    if (this.popupUpdateInterval) return

    console.log('Starting popup real-time updates')

    if (this.isLocked) {
      this.broadcastRealTimeUpdate({
        type: 'STATUS_CHANGED',
        locked: true,
        usage: this.currentUsageMs,
        timestamp: Date.now(),
      })
    }

    this.popupUpdateInterval = setInterval(() => {
      if (this.isLocked) {
        return
      }
      const usage = this.getCurrentRealTimeUsage()
      this.broadcastRealTimeUpdate({
        type: 'REAL_TIME_UPDATE',
        usage: usage,
        timestamp: Date.now(),
      })
    }, 1000)
  }

  stopPopupUpdates() {
    if (this.popupUpdateInterval) {
      console.log('Stopping popup real-time updates')
      clearInterval(this.popupUpdateInterval)
      this.popupUpdateInterval = null
    }
  }

  broadcastRealTimeUpdate(data) {
    this.popupConnections.forEach((port) => {
      try {
        port.postMessage(data)
      } catch (error) {
        console.error('Failed to send real-time update:', error)

        this.popupConnections.delete(port)
      }
    })
  }

  getCurrentRealTimeUsage() {
    if (this.isPaused) {
      return this.currentUsageMs
    }

    if (this.isActive && this.lastTickTime) {
      const now = Date.now()
      const deltaTime = now - this.lastTickTime
      return this.currentUsageMs + deltaTime
    }

    return this.currentUsageMs
  }

  async start() {
    if (this.tickInterval || this.startInProgress) return
    if (this.isLocked) {
      console.log('⏭️ Skipping start - timekeeper is locked')
      return
    }
    this.startInProgress = true

    await this.syncWithStorage()
    if (this.isLocked) {
      console.log('⏭️ Skipping start after sync - locked')
      this.startInProgress = false
      return
    }

    if (!this.tickInterval) {
      this.lastTickTime = Date.now()

      chrome.alarms.clear('timekeeper_tick')
      chrome.alarms.create('timekeeper_tick', {
        delayInMinutes: this.tickFrequency / 60000,
        periodInMinutes: this.tickFrequency / 60000,
      })

      this.tickInterval = 'alarm'
    }

    console.log(
      '⏰ TimeKeeper started with current usage:',
      this.currentUsageMs + 'ms'
    )
    this.startInProgress = false
  }

  async stop() {
    if (this.stopInProgress) return
    this.stopInProgress = true

    if (this.tickInterval) {
      if (this.tickInterval === 'alarm') {
        chrome.alarms.clear('timekeeper_tick')
      } else {
        clearInterval(this.tickInterval)
      }
      this.tickInterval = null
    }

    if (this.currentUsageMs > 0) {
      const usage = await storage.getUsageToday()
      await storage.updateUsageToday({
        ...usage,
        millisActive: this.currentUsageMs,
        lastTickAt: Date.now(),
      })
      console.log(
        '💾 Saved current usage before stopping:',
        this.currentUsageMs + 'ms'
      )
    }

    this.isActive = false
    this.lastTickTime = null

    console.log('⏰ TimeKeeper stopped')
    this.stopInProgress = false
  }

  setActive(active) {
    const now = Date.now()

    if (this.isActive === active) {
      return
    }

    if (now - this.lastActiveChange < 200) {
      console.log('⏸️ setActive debounced - too rapid switching')
      return
    }

    if (this.isLocked && active) {
      console.log('🔒 Ignoring setActive(true) while locked')
      return
    }

    this.lastActiveChange = now
    this.isActive = active

    if (active) {
      this.lastTickTime = now
      console.log('⚡ TimeKeeper set to active')
    } else {
      console.log('💤 TimeKeeper set to inactive')
      console.trace('💤 STACK TRACE - What called setActive(false)?')
    }
  }

  async tick() {
    if (!this.isActive || !this.lastTickTime) return

    const now = Date.now()
    const deltaTime = now - this.lastTickTime

    if (deltaTime < 100) {
      console.log('⏩ Skipping tiny tick delta:', deltaTime + 'ms')
      return
    }

    console.log('⏰ TICK:', {
      isActive: this.isActive,
      deltaTime,
      timeSeconds: Math.round(deltaTime / 1000) + 's',
    })

    const { settings, flags, usage } = await this.getFreshData()

    if (
      this.isLocked ||
      !settings.enabled ||
      flags.locked ||
      flags.pausedToday
    ) {
      console.log('⏰ Tick skipped:', {
        enabled: settings.enabled,
        locked: flags.locked || this.isLocked,
        paused: flags.pausedToday,
        inMemoryLocked: this.isLocked,
      })
      this.lastTickTime = now
      return
    }

    if (chrome.idle && chrome.idle.queryState) {
      try {
        const idleState = await new Promise((resolve) => {
          chrome.idle.queryState(this.idleThreshold, resolve)
        })

        if (idleState === 'idle' || idleState === 'locked') {
          this.lastTickTime = now
          return
        }
      } catch (error) {}
    }

    this.currentUsageMs += deltaTime

    const newUsage = {
      ...usage,
      millisActive: this.currentUsageMs,
      lastTickAt: now,
    }

    console.log('⏰ Updating usage:', {
      oldStored: usage.millisActive,
      oldCurrent: this.currentUsageMs - deltaTime,
      delta: deltaTime,
      newCurrent: this.currentUsageMs,
    })

    if (
      now >= this.writeBackoffUntil &&
      now - this.lastUsageSave >= this.usageSaveInterval
    ) {
      try {
        this.lastUsageSave = now
        await storage.updateUsageToday(newUsage)
        this.writeBackoffUntil = 0
        console.log('💾 Usage saved to storage:', this.currentUsageMs + 'ms')
      } catch (error) {
        console.error('💾 Failed to save usage:', error.message)

        this.writeBackoffUntil = now + 120000
      }
    }

    this.lastTickTime = now

    this.broadcastRealTimeUpdate({
      type: 'REAL_TIME_UPDATE',
      usage: this.getCurrentRealTimeUsage(),
      timestamp: now,
    })

    await this.checkLimits(newUsage)
  }

  async checkLimits(usage) {
    const { settings, flags } = await this.getFreshData()

    if (!settings.enabled || flags.pausedToday || flags.locked) return

    let effectiveLimitMillis
    if (flags.snoozed) {
      console.log('⏸️ Skipping nudge check - currently in snooze mode')
      effectiveLimitMillis = (settings.cooldownMin || 5) * 60 * 1000
    } else {
      effectiveLimitMillis = settings.dailyLimitMin * 60 * 1000

      const nudgeThreshold = effectiveLimitMillis * 0.8

      if (!flags.nudged && usage.millisActive >= nudgeThreshold) {
        await this.triggerNudge()
      }
    }

    const tickBuffer = 2000
    if (usage.millisActive >= effectiveLimitMillis - tickBuffer) {
      console.log(
        '🔒 Approaching limit with 2s buffer - triggering lock early to prevent overlap'
      )
      await this.triggerLimit()
    }
  }

  async triggerNudge() {
    const settings = await storage.getSettings()
    const flags = await storage.getFlags()

    if (
      !settings.enabled ||
      !settings.allowSnooze ||
      flags.nudged ||
      flags.pausedToday ||
      flags.snoozed ||
      flags.locked
    )
      return

    const usage = await storage.getUsageToday()
    const limitMillis = settings.dailyLimitMin * 60 * 1000
    const timeLeft = Math.max(0, limitMillis - usage.millisActive)

    await storage.updateFlags({ nudged: true })

    
    
    
    
    
    
    
    
    
    
    
    
    
    
    
    
    
    
    

    const tabs = await chrome.tabs.query({
      url: ['*://twitter.com/*', '*://x.com/*', '*://pro.x.com/*'],
    })

    const currentUsageMs = this.currentUsageMs
    const currentFlags = await storage.getFlags()

    let effectiveLimitMillis
    if (currentFlags.snoozed) {
      effectiveLimitMillis = (settings.cooldownMin || 5) * 60 * 1000
    } else {
      effectiveLimitMillis = settings.dailyLimitMin * 60 * 1000
    }

    const realTimeLeft = Math.max(0, effectiveLimitMillis - currentUsageMs)

    for (const tab of tabs) {
      await globalService.ensureContentScriptAndSendMessage(tab.id, {
        type: 'SHOW_NUDGE',
        settings,
        timeLeft: realTimeLeft,
      })
    }
  }

  async triggerLimit() {
    const settings = await storage.getSettings()
    const flags = await storage.getFlags()

    if (!settings.enabled || flags.locked || flags.pausedToday) return

    let effectiveLimitMillis
    if (flags.snoozed) {
      effectiveLimitMillis = (settings.cooldownMin || 5) * 60 * 1000
    } else {
      effectiveLimitMillis = settings.dailyLimitMin * 60 * 1000
    }

    const currentUsageMs = this.currentUsageMs
    const tickBuffer = 2000
    const effectiveLimitWithBuffer = effectiveLimitMillis - tickBuffer

    console.log('🔍 Usage check:', {
      used: currentUsageMs,
      limit: effectiveLimitMillis,
      limitWithBuffer: effectiveLimitWithBuffer,
      timeUsed: Math.round(currentUsageMs / 1000) + 's',
      willLock: currentUsageMs >= effectiveLimitWithBuffer,
      snoozed: flags.snoozed,
      cooldownMin: settings.cooldownMin,
    })

    if (currentUsageMs >= effectiveLimitWithBuffer) {
      console.log('🔒 LIMIT REACHED (with 2s buffer) - Locking extension')

      await storage.updateFlags({
        locked: true,
        nudged: false,
        frozenTimeUsed: effectiveLimitMillis,
      })

      this.isLocked = true

      console.log('⏹️ Stopping timekeeper due to limit reached')
      await this.stop()

      this.broadcastRealTimeUpdate({
        type: 'STATUS_CHANGED',
        locked: true,
        usage: effectiveLimitMillis,
        timestamp: Date.now(),
      })
    } else {
      return
    }

    const tabs = await chrome.tabs.query({
      url: ['*://twitter.com/*', '*://x.com/*', '*://pro.x.com/*'],
    })

    if (settings.mode === 'close') {
      tabs.forEach((tab) => {
        chrome.tabs
          .sendMessage(tab.id, {
            type: 'SHOW_CLOSE_COUNTDOWN',
            settings,
          })
          .catch(() => {
            chrome.tabs.remove(tab.id)
          })
      })
    } else {
      console.log('🎭 Sending soft lock overlay to', tabs.length, 'tabs')
      console.log(
        '🎭 Settings overlay customization:',
        settings.overlayCustomization
      )

      let customImageData = null
      if (
        settings.overlayCustomization &&
        settings.overlayCustomization.enabled
      ) {
        try {
          customImageData = await storage.getCustomImage()
          console.log(
            '🖼️ Retrieved custom image for overlay:',
            !!customImageData,
            customImageData?.length || 0,
            'bytes'
          )
        } catch (error) {
          console.error('❌ Failed to get custom image for overlay:', error)
        }
      }

      for (const tab of tabs) {
        console.log('🎭 Sending overlay to tab:', tab.id, tab.url)

        const messageData = {
          type: 'SHOW_SOFT_LOCK',
          settings: {
            ...settings,

            overlayCustomization: settings.overlayCustomization
              ? {
                  ...settings.overlayCustomization,
                  customImage: customImageData,
                }
              : {
                  enabled: false,
                  customMessage: '',
                  customImage: null,
                  template: 'default',
                },
          },
        }

        console.log('🎭 Message data:', {
          type: messageData.type,
          hasOverlayCustomization: !!messageData.settings.overlayCustomization,
          overlayEnabled: messageData.settings.overlayCustomization?.enabled,
          customImageExists:
            !!messageData.settings.overlayCustomization?.customImage,
          customImageLength:
            messageData.settings.overlayCustomization?.customImage?.length || 0,
        })

        globalService.tabsWithOverlays.add(tab.id)
        await globalService.ensureContentScriptAndSendMessage(
          tab.id,
          messageData
        )
      }
    }
  }

  async getTimeRemaining() {
    const { settings, usage, flags } = await this.getFreshData()

    if (flags.pausedToday) {
      return { remaining: settings.dailyLimitMin * 60 * 1000, used: 0 }
    }

    let effectiveLimitMillis
    if (flags.snoozed) {
      effectiveLimitMillis = (settings.cooldownMin || 5) * 60 * 1000
    } else {
      effectiveLimitMillis = settings.dailyLimitMin * 60 * 1000
    }

    const remaining = Math.max(0, effectiveLimitMillis - usage.millisActive)

    if (flags.locked) {
      return {
        remaining,
        used: usage.millisActive,
        limit: effectiveLimitMillis,
        frozen: true,
      }
    }

    return {
      remaining,
      used: usage.millisActive,
      limit: effectiveLimitMillis,
      frozen: false,
    }
  }

  getNextResetTime() {
    const now = new Date()
    const settings = storage.getSettings()

    return settings.then((settings) => {
      const resetTime = new Date(now)
      resetTime.setHours(settings.resetHourLocal, 0, 0, 0)

      if (resetTime <= now) {
        resetTime.setDate(resetTime.getDate() + 1)
      }

      return resetTime
    })
  }

  formatTime(millis) {
    const minutes = Math.floor(millis / (1000 * 60))
    const hours = Math.floor(minutes / 60)

    if (hours > 0) {
      return `${hours}h ${minutes % 60}m`
    }
    return `${minutes}m`
  }
}
const storage = new StorageManager()
const timekeeper = new TimeKeeper()
const rules = new RulesEngine()
const rulesEngine = new RulesEngine()
class TwitterTimeLimitService {
  constructor() {
    this.activeTabs = new Set()
    this.isTracking = false
    this.lastPauseToggle = 0
    this.lastUpdateTracking = 0
    this.lastSettingsUpdate = 0
    this.debounceLogCount = 0
    this.updateTrackingTimeout = null
    this.updateTrackingInProgress = false
    this.pauseInProgress = false
    this.resetInProgress = false
    this.lastGetStatus = 0
    this.lastGetStatusLog = 0
    this.cachedStatus = null
    this.lastSnoozeRequest = 0

    this.tabsWithOverlays = new Set()

    this.tweetNotifyRecent = new Map()
    this.tweetNotifyInFlight = new Set()
    this.tweetNotifyTtlMs = 3 * 60 * 1000
    this.tweetNotifyMax = 500
    this.init()
  }

  async init() {
    await storage.checkDailyReset()

    await this.scheduleDailyReset()

    this.setupTabListeners()

    this.setupWindowListeners()

    this.setupMessageListeners()

    this.setupNotificationListeners()

    await this.checkActiveTabs()

    try {
      const cache = await storage.get('notificationsCache')
      if (cache && cache.tweets && Array.isArray(cache.tweets)) {
        const now = Date.now()
        for (const [id, ts] of cache.tweets) {
          if (
            typeof id === 'string' &&
            typeof ts === 'number' &&
            now - ts < this.tweetNotifyTtlMs
          ) {
            this.tweetNotifyRecent.set(id, ts)
          }
        }
      }
    } catch (_) {}
  }

  async scheduleDailyReset() {
    const settings = await storage.getSettings()
    const now = new Date()
    const resetTime = new Date(now)
    resetTime.setHours(settings.resetHourLocal, 0, 0, 0)

    if (resetTime <= now) {
      resetTime.setDate(resetTime.getDate() + 1)
    }

    try {
      await chrome.alarms.clear('daily_reset')
    } catch (e) {}

    chrome.alarms.create('daily_reset', {
      when: resetTime.getTime(),
    })
  }

  setupTabListeners() {
    chrome.tabs.onActivated.addListener(async (activeInfo) => {
      await rules.handleTabActivated(activeInfo.tabId)
      await this.updateTrackingImmediate()
    })

    chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
      await rules.handleTabUpdated(tabId, changeInfo, tab)
      this.debouncedUpdateTracking()
    })

    chrome.tabs.onRemoved.addListener((tabId) => {
      this.activeTabs.delete(tabId)
      this.debouncedUpdateTracking()
    })
  }

  setupWindowListeners() {
    chrome.windows.onFocusChanged.addListener(async (windowId) => {
      console.log(
        '🔍 Window focus changed:',
        windowId === chrome.windows.WINDOW_ID_NONE
          ? 'lost focus'
          : 'gained focus'
      )
      if (windowId === chrome.windows.WINDOW_ID_NONE) {
        console.log(
          '🔍 Window lost focus - updating tracking to stop timekeeper'
        )
        await this.updateTrackingImmediate()
      } else {
        console.log('🔍 Window gained focus - updating tracking')
        await this.updateTrackingImmediate()
      }
    })
  }

  setupMessageListeners() {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      this.handleMessage(message, sender, sendResponse)
      return true
    })
  }

  async handleMessage(message, sender, sendResponse) {
    try {
      switch (message.type) {
        case 'TAB_ACTIVE':
          this.activeTabs.add(sender.tab.id)
          this.debouncedUpdateTracking()
          sendResponse({ success: true })
          break

        case 'TAB_INACTIVE':
          console.log(
            'TAB_INACTIVE message from tab:',
            sender.tab.id,
            sender.tab.url
          )

          sendResponse({ success: true })
          break

        case 'USER_ACTIVITY':
          console.log(
            '⚡ USER_ACTIVITY message received from tab:',
            sender.tab.id
          )

          if (!timekeeper.isPaused) {
            const now = Date.now()
            timekeeper.lastActiveChange = now - 300
            timekeeper.setActive(true)
          } else {
            console.log('⏸️ Ignoring user activity - extension is paused')
          }
          sendResponse({ success: true })
          break

        case 'USER_IDLE':
          const now = Date.now()
          if (now - timekeeper.lastIdleTime < 2000) {
            console.log(
              '💤 USER_IDLE ignored - too frequent from tab:',
              sender.tab.id
            )
            sendResponse({ success: true })
            break
          }

          console.log('💤 USER_IDLE received from tab:', sender.tab.id)
          timekeeper.lastIdleTime = now

          console.log(
            "💤 USER_IDLE ignored - individual tab idle doesn't affect global state"
          )
          sendResponse({ success: true })
          break

        case 'SNOOZE_REQUEST':
          const snoozeResult = await this.handleSnoozeRequest()
          sendResponse(snoozeResult || { success: true })
          break

        case 'BYPASS_REQUEST':
          await this.handleBypassRequest(message.passcode)
          sendResponse({ success: true })
          break

        case 'PAUSE_TOGGLE':
          await this.togglePause()
          sendResponse({ success: true })
          break

        case 'MANUAL_RESET':
          await this.manualReset()
          sendResponse({ success: true })
          break

        case 'GET_STATUS':
          const status = await this.getStatus()
          sendResponse(status)
          break

        case 'UPDATE_SETTINGS':
          try {
            const now = Date.now()
            const requestId = message.requestId || 'unknown'

            if (now - this.lastSettingsUpdate < 1000) {
              sendResponse({ success: true, debounced: true })
              break
            }
            this.lastSettingsUpdate = now

            const oldSettings = await storage.getSettings()

            const storageUpdates = {}

            let shouldLockImmediately = false
            if (
              message.settings.dailyLimitMin !== undefined &&
              oldSettings.dailyLimitMin !== message.settings.dailyLimitMin
            ) {
              const currentUsageMin = timekeeper.currentUsageMs / (1000 * 60)
              const newLimitMin = message.settings.dailyLimitMin

              console.log('📏 Daily limit changed:', {
                oldLimit: oldSettings.dailyLimitMin + 'm',
                newLimit: newLimitMin + 'm',
                currentUsage: Math.round(currentUsageMin * 10) / 10 + 'm',
                currentUsageMs: timekeeper.currentUsageMs,
                newLimitMs: newLimitMin * 60 * 1000,
                exceedsNewLimit: currentUsageMin >= newLimitMin,
              })

              const newLimitMs = newLimitMin * 60 * 1000
              const tickBuffer = 2000
              if (timekeeper.currentUsageMs >= newLimitMs - tickBuffer) {
                console.log(
                  '⚡ Current usage exceeds new limit (with 2s buffer) - triggering lock immediately'
                )
                shouldLockImmediately = true

                timekeeper.isLocked = true

                console.log('⏹️ Stopping timekeeper due to new limit exceeded')
                await timekeeper.stop()

                const currentFlags = await storage.getFlags()
                storageUpdates[STORAGE_KEYS.FLAGS] = {
                  ...currentFlags,
                  locked: true,
                  frozenTimeUsed: newLimitMs,
                }

                console.log('📡 Broadcasting STATUS_CHANGED for immediate lock')
                timekeeper.broadcastRealTimeUpdate({
                  type: 'STATUS_CHANGED',
                  locked: true,
                  usage: timekeeper.currentUsageMs,
                  timestamp: Date.now(),
                })

                console.log(
                  '📦 Batching lock flags with settings update to avoid quota'
                )
              }
            }

            if (
              message.settings.cooldownMin !== undefined &&
              oldSettings.cooldownMin !== message.settings.cooldownMin
            ) {
              console.log(
                '🔄 Delay time changed - always resetting counter to 0'
              )
              timekeeper.currentUsageMs = 0
              timekeeper.isInitialized = true
              timekeeper.isPaused = false

              storageUpdates[STORAGE_KEYS.USAGE_TODAY] = {
                millisActive: 0,
                lastTickAt: Date.now(),
                dateKey: new Date().toISOString().split('T')[0],
              }

              console.log('💾 Storage usage reset to 0 for delay time change')

              timekeeper.broadcastRealTimeUpdate({
                type: 'REAL_TIME_UPDATE',
                usage: 0,
                timestamp: Date.now(),
              })

              if (shouldLockImmediately) {
                console.log(
                  '🔄 Canceling immediate lock due to delay time reset'
                )
                shouldLockImmediately = false
                timekeeper.isLocked = false

                if (storageUpdates[STORAGE_KEYS.FLAGS]) {
                  delete storageUpdates[STORAGE_KEYS.FLAGS]
                }
              }
            }

            const { notifications, ...settingsWithoutNotifications } =
              message.settings

            storageUpdates[STORAGE_KEYS.SETTINGS] = {
              ...oldSettings,
              ...settingsWithoutNotifications,
            }

            if (notifications) {
              const currentNotifications = await storage.getNotifications()
              storageUpdates[STORAGE_KEYS.NOTIFICATIONS] = {
                ...currentNotifications,
                ...notifications,
              }
              console.log('🔔 Notifications settings updated:', notifications)

              chrome.alarms.clear('notificationCheck')
              if (notifications.enabled) {
                const intervalMinutes = notifications.checkInterval || 1
                chrome.alarms.create('notificationCheck', {
                  delayInMinutes: intervalMinutes,
                  periodInMinutes: intervalMinutes,
                })
                console.log(
                  '⏰ Notification alarm set for every',
                  intervalMinutes,
                  'minutes (independent of extension state)'
                )
              } else {
                console.log('🔕 Notifications disabled - alarm cleared')
              }
            }

            if (message.resetUsage) {
              storageUpdates[STORAGE_KEYS.USAGE_TODAY] = {
                millisActive: 0,
                lastTickAt: Date.now(),
                dateKey: new Date().toISOString().split('T')[0],
              }

              const currentFlags = await storage.getFlags()
              storageUpdates[STORAGE_KEYS.FLAGS] = {
                ...currentFlags,
                nudged: false,
                locked: false,
                snoozed: false,
                frozenTimeUsed: undefined,
              }

              timekeeper.isLocked = false
            }

            await chrome.storage.local.set(storageUpdates)

            console.log(
              '💾 Settings saved to storage:',
              storageUpdates[STORAGE_KEYS.SETTINGS]
            )

            storage.cache.clear()
            console.log('🧹 Storage cache cleared after settings update')

            if (storageUpdates[STORAGE_KEYS.FLAGS]?.locked) {
              console.log(
                '🎭 Triggering overlay for immediate lock from daily limit change'
              )

              timekeeper.broadcastRealTimeUpdate({
                type: 'STATUS_CHANGED',
                locked: true,
                usage: timekeeper.currentUsageMs,
                timestamp: Date.now(),
              })

              setTimeout(async () => {
                const tabs = await chrome.tabs.query({
                  url: ['*://twitter.com/*', '*://x.com/*', '*://pro.x.com/*'],
                })

                console.log(
                  '🎭 Sending soft lock overlay to',
                  tabs.length,
                  'tabs'
                )

                const freshSettings = await storage.getSettings()
                let customImageData = null
                if (
                  freshSettings.overlayCustomization?.enabled &&
                  freshSettings.overlayCustomization?.template === 'custom'
                ) {
                  try {
                    customImageData = await storage.getCustomImage()
                  } catch (error) {
                    console.error(
                      '❌ Failed to get custom image for overlay:',
                      error
                    )
                  }
                }

                console.log(
                  '🎭 Settings overlay customization:',
                  freshSettings.overlayCustomization
                )

                for (const tab of tabs) {
                  chrome.tabs
                    .sendMessage(tab.id, {
                      type: 'SHOW_SOFT_LOCK',
                      settings: freshSettings,
                      overlayCustomization: freshSettings.overlayCustomization,
                      customImageData: customImageData,
                    })
                    .catch((error) => {
                      console.log(
                        `Failed to show overlay on tab ${tab.id}:`,
                        error
                      )
                    })
                }
              }, 100)
            }

            const wasEnabled = oldSettings.enabled
            const isNowEnabled = message.settings.enabled

            if (wasEnabled !== isNowEnabled) {
              if (isNowEnabled) {
                await this.refreshTwitterTabs()

                if (chrome.notifications) {
                  await this.createTransientNotification('extension_enabled', {
                    type: 'basic',
                    iconUrl: 'assets/icon-48x48.png',
                    title: 'Boundr',
                    message: 'Extension enabled. Twitter tabs refreshed.',
                  })
                }
              } else {
                
                
                console.log('Extension disabled but keeping notifications active')
              }
            }

            if (message.settings.enabled === false) {
              const tabs = await chrome.tabs.query({
                url: ['*://twitter.com/*', '*://x.com/*', '*://pro.x.com/*'],
              })

              tabs.forEach((tab) => {
                chrome.tabs
                  .sendMessage(tab.id, {
                    type: 'EXTENSION_DISABLED',
                  })
                  .catch(() => {})
              })
            }

            const tabs = await chrome.tabs.query({
              url: ['*://twitter.com/*', '*://x.com/*', '*://pro.x.com/*'],
            })

            tabs.forEach((tab) => {
              chrome.tabs
                .sendMessage(tab.id, {
                  type: 'SETTINGS_UPDATED',
                  settings: storageUpdates[STORAGE_KEYS.SETTINGS],
                })
                .catch(() => {})
            })

            sendResponse({ success: true })
          } catch (error) {
            sendResponse({
              success: false,
              error: error.message,
            })
          }
          break

        case 'RESET_SETTINGS':
          await storage.clear()
          sendResponse({ success: true })
          break

        case 'SET_PASSCODE':
          await rules.setPasscode(message.passcode)
          sendResponse({ success: true })
          break

        case 'REFRESH_TWITTER_TABS':
          const settings = await storage.getSettings()
          if (settings.enabled) {
            await this.refreshTwitterTabs()
            sendResponse({ success: true })
          } else {
            sendResponse({ success: false, error: 'Extension is disabled' })
          }
          break

        case 'CLEAR_LOCK':
          await this.clearLockedState()
          sendResponse({ success: true })
          break

        case 'GET_NOTIFICATIONS':
          const notifications = await storage.getNotifications()
          sendResponse({ notifications })
          break

        case 'UPDATE_NOTIFICATIONS':
          await storage.updateNotifications(message.notifications)

          chrome.alarms.clear('notificationCheck')
          
          if (message.notifications.enabled) {
            chrome.alarms.create('notificationCheck', {
              delayInMinutes: 0,
              periodInMinutes: message.notifications.checkInterval,
            })

            setTimeout(async () => {
              const alarms = await chrome.alarms.getAll()
              const notificationAlarm = alarms.find(
                (alarm) => alarm.name === 'notificationCheck'
              )
              if (notificationAlarm) {
              } else {
              }
            }, 500)

            setTimeout(async () => {
              await this.checkNotifications()
            }, 1000)
          } else {
          }

          sendResponse({ success: true })
          break

        case 'GET_CUSTOM_IMAGE':
          const imageData = await storage.getCustomImage()
          sendResponse({ imageData })
          break

        case 'SET_CUSTOM_IMAGE':
          await storage.setCustomImage(message.imageData)
          sendResponse({ success: true })
          break

        case 'CLEAR_CUSTOM_IMAGE':
          await storage.clearCustomImage()
          sendResponse({ success: true })
          break

        case 'POPUP_CONNECTED':
          sendResponse({ success: true })
          break

        default:
          sendResponse({ error: 'Unknown message type' })
      }
    } catch (error) {
      sendResponse({ error: error.message })
    }
  }

  setupNotificationListeners() {
    chrome.notifications.onClicked.addListener(async (notificationId) => {
      if (notificationId.includes('nudge')) {
        await this.handleSnoozeRequest()
        chrome.notifications.clear(notificationId)
      } else if (
        notificationId.startsWith('tweet_') ||
        notificationId.startsWith('new_tweet_')
      ) {
        
        try {
          const tweetId = notificationId
            .replace('tweet_', '')
            .replace('new_tweet_', '')
          const tweetUrl = `https://x.com/i/web/status/${tweetId}`

          const tabs = await chrome.tabs.query({
            url: ['*://x.com/*', '*://twitter.com/*'],
          })
          if (tabs.length > 0) {
            const preferred = tabs.find((t) => t.active) || tabs[0]
            await chrome.tabs.update(preferred.id, { url: tweetUrl, active: true })
            if (preferred.windowId != null) {
              await chrome.windows.update(preferred.windowId, { focused: true })
            }
          } else {
            const created = await chrome.tabs.create({
              url: tweetUrl,
              active: true,
            })
            if (created && created.windowId != null) {
              await chrome.windows.update(created.windowId, { focused: true })
            }
          }
        } finally {
          chrome.notifications.clear(notificationId)
        }
      }
    })

    chrome.notifications.onButtonClicked.addListener(
      async (notificationId, buttonIndex) => {
        if (notificationId.includes('nudge')) {
          if (buttonIndex === 0) {
            await this.handleSnoozeRequest()
          }
          chrome.notifications.clear(notificationId)
        }
      }
    )
  }

  async createTransientNotification(idPrefix, options, autoCloseMs = 5000) {
    try {
      const uniqueId = `${idPrefix}_${Date.now()}_${Math.random()
        .toString(36)
        .slice(2, 7)}`
      await chrome.notifications.create(uniqueId, {
        requireInteraction: false,
        silent: true,
        ...options,
      })
      setTimeout(() => {
        chrome.notifications.clear(uniqueId)
      }, autoCloseMs)
      return uniqueId
    } catch (e) {
      return null
    }
  }

  async checkActiveTabs() {
    const tabs = await chrome.tabs.query({
      url: ['*://twitter.com/*', '*://x.com/*', '*://pro.x.com/*'],
    })

    console.log(
      'checkActiveTabs found tabs:',
      tabs.map((t) => ({ id: t.id, url: t.url, active: t.active }))
    )

    this.activeTabs.clear()
    tabs.forEach((tab) => {
      if (tab.windowId) {
        this.activeTabs.add(tab.id)
      }
    })

    console.log('activeTabs after update:', Array.from(this.activeTabs))

    this.debouncedUpdateTracking()
  }

  debouncedUpdateTracking() {
    if (this.updateTrackingTimeout) {
      clearTimeout(this.updateTrackingTimeout)
    }

    this.updateTrackingTimeout = setTimeout(() => {
      this.updateTrackingImmediate()
      console.warn('⏱️ debouncedUpdateTracking fired immediate recalculation')
      this.updateTrackingTimeout = null
    }, 100)
  }

  async updateTracking() {
    const now = Date.now()
    if (now - this.lastUpdateTracking < 500) {
      this.debounceLogCount++

      if (this.debounceLogCount % 10 === 1) {
        console.log(
          '🔄 updateTracking debounced (too frequent) - count:',
          this.debounceLogCount
        )
      }
      return
    }
    this.lastUpdateTracking = now

    return this.updateTrackingImmediate()
  }

  async updateTrackingImmediate() {
    if (this.updateTrackingInProgress) {
      console.log('🔄 updateTracking already in progress, skipping')
      return
    }
    this.updateTrackingInProgress = true

    try {
      const wasTracking = this.isTracking
      const settings = await storage.getSettings()
      const flags = await storage.getFlags()

      const activeXTabs = await chrome.tabs.query({
        url: ['*://twitter.com/*', '*://x.com/*', '*://pro.x.com/*'],
        active: true,
      })

      let chromeFocused = false
      let focusedWindowId = null
      try {
        const focusedWindow = await chrome.windows.getLastFocused()
        chromeFocused = !!(focusedWindow && focusedWindow.focused)
        focusedWindowId = focusedWindow ? focusedWindow.id : null
      } catch (_) {}

      const hasActiveXTabInFocusedWindow =
        chromeFocused && activeXTabs.some((t) => t.windowId === focusedWindowId)
      const popupOpen =
        timekeeper.popupConnections && timekeeper.popupConnections.size > 0
      const hasActiveXTabAnywhere = activeXTabs.length > 0

      const nowTs = Date.now()
      const suppressStops =
        this.suppressStopUntil && nowTs < this.suppressStopUntil

      const allowDueToPopup = popupOpen && hasActiveXTabAnywhere

      const safeEnabled = Boolean(settings && settings.enabled)
      const safePaused = Boolean(flags && flags.pausedToday)
      const safeLocked = Boolean(flags && flags.locked)
      const safeTimekeeperLocked = Boolean(timekeeper && timekeeper.isLocked)
      const safeHasActiveTab = Boolean(hasActiveXTabInFocusedWindow)
      const safeAllowPopup = Boolean(allowDueToPopup)

      let shouldTrack =
        (safeHasActiveTab || safeAllowPopup) &&
        safeEnabled &&
        !safePaused &&
        !safeLocked &&
        !safeTimekeeperLocked

      if (!shouldTrack && suppressStops) {
        shouldTrack = Boolean(wasTracking || allowDueToPopup)
      }

      this.isTracking = shouldTrack

      if (wasTracking !== this.isTracking) {
        console.warn('🔄 updateTracking STATE CHANGE:', {
          wasTracking,
          isNowTracking: this.isTracking,
          hasActiveXTabInFocusedWindow,
          hasActiveXTabAnywhere,
          enabled: settings.enabled,
          paused: flags.pausedToday,
          locked: flags.locked,
          shouldTrack,
          activeXTabs: activeXTabs.map((t) => t.url),
          chromeFocused,
          focusedWindowId,
          popupOpen,
          allowDueToPopup,
        })
      }

      if (flags.pausedToday) {
        console.log('⏸️ Skipping tracking logic - extension is paused')
        return
      }

      if (flags.locked) {
        console.log('🔒 Skipping tracking logic - extension is locked')

        const tabs = await chrome.tabs.query({
          url: ['*://twitter.com/*', '*://x.com/*', '*://pro.x.com/*'],
        })

        console.log('🔒 Found X.com tabs to lock:', tabs.length)

        for (const tab of tabs) {
          if (!this.tabsWithOverlays.has(tab.id)) {
            console.log('🔒 Sending lock overlay to new tab:', tab.url)

            this.tabsWithOverlays.add(tab.id)
            try {
              await this.ensureContentScriptAndSendMessage(tab.id, {
                type: 'SHOW_SOFT_LOCK',
                settings: await storage.getSettings(),
                usage: await storage.getUsageToday(),
                flags: flags,
              })
            } catch (error) {
              console.log(
                '❌ Failed to send lock to tab:',
                tab.id,
                error.message
              )

              this.tabsWithOverlays.delete(tab.id)
            }
          } else {
            console.log('🔒 Tab', tab.id, 'already has overlay, skipping')
          }
        }

        await timekeeper.stop()
        return
      }

      if (this.isTracking) {
        console.log('✅ Should be tracking - ensuring timekeeper is running')

        if (!timekeeper.tickInterval) {
          console.log('⏰ Starting timekeeper - not currently running')

          if (!flags.locked && !timekeeper.isLocked) {
            await timekeeper.start()
          } else {
            console.log('🔒 Prevented starting timekeeper - locked')
          }
        } else {
          console.log('⏰ Timekeeper already running')
        }

        if (!timekeeper.isPaused && !flags.locked && !timekeeper.isLocked) {
          timekeeper.setActive(true)
          console.log('✅ Set timekeeper active (not paused)')

          try {
            timekeeper.broadcastRealTimeUpdate({
              type: 'STATUS_CHANGED',
              isTracking: true,
              locked: flags.locked || timekeeper.isLocked,
              paused: flags.pausedToday,
              usage: timekeeper.getCurrentRealTimeUsage(),
              timestamp: Date.now(),
            })
            timekeeper.broadcastRealTimeUpdate({
              type: 'REAL_TIME_UPDATE',
              usage: timekeeper.getCurrentRealTimeUsage(),
              timestamp: Date.now(),
            })
          } catch (_) {}

          if (popupOpen && !timekeeper.popupUpdateInterval) {
            timekeeper.startPopupUpdates()
            console.log('📱 Started popup updates after tracking resume')
          }
        } else {
          console.log('⏸️ Timekeeper started but staying inactive (paused)')
        }
      } else if (!this.isTracking && wasTracking) {
        console.log('❌ Stopping timekeeper - not actively viewing X.com')
        if (suppressStops) {
          console.log('⏭️ Skipping stop due to reset suppression window')
        } else {
          await timekeeper.stop()
        }
        try {
          timekeeper.broadcastRealTimeUpdate({
            type: 'STATUS_CHANGED',
            isTracking: false,
            locked: flags.locked || timekeeper.isLocked,
            paused: flags.pausedToday,
            usage: timekeeper.getCurrentRealTimeUsage(),
            timestamp: Date.now(),
          })
        } catch (_) {}
      }
    } finally {
      this.updateTrackingInProgress = false
    }
  }

  async handleSnoozeRequest() {
    if (this.snoozeInProgress) {
      console.log('⏳ Snooze already in progress - ignoring new request')
      return { success: false, error: 'Snooze in progress' }
    }
    this.snoozeInProgress = true
    console.log('🔄 Snooze request received')

    const requestTime = Date.now()
    if (requestTime - this.lastSnoozeRequest < 2000) {
      console.log('⏸️ Ignoring rapid snooze request')
      return {
        success: false,
        error: 'Please wait before requesting snooze again',
      }
    }
    this.lastSnoozeRequest = requestTime

    const settings = await storage.getSettings()
    if (!settings.allowSnooze) {
      console.log('❌ Snooze not allowed in settings')
      return { success: false, error: 'Snooze not allowed' }
    }

    const flags = await storage.getFlags()

    if (flags.snoozed || flags.snoozeUsedToday) {
      console.log('❌ Snooze already used today or currently active')
      return { success: false, error: 'Snooze already used today' }
    }

    console.log('✅ Snooze approved - proceeding with snooze logic')

    const cooldownMinutes = settings.cooldownMin || 5

    console.log('⏹️ Ensuring no existing timekeeper interval before snooze')
    await timekeeper.stop()

    const now = Date.now()

    await storage.updateUsageToday({
      millisActive: 0,
      lastTickAt: now,
      dateKey: new Date().toISOString().split('T')[0],
    })

    storage.cache.delete('usageToday')

    timekeeper.currentUsageMs = 0
    timekeeper.isInitialized = true
    timekeeper.isPaused = false
    timekeeper.isLocked = false
    timekeeper.lastTickTime = now
    timekeeper.lastUsageSave = 0

    console.log(
      '🔄 Snooze: Reset usage to 0, cooldown limit:',
      (settings.cooldownMin || 5) + 'm'
    )

    console.log(
      '🔄 Snooze period - NOT starting timekeeper (using setTimeout instead)'
    )
    
    
    

    await storage.updateFlags({
      snoozed: true,
      snoozeUsedToday: true,
      locked: false,
      nudged: false,
      frozenTimeUsed: undefined,
    })

    console.log('🔓 Extension unlocked for snooze period')

    timekeeper.broadcastRealTimeUpdate({
      type: 'STATUS_CHANGED',
      locked: false,
      snoozed: true,
      usage: 0,
      timestamp: Date.now(),
    })

    const tabs = await chrome.tabs.query({
      url: ['*://twitter.com/*', '*://x.com/*', '*://pro.x.com/*'],
    })

    console.log('🔄 Sending HIDE_OVERLAY to', tabs.length, 'tabs for snooze')
    tabs.forEach((tab) => {
      chrome.tabs
        .sendMessage(tab.id, {
          type: 'HIDE_OVERLAY',
        })
        .then(() => {
          console.log('✅ HIDE_OVERLAY sent successfully to tab', tab.id)
        })
        .catch((error) => {
          console.log(
            '❌ Failed to send HIDE_OVERLAY to tab',
            tab.id,
            error.message
          )
        })
    })

    const cooldownDurationMillis = cooldownMinutes * 60 * 1000

    setTimeout(async () => {
      
      const cooldownMs = cooldownDurationMillis
      await storage.updateFlags({
        snoozed: false,
        locked: true,
        nudged: false,
        frozenTimeUsed: cooldownMs,
      })

      timekeeper.isLocked = true
      await timekeeper.stop()

      timekeeper.broadcastRealTimeUpdate({
        type: 'STATUS_CHANGED',
        locked: true,
        snoozed: false,
        nudged: false,
        usage: cooldownMs,
        timestamp: Date.now(),
      })

      try {
        const tabsAfterSnooze = await chrome.tabs.query({
          url: ['*://twitter.com/*', '*://x.com/*', '*://pro.x.com/*'],
        })
        const settingsAfter = await storage.getSettings()
        const msg = {
          type: 'SHOW_SOFT_LOCK',
          settings: settingsAfter,
        }
        tabsAfterSnooze.forEach((tab) => {
          chrome.tabs.sendMessage(tab.id, msg).catch(() => {})
        })
      } catch (_) {}
      this.snoozeInProgress = false
    }, cooldownDurationMillis)

    if (chrome.notifications) {
      await this.createTransientNotification('snooze_confirmation', {
        type: 'basic',
        iconUrl: 'assets/icon-48x48.png',
        title: 'Boundr',
        message: `Snoozed for ${cooldownMinutes} minutes! Fresh time starts now.`,
      })

      try {
        timekeeper.broadcastRealTimeUpdate({
          type: 'STATUS_CHANGED',
          isTracking: this.isTracking,
          locked: flags.locked || timekeeper.isLocked,
          paused: flags.pausedToday,
          usage: timekeeper.getCurrentRealTimeUsage(),
          timestamp: Date.now(),
        })
      } catch (_) {}
    }
  }

  async handleBypassRequest(passcode) {
    const isValid = await rules.validatePasscode(passcode)
    if (!isValid) {
      if (chrome.notifications) {
        await this.createTransientNotification('invalid_passcode', {
          type: 'basic',
          iconUrl: 'assets/icon-48x48.png',
          title: 'Boundr',
          message: 'Invalid passcode. Please try again.',
        })
      }
    }

    await clearLockedState()

    if (chrome.notifications) {
      await this.createTransientNotification('access_granted', {
        type: 'basic',
        iconUrl: 'assets/icon-48x48.png',
        title: 'Boundr',
        message: 'Access granted for today',
      })
    }
  }

  async ensureContentScriptAndSendMessage(tabId, message) {
    const messageKey = `${tabId}-${message.type}-${Date.now()}`

    if (!this.pendingMessages) {
      this.pendingMessages = new Set()
    }

    if (this.pendingMessages.has(`${tabId}-${message.type}`)) {
      console.log(
        `⏸️ Already sending ${message.type} to tab ${tabId}, skipping duplicate`
      )
      return
    }

    this.pendingMessages.add(`${tabId}-${message.type}`)

    try {
      const maxRetries = 3
      const delays = [0, 1000, 2000]

      for (let i = 0; i < maxRetries; i++) {
        try {
          if (delays[i] > 0) {
            await new Promise((resolve) => setTimeout(resolve, delays[i]))
          }

          await chrome.tabs.sendMessage(tabId, message)
          console.log(
            `✅ Message sent successfully to tab ${tabId} on attempt ${i + 1}`
          )
          return
        } catch (error) {
          console.log(
            `❌ Attempt ${i + 1}/${maxRetries} failed for tab ${tabId}:`,
            error.message
          )

          if (
            error.message.includes('Receiving end does not exist') &&
            i === 0
          ) {
            try {
              console.log(`🔄 Injecting content script to tab ${tabId}`)
              await chrome.scripting.executeScript({
                target: { tabId: tabId },
                files: ['content/twitter_watch.js'],
              })

              await chrome.scripting.insertCSS({
                target: { tabId: tabId },
                files: ['content/softlock_overlay.css'],
              })

              console.log(`✅ Content script injected to tab ${tabId}`)

              await new Promise((resolve) => setTimeout(resolve, 1000))
            } catch (injectError) {
              console.log(
                `❌ Failed to inject content script to tab ${tabId}:`,
                injectError.message
              )
            }
          }

          if (i === maxRetries - 1) {
            console.log(
              '🔄 All attempts failed - content script may not be available'
            )
          }
        }
      }
    } finally {
      this.pendingMessages.delete(`${tabId}-${message.type}`)
    }
  }

  async togglePause() {
    const now = Date.now()

    if (now - this.lastPauseToggle < 1000) {
      console.log('⏸️ Ignoring rapid pause toggle')
      return
    }
    this.lastPauseToggle = now

    if (this.pauseInProgress) {
      console.log('⏸️ Pause operation already in progress, ignoring')
      return
    }
    this.pauseInProgress = true

    try {
      const flags = await storage.getFlags()
      const newPausedState = !flags.pausedToday

      console.log('⏸️ Toggling pause:', {
        wasPaused: flags.pausedToday,
        willBePaused: newPausedState,
        timekeeperActive: timekeeper.isActive,
        timekeeperRunning: !!timekeeper.tickInterval,
      })

      if (flags.pausedToday !== newPausedState) {
        await storage.updateFlags({ pausedToday: newPausedState })
      }

      timekeeper.isPaused = newPausedState

      if (newPausedState) {
        console.log('⏸️ PAUSED - Stopping timekeeper and real-time updates')

        const flags = await storage.getFlags()
        if (flags.snoozed) {
          console.log(
            '⏸️ Pausing during snooze - ending snooze but allowing resume'
          )
          await storage.updateFlags({
            snoozed: false,
            locked: false,
            pausedToday: true,
          })
        }

        this.tabsWithOverlays.clear()

        const tabs = await chrome.tabs.query({
          url: ['*://twitter.com/*', '*://x.com/*', '*://pro.x.com/*'],
        })

        for (const tab of tabs) {
          await this.ensureContentScriptAndSendMessage(tab.id, {
            type: 'HIDE_OVERLAY',
          })
        }

        await timekeeper.stop()
        timekeeper.stopPopupUpdates()

        if (chrome.notifications) {
          await this.createTransientNotification('extension_paused', {
            type: 'basic',
            iconUrl: 'assets/icon-48x48.png',
            title: 'Boundr',
            message: 'Extension paused. X.com tabs are accessible.',
          })
        }
      } else {
        console.log('▶️ RESUMED - Updating tracking')

        this.suppressStopUntil = Date.now() + 1200

        await this.checkActiveTabs()

        if (
          timekeeper &&
          timekeeper.popupConnections &&
          timekeeper.popupConnections.size > 0
        ) {
          try {
            const activeXTabs = await chrome.tabs.query({
              url: ['*://twitter.com/*', '*://x.com/*', '*://pro.x.com/*'],
              active: true,
            })
            if (activeXTabs.length > 0) {
              if (!timekeeper.tickInterval) {
                await timekeeper.start()
              }
              timekeeper.setActive(true)
            }
          } catch (_) {}
        }

        if (this.isTracking) {
          if (!timekeeper.tickInterval) {
            await timekeeper.start()
            console.log('▶️ Started timekeeper after resume')
          }

          timekeeper.setActive(true)
          console.log('▶️ Set timekeeper active after resume')

          if (timekeeper.popupConnections.size > 0) {
            timekeeper.startPopupUpdates()
          }
        }

        if (chrome.notifications) {
          await this.createTransientNotification('extension_resumed', {
            type: 'basic',
            iconUrl: 'assets/icon-48x48.png',
            title: 'Boundr',
            message: 'Extension resumed. Time tracking active.',
          })
        }
      }
    } catch (error) {
      console.error('Error in togglePause:', error)
    } finally {
      this.pauseInProgress = false
    }
  }

  async manualReset() {
    const nowTs = Date.now()
    if (this.lastResetRequestAt && nowTs - this.lastResetRequestAt < 1500) {
      console.log('⏳ Manual reset ignored - recent request in cooldown')
      return
    }
    this.lastResetRequestAt = nowTs

    if (this.resetInProgress) {
      console.log('🔄 Manual reset already in progress, skipping')
      return
    }

    this.resetInProgress = true

    try {
      console.log('🔄 Manual reset - starting clean reset process')

      timekeeper.broadcastRealTimeUpdate({
        type: 'REAL_TIME_UPDATE',
        usage: 0,
        timestamp: Date.now(),
      })

      await timekeeper.stop()

      timekeeper.currentUsageMs = 0
      timekeeper.isInitialized = true
      timekeeper.isLocked = false
      timekeeper.isPaused = false
      timekeeper.lastTickTime = null

      await Promise.all([
        storage.set('usageToday', {
          millisActive: 0,
          lastTickAt: Date.now(),
          dateKey: new Date().toISOString().split('T')[0],
        }),
        storage.set('flags', {
          nudged: false,
          locked: false,
          pausedToday: false,
          snoozed: false,
          frozenTimeUsed: undefined,
        }),
      ])

      storage.cache.clear()

      this.tabsWithOverlays.clear()

      const tabs = await chrome.tabs.query({
        url: ['*://twitter.com/*', '*://x.com/*', '*://pro.x.com/*'],
      })

      tabs.forEach((tab) => {
        chrome.tabs
          .sendMessage(tab.id, {
            type: 'HIDE_OVERLAY',
          })
          .catch(() => {})
      })

      const settings = await storage.getSettings()
      const fullLimit = settings.dailyLimitMin * 60 * 1000

      timekeeper.broadcastRealTimeUpdate({
        type: 'STATUS_CHANGED',
        isTracking: false,
        locked: false,
        paused: false,
        usage: 0,
        remaining: fullLimit,
        limit: fullLimit,
        timestamp: Date.now(),
      })

      this.suppressStopUntil = Date.now() + 1500

      await this.checkActiveTabs()

      console.log('🔄 Forcing tracking update after manual reset')
      await this.updateTrackingImmediate()

      setTimeout(async () => {
        console.log('🔄 Delayed tracking update after manual reset')
        try {
          await this.updateTrackingImmediate()
        } catch (error) {
          console.error('❌ Error in delayed tracking update:', error)
        }
      }, 1000)

      console.log('🔄 Manual reset completed successfully')
    } finally {
      this.resetInProgress = false
    }
  }

  async getStatus() {
    const now = Date.now()
    if (now - this.lastGetStatus < 100 && this.cachedStatus) {
      return this.cachedStatus
    }
    this.lastGetStatus = now

    const settings = await storage.getSettings()
    const usage = await storage.getUsageToday()
    const flags = await storage.getFlags()

    const realTimeUsage = timekeeper.getCurrentRealTimeUsage()
    const timeRemaining = await this.getTimeRemainingWithRealTime(
      realTimeUsage,
      settings,
      flags
    )
    const nextReset = await timekeeper.getNextResetTime()

    const activeXTabs = await chrome.tabs.query({
      url: ['*://twitter.com/*', '*://x.com/*', '*://pro.x.com/*'],
      active: true,
    })

    const isCurrentlyTracking =
      activeXTabs.length > 0 &&
      settings.enabled &&
      !flags.pausedToday &&
      !flags.locked

    const statusResult = {
      settings,
      usage,
      flags,
      timeRemaining,
      nextReset,
      isTracking: isCurrentlyTracking,
      activeTabs: activeXTabs.map((t) => t.id),
    }

    this.cachedStatus = statusResult
    return statusResult
  }

  async getTimeRemainingWithRealTime(realTimeUsage, settings, flags) {
    if (flags.pausedToday) {
      return { remaining: settings.dailyLimitMin * 60 * 1000, used: 0 }
    }

    let effectiveLimitMillis
    if (flags.snoozed) {
      effectiveLimitMillis = (settings.cooldownMin || 5) * 60 * 1000
    } else {
      effectiveLimitMillis = settings.dailyLimitMin * 60 * 1000
    }

    const remaining = Math.max(0, effectiveLimitMillis - realTimeUsage)

    if (flags.locked) {
      return {
        remaining,
        used: realTimeUsage,
        limit: effectiveLimitMillis,
        frozen: true,
      }
    }

    return {
      remaining,
      used: realTimeUsage,
      limit: effectiveLimitMillis,
      frozen: false,
    }
  }

  async cleanupStaleTabs() {
    if (this.activeTabs.size === 0) return

    try {
      const currentTabs = await chrome.tabs.query({
        url: ['*://twitter.com/*', '*://x.com/*', '*://pro.x.com/*'],
      })

      const currentTabIds = new Set(currentTabs.map((tab) => tab.id))
      const staleTabIds = []

      for (const tabId of this.activeTabs) {
        if (!currentTabIds.has(tabId)) {
          staleTabIds.push(tabId)
        }
      }

      if (staleTabIds.length > 0) {
        console.log('Removing stale tabs:', staleTabIds)
        staleTabIds.forEach((tabId) => this.activeTabs.delete(tabId))
        await this.updateTracking()
      }
    } catch (error) {
      console.error('Error cleaning up stale tabs:', error)
    }
  }

  async refreshTwitterTabs() {
    try {
      const tabs = await chrome.tabs.query({
        url: ['*://twitter.com/*', '*://x.com/*', '*://pro.x.com/*'],
      })

      for (const tab of tabs) {
        try {
          await chrome.tabs.reload(tab.id)
        } catch (error) {}
      }
    } catch (error) {}
  }

  async clearLockedState() {
    try {
      const flags = await storage.getFlags()
      if (flags.locked) {
        await storage.updateFlags({
          locked: false,
          frozenTimeUsed: undefined,
        })

        timekeeper.isLocked = false
      }
    } catch (error) {}
  }

  async checkNotifications() {
    try {
      const notifications = await storage.getNotifications()
      const settings = await storage.getSettings()

      console.log(
        'Checking notifications - enabled:',
        notifications.enabled,
        'extension enabled:',
        settings.enabled
      )

      
      if (!notifications.enabled) {
        console.log('Notifications disabled via toggle')
        return
      }

      const allCookies = await chrome.cookies.getAll({ domain: 'x.com' })
      const csrfCookie = allCookies.find((cookie) => cookie.name === 'ct0')

      if (!csrfCookie || allCookies.length === 0) {
        console.log('No authentication cookies found - please log into X.com')
        return
      }

      const csrfToken = csrfCookie.value
      const cookieHeader = allCookies
        .map((cookie) => `${cookie.name}=${cookie.value}`)
        .join('; ')

      const response = await fetch(
        'https://x.com/i/api/2/notifications/device_follow.json?tweet_mode=extended&count=20',
        {
          headers: {
            authorization: BEARER_TOKEN,
            'x-csrf-token': csrfToken,
            cookie: cookieHeader,
          },
        }
      )

      if (!response.ok) {
        if (response.status === 429) {
          console.log('Rate limited by Twitter API, backing off')
          return
        }
        console.log(
          'Failed to fetch notifications:',
          response.status,
          response.statusText
        )
        return
      }

      const data = await response.json()
      const tweets = data.globalObjects?.tweets
      const users = data.globalObjects?.users
      const timelineEntries =
        data.timeline?.instructions?.[0]?.addEntries?.entries

      if (!timelineEntries) {
        console.log('No timeline entries found in API response')
        return
      }

      const tweetEntries = timelineEntries.filter((entry) =>
        entry.entryId.startsWith('tweet-')
      )
      console.log('Found', tweetEntries.length, 'tweet entries')
      if (tweetEntries.length === 0) {
        console.log('No tweet entries found')
        return
      }

      const tweetIds = tweetEntries
        .map((entry) => entry.content?.item?.content?.tweet?.id)
        .filter((id) => id)
        .reverse()

      if (notifications.lastSeenTweetId === null) {
        console.log(
          'First notification check - setting baseline tweet ID:',
          tweetIds[0]
        )
        await storage.updateNotifications({
          lastSeenTweetId: tweetIds[0],
          processedTweetIds: tweetIds,
        })
        return
      }

      const newTweetIds = []
      for (const tweetId of tweetIds) {
        if (tweetId === notifications.lastSeenTweetId) {
          break
        }
        newTweetIds.push(tweetId)
      }

      console.log('Found', newTweetIds.length, 'new tweets since last check')
      if (newTweetIds.length > 0) {
        const trulyNewTweetIds = newTweetIds.filter(
          (tweetId) => !notifications.processedTweetIds.includes(tweetId)
        )
        console.log(
          'After filtering processed tweets:',
          trulyNewTweetIds.length,
          'truly new tweets'
        )

        if (trulyNewTweetIds.length > 0) {
          const allProcessedIds = [...notifications.processedTweetIds]
          
          
          const nowTs = Date.now()
          for (const [k, ts] of this.tweetNotifyRecent) {
            if (nowTs - ts > this.tweetNotifyTtlMs)
              this.tweetNotifyRecent.delete(k)
          }

          
          const notificationsToCreate = []
          
          for (let i = 0; i < trulyNewTweetIds.length; i++) {
            const tweetId = trulyNewTweetIds[i]
            const newTweet = tweets[tweetId]
            const author = users[newTweet?.user_id_str]

            allProcessedIds.push(tweetId)

            if (
              newTweet &&
              this.shouldNotifyForTweet(newTweet, notifications.filterType) &&
              !this.tweetNotifyRecent.has(tweetId) &&
              !this.tweetNotifyInFlight.has(tweetId)
            ) {
              console.log(
                'Queuing notification for tweet:',
                newTweet.id_str,
                'Position:',
                i + 1,
                'of',
                trulyNewTweetIds.length
              )

              if (newTweet.created_at) {
                const tweetCreatedAt = new Date(newTweet.created_at)
                const now = new Date()
                const timeDiffMinutes = (now - tweetCreatedAt) / (1000 * 60)
                console.log(
                  'Tweet age:',
                  timeDiffMinutes.toFixed(2),
                  'minutes (recent enough)'
                )
              }

              notificationsToCreate.push({
                tweet: newTweet,
                author: author,
                delay: 1000 + i * 1500 
              })
            } else if (newTweet) {
              console.log('Tweet filtered out or already processed - not showing notification for:', tweetId)

              if (newTweet.created_at) {
                const tweetCreatedAt = new Date(newTweet.created_at)
                const now = new Date()
                const timeDiffMinutes = (now - tweetCreatedAt) / (1000 * 60)
                console.log(
                  'Tweet age:',
                  timeDiffMinutes.toFixed(2),
                  'minutes (too old, filtered, or already processed)'
                )
              }
            }
          }

          
          console.log(`Creating ${notificationsToCreate.length} notifications for new tweets`)
          
          notificationsToCreate.forEach(({ tweet, author, delay }) => {
            setTimeout(async () => {
              const id = tweet.id_str
              
              
              if (
                this.tweetNotifyRecent.has(id) ||
                this.tweetNotifyInFlight.has(id)
              ) {
                console.log('Tweet already processed during delay, skipping:', id)
                return
              }
              
              this.tweetNotifyInFlight.add(id)

              chrome.notifications.create(
                'tweet_' + id,
                {
                  type: 'basic',
                  iconUrl:
                    author?.profile_image_url_https?.replace(
                      '_normal',
                      '_400x400'
                    ) ||
                    'https://abs.twimg.com/icons/apple-touch-icon-192x192.png',
                  title: `${author?.name || 'Unknown'} (@${
                    author?.screen_name || 'unknown'
                  })`,
                  message: tweet.full_text || tweet.text || 'New tweet',
                  priority: 2,
                  requireInteraction: false,
                  silent: false,
                },
                (notificationId) => {
                  if (chrome.runtime.lastError) {
                    console.error('Failed to create notification:', chrome.runtime.lastError)
                    this.tweetNotifyInFlight.delete(id)
                  } else {
                    console.log('Successfully created notification for tweet:', id)
                    this.tweetNotifyRecent.set(id, Date.now())

                    if (this.tweetNotifyRecent.size > this.tweetNotifyMax) {
                      const toRemove =
                        this.tweetNotifyRecent.size - this.tweetNotifyMax
                      const keys = this.tweetNotifyRecent.keys()
                      for (let r = 0; r < toRemove; r++) {
                        const k = keys.next().value
                        this.tweetNotifyRecent.delete(k)
                      }
                    }

                    const snapshot = Array.from(
                      this.tweetNotifyRecent.entries()
                    )
                    storage
                      .set('notificationsCache', { tweets: snapshot })
                      .catch(() => {})
                    this.tweetNotifyInFlight.delete(id)

                    
                    setTimeout(() => {
                      chrome.notifications.clear(
                        notificationId,
                        (wasCleared) => {
                          if (wasCleared) {
                            console.log('Auto-cleared notification:', notificationId)
                          }
                        }
                      )
                    }, 5000)
                  }
                }
              )
            }, delay)
          })

          if (allProcessedIds.length > 100) {
            const toKeep = allProcessedIds.slice(-50)
            await storage.updateNotifications({
              lastSeenTweetId: tweetIds[0],
              processedTweetIds: toKeep,
            })
          } else {
            await storage.updateNotifications({
              lastSeenTweetId: tweetIds[0],
              processedTweetIds: allProcessedIds,
            })
          }
        }
      }
    } catch (error) {
      if (error.message.includes('Failed to fetch')) {
        console.log('Network error while checking notifications:', error.message)
      } else {
        console.error('Error checking notifications:', error)
      }
    }
  }

  shouldNotifyForTweet(tweet, filterType) {
    const isRetweet = tweet.full_text && tweet.full_text.startsWith('RT @')

    const tweetCreatedAt = new Date(tweet.created_at)
    const now = new Date()
    const timeDiffMinutes = (now - tweetCreatedAt) / (1000 * 60)
    const isRecent = timeDiffMinutes <= 10

    console.log('Tweet filter check:', {
      tweetId: tweet.id_str,
      tweetText: tweet.full_text || tweet.text,
      isRetweet,
      isRecent,
      ageMinutes: timeDiffMinutes.toFixed(2),
      filterType,
      isReply: !!tweet.in_reply_to_user_id_str,
      createdAt: tweet.created_at,
    })

    if (!isRecent) {
      console.log('Tweet too old, skipping notification')
      return false
    }

    let shouldNotify = false
    switch (filterType) {
      case 'posts':
        shouldNotify =
          !tweet.in_reply_to_user_id_str &&
          !isRetweet &&
          !tweet.retweeted_status
        break
      case 'posts_and_rts':
        shouldNotify = !tweet.in_reply_to_user_id_str
        break
      case 'all':
        shouldNotify = true
        break
      default:
        shouldNotify =
          !tweet.in_reply_to_user_id_str &&
          !isRetweet &&
          !tweet.retweeted_status
    }

    console.log('Final filter decision:', {
      tweetId: tweet.id_str,
      shouldNotify,
      filterType,
      isReply: !!tweet.in_reply_to_user_id_str,
      isRetweet,
      hasRetweetedStatus: !!tweet.retweeted_status,
    })

    return shouldNotify
  }
}

const globalService = new TwitterTimeLimitService()

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'daily_reset') {
    await storage.checkDailyReset()
    await globalService.scheduleDailyReset()
  } else if (alarm.name === 'notificationCheck') {
    await globalService.checkNotifications()
  } else if (alarm.name === 'keepAlive') {
    await ensureBackgroundNotifications()

    if (Math.random() < 0.1) {
      const alarms = await chrome.alarms.getAll()
      const notificationAlarm = alarms.find(
        (alarm) => alarm.name === 'notificationCheck'
      )
      if (notificationAlarm) {
      } else {
        await ensureBackgroundNotifications()
      }
    }
  } else if (alarm.name === 'timekeeper_tick') {
    await timekeeper.tick()
  }
})

const keepAlive = () => {
  chrome.alarms.create('keepAlive', {
    delayInMinutes: 0.1,
    periodInMinutes: 0.1,
  })
}
const ensureBackgroundNotifications = async () => {
  try {
    const notifications = await storage.getNotifications()
    
    
    if (notifications.enabled) {
      chrome.alarms.clear('notificationCheck')
      chrome.alarms.create('notificationCheck', {
        delayInMinutes: 0,
        periodInMinutes: notifications.checkInterval,
      })
    }
  } catch (error) {}
}
const ensureNotificationAlarms = async () => {
  try {
    const notifications = await storage.getNotifications()
    
    
    if (notifications.enabled) {
      chrome.alarms.clear('notificationCheck')
      chrome.alarms.create('notificationCheck', {
        delayInMinutes: 0,
        periodInMinutes: notifications.checkInterval,
      })
    }
  } catch (error) {}
}
keepAlive()
ensureNotificationAlarms()
setTimeout(async () => {
  await new TwitterTimeLimitService().checkNotifications()
}, 1000)

chrome.runtime.onStartup.addListener(() => {
  keepAlive()
  ensureNotificationAlarms()

  setTimeout(async () => {
    await globalService.checkNotifications()
  }, 1000)
})
chrome.runtime.onInstalled.addListener(() => {
  keepAlive()
  ensureNotificationAlarms()

  setTimeout(async () => {
    await globalService.checkNotifications()
  }, 1000)
})
chrome.windows.onFocusChanged.addListener((windowId) => {
  if (windowId !== chrome.windows.WINDOW_ID_NONE) {
    keepAlive()
    ensureNotificationAlarms()

    setTimeout(async () => {
      await globalService.checkNotifications()
    }, 1000)
  }
})
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  return false
})
chrome.windows.onRemoved.addListener((windowId) => {
  ensureBackgroundNotifications()
})
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  try {
    const tab = await chrome.tabs.get(activeInfo.tabId)

    if (
      !tab.url.includes('x.com') &&
      !tab.url.includes('twitter.com') &&
      !tab.url.includes('pro.x.com')
    ) {
      ensureBackgroundNotifications()
    }
  } catch (error) {}

  try {
    globalService.debouncedUpdateTracking()
  } catch (_) {}
})

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' || changeInfo.url) {
    try {
      console.log('🔄 Tab updated:', {
        tabId,
        url: tab.url,
        status: changeInfo.status,
        urlChanged: !!changeInfo.url,
      })

      
      if (
        changeInfo.status === 'complete' &&
        (tab.url?.includes('x.com') ||
          tab.url?.includes('twitter.com') ||
          tab.url?.includes('pro.x.com'))
      ) {
        if (globalService.tabsWithOverlays.has(tabId)) {
          console.log(
            '🔄 Tab refreshed - clearing overlay tracking for:',
            tabId
          )
          globalService.tabsWithOverlays.delete(tabId)
        }
      }

      setTimeout(() => {
        try {
          globalService.debouncedUpdateTracking()
        } catch (error) {
          console.error('❌ Error in delayed update tracking:', error)
        }
      }, 500)
    } catch (error) {
      console.error('❌ Error in tab update handler:', error)
    }
  }
})

chrome.tabs.onRemoved.addListener(async (tabId, removeInfo) => {
  if (globalService.activeTabs.has(tabId)) {
    console.log('Removing closed tab from tracking:', tabId)
    globalService.activeTabs.delete(tabId)
    globalService.debouncedUpdateTracking()
  }

  if (globalService.tabsWithOverlays.has(tabId)) {
    console.log('Removing closed tab from overlay tracking:', tabId)
    globalService.tabsWithOverlays.delete(tabId)
  }
})

chrome.runtime.onConnect.addListener(async (port) => {
  if (port.name === 'popup-realtime') {
    timekeeper.addPopupConnection(port)

    const usage = timekeeper.getCurrentRealTimeUsage()
    port.postMessage({
      type: 'REAL_TIME_UPDATE',
      usage: usage,
      timestamp: Date.now(),
    })

    try {
      await globalService.updateTrackingImmediate()
    } catch (_) {}
  }
})
