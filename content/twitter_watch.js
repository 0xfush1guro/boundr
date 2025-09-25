/**
 * Content script for Twitter monitoring and overlay injection
 * Note: ES6 imports are not supported in content scripts, so we include the library code directly
 */

;(() => {
  const DISABLE_CONSOLE_LOGS = true
  if (DISABLE_CONSOLE_LOGS && typeof console !== 'undefined') {
    const noop = function () {}
    console.log = noop
    console.info = noop
    console.debug = noop
    console.trace = noop
  }
})()

if (typeof window.TwitterWatcher === 'undefined') {
  window.TwitterWatcher = class TwitterWatcher {
    constructor() {
      this.isActive = false
      this.overlay = null
      this.activityTimeout = null
      this.idleCheckInterval = null
      this.lastActivity = Date.now()
      this.hasReportedIdle = false
      this.lastActivityReport = 0
      this.customImage = null
      this.lastImageCheck = 0
      this.imageCacheTimeout = 10000
      this.creatingOverlay = false
      
      
      this.blockTwitterPushNotifications()
      this.lastOverlayCheck = 0
      this.checkingOverlayState = false

      this.lastKnownState = {
        locked: null,
        paused: null,
        snoozed: null,
        hasOverlay: false,
      }

      this.init()
    }

    async blockTwitterPushNotifications() {
      try {
        const regs = await navigator.serviceWorker.getRegistrations()
        for (const reg of regs) {
          try {
            const sub = await reg.pushManager.getSubscription()
            if (sub) {
              await sub.unsubscribe()
              console.log('Unsubscribed push:', sub.endpoint)
            }
            const ok = await reg.unregister()
            console.log('Service worker unregistered:', ok)
          } catch (e) { 
            console.error(e) 
          }
        }
      } catch (e) {
        console.error('Failed to block push notifications:', e)
      }
    }

    async init() {
      console.log('🎬 TwitterWatcher initializing on:', window.location.href)

      this.setupErrorHandling()

      await this.checkInitialState()

      this.setupMessageListeners()

      this.setupActivityTracking()

      this.setupVisibilityTracking()

      this.setupNavigationTracking()

      console.log('✅ TwitterWatcher initialization complete')
    }

    setupErrorHandling() {
      window.addEventListener('unload', () => {
        this.cleanup()
      })

      window.addEventListener('error', (event) => {
        if (
          event.error &&
          event.error.message &&
          event.error.message.includes('Extension context invalidated')
        ) {
          console.warn(
            'Extension context invalidated, disabling content script'
          )
          this.cleanup()
          event.preventDefault()
          return false
        }
      })

      const originalConsoleError = console.error
      console.error = (...args) => {
        if (
          args[0] &&
          args[0].includes &&
          args[0].includes('Extension context invalidated')
        ) {
          console.warn(
            'Extension context invalidated, disabling content script'
          )
          this.cleanup()
          return
        }
        originalConsoleError.apply(console, args)
      }
    }

    cleanup() {
      this.isActive = false

      if (this.idleCheckInterval) {
        clearInterval(this.idleCheckInterval)
        this.idleCheckInterval = null
      }

      if (this.activityTimeout) {
        clearTimeout(this.activityTimeout)
        this.activityTimeout = null
      }

      this.hideOverlay()
    }

    isExtensionContextValid() {
      try {
        return chrome.runtime && chrome.runtime.id
      } catch (error) {
        return false
      }
    }

    async checkInitialState() {
      try {
        if (!this.isExtensionContextValid()) {
          return
        }
        const response = await chrome.runtime.sendMessage({
          type: 'GET_STATUS',
        })
        if (
          response &&
          response.settings.enabled &&
          !response.flags.pausedToday
        ) {
          await this.setActive(true)
        }
      } catch (error) {
        console.warn('Failed to get initial state:', error)
      }
    }

    setupMessageListeners() {
      console.log('🔗 Setting up message listeners')
      chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        console.log('📨 Content script received message:', message.type)
        this.handleMessage(message, sender, sendResponse)
        return true
      })
      console.log('✅ Message listeners set up')
    }

    async handleMessage(message, sender, sendResponse) {
      try {
        switch (message.type) {
          case 'SHOW_NUDGE':
            chrome.runtime
              .sendMessage({ type: 'GET_STATUS' })
              .then((response) => {
                const overlayExists = !!document.querySelector(
                  '.twitter-time-limit-overlay'
                )
                const canShowNudge =
                  response &&
                  response.settings.enabled &&
                  !overlayExists &&
                  !response.flags.locked &&
                  !response.flags.snoozed &&
                  !response.flags.snoozeUsedToday

                if (canShowNudge) {
                  this.showNudge(message.settings, message.timeLeft)
                } else {
                  console.log(
                    '🔕 Nudge suppressed (overlay/locked/snoozed/snooze used)'
                  )
                }
              })
              .catch(() => {})
            sendResponse({ success: true })
            break

          case 'SHOW_SOFT_LOCK':
            chrome.runtime
              .sendMessage({ type: 'GET_STATUS' })
              .then((response) => {
                if (response && response.settings.enabled) {
                  this.lastKnownState.locked = true
                  this.lastKnownState.hasOverlay = true
                  this.showSoftLock(message.settings)
                }
              })
              .catch(() => {})
            sendResponse({ success: true })
            break

          case 'SHOW_CLOSE_COUNTDOWN':
            chrome.runtime
              .sendMessage({ type: 'GET_STATUS' })
              .then((response) => {
                if (response && response.settings.enabled) {
                  this.showCloseCountdown(message.settings)
                }
              })
              .catch(() => {})
            sendResponse({ success: true })
            break

          case 'HIDE_OVERLAY':
            console.log('🔄 HIDE_OVERLAY message received')

            this.lastKnownState.locked = false
            this.lastKnownState.hasOverlay = false
            this.hideOverlay()
            sendResponse({ success: true })
            break

          case 'EXTENSION_DISABLED':
            this.hideOverlay()
            this.setActive(false)
            sendResponse({ success: true })
            break

          case 'SETTINGS_UPDATED':
            console.log('🔄 Settings updated - invalidating image cache')
            this.invalidateImageCache()
            sendResponse({ success: true })
            break

          default:
            sendResponse({ error: 'Unknown message type' })
        }
      } catch (error) {
        console.error('Error handling message:', error)
        sendResponse({ error: error.message })
      }
    }

    setupActivityTracking() {
      const activityEvents = [
        'mousedown',
        'keypress',
        'scroll',
        'touchstart',
        'click',
      ]

      activityEvents.forEach((event) => {
        document.addEventListener(
          event,
          () => {
            this.recordActivity()
          },
          { passive: true }
        )
      })

      this.idleCheckInterval = setInterval(() => {
        if (!this.isExtensionContextValid()) {
          this.cleanup()
          return
        }

        const now = Date.now()
        if (now - this.lastActivity > 30000) {
          if (!this.hasReportedIdle) {
            this.reportIdle()
            this.hasReportedIdle = true
          }
        } else {
          this.hasReportedIdle = false
        }
      }, 5000)
    }

    setupVisibilityTracking() {
      document.addEventListener('visibilitychange', async () => {
        if (document.hidden) {
          await this.setActive(false)
        } else {
          await this.setActive(true)
        }
      })
    }

    setupNavigationTracking() {
      console.log(
        '🔄 Navigation tracking temporarily disabled to prevent flickering'
      )

      return

      let currentUrl = window.location.href
      let navigationTimeout = null

      const observer = new MutationObserver(() => {
        if (window.location.href !== currentUrl) {
          currentUrl = window.location.href

          if (navigationTimeout) {
            clearTimeout(navigationTimeout)
          }

          navigationTimeout = setTimeout(() => {
            if (window.location.href === currentUrl) {
              this.checkOverlayState()
            }
            navigationTimeout = null
          }, 5000)
        }
      })

      observer.observe(document.body, {
        childList: true,
        subtree: true,
      })
    }

    recordActivity() {
      this.lastActivity = Date.now()
      this.hasReportedIdle = false
      if (this.isActive) {
        this.reportActivity()
      }
    }

    reportActivity() {
      if (!this.isExtensionContextValid()) {
        return
      }

      const now = Date.now()
      if (now - this.lastActivityReport < 2000) {
        return
      }
      this.lastActivityReport = now

      try {
        chrome.runtime.sendMessage({ type: 'USER_ACTIVITY' }).catch(() => {})
      } catch (error) {
        if (
          error.message &&
          error.message.includes('Extension context invalidated')
        ) {
          this.cleanup()
        }
      }
    }

    reportIdle() {
      if (!this.isExtensionContextValid()) {
        return
      }
      try {
        chrome.runtime.sendMessage({ type: 'USER_IDLE' }).catch(() => {})
      } catch (error) {
        if (
          error.message &&
          error.message.includes('Extension context invalidated')
        ) {
          this.cleanup()
        }
      }
    }

    async setActive(active) {
      this.isActive = active

      if (!this.isExtensionContextValid()) {
        return
      }

      try {
        const response = await chrome.runtime.sendMessage({
          type: 'GET_STATUS',
        })
        if (!response || !response.settings.enabled) {
          this.isActive = false
          return
        }
      } catch (error) {
        this.isActive = false
        return
      }

      try {
        if (active) {
          chrome.runtime.sendMessage({ type: 'TAB_ACTIVE' }).catch(() => {})
        } else {
          chrome.runtime.sendMessage({ type: 'TAB_INACTIVE' }).catch(() => {})
        }
      } catch (error) {
        if (
          error.message &&
          error.message.includes('Extension context invalidated')
        ) {
          this.cleanup()
        }
      }
    }

    async showNudge(settings, timeLeft) {
      this.createToast({
        title: 'Boundr',
        message: this.getMessage(
          settings.tone,
          'nudge',
          timeLeft,
          settings.overlayCustomization
        ),
        duration: 10000,
        actions: await this.getNudgeActions(settings),
      })
    }

    async getNudgeActions(settings) {
      if (!settings.allowSnooze) {
        return []
      }

      try {
        const response = await chrome.runtime.sendMessage({
          type: 'GET_STATUS',
        })
        if (
          response &&
          response.flags &&
          (response.flags.snoozed || response.flags.snoozeUsedToday)
        ) {
          return [
            { text: 'Snooze used', action: 'dismiss' },
            { text: 'Dismiss', action: 'dismiss' },
          ]
        } else {
          return [
            { text: `Snooze ${settings.cooldownMin}m`, action: 'snooze' },
            { text: 'Dismiss', action: 'dismiss' },
          ]
        }
      } catch (error) {
        console.warn('Failed to check snooze status for nudge:', error)
        return [{ text: 'Dismiss', action: 'dismiss' }]
      }
    }

    async showSoftLock(settings) {
      console.log('🔄 showSoftLock called - creating new overlay')
      if (this.creatingOverlay) {
        console.log('⏳ Overlay creation already in progress - skipping')
        return
      }
      this.creatingOverlay = true
      try {
        this.removeAllOverlays()
        this.overlay = await this.createSoftLockOverlay(settings)
        document.body.appendChild(this.overlay)
        console.log('🔄 Soft lock overlay added to DOM')

        if (this.isExtensionContextValid()) {
          try {
            const response = await chrome.runtime.sendMessage({
              type: 'GET_STATUS',
            })
            if (
              response &&
              response.flags &&
              (response.flags.snoozed || response.flags.snoozeUsedToday)
            ) {
              this.disableSnoozeButton()
            }
          } catch (error) {
            console.warn('Failed to check snooze status:', error)
          }
        }
      } finally {
        this.creatingOverlay = false
      }
    }

    async showCloseCountdown(settings) {
      if (this.creatingOverlay) {
        console.log('⏳ Overlay creation already in progress - skipping')
        return
      }
      this.creatingOverlay = true
      try {
        this.removeAllOverlays()
        this.overlay = await this.createCloseCountdownOverlay(settings)
        document.body.appendChild(this.overlay)

        if (this.isExtensionContextValid()) {
          try {
            const response = await chrome.runtime.sendMessage({
              type: 'GET_STATUS',
            })
            if (response && response.flags && response.flags.snoozed) {
              this.disableSnoozeButton()
            }
          } catch (error) {
            console.warn('Failed to check snooze status:', error)
          }
        }
      } finally {
        this.creatingOverlay = false
      }
    }

    hideOverlay() {
      console.log('hideOverlay called, overlay exists:', !!this.overlay)
      this.removeAllOverlays()
    }

    removeAllOverlays() {
      try {
        const overlays = document.querySelectorAll(
          '.twitter-time-limit-overlay'
        )
        if (overlays.length > 0) {
          console.log('🧹 Removing all overlays found:', overlays.length)
          overlays.forEach((el) => el.remove())
        }
      } catch (e) {}
      this.overlay = null
      console.log('Overlay removed successfully')
    }

    checkOverlayState() {
      if (!this.isExtensionContextValid()) {
        return
      }

      if (this.checkingOverlayState) {
        console.log('🔄 checkOverlayState - already in progress, skipping')
        return
      }
      this.checkingOverlayState = true

      const now = Date.now()
      if (now - this.lastOverlayCheck < 3000) {
        console.log(
          '🔄 checkOverlayState - too soon since last check, skipping'
        )
        this.checkingOverlayState = false
        return
      }
      this.lastOverlayCheck = now

      console.log(
        '🔄 checkOverlayState called - current cached state:',
        this.lastKnownState
      )
      chrome.runtime
        .sendMessage({ type: 'GET_STATUS' })
        .then(async (response) => {
          try {
            if (response && response.settings.enabled) {
              const currentState = {
                locked: response.flags.locked,
                paused: response.flags.pausedToday,
                snoozed: response.flags.snoozed,
                hasOverlay: !!(
                  this.overlay ||
                  document.querySelector('.twitter-time-limit-overlay')
                ),
              }

              if (this.lastKnownState.locked === null) {
                console.log(
                  '🔄 checkOverlayState - first run, caching initial state:',
                  currentState
                )
                this.lastKnownState = { ...currentState }
                
                
                if (currentState.locked && !currentState.hasOverlay && !this.creatingOverlay) {
                  console.log('🔄 checkOverlayState - first run, showing overlay (locked)')
                  await this.showSoftLock(response.settings)
                }
                return
              }

              const stateChanged =
                this.lastKnownState.locked !== currentState.locked ||
                this.lastKnownState.paused !== currentState.paused ||
                this.lastKnownState.snoozed !== currentState.snoozed

              if (!stateChanged) {
                console.log(
                  '🔄 checkOverlayState - no state change, skipping overlay operations'
                )
                return
              }

              console.log(
                '🔄 checkOverlayState - state changed, applying changes:',
                {
                  old: this.lastKnownState,
                  new: currentState,
                }
              )

              this.lastKnownState = { ...currentState }

              if (currentState.locked) {
                if (!currentState.hasOverlay && !this.creatingOverlay) {
                  console.log('🔄 checkOverlayState - showing overlay (locked)')
                  await this.showSoftLock(response.settings)
                }
              } else if (currentState.paused || currentState.snoozed) {
                if (currentState.hasOverlay) {
                  console.log(
                    '🔄 checkOverlayState - hiding overlay (paused/snoozed)'
                  )
                  this.hideOverlay()
                }
              } else if (!currentState.locked && currentState.hasOverlay) {
                console.log(
                  '🔄 checkOverlayState - hiding overlay (not locked)'
                )
                this.hideOverlay()
              }
            }
          } finally {
            this.checkingOverlayState = false
          }
        })
        .catch(() => {
          this.checkingOverlayState = false
        })
    }

    createToast({ title, message, duration = 5000, actions = [] }) {
      const toast = document.createElement('div')
      toast.className = 'twitter-time-limit-toast'
      toast.innerHTML = `
      <div class="toast-content">
        <div class="toast-title">${title}</div>
        <div class="toast-message">${message}</div>
        ${
          actions.length > 0
            ? `
          <div class="toast-actions">
            ${actions
              .map(
                (action) => `
              <button class="toast-action" data-action="${action.action}">
                ${action.text}
              </button>
            `
              )
              .join('')}
          </div>
        `
            : ''
        }
      </div>
    `

      Object.assign(toast.style, {
        position: 'fixed',
        top: '20px',
        right: '20px',
        background: 'var(--bg, #ffffff)',
        border: '1px solid var(--border, #e2e8f0)',
        borderRadius: '12px',
        padding: '16px',
        boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1)',
        zIndex: '10000',
        maxWidth: '320px',
        fontFamily: 'system-ui, -apple-system, sans-serif',
        fontSize: '14px',
        color: 'var(--fg, #0f172a)',
      })

      actions.forEach((action) => {
        const button = toast.querySelector(`[data-action="${action.action}"]`)
        if (button) {
          button.addEventListener('click', () => {
            this.handleToastAction(action.action)
            toast.remove()
          })
        }
      })

      document.body.appendChild(toast)

      setTimeout(() => {
        if (toast.parentNode) {
          toast.remove()
        }
      }, duration)

      return toast
    }

    handleToastAction(action) {
      switch (action) {
        case 'snooze':
          chrome.runtime.sendMessage({ type: 'SNOOZE_REQUEST' })
          break
        case 'dismiss':
          break
      }
    }

    async createSoftLockOverlay(settings) {
      const overlay = document.createElement('div')
      overlay.className = 'twitter-time-limit-overlay'

      const message = this.getMessage(
        settings.tone,
        'limit',
        null,
        settings.overlayCustomization
      )
      const nextReset = this.getNextResetTime(settings.resetHourLocal)

      console.log('Creating soft lock overlay with settings:', settings)
      console.log('Cooldown minutes setting:', settings.cooldownMin)

      let visualElement = '<div class="overlay-emoji">🚫</div>'

      console.log('🎭 Overlay customization check:', {
        hasCustomization: !!settings.overlayCustomization,
        isEnabled: settings.overlayCustomization?.enabled,
        template: settings.overlayCustomization?.template,
      })

      if (
        settings.overlayCustomization &&
        settings.overlayCustomization.enabled
      ) {
        console.log('🎭 Custom overlay enabled')

        let customImage = settings.overlayCustomization.customImage
        if (!customImage) {
          console.log('🎭 No image in settings, fetching from storage')
          customImage = await this.getCustomImage()
        }

        console.log('🎭 Custom image result:', {
          hasImage: !!customImage,
          imageLength: customImage?.length || 0,
          imagePreview: customImage
            ? customImage.substring(0, 50) + '...'
            : null,
          source: settings.overlayCustomization.customImage
            ? 'settings'
            : 'storage',
        })

        if (customImage) {
          visualElement = `<img src="${customImage}" class="overlay-image" alt="Custom overlay image" />`
          console.log('🎭 Using custom image for overlay')
        } else {
          console.log('🎭 No custom image available, using default emoji')
        }
      } else {
        console.log('🎭 Custom overlay not enabled, using default emoji')
      }

      overlay.innerHTML = `
      <div class="overlay-content">
        ${visualElement}
        <h1 class="overlay-title">${message}</h1>
        <p class="overlay-subtitle">Back at ${nextReset} or use cooldown</p>
        <div class="overlay-actions">
          <button class="overlay-button overlay-button-secondary" data-action="cooldown">
            Start cooldown ${settings.cooldownMin}m
          </button>
          ${
            settings.passcodeHash
              ? `
            <button class="overlay-button overlay-button-primary" data-action="bypass">
              I insist (enter passcode)
            </button>
          `
              : ''
          }
        </div>
      </div>
    `

      this.styleOverlay(overlay)
      this.addOverlayEventListeners(overlay, settings)

      return overlay
    }

    async createCloseCountdownOverlay(settings) {
      const overlay = document.createElement('div')
      overlay.className =
        'twitter-time-limit-overlay twitter-time-limit-countdown'

      const message = this.getMessage(
        settings.tone,
        'limit',
        null,
        settings.overlayCustomization
      )

      let visualElement = '<div class="overlay-emoji">⏰</div>'
      if (
        settings.overlayCustomization &&
        settings.overlayCustomization.enabled
      ) {
        const customImage = await this.getCustomImage()
        if (customImage) {
          visualElement = `<img src="${customImage}" class="overlay-image" alt="Custom overlay image" />`
        }
      }

      overlay.innerHTML = `
      <div class="overlay-content">
        ${visualElement}
        <h1 class="overlay-title">${message}</h1>
        <p class="overlay-subtitle">Closing tab in <span class="countdown-number">10</span> seconds</p>
        <div class="overlay-actions">
          <button class="overlay-button overlay-button-secondary" data-action="cooldown">
            Start cooldown ${settings.cooldownMin}m
          </button>
          ${
            settings.passcodeHash
              ? `
            <button class="overlay-button overlay-button-primary" data-action="bypass">
              I insist (enter passcode)
            </button>
          `
              : ''
          }
        </div>
      </div>
    `

      this.styleOverlay(overlay)
      this.addOverlayEventListeners(overlay, settings)

      this.startCountdown(overlay)

      return overlay
    }

    startCountdown(overlay) {
      let count = 10
      const countdownElement = overlay.querySelector('.countdown-number')

      const interval = setInterval(() => {
        count--
        if (countdownElement) {
          countdownElement.textContent = count
        }

        if (count <= 0) {
          clearInterval(interval)
        }
      }, 1000)
    }

    styleOverlay(overlay) {
      Object.assign(overlay.style, {
        position: 'fixed',
        top: '0',
        left: '0',
        width: '100%',
        height: '100%',
        background: 'rgba(0, 0, 0, 0.8)',
        backdropFilter: 'blur(8px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: '999999',
        fontFamily: 'system-ui, -apple-system, sans-serif',
      })

      const content = overlay.querySelector('.overlay-content')
      Object.assign(content.style, {
        background: 'var(--bg, #ffffff)',
        border: '1px solid var(--border, #e2e8f0)',
        borderRadius: '24px',
        padding: '50px',
        textAlign: 'center',
        maxWidth: '520px',
        boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
      })

      const emoji = overlay.querySelector('.overlay-emoji')
      if (emoji) {
        Object.assign(emoji.style, {
          fontSize: '64px',
          marginBottom: '20px',
        })
      }

      const title = overlay.querySelector('.overlay-title')
      if (title) {
        Object.assign(title.style, {
          fontSize: '28px',
          fontWeight: 'bold',
          marginBottom: '12px',
          color: 'var(--fg, #0f172a)',
        })
      }

      const subtitle = overlay.querySelector('.overlay-subtitle')
      if (subtitle) {
        Object.assign(subtitle.style, {
          fontSize: '18px',
          color: 'var(--fg-secondary, #64748b)',
          marginBottom: '32px',
        })
      }

      const actions = overlay.querySelector('.overlay-actions')
      if (actions) {
        Object.assign(actions.style, {
          display: 'flex',
          gap: '12px',
          justifyContent: 'center',
          flexWrap: 'wrap',
        })
      }

      const buttons = overlay.querySelectorAll('.overlay-button')
      buttons.forEach((button) => {
        Object.assign(button.style, {
          padding: '16px 32px',
          borderRadius: '12px',
          border: 'none',
          fontSize: '16px',
          fontWeight: '600',
          cursor: 'pointer',
          transition: 'all 0.3s',
          minWidth: '160px',
        })

        if (button.classList.contains('overlay-button-primary')) {
          Object.assign(button.style, {
            background: '#3b82f6',
            color: '#ffffff',
          })
        } else {
          Object.assign(button.style, {
            background: 'var(--bg-secondary, #f8fafc)',
            color: 'var(--fg, #0f172a)',
            border: '1px solid var(--border, #e2e8f0)',
          })
        }
      })
    }

    addOverlayEventListeners(overlay, settings) {
      const buttons = overlay.querySelectorAll('.overlay-button')

      buttons.forEach((button) => {
        button.addEventListener('click', () => {
          const action = button.dataset.action
          this.handleOverlayAction(action, settings)
        })
      })
    }

    handleOverlayAction(action, settings) {
      console.log('Overlay action clicked:', action)

      if (!this.isExtensionContextValid()) {
        console.warn(
          'Extension context invalid, cannot perform action:',
          action
        )
        return
      }

      switch (action) {
        case 'cooldown':
          console.log('Sending snooze request...')
          chrome.runtime
            .sendMessage({
              type: 'SNOOZE_REQUEST',
            })
            .then((response) => {
              console.log('Snooze response:', response)
              if (response && response.success) {
                console.log('Snooze successful, hiding overlay immediately')
                this.hideOverlay()
              } else if (response && response.error) {
                console.log('Snooze failed:', response.error)
                this.showSnoozeError(response.error)
                this.disableSnoozeButton()
              }
            })
            .catch((error) => {
              console.error('Snooze error:', error)
            })
          break

        case 'bypass':
          this.promptForPasscode()
          break
      }
    }

    promptForPasscode() {
      if (!this.isExtensionContextValid()) {
        console.warn('Extension context invalid, cannot prompt for passcode')
        return
      }

      const passcode = prompt('Enter passcode to bypass:')
      if (passcode) {
        chrome.runtime
          .sendMessage({
            type: 'BYPASS_REQUEST',
            passcode,
          })
          .catch((error) => {
            console.error('Bypass request error:', error)
          })
      }
    }

    showSnoozeError(error) {
      const errorDiv = document.createElement('div')
      errorDiv.className = 'snooze-error'
      errorDiv.textContent =
        error === 'Snooze already used today'
          ? 'Snooze already used today'
          : 'Snooze not available'
      errorDiv.style.cssText = `
      position: absolute;
      top: 10px;
      left: 50%;
      transform: translateX(-50%);
      background: #fee2e2;
      color: #dc2626;
      padding: 8px 16px;
      border-radius: 8px;
      font-size: 14px;
      font-weight: 500;
      border: 1px solid #fecaca;
      z-index: 1000000;
    `

      if (this.overlay) {
        this.overlay.appendChild(errorDiv)

        setTimeout(() => {
          if (errorDiv.parentNode) {
            errorDiv.remove()
          }
        }, 3000)
      }
    }

    disableSnoozeButton() {
      if (this.overlay) {
        const snoozeButton = this.overlay.querySelector(
          '[data-action="cooldown"]'
        )
        if (snoozeButton) {
          snoozeButton.disabled = true
          snoozeButton.textContent = 'Snooze used'
          snoozeButton.style.cssText = `
          background: #f3f4f6 !important;
          color: #9ca3af !important;
          cursor: not-allowed !important;
          opacity: 0.6 !important;
        `
        }
      }
    }

    getMessage(tone, type, timeLeft = null, overlayCustomization = null) {
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

      const timeLeftText = timeLeft
        ? this.formatTimeLeft(timeLeft)
        : '5 minutes'

      const messages = {
        gentle: {
          limit: "Let's call it a day 🫶",
          nudge: `Just ${timeLeftText} left! Take a break?`,
        },
        classic: {
          limit: "That's enough Twitter for today, mate.",
          nudge: `${timeLeftText} left • snooze once?`,
        },
        drill: {
          limit: 'Session terminated. Go touch grass.',
          nudge: `${timeLeftText} remaining. Prepare for shutdown.`,
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

    async getCustomImage() {
      const now = Date.now()

      if (
        this.customImage &&
        now - this.lastImageCheck < this.imageCacheTimeout
      ) {
        console.log('🖼️ Using cached custom image')
        return this.customImage
      }

      console.log('🖼️ Fetching custom image from storage')
      try {
        const response = await chrome.runtime.sendMessage({
          type: 'GET_CUSTOM_IMAGE',
        })

        console.log('🖼️ Custom image response:', {
          hasResponse: !!response,
          hasImageData: !!(response && response.imageData),
          imageDataLength: response?.imageData?.length || 0,
        })

        this.customImage =
          response && response.imageData ? response.imageData : null
        this.lastImageCheck = now

        if (this.customImage) {
          console.log('🖼️ Custom image loaded and cached')
        } else {
          console.log('🖼️ No custom image found in storage')
        }

        return this.customImage
      } catch (error) {
        console.error('❌ Failed to get custom image:', error)
        return null
      }
    }

    invalidateImageCache() {
      this.customImage = null
      this.lastImageCheck = 0
    }

    getNextResetTime(resetHour) {
      const now = new Date()
      const resetTime = new Date(now)
      resetTime.setHours(resetHour, 0, 0, 0)

      if (resetTime <= now) {
        resetTime.setDate(resetTime.getDate() + 1)
      }

      return resetTime.toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
      })
    }
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    try {
      if (window.__twitterTimeLimitWatcher) {
        window.__twitterTimeLimitWatcher.cleanup()
      }
    } catch (_) {}
    window.__twitterTimeLimitWatcher = new window.TwitterWatcher()
  })
} else {
  try {
    if (window.__twitterTimeLimitWatcher) {
      window.__twitterTimeLimitWatcher.cleanup()
    }
  } catch (_) {}
  window.__twitterTimeLimitWatcher = new window.TwitterWatcher()
}

console.log('🚀 TwitterWatcher content script loaded on:', window.location.href)
