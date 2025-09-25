/**
 * Popup UI logic
 * Note: ES6 imports are not supported in extension pages, so we use chrome.runtime.sendMessage
 */

(() => {
  const DISABLE_CONSOLE_LOGS = true;
  if (DISABLE_CONSOLE_LOGS && typeof console !== 'undefined') {
    const noop = function() {};
    console.log = noop;
    console.info = noop;
    console.debug = noop;
    console.trace = noop;
  }
})();

class PopupController {
  constructor() {
    this.status = null
    this.ignoreRealtimeUntil = 0
    this.lastDisplayedUsed = null
    this.justResetUntil = 0
    this.init()
  }

  async init() {
    await this.applyTheme()

    await this.loadStatus()

    this.setupEventListeners()

    this.setupThemeListener()

    this.setupRealTimeUpdates()
    
    setInterval(() => {
      this.applyTheme()
    }, 2000)
  }

  async applyTheme() {
    try {
      
      let settings
      if (this.status && this.status.settings) {
        settings = this.status.settings
      } else {
        const response = await chrome.runtime.sendMessage({ type: 'GET_STATUS' })
      if (response && response.settings) {
          settings = response.settings
        }
      }
        
      if (settings) {
        const theme = settings.theme
        const html = document.documentElement
        
        html.classList.remove('light', 'dark')
        
        if (theme === 'light') {
          html.classList.add('light')
        } else if (theme === 'dark') {
          html.classList.add('dark')
        } else {
          if (
            window.matchMedia &&
            window.matchMedia('(prefers-color-scheme: dark)').matches
          ) {
            html.classList.add('dark')
          } else {
            html.classList.add('light')
          }
        }
      }
    } catch (error) {
      console.warn('Failed to apply theme:', error)
    }
  }

  showMessage(message, type = 'info') {
    const existingToasts = document.querySelectorAll('.toast-notification')
    existingToasts.forEach((toast) => toast.remove())

    let toastContainer = document.getElementById('toast-container')
    if (!toastContainer) {
      toastContainer = document.createElement('div')
      toastContainer.id = 'toast-container'
      toastContainer.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        z-index: 10000;
        pointer-events: none;
      `
      document.body.appendChild(toastContainer)
    }

    const toast = document.createElement('div')
    toast.className = 'toast-notification'

    let bgColor, textColor
    if (type === 'success') {
      bgColor = '#059669'
      textColor = '#ffffff'
    } else if (type === 'error') {
      bgColor = '#dc2626'
      textColor = '#ffffff'
    } else {
      bgColor = '#1e293b'
      textColor = '#f1f5f9'
    }
    
    toast.style.cssText = `
      background-color: ${bgColor};
      color: ${textColor};
      padding: 12px 16px;
      border-radius: 8px;
      box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05);
      font-family: system-ui, -apple-system, sans-serif;
      font-size: 14px;
      font-weight: 500;
      max-width: 300px;
      word-wrap: break-word;
      pointer-events: auto;
      transform: translateX(100%);
      transition: transform 0.3s ease-in-out;
    `
    
    toast.textContent = message
    toastContainer.appendChild(toast)
    
    requestAnimationFrame(() => {
      toast.style.transform = 'translateX(0)'
    })
    
    setTimeout(() => {
      if (toast.parentNode) {
        toast.style.transform = 'translateX(100%)'
        setTimeout(() => {
          if (toast.parentNode) {
            toast.remove()
          }
        }, 300)
      }
    }, 3000)
  }

  setupThemeListener() {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message.type === 'THEME_CHANGED') {
        console.log('Theme change received, applying new theme...')
        this.applyTheme()
        sendResponse({ success: true })
      }
    })
  }

  setupRealTimeUpdates() {
    console.log('Setting up real-time updates...')

    this.realtimePort = chrome.runtime.connect({ name: 'popup-realtime' })

    

    this.realtimePort.onMessage.addListener((message) => {
      console.log('Received real-time update:', message)
      if (message.type === 'REAL_TIME_UPDATE') {
        
        if (this.status && this.status.flags && this.status.flags.locked) {
          return
        }
        if (Date.now() < this.ignoreRealtimeUntil) {
          return
        }
        this.updateRealTimeUsage(message.usage)
      } else if (message.type === 'STATUS_CHANGED') {
        console.log('🔒 Status changed - force reloading popup status')
        if (typeof message.usage === 'number' && message.usage === 0) {
          this.justResetUntil = Date.now() + 2000
          this.ignoreRealtimeUntil = Date.now() + 2000
          this.lastDisplayedUsed = 0
        }
        
        
        if (Date.now() < this.justResetUntil) {
          console.log('🔄 Ignoring STATUS_CHANGED during reset period')
          return
        }
        
        this.status = null
        this.loadStatus()
      }
    })

    this.realtimePort.onDisconnect.addListener(() => {
      console.log('Real-time port disconnected, reconnecting...')

      setTimeout(() => {
        this.setupRealTimeUpdates()
      }, 1000)
    })
  }

  async updateRealTimeUsage(realTimeUsage) {
    console.log('🔄 Real-time update received:', realTimeUsage + 'ms')

    if (!this.status) {
      console.log('🔄 No status cached, loading fresh')
      await this.loadStatus()
      return
    }

    
    if (this.status.flags.pausedToday) {
      console.log('⏸️ Ignoring real-time update - extension is paused')
      return
    }

    if (this.status.flags.locked) {
      console.log('🔒 Ignoring real-time update - extension is locked, frozenTime:', this.status.flags.frozenTimeUsed)
      
      await this.loadStatus()
      return
    }

    const limitMs = this.status.settings.dailyLimitMin * 60 * 1000
    const tickBuffer = 2000 
    
    
    if (realTimeUsage >= (limitMs - tickBuffer)) {
      console.log('🔒 Approaching limit - showing locked state in popup immediately')
      
      
      this.status.flags.locked = true
      this.status.timeRemaining.used = limitMs 
      this.status.timeRemaining.remaining = 0  
      
      this.updateUI()
      return
    }

    
    
    if (Date.now() < this.justResetUntil) {
      realTimeUsage = 0
      this.lastDisplayedUsed = 0
    }
    
    
    
    if (this.lastDisplayedUsed == null || realTimeUsage >= this.lastDisplayedUsed) {
      this.status.timeRemaining.used = realTimeUsage
      const remaining = Math.max(0, limitMs - realTimeUsage)
      this.status.timeRemaining.remaining = remaining

      
      this.lastDisplayedUsed = realTimeUsage

      console.log('🔄 Updating UI with real-time usage:', {
        used: realTimeUsage,
        limit: limitMs,
        remaining: remaining,
        dailyLimitMin: this.status.settings.dailyLimitMin,
      })

      this.updateUI()
    } else {
      console.log('🔄 Ignoring older real-time usage:', realTimeUsage + 'ms (current:', this.lastDisplayedUsed + 'ms)')
    }
  }

  async loadStatus() {
    try {
      
      if (Date.now() < this.justResetUntil) {
        console.log('🔄 Skipping loadStatus during reset period')
        return
      }
      
      const response = await chrome.runtime.sendMessage({ type: 'GET_STATUS' })
      if (response) {
        this.status = response
        
        
        
        if (response.flags.locked || response.flags.pausedToday) {
          
          if (response.flags.locked && typeof response.flags.frozenTimeUsed === 'number') {
            this.lastDisplayedUsed = response.flags.frozenTimeUsed
          } else if (response.timeRemaining && typeof response.timeRemaining.used === 'number') {
            this.lastDisplayedUsed = response.timeRemaining.used
          }
        } else if (response.timeRemaining && typeof response.timeRemaining.used === 'number') {
          
          if (this.lastDisplayedUsed == null || response.timeRemaining.used >= this.lastDisplayedUsed) {
            this.lastDisplayedUsed = response.timeRemaining.used
          }
        }
        console.log('🔍 POPUP Status loaded:', {
          isTracking: response.isTracking,
          activeTabs: response.activeTabs,
          locked: response.flags.locked,
          enabled: response.settings.enabled,
          paused: response.flags.pausedToday,
          used: this.formatTime(response.timeRemaining.used),
          frozenTime: response.flags.frozenTimeUsed
            ? this.formatTime(response.flags.frozenTimeUsed)
            : 'none',
          nudged: response.flags.nudged,
          snoozed: response.flags.snoozed,
          fullSettings: response.settings,
        })
        this.updateUI()
      }
    } catch (error) {
      console.error('Failed to load status:', error)
    }
  }

  updateUI() {
    if (!this.status) return

    
    if (Date.now() < this.justResetUntil) {
      this.forceResetDisplay()
      return
    }

    this.updateProgressRing()
    this.updateTimeDisplay()
    this.updateStatusText()
    this.updateButtons()
    this.updateResetTime()
    this.updateToggle()
  }

  forceResetDisplay() {
    
    const timeUsed = document.getElementById('time-used')
    if (timeUsed) {
      timeUsed.textContent = '0s'
    }

    
    const timeRemainingEl = document.getElementById('time-remaining')
    if (timeRemainingEl && this.status && this.status.settings) {
      const fullLimit = this.status.settings.dailyLimitMin * 60 * 1000
      timeRemainingEl.textContent = `${this.formatTimeCompact(fullLimit)} left`
      timeRemainingEl.classList.remove('text-red-500', 'text-orange-500')
    }

    
    const progressCircle = document.getElementById('progress-circle')
    if (progressCircle) {
      
      const parent = progressCircle.parentNode
      const svg = parent.querySelector('svg') || parent
      
      
      progressCircle.remove()
      
      
      const newCircle = document.createElementNS('http://www.w3.org/2000/svg', 'circle')
      newCircle.id = 'progress-circle'
      newCircle.setAttribute('cx', '50')
      newCircle.setAttribute('cy', '50')
      newCircle.setAttribute('r', '42')
      newCircle.setAttribute('fill', 'none')
      newCircle.setAttribute('stroke', '#3b82f6')
      newCircle.setAttribute('stroke-width', '8')
      newCircle.setAttribute('stroke-linecap', 'round')
      newCircle.setAttribute('stroke-dasharray', '0 264')
      newCircle.style.cssText = 'transition: none !important; animation: none !important;'
      
      
      if (svg) {
        svg.style.transform = 'rotate(-90deg)'
        svg.style.transformOrigin = 'center'
      }
      
      
      svg.appendChild(newCircle)
      
      
      newCircle.offsetHeight
    }

    
    const statusText = document.getElementById('status-text')
    if (statusText && this.status) {
      
      chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
        const currentTab = tabs[0]
        const isOnXcom = currentTab && (
          currentTab.url.includes('x.com') || 
          currentTab.url.includes('twitter.com') || 
          currentTab.url.includes('pro.x.com')
        )
        
        if (isOnXcom) {
          statusText.textContent = 'Active'
          statusText.classList.remove('text-red-500', 'text-orange-500')
          statusText.classList.add('text-green-500')
        } else {
          statusText.textContent = 'Inactive'
          statusText.classList.remove('text-red-500', 'text-orange-500', 'text-green-500')
        }
      })
    }

    
    this.updateButtons()
    this.updateResetTime()
    this.updateToggle()
  }

  updateProgressRing() {
    if (!this.status || !this.status.timeRemaining) return

    
    if (Date.now() < this.justResetUntil || this.lockedProgressCircle) {
      return
    }

    const { used, limit } = this.status.timeRemaining
    const { flags } = this.status
    
    
    let percentage
    if (flags.locked) {
      percentage = 100
    } else {
      percentage = limit > 0 ? (used / limit) * 100 : 0
    }
    
    console.log('🔄 Progress Ring Update:', {
      used: used + 'ms',
      limit: limit + 'ms', 
      percentage: percentage.toFixed(1) + '%',
      locked: flags.locked,
      justResetUntil: this.justResetUntil,
      lockedCircle: !!this.lockedProgressCircle
    });
    
    const circumference = 2 * Math.PI * 42 
    const strokeDasharray = (percentage / 100) * circumference
    const remainingDash = circumference - strokeDasharray

    const progressCircle = document.getElementById('progress-circle')
    if (progressCircle) {
      
      const parentSvg = progressCircle.closest('svg')
      
      
      progressCircle.removeAttribute('transform')
      progressCircle.style.transform = ''
      
      
      if (parentSvg) {
        parentSvg.style.transform = 'rotate(-90deg)'
        parentSvg.style.transformOrigin = 'center'
      } else {
        
        progressCircle.style.transform = 'rotate(-90deg) !important'
        progressCircle.style.transformOrigin = 'center !important'
      }
      
      progressCircle.style.strokeDasharray = `${strokeDasharray} ${remainingDash}`
      
      
      if (flags.locked || percentage >= 90) {
        progressCircle.style.stroke = '#ef4444' 
      } else if (percentage >= 70) {
        progressCircle.style.stroke = '#f97316' 
      } else {
        progressCircle.style.stroke = '#3b82f6' 
      }
      
      console.log('✅ Progress Ring Applied:', {
        strokeDasharray: `${strokeDasharray.toFixed(1)} ${remainingDash.toFixed(1)}`,
        color: progressCircle.style.stroke
      });
    } else {
      console.log('❌ Progress circle element not found');
    }
  }

  updateTimeDisplay() {
    const { timeRemaining, flags } = this.status
    
    const timeUsed = document.getElementById('time-used')
    const timeRemainingEl = document.getElementById('time-remaining')
    
    if (timeUsed) {
      if (flags.locked && flags.frozenTimeUsed !== undefined) {
        timeUsed.textContent = this.formatTime(flags.frozenTimeUsed)
        console.log(
          '🧊 Showing frozen time:',
          this.formatTime(flags.frozenTimeUsed),
          'actual time:',
          this.formatTime(timeRemaining.used),
          'locked:',
          flags.locked,
          'frozenTimeUsed:',
          flags.frozenTimeUsed
        )
      } else {
        timeUsed.textContent = this.formatTime(timeRemaining.used)
        console.log(
          '⏱️ Showing current time:',
          this.formatTime(timeRemaining.used),
          'locked:',
          flags.locked,
          'frozenTimeUsed:',
          flags.frozenTimeUsed
        )
      }
    }
    
    if (timeRemainingEl) {
      let remaining = timeRemaining.remaining
      
      
      if (Date.now() < this.justResetUntil) {
        remaining = this.status.settings.dailyLimitMin * 60 * 1000
      }
      
      if (flags.locked) {
        timeRemainingEl.textContent = 'Locked'
        timeRemainingEl.classList.add('text-red-500')
      } else if (flags.pausedToday) {
        timeRemainingEl.textContent = 'Paused'
        timeRemainingEl.classList.add('text-orange-500')
        timeRemainingEl.classList.remove('text-red-500')
      } else if (remaining <= 0) {
        timeRemainingEl.textContent = 'Limit reached'
        timeRemainingEl.classList.add('text-red-500')
        timeRemainingEl.classList.remove('text-orange-500')
      } else {
        timeRemainingEl.textContent = `${this.formatTimeCompact(
          remaining
        )} left`
        timeRemainingEl.classList.remove('text-red-500', 'text-orange-500')
      }
    }
  }

  updateStatusText() {
    
    if (Date.now() < this.justResetUntil) {
      console.log('🔄 Skipping status text update during reset period')
      return
    }
    
    const statusText = document.getElementById('status-text')
    const nudgeIndicator = document.getElementById('nudge-indicator')
    const pausedStatus = document.getElementById('paused-status')
    
    if (!statusText) return

    
    console.log('🔍 updateStatusText - Current status:', {
      enabled: this.status.settings.enabled,
      pausedToday: this.status.flags.pausedToday,
      locked: this.status.flags.locked,
      isTracking: this.status.isTracking,
      timeRemaining: this.status.timeRemaining
    })
    
    if (!this.status.settings.enabled) {
      statusText.textContent = 'Disabled'
      statusText.className =
        'text-sm font-medium text-gray-600 dark:text-gray-400'
    } else if (this.status.flags.pausedToday) {
      statusText.textContent = 'Paused'
      statusText.className =
        'text-sm font-medium text-orange-600 dark:text-orange-400'
    } else if (this.status.flags.locked) {
      statusText.textContent = 'Locked'
      statusText.className =
        'text-sm font-medium text-red-600 dark:text-red-400'
    } else if (this.status.isTracking) {
      console.log(
        '🟢 Setting status to ACTIVE because isTracking =',
        this.status.isTracking
      )
      statusText.textContent = 'Active'
      statusText.className =
        'text-sm font-medium text-green-600 dark:text-green-400'
    } else {
      console.log(
        '⚪ Setting status to INACTIVE because isTracking =',
        this.status.isTracking
      )
      statusText.textContent = 'Inactive'
      statusText.className =
        'text-sm font-medium text-gray-600 dark:text-gray-400'
    }
    
    if (pausedStatus) {
      pausedStatus.classList.add('hidden')
    }
    
    if (nudgeIndicator) {
      const shouldShowNudge = this.status.flags.nudged && !this.status.flags.locked && !this.status.flags.snoozed
      if (shouldShowNudge) {
        nudgeIndicator.classList.remove('hidden')
      } else {
        nudgeIndicator.classList.add('hidden')
      }
    }
  }

  updateButtons() {
    const pauseToggle = document.getElementById('pause-toggle')
    const pauseText = document.getElementById('pause-text')
    
    if (pauseToggle && pauseText) {
      pauseToggle.style.cssText = ''
      pauseToggle.onmouseenter = null
      pauseToggle.onmouseleave = null
      
      
      console.log('🔄 updateButtons flags:', {
        snoozed: this.status.flags.snoozed,
        locked: this.status.flags.locked,
        pausedToday: this.status.flags.pausedToday,
        snoozeUsedToday: this.status.flags.snoozeUsedToday
      });
      
      
      console.log('🔍 Button element cursor before styling:', pauseToggle.style.cursor);
      console.log('🔍 Button computed style cursor before styling:', window.getComputedStyle(pauseToggle).cursor);
      
      
      if (this.status.flags.locked) {
        pauseText.textContent = 'Pause'
        pauseToggle.disabled = true
        
        
        pauseToggle.style.cursor = 'not-allowed !important' 
        pauseToggle.style.setProperty('cursor', 'not-allowed', 'important') 
        pauseToggle.className =
          'w-full px-4 py-2.5 bg-gray-600 text-gray-400 font-medium rounded-lg border border-gray-500 cursor-not-allowed opacity-50'
        
        
        console.log('🔍 LOCKED - Button element cursor after styling:', pauseToggle.style.cursor);
        console.log('🔍 LOCKED - Button computed style cursor after styling:', window.getComputedStyle(pauseToggle).cursor);
      } else if (this.status.flags.snoozed && !this.status.flags.locked && !this.status.flags.pausedToday) {
        pauseText.textContent = 'Pause'
        pauseToggle.disabled = true
        
        pauseToggle.style.cursor = 'not-allowed !important' 
        pauseToggle.className =
          'w-full px-4 py-2.5 bg-gray-600 text-gray-400 font-medium rounded-lg border border-gray-500 cursor-not-allowed opacity-50'
      } else if (this.status.flags.pausedToday) {
        pauseText.textContent = 'Resume'
        pauseToggle.disabled = false
        pauseToggle.style.pointerEvents = 'auto' 
        pauseToggle.style.cursor = 'pointer' 
        pauseToggle.className =
          'w-full px-4 py-2.5 bg-blue-700 hover:bg-blue-800 text-white font-medium rounded-lg transition-colors duration-200 shadow-md border border-blue-600'
      } else {
        pauseText.textContent = 'Pause'
        pauseToggle.disabled = false
        pauseToggle.style.pointerEvents = 'auto' 
        pauseToggle.style.cursor = 'pointer' 
        pauseToggle.className =
          'w-full px-4 py-2.5 bg-gray-800 hover:bg-gray-700 text-gray-300 font-medium rounded-lg border border-gray-600 transition-colors duration-200'
      }
    }
  }

  updateResetTime() {
    const resetTime = document.getElementById('reset-time')
    const nextReset = document.getElementById('next-reset')
    
    if (resetTime && this.status.settings) {
      const hour = this.status.settings.resetHourLocal
        .toString()
        .padStart(2, '0')
      resetTime.textContent = `Resets at ${hour}:00`
    }
    
    if (nextReset && this.status.nextReset) {
      const resetDate = new Date(this.status.nextReset)
      const now = new Date()
      const isToday = resetDate.toDateString() === now.toDateString()
      
      if (isToday) {
        nextReset.textContent = `Next reset: Today at ${resetDate.toLocaleTimeString(
          [],
          { hour: '2-digit', minute: '2-digit' }
        )}`
      } else {
        nextReset.textContent = `Next reset: Tomorrow at ${resetDate.toLocaleTimeString(
          [],
          { hour: '2-digit', minute: '2-digit' }
        )}`
      }
    }
  }

  updateToggle() {
    const toggle = document.getElementById('extension-toggle')
    const label = document.getElementById('toggle-label')
    
    if (toggle && label && this.status) {
      const enabled = this.status.settings.enabled
      
      if (enabled) {
        toggle.className =
          'relative inline-flex h-6 w-11 items-center rounded-full transition-all duration-300 ease-in-out enabled'
        toggle.dataset.enabled = 'true'
        label.textContent = 'Enabled'
      } else {
        toggle.className =
          'relative inline-flex h-6 w-11 items-center rounded-full transition-all duration-300 ease-in-out disabled'
        toggle.dataset.enabled = 'false'
        label.textContent = 'Disabled'
      }
    }

    this.updateButtonStates()
  }

  updateButtonStates() {
    const pauseToggle = document.getElementById('pause-toggle')
    const manualReset = document.getElementById('manual-reset')
    
    if (!this.status) return
    
    const enabled = this.status.settings.enabled
    const locked = this.status.flags.locked
    const snoozed = this.status.flags.snoozed
    
    if (pauseToggle) {
      if (enabled && !locked && !snoozed) {
        pauseToggle.disabled = false
        pauseToggle.style.opacity = '1'
        pauseToggle.style.cursor = 'pointer'
        pauseToggle.style.pointerEvents = 'auto'
      } else {
        pauseToggle.disabled = true
        pauseToggle.style.opacity = '0.5'
        pauseToggle.style.cursor = 'not-allowed !important' 
        
      }
    }
    
    if (manualReset) {
      if (enabled) {
        manualReset.disabled = false
        manualReset.style.opacity = '1'
        manualReset.style.cursor = 'pointer'
      } else {
        manualReset.disabled = true
        manualReset.style.opacity = '0.5'
        manualReset.style.cursor = 'not-allowed'
      }
    }
  }

  setupEventListeners() {
    const pauseToggle = document.getElementById('pause-toggle')
    if (pauseToggle) {
      pauseToggle.addEventListener('click', async (e) => {
        
        if (pauseToggle.disabled || (this.status && this.status.flags.snoozed)) {
          e.preventDefault()
          e.stopPropagation()
          console.log('🚫 Pause click blocked - button disabled or in snooze mode')
          return
        }
        
        try {
          pauseToggle.disabled = true
          pauseToggle.style.opacity = '0.5'
          pauseToggle.style.cursor = 'not-allowed'
          await chrome.runtime.sendMessage({ type: 'PAUSE_TOGGLE' })
          await this.loadStatus()
        } catch (error) {
          console.error('Failed to toggle pause:', error)
        } finally {
          setTimeout(() => {
            if (this.status && this.status.settings.enabled && !this.status.flags.locked) {
              pauseToggle.disabled = false
              pauseToggle.style.opacity = '1'
              pauseToggle.style.cursor = 'pointer'
            }
          }, 800)
        }
      })
    }

    const manualReset = document.getElementById('manual-reset')
    if (manualReset) {
      manualReset.addEventListener('click', async () => {
        if (manualReset.disabled) return
        
        if (confirm("Reset today's usage? This cannot be undone.")) {
          try {
            manualReset.disabled = true
            manualReset.style.opacity = '0.5'
            manualReset.style.cursor = 'not-allowed'
            
            
            const timeUsedEl = document.getElementById('time-used')
            const timeRemainingEl = document.getElementById('time-remaining')
            const progressCircle = document.getElementById('progress-circle')
            
            
            if (timeUsedEl) {
              timeUsedEl.style.transition = 'none'
              timeUsedEl.textContent = '0s'
              timeUsedEl.offsetHeight 
            }
            if (timeRemainingEl && this.status && this.status.settings) {
              const fullLimit = this.status.settings.dailyLimitMin * 60 * 1000
              timeRemainingEl.style.transition = 'none'
              timeRemainingEl.textContent = `${this.formatTimeCompact(fullLimit)} left`
              timeRemainingEl.classList.remove('text-red-500', 'text-orange-500')
              timeRemainingEl.offsetHeight 
            }
            
            
            const statusText = document.getElementById('status-text')
            if (statusText && this.status) {
              
              chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
                const currentTab = tabs[0]
                const isOnXcom = currentTab && (
                  currentTab.url.includes('x.com') || 
                  currentTab.url.includes('twitter.com') || 
                  currentTab.url.includes('pro.x.com')
                )
                
                if (isOnXcom) {
                  statusText.textContent = 'Active'
                  statusText.classList.remove('text-red-500', 'text-orange-500')
                  statusText.classList.add('text-green-500')
                } else {
                  statusText.textContent = 'Inactive'
                  statusText.classList.remove('text-red-500', 'text-orange-500', 'text-green-500')
                }
              })
            }
            if (progressCircle) {
              
              const parent = progressCircle.parentNode
              const svg = parent.querySelector('svg') || parent
              
              
              progressCircle.remove()
              
              
              const newCircle = document.createElementNS('http://www.w3.org/2000/svg', 'circle')
              newCircle.id = 'progress-circle'
              newCircle.setAttribute('cx', '50')
              newCircle.setAttribute('cy', '50')
              newCircle.setAttribute('r', '42')
              newCircle.setAttribute('fill', 'none')
              newCircle.setAttribute('stroke', '#3b82f6')
              newCircle.setAttribute('stroke-width', '8')
              newCircle.setAttribute('stroke-linecap', 'round')
              newCircle.setAttribute('stroke-dasharray', '0 264')
              newCircle.style.cssText = 'transition: none !important; animation: none !important;'
              
              
              if (svg) {
                svg.style.transform = 'rotate(-90deg)'
                svg.style.transformOrigin = 'center'
              }
              
              
              svg.appendChild(newCircle)
              
              
              newCircle.offsetHeight
              
              
              this.lockedProgressCircle = newCircle
            }
            
            
            const correctRemainingText = this.status && this.status.settings ? 
              `${this.formatTimeCompact(this.status.settings.dailyLimitMin * 60 * 1000)} left` : 
              '1m 0s left'
              
            const observer = new MutationObserver((mutations) => {
              mutations.forEach((mutation) => {
                if (mutation.target.id === 'time-used' && mutation.target.textContent !== '0s') {
                  mutation.target.textContent = '0s'
                }
                if (mutation.target.id === 'time-remaining' && mutation.target.textContent !== correctRemainingText) {
                  mutation.target.textContent = correctRemainingText
                }
                
                if (mutation.target.id === 'status-text') {
                  
                  chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
                    const currentTab = tabs[0]
                    const isOnXcom = currentTab && (
                      currentTab.url.includes('x.com') || 
                      currentTab.url.includes('twitter.com') || 
                      currentTab.url.includes('pro.x.com')
                    )
                    
                    const correctStatus = isOnXcom ? 'Active' : 'Inactive'
                    if (mutation.target.textContent !== correctStatus) {
                      mutation.target.textContent = correctStatus
                      if (correctStatus === 'Active') {
                        mutation.target.classList.remove('text-red-500', 'text-orange-500')
                        mutation.target.classList.add('text-green-500')
                      } else {
                        mutation.target.classList.remove('text-red-500', 'text-orange-500', 'text-green-500')
                      }
                    }
                  })
                }
              })
            })
            
            
            if (timeUsedEl) observer.observe(timeUsedEl, { childList: true, characterData: true, subtree: true })
            if (timeRemainingEl) observer.observe(timeRemainingEl, { childList: true, characterData: true, subtree: true })
            if (statusText) observer.observe(statusText, { childList: true, characterData: true, subtree: true })
            
            
            setTimeout(() => {
              observer.disconnect()
            }, 3000)
            
            
            chrome.runtime.sendMessage({ type: 'MANUAL_RESET' }).catch(() => {})
            
            
            setTimeout(() => {
              this.lockedProgressCircle = null 
              this.justResetUntil = 0 
              this.loadStatus()
              
              setTimeout(() => {
                if (this.status) {
                  this.updateProgressRing()
                }
              }, 100)
            }, 2500)
            
          } catch (error) {
            console.error('Failed to reset:', error)
          } finally {
            
            setTimeout(() => {
              manualReset.disabled = false
              manualReset.style.opacity = '1'
              manualReset.style.cursor = 'pointer'
            }, 1200)
          }
        }
      })
    }

    const extensionToggle = document.getElementById('extension-toggle')
    console.log('🔘 Toggle button found:', extensionToggle)
    if (extensionToggle) {
      if (extensionToggle._hasToggleListener) {
        console.log('⚠️ Toggle button already has listener, skipping')
        return
      }

      console.log('🔘 Adding click listener to toggle button')
      extensionToggle.addEventListener('click', async () => {
        try {
          const currentEnabled = this.status?.settings?.enabled ?? true
          const requestId = Math.random().toString(36).substr(2, 9)
          console.log('🔘 Toggle clicked:', {
            requestId,
            currentEnabled,
            willBeEnabled: !currentEnabled,
            timestamp: new Date().toISOString(),
          })

          const response = await chrome.runtime.sendMessage({
            type: 'UPDATE_SETTINGS', 
            settings: { enabled: !currentEnabled },
            requestId,
          })

          console.log('🔘 Toggle response:', response)

          await new Promise((resolve) => setTimeout(resolve, 100))

          await this.loadStatus()
          console.log('🔘 Status reloaded after toggle')

          this.updateUI()
        } catch (error) {
          console.error('Failed to toggle extension:', error)
        }
      })

      extensionToggle._hasToggleListener = true
      console.log('✅ Toggle button listener attached')
    }

    const openOptions = document.getElementById('open-options')
    if (openOptions) {
      openOptions.addEventListener('click', () => {
        chrome.runtime.openOptionsPage()
      })
    }

    const openFaq = document.getElementById('open-faq')
    if (openFaq) {
      openFaq.addEventListener('click', () => {
        chrome.tabs.create({
          url: 'https://x.com/0xfush1guro',
        })
      })
    }

    const permissionsLink = document.getElementById('permissions-link')
    if (permissionsLink) {
      permissionsLink.addEventListener('click', (e) => {
        e.preventDefault()
        chrome.tabs.create({
          url: 'chrome://extensions/?id=' + chrome.runtime.id,
        })
      })
    }

    
    const refreshOnFocus = async () => {
      try {
        
        this.ignoreRealtimeUntil = Date.now() + 300; 
        await this.loadStatus()
      } catch (e) {}
    }
    window.addEventListener('focus', refreshOnFocus)
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        refreshOnFocus()
      }
    })
  }

  formatTime(milliseconds) {
    const totalSeconds = Math.floor(milliseconds / 1000)
    const hours = Math.floor(totalSeconds / 3600)
    const minutes = Math.floor((totalSeconds % 3600) / 60)
    const seconds = totalSeconds % 60

    if (hours > 0) {
      if (seconds === 0) {
        return `${hours}h ${minutes}m`
      } else {
        return `${hours}h ${minutes}m ${seconds}s`
      }
    } else if (minutes > 0) {
      return `${minutes}m ${seconds}s`
    } else {
      return `${seconds}s`
    }
  }

  formatTimeCompact(milliseconds) {
    const totalSeconds = Math.floor(milliseconds / 1000)
    const hours = Math.floor(totalSeconds / 3600)
    const minutes = Math.floor((totalSeconds % 3600) / 60)
    const seconds = totalSeconds % 60
    
    if (hours > 0) {
      if (minutes === 0) {
        return `${hours}h`
      } else if (seconds === 0) {
        return `${hours}h ${minutes}m`
      } else {
        return `${hours}h ${minutes}m`
      }
    } else if (minutes > 0) {
      return `${minutes}m ${seconds}s`
    } else {
      return `${seconds}s`
    }
  }
}

document.addEventListener('DOMContentLoaded', () => {
  if (window.popupController) {
    console.log('⚠️ PopupController already exists, not creating duplicate')
    return
  }

  console.log('✅ Creating PopupController instance')
  window.popupController = new PopupController()
})
