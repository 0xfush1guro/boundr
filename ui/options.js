/**
 * Options page logic
 * Note: ES6 imports are not supported in extension pages, so we use chrome.runtime.sendMessage
 */

class OptionsController {
  constructor() {
    this.settings = null;
    this.saveTimeout = null;
    this.pendingChanges = null;
    this.lastSaveTime = 0;
    this.saveQueue = [];
    this.saveInProgress = false;
    this.init();
    
    this.cropper = null;
  }

  async init() {
    await this.loadSettings();

    await this.applyTheme();

    this.setupEventListeners();
    this.setupNotificationListeners();
  }

  async loadSettings() {
    try {
      const response = await chrome.runtime.sendMessage({ type: "GET_STATUS" });
      if (response && response.settings) {
        this.settings = response.settings;
        this.populateForm();
        this.loadNotificationSettings();
      }
    } catch (error) {
      console.error("Failed to load settings:", error);
    }
  }

  populateForm() {
    if (!this.settings) return;

    const dailyLimitHours = document.getElementById("daily-limit-hours");
    const dailyLimitMinutes = document.getElementById("daily-limit-minutes");
    if (dailyLimitHours && dailyLimitMinutes) {
      const totalMinutes = this.settings.dailyLimitMin;
      const hours = Math.floor(totalMinutes / 60);
      const minutes = totalMinutes % 60;
      dailyLimitHours.value = hours;
      dailyLimitMinutes.value = minutes;
    }

    const resetHour = document.getElementById("reset-hour");
    if (resetHour) {
      const hour = this.settings.resetHourLocal.toString().padStart(2, "0");
      resetHour.value = `${hour}:00`;
    }

    const modeRadios = document.querySelectorAll('input[name="mode"]');
    modeRadios.forEach((radio) => {
      radio.checked = radio.value === this.settings.mode;
    });

    const allowSnooze = document.getElementById("allow-snooze");
    if (allowSnooze) {
      allowSnooze.checked = this.settings.allowSnooze;
    }

    const themeRadios = document.querySelectorAll('input[name="theme"]');
    themeRadios.forEach((radio) => {
      radio.checked = radio.value === this.settings.theme;
    });

    const toneSelect = document.getElementById("tone-select");
    if (toneSelect) {
      toneSelect.value = this.settings.tone;
    }

    const cooldownMinutes = document.getElementById("cooldown-minutes");
    if (cooldownMinutes) {
      cooldownMinutes.value = this.settings.cooldownMin || 5;
    }

    this.populateOverlayCustomization();
  }

  populateOverlayCustomization() {
    if (!this.settings.overlayCustomization) {
      this.settings.overlayCustomization = {
        enabled: false,
        customMessage: "",
        customImage: null,
        template: "default",
      };
    }

    const enableCustomOverlay = document.getElementById(
      "enable-custom-overlay"
    );
    if (enableCustomOverlay) {
      enableCustomOverlay.checked = this.settings.overlayCustomization.enabled;
      this.toggleOverlayCustomization();
    }

    const templateRadios = document.querySelectorAll(
      'input[name="overlay-template"]'
    );
    templateRadios.forEach((radio) => {
      radio.checked =
        radio.value === this.settings.overlayCustomization.template;
    });

    const customMessage = document.getElementById("custom-message");
    if (customMessage) {
      customMessage.value =
        this.settings.overlayCustomization.customMessage || "";
    }

    this.loadCustomImage().catch((error) => {
      console.error("Failed to load custom image:", error);
    });

    this.applyTheme();
  }

  async loadCustomImage() {
    try {
      const response = await chrome.runtime.sendMessage({
        type: "GET_CUSTOM_IMAGE",
      });

      if (response && response.imageData) {
        this.showImagePreview(response.imageData);
      }
    } catch (error) {
      console.error("Failed to load custom image:", error);
    }
  }

  setupEventListeners() {
    const dailyLimitHours = document.getElementById("daily-limit-hours");
    const dailyLimitMinutes = document.getElementById("daily-limit-minutes");
    const limitDecrease = document.getElementById("limit-decrease");
    const limitIncrease = document.getElementById("limit-increase");

    if (limitDecrease) {
      limitDecrease.addEventListener("click", () => {
        const hours = parseInt(dailyLimitHours.value) || 0;
        const minutes = parseInt(dailyLimitMinutes.value) || 30;
        const totalMinutes = hours * 60 + minutes;
        const newTotalMinutes = Math.max(1, totalMinutes - 5);
        const newHours = Math.floor(newTotalMinutes / 60);
        const newMinutes = newTotalMinutes % 60;
        dailyLimitHours.value = newHours;
        dailyLimitMinutes.value = newMinutes;
      });
    }

    if (limitIncrease) {
      limitIncrease.addEventListener("click", () => {
        const hours = parseInt(dailyLimitHours.value) || 0;
        const minutes = parseInt(dailyLimitMinutes.value) || 30;
        const totalMinutes = hours * 60 + minutes;
        const newTotalMinutes = Math.min(1440, totalMinutes + 5);
        const newHours = Math.floor(newTotalMinutes / 60);
        const newMinutes = newTotalMinutes % 60;
        dailyLimitHours.value = newHours;
        dailyLimitMinutes.value = newMinutes;
      });
    }

    const resetHour = document.getElementById("reset-hour");
    const toneSelect = document.getElementById("tone-select");
    const cooldownMinutes = document.getElementById("cooldown-minutes");

    const themeRadios = document.querySelectorAll('input[name="theme"]');
    themeRadios.forEach((radio) => {
      if (radio._hasThemeListener) {
        console.log(
          "⚠️ Theme radio already has listener, skipping:",
          radio.value
        );
        return;
      }

      radio.addEventListener("change", async () => {
        console.log("🎨 Theme changed to:", radio.value);

        await this.saveThemeOnly(radio.value);

        await this.applyTheme();

        chrome.runtime
          .sendMessage({ type: "THEME_CHANGED" })
          .then(() => {
            console.log("Theme change message sent to popup");
          })
          .catch(() => {
            console.log("Popup not open, theme change message not sent");
          });
      });

      radio._hasThemeListener = true;
      console.log("✅ Theme radio listener attached:", radio.value);
    });

    const setPasscode = document.getElementById("set-passcode");
    if (setPasscode) {
      setPasscode.addEventListener("click", async () => {
        const passcode = document.getElementById("passcode").value;
        if (passcode) {
          try {
            await chrome.runtime.sendMessage({
              type: "SET_PASSCODE",
              passcode,
            });
            document.getElementById("passcode").value = "";
            this.showMessage("Passcode set successfully", "success");
          } catch (error) {
            this.showMessage("Failed to set passcode", "error");
          }
        } else {
          this.showMessage("Please enter a passcode", "error");
        }
      });
    }

    const saveSettings = document.getElementById("save-settings");
    if (saveSettings) {
      if (saveSettings._hasListener) {
        console.log("⚠️ Save button already has listener, skipping");
        return;
      }

      saveSettings.addEventListener("click", () => {
        console.log("🔘 Save button clicked");

        if (this.saveTimeout) {
          clearTimeout(this.saveTimeout);
          this.saveTimeout = null;
        }
        this.saveSettings();
      });

      saveSettings._hasListener = true;
      console.log("✅ Save button listener attached");
    }

    const resetSettings = document.getElementById("reset-settings");
    if (resetSettings) {
      resetSettings.addEventListener("click", () => {
        if (confirm("Reset all settings to defaults? This cannot be undone.")) {
          this.resetSettings();
        }
      });
    }

    const refreshTabs = document.getElementById("refresh-tabs");
    if (refreshTabs) {
      refreshTabs.addEventListener("click", () => {
        this.refreshTwitterTabs();
      });
    }

    this.setupOverlayCustomizationListeners();
  }

  setupNotificationListeners() {
    const enableNotifications = document.getElementById("enable-notifications");
    if (enableNotifications) {
      enableNotifications.addEventListener("change", () => {
        this.toggleNotificationSettings();
      });
    }

    const notificationFilter = document.querySelectorAll(
      'input[name="notification-filter"]'
    );
    notificationFilter.forEach((radio) => {
      radio.addEventListener("change", () => {
        
      });
    });

    const notificationInterval = document.getElementById(
      "notification-interval"
    );
    if (notificationInterval) {
      notificationInterval.addEventListener("change", () => {
        
      });
    }
  }

  setupOverlayCustomizationListeners() {
    const enableCustomOverlay = document.getElementById(
      "enable-custom-overlay"
    );
    if (enableCustomOverlay) {
      enableCustomOverlay.addEventListener("change", () => {
        this.toggleOverlayCustomization();
      });
    }

    const templateRadios = document.querySelectorAll(
      'input[name="overlay-template"]'
    );
    templateRadios.forEach((radio) => {
      radio.addEventListener("change", () => {
        this.toggleCustomMessageSection();
      });
    });

    const overlayImage = document.getElementById("overlay-image");
    if (overlayImage) {
      overlayImage.addEventListener("change", (e) => {
        this.handleImageUpload(e);
      });
    }

    const clearImage = document.getElementById("clear-image");
    if (clearImage) {
      clearImage.addEventListener("click", () => {
        this.clearImage();
      });
    }
  }

  toggleOverlayCustomization() {
    const enableCustomOverlay = document.getElementById(
      "enable-custom-overlay"
    );
    const overlayOptions = document.getElementById(
      "overlay-customization-options"
    );

    if (enableCustomOverlay && overlayOptions) {
      if (enableCustomOverlay.checked) {
        overlayOptions.style.display = "block";
      } else {
        overlayOptions.style.display = "none";
      }
    }
  }

  toggleCustomMessageSection() {
    const customTemplate = document.querySelector(
      'input[name="overlay-template"][value="custom"]'
    );
    const customMessageSection = document.getElementById(
      "custom-message-section"
    );

    if (customTemplate && customMessageSection) {
      if (customTemplate.checked) {
        customMessageSection.style.display = "block";
      } else {
        customMessageSection.style.display = "none";
      }
    }
  }

  handleImageUpload(event) {
    const file = event.target.files[0];
    if (!file) return;

    if (file.size > 2 * 1024 * 1024) {
      this.showMessage("Image must be smaller than 2MB", "error");
      event.target.value = "";
      return;
    }

    if (!file.type.startsWith("image/")) {
      this.showMessage("Please select a valid image file", "error");
      event.target.value = "";
      return;
    }

    this.compressAndStoreImage(file);
  }

  compressAndStoreImage(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
      const base64Image = e.target.result;
      this.showMessage(
        `Image loaded successfully! (${Math.round(file.size / 1024)}KB)`,
        "success"
      );
      
      
      if (this.cropper) {
        try { 
          this.cropper.destroy(); 
        } catch (_) {}
        this.cropper = null;
      }
      
      this.showImagePreview(base64Image, true);
    };

    reader.onerror = () => {
      this.showMessage("Failed to load image", "error");
      document.getElementById("overlay-image").value = "";
    };

    reader.readAsDataURL(file);
  }

  async showImagePreview(base64Image, enableCrop = false) {
    const imagePreview = document.getElementById("image-preview");
    const previewImg = document.getElementById("preview-img");
    const clearImageBtn = document.getElementById("clear-image");
    const modal = document.getElementById('cropper-modal');
    const cropImg = document.getElementById('cropper-img');
    const cropSave = document.getElementById('cropper-save');
    const cropCancel = document.getElementById('cropper-cancel');

    if (imagePreview && previewImg) {
      previewImg.src = base64Image;
      imagePreview.style.display = "block";

      if (clearImageBtn) {
        clearImageBtn.style.display = "block";
      }

      
      if (enableCrop && window.Cropper && modal && cropImg) {
        
        if (imagePreview) {
          imagePreview.style.display = 'none';
        }
        
        modal.style.display = 'block';
        cropImg.src = base64Image;
        
        
        cropImg.style.display = 'none';
        
        
        setTimeout(() => {
          if (this.cropper) {
            try { this.cropper.destroy(); } catch (_) {}
            this.cropper = null;
          }
          this.cropper = new Cropper(cropImg, {
            aspectRatio: 1,
            viewMode: 1,
            dragMode: 'move',
            autoCropArea: 0.8, 
            background: false,
            responsive: true,
            center: true, 
            guides: true, 
            highlight: true, 
          });
        }, 100);

        cropSave.onclick = async () => {
          if (!this.cropper) return;
          const canvas = this.cropper.getCroppedCanvas({ width: 512, height: 512, imageSmoothingEnabled: true, imageSmoothingQuality: 'high' });
          const croppedDataUrl = canvas.toDataURL('image/png', 0.92);
          
          chrome.runtime
            .sendMessage({ type: 'SET_CUSTOM_IMAGE', imageData: croppedDataUrl })
            .then(() => this.showMessage('Cropped image saved', 'success'))
            .catch(() => this.showMessage('Failed to save cropped image', 'error'));
          
          try { this.cropper.destroy(); } catch (_) {}
          this.cropper = null;
          modal.style.display = 'none';
          
          
          cropImg.style.display = 'block';
          
          
          if (imagePreview) {
            imagePreview.style.display = 'block';
          }
          previewImg.src = croppedDataUrl;
        };

        cropCancel.onclick = () => {
          try { this.cropper.destroy(); } catch (_) {}
          this.cropper = null;
          modal.style.display = 'none';
          
          
          cropImg.style.display = 'block';
          
          
          if (imagePreview) {
            imagePreview.style.display = 'block';
          }
        };
      } else {
        
        chrome.runtime
          .sendMessage({
            type: 'SET_CUSTOM_IMAGE',
            imageData: base64Image,
          })
          .catch((error) => {
            console.error('Failed to store custom image:', error);
          });
      }
    }
  }

  async clearImage() {
    const overlayImage = document.getElementById("overlay-image");
    const imagePreview = document.getElementById("image-preview");
    const clearImageBtn = document.getElementById("clear-image");

    if (overlayImage) overlayImage.value = "";
    if (imagePreview) imagePreview.style.display = "none";
    if (clearImageBtn) clearImageBtn.style.display = "none";

    chrome.runtime
      .sendMessage({
        type: "CLEAR_CUSTOM_IMAGE",
      })
      .catch((error) => {
        console.error("Failed to clear custom image:", error);
      });
  }

  async saveThemeOnly(theme) {
    try {
      const requestId = Math.random().toString(36).substr(2, 9);
      console.log("🎨 saveThemeOnly called:", {
        requestId,
        theme,
        timestamp: new Date().toISOString(),
      });

      await chrome.runtime.sendMessage({
        type: "UPDATE_SETTINGS",
        settings: { theme },
        requestId,
      });
      console.log("Theme saved successfully:", theme);
    } catch (error) {
      console.error("Failed to save theme:", error);
    }
  }

  debouncedSave() {
    console.log("Auto-save disabled - please click Save Settings button");
  }

  async saveSettingsWithRateLimit() {
    const now = Date.now();
    const timeSinceLastSave = now - this.lastSaveTime;

    if (timeSinceLastSave < 2000) {
      console.log("Rate limiting: Queuing save request");
      this.saveQueue.push(this.pendingChanges);

      setTimeout(() => {
        this.processSaveQueue();
      }, 2000 - timeSinceLastSave);
      return;
    }

    await this.saveSettings();
  }

  async processSaveQueue() {
    if (this.saveQueue.length === 0) return;

    const latestChanges = this.saveQueue[this.saveQueue.length - 1];
    this.saveQueue = [];

    this.pendingChanges = latestChanges;
    await this.saveSettings();
  }

  async saveSettings() {
    if (this.saveInProgress) {
      console.log("⏸️ Save already in progress, skipping duplicate");
      return;
    }

    this.saveInProgress = true;

    try {
      const formData = this.pendingChanges || this.getFormData();
      this.pendingChanges = null;

      this.lastSaveTime = Date.now();

      if (!this.validateFormData(formData)) {
        return;
      }

      const shouldResetUsage = this.shouldResetUsage(formData);

      const requestId = Math.random().toString(36).substr(2, 9);
      console.log("📤 Sending UPDATE_SETTINGS:", {
        requestId,
        settings: formData,
        resetUsage: shouldResetUsage,
        timestamp: new Date().toISOString(),
      });

      const response = await chrome.runtime.sendMessage({
        type: "UPDATE_SETTINGS",
        settings: formData,
        resetUsage: shouldResetUsage,
        requestId,
      });

      if (response && !response.success) {
        throw new Error(response.error || "Failed to save settings");
      }

      if (shouldResetUsage) {
        this.showMessage(
          "Settings saved and usage counter reset to 0!",
          "success"
        );
      } else {
        this.showMessage("Settings saved successfully!", "success");
      }

      await this.loadSettings();
    } catch (error) {
      console.error("Failed to save settings:", error);

      if (
        error.message &&
        error.message.includes("MAX_WRITE_OPERATIONS_PER_MINUTE")
      ) {
        this.showMessage(
          "Too many changes at once. Please wait a moment and try again.",
          "error"
        );
      } else if (
        error.message &&
        error.message.includes("QUOTA_BYTES_PER_ITEM")
      ) {
        this.showMessage(
          "Image is too large for storage. Please choose a smaller image or disable custom overlay.",
          "error"
        );
      } else if (error.message && error.message.includes("QUOTA_BYTES")) {
        this.showMessage(
          "Storage quota exceeded. Please clear some data or use a smaller image.",
          "error"
        );
      } else {
        this.showMessage("Failed to save settings", "error");
      }
    } finally {
      this.saveInProgress = false;
    }
  }

  getFormData() {
    const dailyLimitHours =
      parseInt(document.getElementById("daily-limit-hours").value) || 0;
    const dailyLimitMinutes =
      parseInt(document.getElementById("daily-limit-minutes").value) || 30;
    const totalMinutes = dailyLimitHours * 60 + dailyLimitMinutes;
    const resetHour = document.getElementById("reset-hour").value;
    const mode = document.querySelector('input[name="mode"]:checked').value;
    const allowSnooze = document.getElementById("allow-snooze").checked;
    const theme = document.querySelector('input[name="theme"]:checked').value;
    const tone = document.getElementById("tone-select").value;
    const cooldownMin = parseInt(
      document.getElementById("cooldown-minutes").value
    );

    const overlayCustomization = this.getOverlayCustomizationData();

    
    const enableNotifications = document.getElementById("enable-notifications");
    const notificationFilter = document.querySelector(
      'input[name="notification-filter"]:checked'
    );
    const notificationInterval = document.getElementById(
      "notification-interval"
    );

    return {
      dailyLimitMin: totalMinutes,
      resetHourLocal: parseInt(resetHour.split(":")[0]),
      mode,
      allowSnooze,
      theme,
      tone,
      cooldownMin,
      overlayCustomization,
      notifications: {
        enabled: enableNotifications ? enableNotifications.checked : false,
        filterType: notificationFilter ? notificationFilter.value : "following",
        checkInterval: notificationInterval
          ? parseFloat(notificationInterval.value)
          : 1,
      },
    };
  }

  getOverlayCustomizationData() {
    const enableCustomOverlay = document.getElementById(
      "enable-custom-overlay"
    );
    const template = document.querySelector(
      'input[name="overlay-template"]:checked'
    );
    const customMessage = document.getElementById("custom-message");
    const previewImg = document.getElementById("preview-img");

    return {
      enabled: enableCustomOverlay ? enableCustomOverlay.checked : false,
      template: template ? template.value : "default",
      customMessage: customMessage ? customMessage.value : "",
    };
  }

  shouldResetUsage(newFormData) {
    if (!this.settings) return false;

    const oldDailyLimit = this.settings.dailyLimitMin;
    const newDailyLimit = newFormData.dailyLimitMin;

    const oldCooldown = this.settings.cooldownMin;
    const newCooldown = newFormData.cooldownMin;

    const dailyLimitChanged = oldDailyLimit !== newDailyLimit;
    const cooldownChanged = oldCooldown !== newCooldown;

    console.log("Usage reset check:", {
      oldDailyLimit,
      newDailyLimit,
      oldCooldown,
      newCooldown,
      dailyLimitChanged,
      cooldownChanged,
      shouldReset: dailyLimitChanged || cooldownChanged,
    });

    return dailyLimitChanged || cooldownChanged;
  }

  validateFormData(data) {
    if (
      !data.dailyLimitMin ||
      data.dailyLimitMin < 1 ||
      data.dailyLimitMin > 1440
    ) {
      this.showMessage(
        "Daily limit must be between 1 and 1440 minutes (24 hours)",
        "error"
      );
      return false;
    }

    if (!data.cooldownMin || data.cooldownMin < 1 || data.cooldownMin > 60) {
      this.showMessage("Cooldown must be between 1 and 60 minutes", "error");
      return false;
    }

    return true;
  }

  async resetSettings() {
    try {
      await chrome.runtime.sendMessage({ type: "RESET_SETTINGS" });
      await this.loadSettings();
      this.showMessage("Settings reset to defaults", "success");
    } catch (error) {
      console.error("Failed to reset settings:", error);
      this.showMessage("Failed to reset settings", "error");
    }
  }

  async refreshTwitterTabs() {
    try {
      this.showMessage("Refreshing Twitter tabs...", "info");

      const response = await chrome.runtime.sendMessage({
        type: "REFRESH_TWITTER_TABS",
      });

      if (response && response.success) {
        this.showMessage("Twitter tabs refreshed successfully!", "success");
      } else {
        this.showMessage("Failed to refresh Twitter tabs", "error");
      }
    } catch (error) {
      console.error("Failed to refresh Twitter tabs:", error);
      this.showMessage("Failed to refresh Twitter tabs", "error");
    }
  }

  async applyTheme() {
    try {
      const selectedTheme = document.querySelector(
        'input[name="theme"]:checked'
      );
      const theme = selectedTheme ? selectedTheme.value : "system";

      const html = document.documentElement;

      html.classList.remove("light", "dark");

      if (theme === "light") {
        html.classList.add("light");
      } else if (theme === "dark") {
        html.classList.add("dark");
      } else {
        if (
          window.matchMedia &&
          window.matchMedia("(prefers-color-scheme: dark)").matches
        ) {
          html.classList.add("dark");
        } else {
          html.classList.add("light");
        }
      }
    } catch (error) {
      console.warn("Failed to apply theme:", error);
    }
  }

  showMessage(message, type = "info") {
    const existingToasts = document.querySelectorAll(".toast-notification");
    existingToasts.forEach((toast) => toast.remove());

    let toastContainer = document.getElementById("toast-container");
    if (!toastContainer) {
      toastContainer = document.createElement("div");
      toastContainer.id = "toast-container";
      toastContainer.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        z-index: 10000;
        pointer-events: none;
      `;
      document.body.appendChild(toastContainer);
    }

    const toast = document.createElement("div");
    toast.className = "toast-notification";

    let bgColor, textColor;
    if (type === "success") {
      bgColor = "#059669";
      textColor = "#ffffff";
    } else if (type === "error") {
      bgColor = "#dc2626";
      textColor = "#ffffff";
    } else {
      bgColor = "#1e293b";
      textColor = "#f1f5f9";
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
    `;

    toast.textContent = message;
    toastContainer.appendChild(toast);

    requestAnimationFrame(() => {
      toast.style.transform = "translateX(0)";
    });

    setTimeout(() => {
      if (toast.parentNode) {
        toast.style.transform = "translateX(100%)";
        setTimeout(() => {
          if (toast.parentNode) {
            toast.remove();
          }
        }, 300);
      }
    }, 3000);
  }

  toggleNotificationSettings() {
    const enableNotifications = document.getElementById("enable-notifications");
    const notificationSettings = document.getElementById(
      "notification-settings"
    );

    if (enableNotifications && notificationSettings) {
      if (enableNotifications.checked) {
        notificationSettings.style.display = "block";
      } else {
        notificationSettings.style.display = "none";
      }
    }
  }

  async saveNotificationSettings() {
    try {
      const enableNotifications = document.getElementById(
        "enable-notifications"
      );
      const notificationFilter = document.querySelector(
        'input[name="notification-filter"]:checked'
      );
      const notificationInterval = document.getElementById(
        "notification-interval"
      );

      if (
        !enableNotifications ||
        !notificationFilter ||
        !notificationInterval
      ) {
        return;
      }

      const notificationSettings = {
        enabled: enableNotifications.checked,
        filterType: notificationFilter.value,
        checkInterval: parseFloat(notificationInterval.value),
      };

      const response = await chrome.runtime.sendMessage({
        type: "UPDATE_NOTIFICATIONS",
        notifications: notificationSettings,
      });

      if (response && response.success) {
        this.showMessage("Notification settings saved", "success");
      } else {
        this.showMessage("Failed to save notification settings", "error");
      }
    } catch (error) {
      console.error("Failed to save notification settings:", error);
      this.showMessage("Failed to save notification settings", "error");
    }
  }

  async loadNotificationSettings() {
    try {
      const response = await chrome.runtime.sendMessage({
        type: "GET_NOTIFICATIONS",
      });
      if (response && response.notifications) {
        const notifications = response.notifications;

        const enableNotifications = document.getElementById(
          "enable-notifications"
        );
        const notificationFilter = document.querySelector(
          `input[name="notification-filter"][value="${notifications.filterType}"]`
        );
        const notificationInterval = document.getElementById(
          "notification-interval"
        );
        const notificationSettings = document.getElementById(
          "notification-settings"
        );

        if (enableNotifications) {
          enableNotifications.checked = notifications.enabled;
        }

        if (notificationFilter) {
          notificationFilter.checked = true;
        }

        if (notificationInterval) {
          notificationInterval.value = notifications.checkInterval;
        }

        if (notificationSettings) {
          notificationSettings.style.display = notifications.enabled
            ? "block"
            : "none";
        }
      }
    } catch (error) {
      console.error("Failed to load notification settings:", error);
    }
  }
}

document.addEventListener("DOMContentLoaded", () => {
  if (window.optionsController) {
    console.log("⚠️ OptionsController already exists, not creating duplicate");
    return;
  }

  console.log("✅ Creating OptionsController instance");
  window.optionsController = new OptionsController();
});
