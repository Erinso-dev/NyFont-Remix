import { saveSettingsDebounced } from '../../../../script.js';

const NYFONT_SAVE_DELAY = 4000;
let nyFontSaveTimer = 0;

/** 去抖保存：整份设置很大，改字体/排版时不要每次都保存 */
export function scheduleNyFontSave() {
    if (nyFontSaveTimer) return;
    nyFontSaveTimer = setTimeout(() => {
        nyFontSaveTimer = 0;
        saveSettingsDebounced();
    }, NYFONT_SAVE_DELAY);
}

/** 立刻补存（收起面板 / 页面隐藏 / 切角色时调用）；没有待存内容时什么也不做 */
export function flushNyFontSave() {
    if (!nyFontSaveTimer) return;
    clearTimeout(nyFontSaveTimer);
    nyFontSaveTimer = 0;
    saveSettingsDebounced();
}

try {
    window.addEventListener('pagehide', flushNyFontSave);
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') flushNyFontSave();
    });
    // 收起 NyFont 面板时立刻补存
    document.addEventListener('click', (event) => {
        const target = event.target;
        if (target instanceof Element && target.closest('#nytw_settings_root .inline-drawer-toggle')) {
            flushNyFontSave();
        }
    }, true);
} catch { /* no-op */ }

export function notify(type, message) {
    const text = String(message || '');
    const toastrInstance = globalThis.toastr;
    if (toastrInstance && typeof toastrInstance[type] === 'function') {
        toastrInstance[type](text);
        return;
    }
    const method = type === 'error' ? 'error' : 'log';
    console[method](`[NyTW] ${text}`);
}

export function debounce(fn, delayMs) {
    let timer = null;
    return (...args) => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => fn(...args), delayMs);
    };
}

export async function waitForElement(selector, root = document, timeout = 10000) {
    const existing = root.querySelector(selector);
    if (existing) return existing;

    return new Promise((resolve) => {
        const obs = new MutationObserver(() => {
            const el = root.querySelector(selector);
            if (el) {
                obs.disconnect();
                resolve(el);
            }
        });

        obs.observe(root, { childList: true, subtree: true });
        setTimeout(() => {
            obs.disconnect();
            resolve(root.querySelector(selector));
        }, timeout);
    });
}

