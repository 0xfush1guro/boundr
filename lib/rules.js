/**
 * Block/close decision logic and anti-bypass measures
 */

import { storage } from './storage.js';

class RulesEngine {
  constructor() {
    this.twitterDomains = ['twitter.com', 'x.com', 'www.twitter.com', 'www.x.com'];
    this.mobileDomains = ['m.twitter.com', 'mobile.twitter.com', 'm.x.com'];
  }

  isTwitterUrl(url) {
    try {
      const urlObj = new URL(url);
      return this.twitterDomains.includes(urlObj.hostname) || 
             this.mobileDomains.includes(urlObj.hostname);
    } catch {
      return false;
    }
  }

  async shouldBlockTab(tabId, url) {
    if (!this.isTwitterUrl(url)) return false;

    const flags = await storage.getFlags();
    return flags.locked || flags.pausedToday;
  }

  async shouldStartTracking(tabId, url) {
    if (!this.isTwitterUrl(url)) return false;

    const flags = await storage.getFlags();
    return !flags.pausedToday;
  }

  async handleTabActivated(tabId) {
    const tab = await chrome.tabs.get(tabId);
    if (!this.isTwitterUrl(tab.url)) return;

    const shouldBlock = await this.shouldBlockTab(tabId, tab.url);
    if (shouldBlock) {
      await this.blockTab(tabId);
    } else {
      await this.allowTab(tabId);
    }
  }

  async handleTabUpdated(tabId, changeInfo, tab) {
    if (changeInfo.status !== 'complete') return;
    if (!this.isTwitterUrl(tab.url)) return;

    const shouldBlock = await this.shouldBlockTab(tabId, tab.url);
    if (shouldBlock) {
      await this.blockTab(tabId);
    }
  }

  async blockTab(tabId) {
    const settings = await storage.getSettings();
    
    if (settings.mode === 'close') {
      
      chrome.tabs.remove(tabId);
    } else {
      
      chrome.tabs.sendMessage(tabId, {
        type: 'SHOW_SOFT_LOCK',
        settings
      }).catch(() => {
        
      });
    }
  }

  async allowTab(tabId) {
    
    chrome.tabs.sendMessage(tabId, {
      type: 'HIDE_OVERLAY'
    }).catch(() => {
      
    });
  }

  async closeAllTwitterTabs() {
    const tabs = await chrome.tabs.query({ 
      url: ['*://twitter.com/*', '*://x.com/*'] 
    });
    
    const tabIds = tabs.map(tab => tab.id);
    if (tabIds.length > 0) {
      chrome.tabs.remove(tabIds);
    }
  }

  async blockAllTwitterTabs() {
    const tabs = await chrome.tabs.query({ 
      url: ['*://twitter.com/*', '*://x.com/*'] 
    });
    
    const settings = await storage.getSettings();
    
    tabs.forEach(tab => {
      chrome.tabs.sendMessage(tab.id, {
        type: 'SHOW_SOFT_LOCK',
        settings
      }).catch(() => {
        
      });
    });
  }

  
  getBlockedDomains() {
    return [
      ...this.twitterDomains,
      ...this.mobileDomains,
      'nitter.net',
      'nitter.it',
      'nitter.1d4.us',
      'nitter.kavin.rocks'
    ];
  }

  
  isTwitterAlternative(url) {
    try {
      const urlObj = new URL(url);
      const hostname = urlObj.hostname.toLowerCase();
      
      
      if (hostname.includes('nitter')) return true;
      
      
      const alternatives = [
        'twitonomy.com',
        'tweetdeck.twitter.com'
      ];
      
      return alternatives.some(alt => hostname.includes(alt));
    } catch {
      return false;
    }
  }

  
  getMessage(tone, type = 'limit') {
    const messages = {
      gentle: {
        limit: "Let's call it a day 🫶",
        nudge: "Just 5 minutes left! Take a break?",
        cooldown: "Take a breather for a few minutes"
      },
      classic: {
        limit: "That's enough Twitter for today, mate.",
        nudge: "5 minutes left • snooze once?",
        cooldown: "Back in a few minutes"
      },
      drill: {
        limit: "Session terminated. Go touch grass.",
        nudge: "5 minutes remaining. Prepare for shutdown.",
        cooldown: "Standby mode activated"
      }
    };

    return messages[tone]?.[type] || messages.classic[type];
  }

  
  async validatePasscode(enteredPasscode) {
    const settings = await storage.getSettings();
    if (!settings.passcodeHash) return true; 

    
    const hash = await this.simpleHash(enteredPasscode);
    return hash === settings.passcodeHash;
  }

  
  async simpleHash(str) {
    const encoder = new TextEncoder();
    const data = encoder.encode(str);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  }

  
  async setPasscode(passcode) {
    const hash = await this.simpleHash(passcode);
    await storage.updateSettings({ passcodeHash: hash });
  }

  
  async clearPasscode() {
    await storage.updateSettings({ passcodeHash: null });
  }
}

export const rules = new RulesEngine();
