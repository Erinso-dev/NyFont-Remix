import { saveSettingsDebounced } from '../../../../script.js';
import { getFontFamilyDisplayLabel } from './nytwFonts.js';
import { applyPanelSkin, syncFieldMetrics } from './nytwCore.js';
import { extensionFolderPath, settings } from './nytwState.js';
import { waitForElement } from './nytwUtils.js';
import { initDisplaySettingsTab } from './nytwUiDisplaySettingsTab.js';
import { initFontSettingsTab } from './nytwUiFontSettingsTab.js';
import { initHelpTab } from './nytwUiHelpTab.js';
import { initImportTab } from './nytwUiImportTab.js';
import { initTabs } from './nytwUiTabs.js';

export async function setupSettingsUi() {
    const settingsContainer = await waitForElement('#extensions_settings');
    if (!settingsContainer) return;
    if (document.getElementById('nytw_settings_root')) return;

    try {
        const response = await fetch(`${extensionFolderPath}/settings.html`);
        if (!response.ok) return;
        const html = await response.text();
        settingsContainer.insertAdjacentHTML('beforeend', html);
    } catch (error) {
        console.error('[NyTW] Failed to load settings UI', error);
        return;
    }

    const root = document.getElementById('nytw_settings_root');
    if (!root) return;

    initTabs(root);

    const migrateFontSettingToDisplayLabel = (key) => {
        const raw = String(settings[key] || '').trim();
        if (!raw) return false;
        if (raw.includes(',') || raw.includes('（') || raw.includes('(')) return false;
        const display = getFontFamilyDisplayLabel(raw);
        if (!display || display === raw) return false;
        settings[key] = display;
        return true;
    };

    const migratedAny = migrateFontSettingToDisplayLabel('globalFont')
        || migrateFontSettingToDisplayLabel('bodyFont')
        || migrateFontSettingToDisplayLabel('dialogueFont')
        || migrateFontSettingToDisplayLabel('customFont');
    if (migratedAny) saveSettingsDebounced();

    // Tabs init order matters for cross-tab interactions (e.g. import-tab enabling wrap toggle).
    initFontSettingsTab();
    initDisplaySettingsTab();
    initImportTab();
    initHelpTab(root);

    // 根据实际底色切换浅色/深色皮肤，保证文字对比度
    applyPanelSkin();
    syncFieldMetrics();
    setTimeout(() => { applyPanelSkin(); syncFieldMetrics(); }, 600);
    document.addEventListener('change', (event) => {
        if (event.target?.id === 'themes') setTimeout(() => { applyPanelSkin(); syncFieldMetrics(); }, 300);
    }, true);
    // 展开/切换标签后重新对齐一次（元素届时才有真实尺寸）
    root.addEventListener('click', () => setTimeout(syncFieldMetrics, 120), true);
}

