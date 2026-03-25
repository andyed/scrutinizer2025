const { app } = require('electron');
const path = require('path');
const fs = require('fs');

class SettingsManager {
    constructor() {
        this.settings = null;
        this.settingsFile = null;
        this.defaults = {
            radius: 45,  // ~1° foveal radius (2° diameter) on MBP Retina @ 20" (see docs/foveal-calibration-logic.md §7)
            blur: 10,
            intensity: 0.6,
            enabled: true, // Default to enabled
            comfortMode: false, // Comfort mode: +1° clear zone (microsaccade envelope)
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
                const mergedSettings = { ...this.defaults, ...userSettings };

                // Migration v1: Clamp radius to [20, 200] range.
                // Old defaults (180, 300, 450) were too large — 180px maps to ~4° on MBP Retina,
                // compressing eccentricity and under-attenuating all peripheral models.
                if (mergedSettings.radius > 200) {
                    mergedSettings.radius = 45;
                }

                // Migration v2: fovea_deg 2.0→1.0 — halve stored radius to preserve ppd.
                // Old default 90px assumed fovea_deg=2.0 (2° radius). Correct anatomy is
                // 1° radius (2° diameter). Halving radius keeps ppd = radius/fovea_deg = 45.
                if (!mergedSettings._foveaDegMigrated) {
                    mergedSettings.radius = Math.round(mergedSettings.radius / 2);
                    mergedSettings._foveaDegMigrated = true;
                    // Persist the migration flag
                    this.settings = mergedSettings;
                    this.save();
                }

                return mergedSettings;
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
