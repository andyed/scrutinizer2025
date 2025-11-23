const { app } = require('electron');
const path = require('path');
const fs = require('fs');

class SettingsManager {
    constructor() {
        this.settings = null;
        this.settingsFile = null;
        this.defaults = {
            radius: 180,
            blur: 10,
            enabled: true, // Default to enabled
            showWelcomePopup: true, // Default to showing popup
            startPage: 'https://github.com/andyed/scrutinizer2025?tab=readme-ov-file#what-is-scrutinizer',
            windowBounds: { width: 1200, height: 900 }
        };
    }

    init() {
        this.userDataPath = app.getPath('userData');
        this.settingsFile = path.join(this.userDataPath, 'settings.json');
        this.settings = this.load();
    }

    load() {
        try {
            if (fs.existsSync(this.settingsFile)) {
                const data = fs.readFileSync(this.settingsFile, 'utf8');
                const userSettings = JSON.parse(data);
                // Merge defaults to ensure all keys exist
                return { ...this.defaults, ...userSettings };
            }
        } catch (error) {
            console.error('Failed to load settings:', error);
        }
        return { ...this.defaults };
    }

    save() {
        try {
            fs.writeFileSync(this.settingsFile, JSON.stringify(this.settings, null, 2));
        } catch (error) {
            console.error('Failed to save settings:', error);
        }
    }

    get(key) {
        return this.settings[key];
    }

    set(key, value) {
        this.settings[key] = value;
        this.save();
    }

    getAll() {
        return { ...this.settings };
    }
}

module.exports = new SettingsManager();
