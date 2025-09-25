/**
 * Active time calculation and idle handling
 */

import { storage } from './storage.js';

class TimeKeeper {
  constructor() {
    this.isActive = false;
    this.lastTickTime = null;
    this.tickInterval = null;
    this.idleThreshold = 60; 
    this.tickFrequency = 1000; 
  }

  start() {
    if (this.tickInterval) return;
    
    this.lastTickTime = Date.now();
    this.tickInterval = setInterval(() => {
      this.tick();
    }, this.tickFrequency);
  }

  stop() {
    if (this.tickInterval) {
      clearInterval(this.tickInterval);
      this.tickInterval = null;
    }
    this.lastTickTime = null;
  }

  setActive(active) {
    this.isActive = active;
    if (active) {
      this.lastTickTime = Date.now();
    }
  }

  async tick() {
    if (!this.isActive || !this.lastTickTime) return;

    const now = Date.now();
    const deltaTime = now - this.lastTickTime;
    
    
    if (chrome.idle && chrome.idle.queryState) {
      try {
        const idleState = await new Promise((resolve) => {
          chrome.idle.queryState(this.idleThreshold, resolve);
        });
        
        if (idleState === 'idle' || idleState === 'locked') {
          this.lastTickTime = now;
          return;
        }
      } catch (error) {
        console.warn('Idle detection failed:', error);
      }
    }

    
    const usage = await storage.getUsageToday();
    const newUsage = {
      ...usage,
      millisActive: usage.millisActive + deltaTime,
      lastTickAt: now
    };
    
    await storage.updateUsageToday(newUsage);
    this.lastTickTime = now;

    
    await this.checkLimits(newUsage);
  }

  async checkLimits(usage) {
    const settings = await storage.getSettings();
    const flags = await storage.getFlags();
    
    if (flags.pausedToday || flags.locked) return;

    const limitMillis = settings.dailyLimitMin * 60 * 1000;
    const nudgeThreshold = limitMillis * 0.8;
    
    
    if (!flags.nudged && usage.millisActive >= nudgeThreshold) {
      await this.triggerNudge();
    }
    
    
    if (usage.millisActive >= limitMillis) {
      await this.triggerLimit();
    }
  }

  async triggerNudge() {
    const settings = await storage.getSettings();
    const flags = await storage.getFlags();
    
    if (!settings.allowSnooze || flags.nudged) return;

    
    await storage.updateFlags({ nudged: true });

    
    if (chrome.notifications) {
      chrome.notifications.create({
        type: 'basic',
        iconUrl: 'assets/icon.svg',
        title: 'Boundr',
        message: '5 minutes left • snooze once?',
        buttons: [
          { title: 'Snooze 5m' },
          { title: 'Dismiss' }
        ]
      });
    }

    
    const tabs = await chrome.tabs.query({ 
      url: ['*://twitter.com/*', '*://x.com/*'] 
    });
    
    tabs.forEach(tab => {
      chrome.tabs.sendMessage(tab.id, {
        type: 'SHOW_NUDGE',
        settings
      }).catch(() => {
        
      });
    });
  }

  async triggerLimit() {
    const settings = await storage.getSettings();
    const flags = await storage.getFlags();
    
    if (flags.locked) return;

    
    await storage.updateFlags({ locked: true });

    
    const tabs = await chrome.tabs.query({ 
      url: ['*://twitter.com/*', '*://x.com/*'] 
    });
    
    if (settings.mode === 'close') {
      
      tabs.forEach(tab => {
        chrome.tabs.sendMessage(tab.id, {
          type: 'SHOW_CLOSE_COUNTDOWN',
          settings
        }).catch(() => {
          
          chrome.tabs.remove(tab.id);
        });
      });
    } else {
      
      tabs.forEach(tab => {
        chrome.tabs.sendMessage(tab.id, {
          type: 'SHOW_SOFT_LOCK',
          settings
        }).catch(() => {
          
        });
      });
    }
  }

  
  async getTimeRemaining() {
    const settings = await storage.getSettings();
    const usage = await storage.getUsageToday();
    const flags = await storage.getFlags();
    
    if (flags.pausedToday) {
      return { remaining: settings.dailyLimitMin * 60 * 1000, used: 0 };
    }
    
    const limitMillis = settings.dailyLimitMin * 60 * 1000;
    const remaining = Math.max(0, limitMillis - usage.millisActive);
    
    return {
      remaining,
      used: usage.millisActive,
      limit: limitMillis
    };
  }

  
  getNextResetTime() {
    const now = new Date();
    const settings = storage.getSettings();
    
    return settings.then(settings => {
      const resetTime = new Date(now);
      resetTime.setHours(settings.resetHourLocal, 0, 0, 0);
      
      
      if (resetTime <= now) {
        resetTime.setDate(resetTime.getDate() + 1);
      }
      
      return resetTime;
    });
  }

  
  formatTime(millis) {
    const minutes = Math.floor(millis / (1000 * 60));
    const hours = Math.floor(minutes / 60);
    
    if (hours > 0) {
      return `${hours}h ${minutes % 60}m`;
    }
    return `${minutes}m`;
  }
}

export const timekeeper = new TimeKeeper();
