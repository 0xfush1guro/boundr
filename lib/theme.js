/**
 * Theme management for light/dark/system modes
 */

import { storage } from './storage.js';

class ThemeManager {
  constructor() {
    this.currentTheme = 'system';
    this.systemPrefersDark = false;
    this.init();
  }

  async init() {
    
    if (window.matchMedia) {
      const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
      this.systemPrefersDark = mediaQuery.matches;
      
      mediaQuery.addEventListener('change', (e) => {
        this.systemPrefersDark = e.matches;
        this.applyTheme();
      });
    }

    
    const settings = await storage.getSettings();
    this.currentTheme = settings.theme || 'system';
    this.applyTheme();
  }

  async setTheme(theme) {
    this.currentTheme = theme;
    await storage.updateSettings({ theme });
    this.applyTheme();
  }

  getTheme() {
    return this.currentTheme;
  }

  isDarkMode() {
    switch (this.currentTheme) {
      case 'dark':
        return true;
      case 'light':
        return false;
      case 'system':
      default:
        return this.systemPrefersDark;
    }
  }

  applyTheme() {
    const isDark = this.isDarkMode();
    const html = document.documentElement;
    
    if (isDark) {
      html.classList.add('dark');
      html.classList.remove('light');
    } else {
      html.classList.add('light');
      html.classList.remove('dark');
    }

    
    this.updateCSSVariables(isDark);
  }

  updateCSSVariables(isDark) {
    const root = document.documentElement;
    
    if (isDark) {
      root.style.setProperty('--bg', '#0f0f0f');
      root.style.setProperty('--bg-secondary', '#1a1a1a');
      root.style.setProperty('--fg', '#ffffff');
      root.style.setProperty('--fg-secondary', '#a3a3a3');
      root.style.setProperty('--muted', '#404040');
      root.style.setProperty('--muted-foreground', '#a3a3a3');
      root.style.setProperty('--border', '#262626');
      root.style.setProperty('--accent', '#3b82f6');
      root.style.setProperty('--accent-foreground', '#ffffff');
      root.style.setProperty('--destructive', '#ef4444');
      root.style.setProperty('--destructive-foreground', '#ffffff');
    } else {
      root.style.setProperty('--bg', '#ffffff');
      root.style.setProperty('--bg-secondary', '#f8fafc');
      root.style.setProperty('--fg', '#0f172a');
      root.style.setProperty('--fg-secondary', '#64748b');
      root.style.setProperty('--muted', '#f1f5f9');
      root.style.setProperty('--muted-foreground', '#64748b');
      root.style.setProperty('--border', '#e2e8f0');
      root.style.setProperty('--accent', '#3b82f6');
      root.style.setProperty('--accent-foreground', '#ffffff');
      root.style.setProperty('--destructive', '#ef4444');
      root.style.setProperty('--destructive-foreground', '#ffffff');
    }
  }

  
  getOverlayStyles() {
    const isDark = this.isDarkMode();
    
    return {
      background: isDark ? 'rgba(15, 15, 15, 0.8)' : 'rgba(255, 255, 255, 0.8)',
      backdropFilter: 'blur(8px)',
      color: isDark ? '#ffffff' : '#0f172a',
      border: isDark ? '1px solid #262626' : '1px solid #e2e8f0'
    };
  }

  
  getButtonStyles(variant = 'primary') {
    const isDark = this.isDarkMode();
    
    const variants = {
      primary: {
        background: '#3b82f6',
        color: '#ffffff',
        border: 'none'
      },
      secondary: {
        background: isDark ? '#1a1a1a' : '#f8fafc',
        color: isDark ? '#ffffff' : '#0f172a',
        border: isDark ? '1px solid #262626' : '1px solid #e2e8f0'
      },
      ghost: {
        background: 'transparent',
        color: isDark ? '#a3a3a3' : '#64748b',
        border: 'none'
      },
      destructive: {
        background: '#ef4444',
        color: '#ffffff',
        border: 'none'
      }
    };

    return variants[variant] || variants.primary;
  }

  
  getCardStyles() {
    const isDark = this.isDarkMode();
    
    return {
      background: isDark ? '#1a1a1a' : '#ffffff',
      border: isDark ? '1px solid #262626' : '1px solid #e2e8f0',
      borderRadius: '16px',
      boxShadow: isDark 
        ? '0 10px 15px -3px rgba(0, 0, 0, 0.3), 0 4px 6px -2px rgba(0, 0, 0, 0.1)'
        : '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)'
    };
  }

  
  onThemeChange(callback) {
    storage.onChanged((changes) => {
      if (changes.settings && changes.settings.newValue.theme !== this.currentTheme) {
        this.currentTheme = changes.settings.newValue.theme;
        this.applyTheme();
        callback(this.currentTheme);
      }
    });
  }
}


export const theme = new ThemeManager();
