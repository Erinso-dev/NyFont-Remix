import { saveSettingsDebounced } from '../../../../script.js';
import { queueApplyFonts, scheduleScan } from './nytwCore.js';
import { importer_scheduleScan } from './nytwChatFontImporter.js';
import { settings } from './nytwState.js';
import { debounce } from './nytwUtils.js';
import { getFontFamilyDisplayLabel, toCssFontFamilyValue, setupFontPicker, setupLocalePicker } from './nytwFonts.js';
import { UNICODE_RANGES } from './nytwLocaleData.js';

function renderLocaleFontsList(rootEl, onUpdate) {
    rootEl.innerHTML = '';

    if (!settings.localeFonts || !settings.localeFonts.length) {
        return;
    }

    settings.localeFonts.forEach((item, index) => {
        const row = document.createElement('div');
        row.className = 'nytw-locale-row';

        // 1. Language/Range Picker (Styled like Font Picker)
        const rangeWrapper = document.createElement('div');
        rangeWrapper.className = 'nytw-input-wrapper nytw-locale-select-wrapper';

        const rangeInput = document.createElement('input');
        rangeInput.type = 'text';
        rangeInput.className = 'text_pole nytw-input nytw-locale-trigger';
        rangeInput.readOnly = true; // User picks from list
        rangeInput.placeholder = '选择语言...';

        const currentDef = UNICODE_RANGES[item.rangeKey];
        rangeInput.value = currentDef ? currentDef.label : item.rangeKey;
        rangeInput.title = rangeInput.value;

        const rangePopup = document.createElement('div');
        rangePopup.className = 'nytw-font-picker-popup';

        rangeWrapper.appendChild(rangeInput);
        rangeWrapper.appendChild(rangePopup);

        setupLocalePicker(rangeInput, rangePopup, (val) => {
            item.rangeKey = val;
            const newDef = UNICODE_RANGES[val];
            rangeInput.value = newDef ? newDef.label : val;
            rangeInput.title = rangeInput.value;
            onUpdate();
        });

        // 2. Font Picker
        const fontWrapper = document.createElement('div');
        fontWrapper.className = 'nytw-input-wrapper';

        const fontInput = document.createElement('input');
        fontInput.type = 'text';
        fontInput.className = 'text_pole nytw-input';
        fontInput.placeholder = '选择字体...';
        fontInput.value = item.font || '';
        fontInput.autocomplete = 'off';

        const fontPopup = document.createElement('div');
        fontPopup.className = 'nytw-font-picker-popup';

        fontWrapper.appendChild(fontInput);
        fontWrapper.appendChild(fontPopup);

        setupFontPicker(fontInput, fontPopup, (val) => {
            item.font = val;
            onUpdate();
        });

        // 3. Delete Button
        const delBtn = document.createElement('button');
        delBtn.className = 'nytw-locale-delete';
        delBtn.innerHTML = '<i class="fa-solid fa-xmark"></i>';
        delBtn.title = '删除规则';
        delBtn.addEventListener('click', () => {
            settings.localeFonts.splice(index, 1);
            renderLocaleFontsList(rootEl, onUpdate);
            onUpdate();
        });

        row.appendChild(rangeWrapper);
        row.appendChild(fontWrapper);
        row.appendChild(delBtn);
        rootEl.appendChild(row);
    });
}


function renderCustomFontRules(containerEl) {
    if (!containerEl) return;
    containerEl.innerHTML = '';

    if (!Array.isArray(settings.customFontRules)) settings.customFontRules = [];
    const rules = settings.customFontRules;

    if (!rules.length) {
        const empty = document.createElement('div');
        empty.className = 'nytw-help nytw-help--compact';
        empty.textContent = '还没有包裹规则，点下面的按钮添加一条。';
        containerEl.appendChild(empty);
        return;
    }

    const save = debounce(() => {
        saveSettingsDebounced();
        scheduleScan();
    }, 200);

    rules.forEach((rule, index) => {
        const block = document.createElement('div');
        block.className = 'nytw-custom-rule';

        // 第一行：独立字体 + 删除
        const fontRow = document.createElement('div');
        fontRow.className = 'flex-container alignItemsCenter nytw-row nytw-row--nested';

        const fontLabel = document.createElement('label');
        fontLabel.className = 'nytw-label';
        fontLabel.textContent = '独立字体';

        const fontWrapper = document.createElement('div');
        fontWrapper.className = 'nytw-input-wrapper';

        const fontInput = document.createElement('input');
        fontInput.type = 'text';
        fontInput.className = 'text_pole nytw-input nytw-font-input';
        fontInput.placeholder = '（留空表示默认）';
        fontInput.autocomplete = 'off';
        fontInput.value = rule.font || '';

        const fontPopup = document.createElement('div');
        fontPopup.className = 'nytw-font-picker-popup';

        fontWrapper.appendChild(fontInput);
        fontWrapper.appendChild(fontPopup);

        setupFontPicker(fontInput, fontPopup, (val) => {
            rule.font = val;
            save();
        });

        const delBtn = document.createElement('button');
        delBtn.type = 'button';
        delBtn.className = 'menu_button nytw-icon-button';
        delBtn.title = '删除这条规则';
        delBtn.innerHTML = '<i class="fa-solid fa-xmark" aria-hidden="true"></i>';
        delBtn.addEventListener('click', () => {
            const currentIndex = settings.customFontRules.indexOf(rule);
            if (currentIndex < 0) return;
            settings.customFontRules.splice(currentIndex, 1);
            saveSettingsDebounced();
            renderCustomFontRules(containerEl);
            scheduleScan();
        });

        fontRow.appendChild(fontLabel);
        fontRow.appendChild(fontWrapper);
        fontRow.appendChild(delBtn);

        // 第二行：包裹符号
        const symbolRow = document.createElement('div');
        symbolRow.className = 'flex-container alignItemsCenter nytw-row nytw-row--nested nytw-row--symbols';

        const symbolLabel = document.createElement('label');
        symbolLabel.className = 'nytw-label';
        symbolLabel.textContent = '包裹符号';

        const multi = document.createElement('div');
        multi.className = 'nytw-multi-input-wrapper';

        const openInput = document.createElement('input');
        openInput.type = 'text';
        openInput.className = 'text_pole nytw-token';
        openInput.placeholder = '（起始）';
        openInput.value = rule.open || '';
        openInput.addEventListener('input', () => {
            rule.open = openInput.value;
            save();
        });

        const arrow = document.createElement('span');
        arrow.className = 'nytw-arrow';
        arrow.textContent = '→';

        const closeInput = document.createElement('input');
        closeInput.type = 'text';
        closeInput.className = 'text_pole nytw-token';
        closeInput.placeholder = '（结束）';
        closeInput.value = rule.close || '';
        closeInput.addEventListener('input', () => {
            rule.close = closeInput.value;
            save();
        });

        multi.appendChild(openInput);
        multi.appendChild(arrow);
        multi.appendChild(closeInput);

        symbolRow.appendChild(symbolLabel);
        symbolRow.appendChild(multi);

        block.appendChild(fontRow);
        block.appendChild(symbolRow);
        containerEl.appendChild(block);
    });
}

let refreshFontSettingsControls = () => {};

// Refresh the existing controls without rebinding picker or toggle listeners.
export function syncFontSettingsControls() {
    refreshFontSettingsControls();
}

export function initFontSettingsTab() {
    const enabledEl = document.getElementById('nytw_fonts_enabled');
    const fontsSettingsPanel = document.getElementById('nytw_main_settings_panel');
    const fontsEnabledRow = document.getElementById('nytw_fonts_enabled_row');
    const fontsEnabledText = document.getElementById('nytw_fonts_enabled_text');
    const root = document.getElementById('nytw_settings_root');
    const displayTabItem = document.getElementById('nytw_tab_item_display')
        || root?.querySelector?.('.nytw-tab-item[data-tab="display"]');
    const settingsTabItem = root?.querySelector?.('.nytw-tab-item[data-tab="settings"]');

    const setMainPanelOpen = (open) => {
        if (fontsSettingsPanel) {
            fontsSettingsPanel.classList.toggle('is-open', open);
            fontsSettingsPanel.setAttribute('aria-hidden', open ? 'false' : 'true');
        }
        fontsEnabledRow?.classList.toggle('is-open', open);
        if (fontsEnabledText) {
            fontsEnabledText.textContent = open ? '字体覆盖已启用' : '点击启用字体覆盖';
        }
    };

    const setDisplayTabVisible = (visible) => {
        if (!(displayTabItem instanceof HTMLElement)) return;

        const wasCollapsed = displayTabItem.classList.contains('is-collapsed');
        const willBeCollapsed = !visible;

        if (wasCollapsed !== willBeCollapsed && settingsTabItem instanceof HTMLElement) {
            settingsTabItem.classList.remove('nytw-tab-anim');
            void settingsTabItem.offsetWidth;
            settingsTabItem.classList.add('nytw-tab-anim');
            setTimeout(() => {
                if (settingsTabItem.isConnected) settingsTabItem.classList.remove('nytw-tab-anim');
            }, 500);
        }

        displayTabItem.classList.toggle('is-collapsed', !visible);
        displayTabItem.setAttribute('aria-hidden', visible ? 'false' : 'true');
        if (visible) {
            displayTabItem.removeAttribute('tabindex');
        } else {
            displayTabItem.setAttribute('tabindex', '-1');
            // If the user is currently on the display tab, return them to font settings.
            if (displayTabItem.classList.contains('active') && settingsTabItem instanceof HTMLElement) {
                settingsTabItem.click();
            }
        }
    };

    if (enabledEl instanceof HTMLInputElement) {
        enabledEl.checked = Boolean(settings.fontsEnabled);
        setMainPanelOpen(enabledEl.checked);
        setDisplayTabVisible(enabledEl.checked);

        const updateState = () => {
            settings.fontsEnabled = enabledEl.checked;
            setMainPanelOpen(enabledEl.checked);
            setDisplayTabVisible(enabledEl.checked);
            saveSettingsDebounced();
            queueApplyFonts();
            scheduleScan();
        };

        enabledEl.addEventListener('change', updateState);

        // Click handler for the header row to toggle checkbox
        if (fontsEnabledRow) {
            fontsEnabledRow.addEventListener('click', (e) => {
                // Avoid double toggling if clicking directly on the checkbox (though it's hidden now)
                if (e.target !== enabledEl) {
                    enabledEl.checked = !enabledEl.checked;
                    updateState();
                }
            });
        }
    }

    const debouncedSaveAndApply = debounce(() => {
        saveSettingsDebounced();
        queueApplyFonts();
        scheduleScan();
    }, 200);

    const debouncedSaveAndScan = debounce(() => {
        saveSettingsDebounced();
        scheduleScan();
    }, 200);

    const globalEl = document.getElementById('nytw_global_font');
    const globalPopup = document.getElementById('nytw_global_font_popup');
    if (globalEl instanceof HTMLInputElement && globalPopup) {
        globalEl.value = settings.globalFont || '';
        setupFontPicker(globalEl, globalPopup, (val) => {
            settings.globalFont = val;
            debouncedSaveAndApply();
        });
    }

    const bodyEl = document.getElementById('nytw_body_font');
    const bodyPopup = document.getElementById('nytw_body_font_popup');
    if (bodyEl instanceof HTMLInputElement && bodyPopup) {
        bodyEl.value = settings.bodyFont || '';
        setupFontPicker(bodyEl, bodyPopup, (val) => {
            settings.bodyFont = val;
            debouncedSaveAndApply();
        });
    }

    const dialogueEl = document.getElementById('nytw_dialogue_font');
    const dialoguePopup = document.getElementById('nytw_dialogue_font_popup');
    if (dialogueEl instanceof HTMLInputElement && dialoguePopup) {
        dialogueEl.value = settings.dialogueFont || '';
        setupFontPicker(dialogueEl, dialoguePopup, (val) => {
            settings.dialogueFont = val;
            debouncedSaveAndApply();
        });
    }

    const customFontEl = document.getElementById('nytw_custom_font');
    const customFontPopup = document.getElementById('nytw_custom_font_popup');
    if (customFontEl instanceof HTMLInputElement && customFontPopup) {
        customFontEl.value = settings.customFont || '';
        setupFontPicker(customFontEl, customFontPopup, (val) => {
            settings.customFont = val;
            debouncedSaveAndApply();
        });
    }

    // 包裹规则列表
    const customRulesContainer = document.getElementById('nytw_custom_rules');
    if (customRulesContainer) {
        renderCustomFontRules(customRulesContainer);
    }
    const addCustomRuleBtn = document.getElementById('nytw_add_custom_rule');
    if (addCustomRuleBtn) {
        addCustomRuleBtn.addEventListener('click', () => {
            if (!Array.isArray(settings.customFontRules)) settings.customFontRules = [];
            settings.customFontRules.push({ font: '', open: '', close: '' });
            if (!settings.customFontWrapEnabled) {
                const wrapToggle = document.getElementById('nytw_custom_font_wrap_enabled');
                if (wrapToggle instanceof HTMLInputElement && !wrapToggle.checked) {
                    wrapToggle.checked = true;
                    wrapToggle.dispatchEvent(new Event('change'));
                }
            }
            saveSettingsDebounced();
            if (customRulesContainer) renderCustomFontRules(customRulesContainer);
            scheduleScan();
        });
    }

    const customOpenEl = document.getElementById('nytw_custom_font_open');
    if (customOpenEl instanceof HTMLInputElement) {
        customOpenEl.value = settings.customFontOpen || '';
        customOpenEl.addEventListener('input', () => {
            settings.customFontOpen = customOpenEl.value;
            debouncedSaveAndScan();
        });
    }

    const customCloseEl = document.getElementById('nytw_custom_font_close');
    if (customCloseEl instanceof HTMLInputElement) {
        customCloseEl.value = settings.customFontClose || '';
        customCloseEl.addEventListener('input', () => {
            settings.customFontClose = customCloseEl.value;
            debouncedSaveAndScan();
        });
    }

    const customFontWrapToggle = document.getElementById('nytw_custom_font_wrap_toggle');
    const customFontWrapEnabledEl = document.getElementById('nytw_custom_font_wrap_enabled');
    const customFontWrapPanel = document.getElementById('nytw_custom_font_wrap_panel');

    const setCustomFontWrapPanelOpen = (open) => {
        if (customFontWrapPanel) {
            customFontWrapPanel.classList.toggle('is-open', open);
            customFontWrapPanel.setAttribute('aria-hidden', open ? 'false' : 'true');
        }
        customFontWrapToggle?.classList.toggle('is-open', open);
    };

    if (customFontWrapEnabledEl instanceof HTMLInputElement) {
        customFontWrapEnabledEl.checked = Boolean(settings.customFontWrapEnabled);
        setCustomFontWrapPanelOpen(customFontWrapEnabledEl.checked);

        const updateWrapState = () => {
            settings.customFontWrapEnabled = customFontWrapEnabledEl.checked;
            saveSettingsDebounced();
            setCustomFontWrapPanelOpen(customFontWrapEnabledEl.checked);
            scheduleScan();
        };

        customFontWrapEnabledEl.addEventListener('change', updateWrapState);

        if (customFontWrapToggle) {
            customFontWrapToggle.addEventListener('click', (e) => {
                if (e.target !== customFontWrapEnabledEl) {
                    customFontWrapEnabledEl.checked = !customFontWrapEnabledEl.checked;
                    updateWrapState();
                }
            });
        }
    } else {
        setCustomFontWrapPanelOpen(Boolean(settings.customFontWrapEnabled));
    }

    // Locale Fonts Logic
    const localeFontToggle = document.getElementById('nytw_locale_font_toggle');
    const localeFontEnabledEl = document.getElementById('nytw_locale_font_enabled');
    const localeFontPanel = document.getElementById('nytw_locale_font_panel');
    const localeListContainer = document.getElementById('nytw_locale_list');
    const addLocaleBtn = document.getElementById('nytw_add_locale_btn');

    const setLocaleFontPanelOpen = (open) => {
        if (localeFontPanel) {
            localeFontPanel.classList.toggle('is-open', open);
            localeFontPanel.setAttribute('aria-hidden', open ? 'false' : 'true');
        }
        localeFontToggle?.classList.toggle('is-open', open);
    };

    if (localeFontEnabledEl instanceof HTMLInputElement) {
        localeFontEnabledEl.checked = Boolean(settings.localeFontEnabled);
        setLocaleFontPanelOpen(localeFontEnabledEl.checked);

        const updateLocaleState = () => {
            settings.localeFontEnabled = localeFontEnabledEl.checked;
            saveSettingsDebounced();
            setLocaleFontPanelOpen(localeFontEnabledEl.checked);
            queueApplyFonts();
            scheduleScan();
        };

        localeFontEnabledEl.addEventListener('change', updateLocaleState);

        if (localeFontToggle) {
            localeFontToggle.addEventListener('click', (e) => {
                if (e.target !== localeFontEnabledEl) {
                    localeFontEnabledEl.checked = !localeFontEnabledEl.checked;
                    updateLocaleState();
                }
            });
        }
    }

    const updateLocaleList = debounce(() => {
        saveSettingsDebounced();
        queueApplyFonts();
        scheduleScan();
    }, 500);

    if (addLocaleBtn && localeListContainer) {
        renderLocaleFontsList(localeListContainer, updateLocaleList);

        addLocaleBtn.addEventListener('click', (e) => {
            e.stopPropagation(); // Prevent toggling parent
            if (!settings.localeFonts) settings.localeFonts = [];
            settings.localeFonts.push({ rangeKey: 'latin', font: '' });

            // Auto-enable if disabled
            if (!settings.localeFontEnabled && localeFontEnabledEl instanceof HTMLInputElement) {
                localeFontEnabledEl.checked = true;
                // Trigger change event to update UI
                localeFontEnabledEl.dispatchEvent(new Event('change'));
            }

            renderLocaleFontsList(localeListContainer, updateLocaleList);
            updateLocaleList(); // Also trigger scan immediately
        });
    }

    refreshFontSettingsControls = () => {
        for (const [el, key] of [[globalEl, 'globalFont'], [bodyEl, 'bodyFont'], [dialogueEl, 'dialogueFont'], [customFontEl, 'customFont']]) {
            if (!(el instanceof HTMLInputElement)) continue;
            el.value = settings[key] || '';
            el.style.fontFamily = toCssFontFamilyValue(el.value);
        }
        if (customOpenEl) customOpenEl.value = settings.customFontOpen || '';
        if (customCloseEl) customCloseEl.value = settings.customFontClose || '';
        if (enabledEl) enabledEl.checked = Boolean(settings.fontsEnabled);
        setMainPanelOpen(Boolean(settings.fontsEnabled));
        setDisplayTabVisible(Boolean(settings.fontsEnabled));
        if (customFontWrapEnabledEl) customFontWrapEnabledEl.checked = Boolean(settings.customFontWrapEnabled);
        setCustomFontWrapPanelOpen(Boolean(settings.customFontWrapEnabled));
        if (localeFontEnabledEl) localeFontEnabledEl.checked = Boolean(settings.localeFontEnabled);
        setLocaleFontPanelOpen(Boolean(settings.localeFontEnabled));
        if (localeListContainer) renderLocaleFontsList(localeListContainer, updateLocaleList);
        for (const popup of [globalPopup, bodyPopup, dialoguePopup, customFontPopup]) {
            if (popup) popup.classList.remove('is-open');
        }
    };

    // Chat Font Import Toggle
    const chatFontImportRow = document.getElementById('nytw_chat_font_import_row');
    const chatFontImportEnabledEl = document.getElementById('nytw_chat_font_import_enabled');

    if (chatFontImportEnabledEl instanceof HTMLInputElement) {
        chatFontImportEnabledEl.checked = Boolean(settings.chatFontImportEnabled);

        const updateUiState = () => {
            const isEnabled = chatFontImportEnabledEl.checked;
            const textSpan = document.getElementById('nytw_chat_font_import_text');

            if (textSpan) {
                textSpan.textContent = isEnabled
                    ? '外部聊天字体导入运行中'
                    : '点击开启外部聊天字体导入';
            }
            if (chatFontImportRow) {
                chatFontImportRow.classList.toggle('is-open', isEnabled);
            }
        };

        const updateImportState = () => {
            settings.chatFontImportEnabled = chatFontImportEnabledEl.checked;
            updateUiState();
            saveSettingsDebounced();
            if (settings.chatFontImportEnabled) {
                importer_scheduleScan('ENABLE_TOGGLE');
            }
        };

        // Initialize UI
        updateUiState();

        chatFontImportEnabledEl.addEventListener('change', updateImportState);

        if (chatFontImportRow) {
            chatFontImportRow.addEventListener('click', (e) => {
                // If clicking directly on the hidden input, do nothing (change event will handle it)
                if (e.target === chatFontImportEnabledEl) return;

                // Toggle the checkbox
                chatFontImportEnabledEl.checked = !chatFontImportEnabledEl.checked;
                updateImportState();
            });
        }
    }

    const globalClear = document.getElementById('nytw_global_font_clear');
    globalClear?.addEventListener('click', () => {
        settings.globalFont = '';
        if (globalEl instanceof HTMLInputElement) {
            globalEl.value = '';
            globalEl.style.fontFamily = '';
        }
        saveSettingsDebounced();
        queueApplyFonts();
    });

    const bodyClear = document.getElementById('nytw_body_font_clear');
    bodyClear?.addEventListener('click', () => {
        settings.bodyFont = '';
        if (bodyEl instanceof HTMLInputElement) {
            bodyEl.value = '';
            bodyEl.style.fontFamily = '';
        }
        saveSettingsDebounced();
        queueApplyFonts();
    });

    const dialogueClear = document.getElementById('nytw_dialogue_font_clear');
    dialogueClear?.addEventListener('click', () => {
        settings.dialogueFont = '';
        if (dialogueEl instanceof HTMLInputElement) {
            dialogueEl.value = '';
            dialogueEl.style.fontFamily = '';
        }
        saveSettingsDebounced();
        queueApplyFonts();
    });

    const customFontClear = document.getElementById('nytw_custom_font_clear');
    customFontClear?.addEventListener('click', () => {
        settings.customFont = '';
        if (customFontEl instanceof HTMLInputElement) {
            customFontEl.value = '';
            customFontEl.style.fontFamily = '';
        }
        saveSettingsDebounced();
        queueApplyFonts();
        scheduleScan();
    });

    const customSymbolsClear = document.getElementById('nytw_custom_font_symbols_clear');
    customSymbolsClear?.addEventListener('click', () => {
        settings.customFontOpen = '';
        settings.customFontClose = '';
        if (customOpenEl instanceof HTMLInputElement) customOpenEl.value = '';
        if (customCloseEl instanceof HTMLInputElement) customCloseEl.value = '';
        saveSettingsDebounced();
        scheduleScan();
    });
}
