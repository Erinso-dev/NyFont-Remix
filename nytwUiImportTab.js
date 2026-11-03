import { saveSettingsDebounced } from '../../../../script.js';
import { queueApplyFonts } from './nytwCore.js';
import { settings } from './nytwState.js';
import { notify } from './nytwUtils.js';
import {
    UNCATEGORIZED_ID,
    createTagChip,
    ensureTagSupport,
    getFontTagIds,
    getTagDef,
    getTagDefs,
    openBatchTagEditor,
    openFontTagEditor,
    openTagManager,
    renderTagFilterBar,
} from './nytwTags.js';
import {
    createFontId,
    deleteFontBlob,
    extractFontFamiliesFromCssText,
    formatBytes,
    getFontBlob,
    getFontFamilyDisplayLabel,
    getImportedFontKind,
    inferFamiliesFromGoogleFontsCssUrl,
    inferFontFormatFromFileName,
    normalizeExternalStylesheetUrl,
    normalizeFontFamily,
    parseFontFamilyList,
    putFontBlob,
    toCssFontFamilyValue,
    uniqueFontFamily,
} from './nytwFonts.js';

const FONT_CONFIG_SCHEMA = 'Ny-font-manager.font-config';
const FONT_CONFIG_VERSION = 1;

function normalizeTagList(rawTags) {
    if (!Array.isArray(rawTags)) return [];
    return Array.from(new Set(rawTags.map((t) => String(t ?? '').trim()).filter(Boolean)));
}

function cloneJsonValue(value) {
    return JSON.parse(JSON.stringify(value ?? null));
}

function readFileAsText(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(reader.error || new Error('文件读取失败'));
        reader.readAsText(file);
    });
}

function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(reader.error || new Error('字体文件读取失败'));
        reader.readAsDataURL(blob);
    });
}

function dataUrlToBlob(dataUrl, fallbackType = '') {
    const text = String(dataUrl || '');
    const commaIndex = text.indexOf(',');
    if (!text.startsWith('data:') || commaIndex < 0) {
        throw new Error('字体文件数据格式无效');
    }

    const header = text.slice(0, commaIndex);
    const payload = text.slice(commaIndex + 1);
    const mimeMatch = header.match(/^data:([^;,]*)/i);
    const mimeType = mimeMatch?.[1] || fallbackType || '';
    const isBase64 = /;base64/i.test(header);

    const binary = isBase64 ? atob(payload) : decodeURIComponent(payload);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return new Blob([bytes], { type: mimeType });
}

function downloadJsonFile(fileName, payload) {
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = fileName;
    anchor.style.display = 'none';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function buildExportFileName() {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    return `Ny-font-manager-font-config-${stamp}.json`;
}

function parseFontConfigPayload(text) {
    let payload;
    try {
        payload = JSON.parse(text);
    } catch {
        throw new Error('配置文件不是有效的 JSON。');
    }

    if (!payload || typeof payload !== 'object') {
        throw new Error('配置文件格式无效。');
    }

    const importedFonts = Array.isArray(payload.importedFonts)
        ? payload.importedFonts
        : (Array.isArray(payload.fonts) ? payload.fonts : null);
    if (!importedFonts) {
        throw new Error('配置文件中没有找到已导入字体列表。');
    }

    let fontFiles = [];
    if (Array.isArray(payload.fontFiles)) {
        fontFiles = payload.fontFiles;
    } else if (payload.fontBlobs && typeof payload.fontBlobs === 'object') {
        fontFiles = Object.entries(payload.fontBlobs).map(([id, entry]) => ({ id, ...(entry || {}) }));
    }

    const fontTags = Array.isArray(payload.fontTags) ? payload.fontTags : [];
    return { importedFonts, fontFiles, fontTags };
}

function normalizeImportedFontRecord(rawFont) {
    if (!rawFont || typeof rawFont !== 'object') return null;

    const id = String(rawFont.id || createFontId()).trim() || createFontId();
    const family = normalizeFontFamily(rawFont.family || rawFont.name || '');
    if (!family) return null;

    if (getImportedFontKind(rawFont) === 'css') {
        const cssUrl = normalizeExternalStylesheetUrl(rawFont.cssUrl || rawFont.url || '');
        if (!cssUrl) return null;
        return {
            id,
            kind: 'css',
            family,
            cssUrl,
            tags: normalizeTagList(rawFont.tags),
        };
    }

    const fileName = String(rawFont.fileName || rawFont.name || `${family}.font`).trim().slice(0, 240);
    const size = Number(rawFont.size);
    return {
        id,
        kind: 'file',
        name: family,
        family,
        fileName,
        size: Number.isFinite(size) && size > 0 ? size : 0,
        format: String(rawFont.format || inferFontFormatFromFileName(fileName) || '').trim().slice(0, 40),
        tags: normalizeTagList(rawFont.tags),
    };
}

function getFamilyMergeKey(font) {
    return `${getImportedFontKind(font)}:${normalizeFontFamily(font?.family).toLowerCase()}`;
}

function mergeImportedFontRecords(importedFonts) {
    const next = Array.isArray(settings.importedFonts) ? [...settings.importedFonts] : [];
    let added = 0;
    let updated = 0;

    for (const font of importedFonts) {
        const id = String(font?.id || '').trim();
        const familyKey = getFamilyMergeKey(font);
        let index = id ? next.findIndex((item) => String(item?.id || '') === id) : -1;
        if (index < 0 && familyKey !== `${getImportedFontKind(font)}:`) {
            index = next.findIndex((item) => getFamilyMergeKey(item) === familyKey);
        }

        if (index >= 0) {
            next[index] = { ...next[index], ...font };
            updated++;
        } else {
            next.push(font);
            added++;
        }
    }

    settings.importedFonts = next;
    return { added, updated };
}

async function exportFontConfig() {
    const importedFonts = Array.isArray(settings.importedFonts) ? settings.importedFonts : [];
    const fontFiles = [];
    const missingFileFonts = [];

    for (const font of importedFonts) {
        if (getImportedFontKind(font) !== 'file' || !font?.id) continue;
        const blob = await getFontBlob(font.id);
        if (!blob) {
            missingFileFonts.push(font.family || font.fileName || font.id);
            continue;
        }

        fontFiles.push({
            id: font.id,
            fileName: font.fileName || blob.name || '',
            type: blob.type || '',
            size: blob.size || font.size || 0,
            dataUrl: await blobToDataUrl(blob),
        });
    }

    downloadJsonFile(buildExportFileName(), {
        schema: FONT_CONFIG_SCHEMA,
        version: FONT_CONFIG_VERSION,
        exportedAt: new Date().toISOString(),
        importedFonts: cloneJsonValue(importedFonts),
        fontTags: cloneJsonValue(getTagDefs()),
        fontFiles,
    });

    const fileCount = fontFiles.length;
    const cssCount = importedFonts.filter((font) => getImportedFontKind(font) === 'css').length;
    if (missingFileFonts.length) {
        notify('warning', `已导出字体配置，但有 ${missingFileFonts.length} 个本地字体文件未找到，需重新导入。`);
    } else {
        notify('success', `已导出字体配置（${cssCount} 个 Web 字体，${fileCount} 个本地字体）。`);
    }
}

async function importFontConfigFromFile(file) {
    const text = await readFileAsText(file);
    const payload = parseFontConfigPayload(text);
    if (Array.isArray(payload.fontTags) && payload.fontTags.length) {
        const known = new Set(getTagDefs().map((def) => def.id));
        for (const def of payload.fontTags) {
            if (!def || typeof def !== 'object') continue;
            const id = String(def.id || '').trim();
            if (!id || known.has(id)) continue;
            known.add(id);
            settings.fontTagDefs.push({
                id,
                name: String(def.name || id).trim().slice(0, 24) || id,
                color: String(def.color || '').trim(),
            });
        }
    }

    const fileMap = new Map(
        payload.fontFiles
            .filter((entry) => entry && typeof entry === 'object')
            .map((entry) => [String(entry.id || '').trim(), entry]),
    );

    const imported = [];
    let skipped = 0;
    let restoredFiles = 0;

    for (const rawFont of payload.importedFonts) {
        const font = normalizeImportedFontRecord(rawFont);
        if (!font) {
            skipped++;
            continue;
        }

        if (getImportedFontKind(font) === 'file') {
            const fileEntry = fileMap.get(font.id);
            if (fileEntry?.dataUrl) {
                try {
                    const blob = dataUrlToBlob(fileEntry.dataUrl, fileEntry.type || '');
                    await putFontBlob(font.id, blob);
                    if (!font.size && blob.size) font.size = blob.size;
                    restoredFiles++;
                } catch (error) {
                    console.warn('[NyTW] Failed to restore font blob', font.fileName || font.id, error);
                    skipped++;
                    continue;
                }
            } else {
                let existingBlob = null;
                try {
                    existingBlob = await getFontBlob(font.id);
                } catch { /* no-op */ }

                if (!existingBlob) {
                    skipped++;
                    continue;
                }
            }
        }

        imported.push(font);
    }

    if (!imported.length) {
        throw new Error('没有可导入的字体配置。');
    }

    const result = mergeImportedFontRecords(imported);
    ensureTagSupport();
    saveSettingsDebounced();
    renderImportedFontsList();
    setImportedFontsPanelOpen(true);
    queueApplyFonts();

    const details = [`新增 ${result.added} 个`, `更新 ${result.updated} 个`];
    if (restoredFiles) details.push(`恢复 ${restoredFiles} 个本地文件`);
    if (skipped) details.push(`跳过 ${skipped} 个无效/缺少文件项`);
    notify(skipped ? 'warning' : 'success', `字体配置导入完成：${details.join('，')}。`);
}

function setImportedFontsPanelOpen(open) {
    const importedFontsToggle = document.getElementById('nytw_imported_fonts_toggle');
    const importedFontsPanel = document.getElementById('nytw_imported_fonts_panel');

    if (importedFontsPanel) {
        importedFontsPanel.classList.toggle('is-open', open);
        importedFontsPanel.setAttribute('aria-hidden', open ? 'false' : 'true');
    }
    importedFontsToggle?.classList.toggle('is-open', open);
}

/* ------------------------------------------------------------------ */
/* 字体库列表（带搜索 + 标签筛选）                                       */
/* ------------------------------------------------------------------ */

let importSearchText = '';
let importActiveTag = '';
let importSortMode = 'default';
let importBatchMode = false;
const importSelectedIds = new Set();

function currentImportTags() {
    if (!importActiveTag || importActiveTag === UNCATEGORIZED_ID) return [];
    return [importActiveTag];
}

function matchesImportFilter(font) {
    const tagIds = getFontTagIds(font);
    if (importActiveTag === UNCATEGORIZED_ID) {
        if (tagIds.length) return false;
    } else if (importActiveTag) {
        if (!tagIds.includes(importActiveTag)) return false;
    }

    if (!importSearchText) return true;
    const tagNames = tagIds.map((id) => getTagDef(id)?.name || '').join(' ');
    const haystack = [font.family, font.name, font.fileName, font.format, tagNames]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
    return haystack.includes(importSearchText);
}

function fillFontTags(tagWrap, font) {
    tagWrap.innerHTML = '';
    const tagIds = getFontTagIds(font);
    for (const tagId of tagIds) {
        const def = getTagDef(tagId);
        if (!def) continue;
        tagWrap.appendChild(createTagChip(def.name, {
            color: def.color,
            className: 'nytw-tag-chip--font',
            onClick: () => {
                importActiveTag = tagId;
                renderImportedFontsList();
            },
        }));
    }
    if (!tagIds.length) {
        const none = document.createElement('span');
        none.className = 'nytw-tag-none';
        none.textContent = '未分类';
        tagWrap.appendChild(none);
    }
}

/**
 * 只刷新标签相关的 UI（筛选条计数 + 每行标签），
 * 不重建整个列表，避免滚动位置丢失、面板闪烁。
 */
export function refreshFontTagsUI() {
    renderTagFilterBar(document.getElementById('nytw_tag_filter_bar'), {
        active: importActiveTag,
        onChange: (tagId) => {
            importActiveTag = tagId || '';
            renderImportedFontsList();
        },
    });

    const container = document.getElementById('nytw_imported_fonts');
    if (!container) return;
    const rows = container.children || [];
    for (const row of rows) {
        const fontId = row.getAttribute?.('data-font-id');
        if (!fontId) continue;
        const font = settings.importedFonts.find((f) => f.id === fontId);
        if (!font) continue;
        const tagWrap = row.querySelector?.('.nytw-font-tags');
        if (tagWrap) fillFontTags(tagWrap, font);
    }
}

function buildFontRow(font) {
    const row = document.createElement('div');
    row.className = 'nytw-font-row';
    row.dataset.fontId = font.id;

    const header = document.createElement('div');
    header.className = 'nytw-font-header';

    if (importBatchMode) {
        row.classList.add('nytw-font-row--batch');
        if (importSelectedIds.has(font.id)) row.classList.add('is-selected');
        const check = document.createElement('span');
        check.className = 'nytw-row-check';
        check.innerHTML = importSelectedIds.has(font.id) ? '<i class="fa-solid fa-check"></i>' : '';
        header.appendChild(check);
    }

    const meta = document.createElement('div');
    meta.className = 'nytw-font-meta';

    const family = String(font.family || font.name || '').trim();
    const name = document.createElement('div');
    name.className = 'nytw-font-name';
    name.textContent = family ? (getFontFamilyDisplayLabel(family) || family) : '未命名';
    try {
        name.style.fontFamily = toCssFontFamilyValue(family);
    } catch { /* ignore */ }

    const sub = document.createElement('div');
    sub.className = 'nytw-font-sub';
    const pieces = [];
    if (getImportedFontKind(font) === 'css') {
        if (font.cssUrl) pieces.push(font.cssUrl);
        pieces.push('css 网络字体');
    } else {
        if (font.fileName) pieces.push(font.fileName);
        if (font.format) pieces.push(font.format);
        if (font.size) pieces.push(formatBytes(font.size));
    }
    sub.textContent = pieces.join(' · ');

    meta.appendChild(name);
    meta.appendChild(sub);

    const tagWrap = document.createElement('div');
    tagWrap.className = 'nytw-font-tags';
    fillFontTags(tagWrap, font);
    meta.appendChild(tagWrap);

    const headerActions = document.createElement('div');
    headerActions.className = 'nytw-font-header-actions';

    const tagBtn = document.createElement('button');
    tagBtn.type = 'button';
    tagBtn.className = 'nytw-font-tag-btn';
    tagBtn.title = '编辑标签';
    tagBtn.innerHTML = '<i class="fa-solid fa-tags"></i>';

    const del = document.createElement('button');
    del.className = 'menu_button nytw-font-delete';
    del.textContent = '删除';

    headerActions.appendChild(tagBtn);
    headerActions.appendChild(del);

    header.appendChild(meta);
    header.appendChild(headerActions);

    const actions = document.createElement('div');
    actions.className = 'nytw-font-actions';

    const actionDefs = [
        ['nytw-font-use-global', '设为全局'],
        ['nytw-font-use-body', '设为正文'],
        ['nytw-font-use-dialogue', '设为对话'],
        ['nytw-font-use-custom', '设为自定义'],
    ];
    for (const [cls, label] of actionDefs) {
        const btn = document.createElement('button');
        btn.className = `menu_button ${cls}`;
        btn.textContent = label;
        actions.appendChild(btn);
    }

    row.appendChild(header);
    row.appendChild(actions);
    return row;
}

/**
 * 删除若干字体（含清空引用与本地字体文件）
 */
async function deleteFontEntries(fonts) {
    for (const font of fonts) {
        if (!font) continue;
        const fontId = font.id;
        settings.importedFonts = settings.importedFonts.filter((f) => f.id !== fontId);

        const family = String(font.family || '').trim();
        if (family) {
            const matchesDeletedFamily = (value) => {
                const families = parseFontFamilyList(value);
                return families.length === 1 && families[0] === family;
            };
            if (matchesDeletedFamily(settings.globalFont)) settings.globalFont = '';
            if (matchesDeletedFamily(settings.bodyFont)) settings.bodyFont = '';
            if (matchesDeletedFamily(settings.dialogueFont)) settings.dialogueFont = '';
            if (matchesDeletedFamily(settings.customFont)) settings.customFont = '';
        }

        try {
            if (getImportedFontKind(font) === 'file') await deleteFontBlob(fontId);
        } catch (error) {
            console.warn('[NyTW] Failed to delete font blob', error);
        }
    }

    for (const [id, key] of [
        ['nytw_global_font', 'globalFont'],
        ['nytw_body_font', 'bodyFont'],
        ['nytw_dialogue_font', 'dialogueFont'],
        ['nytw_custom_font', 'customFont'],
    ]) {
        const el = document.getElementById(id);
        if (el instanceof HTMLInputElement) {
            el.value = settings[key] || '';
            el.style.fontFamily = toCssFontFamilyValue(el.value);
        }
    }
}

export function renderImportedFontsList() {
    const container = document.getElementById('nytw_imported_fonts');
    if (!container) return;

    container.innerHTML = '';

    const allFonts = Array.isArray(settings.importedFonts) ? settings.importedFonts : [];
    const fonts = allFonts.filter(matchesImportFilter);

    if (importSortMode === 'name') {
        fonts.sort((a, b) => String(a.family || a.name || '')
            .localeCompare(String(b.family || b.name || ''), 'zh-Hans-CN'));
    } else if (importSortMode === 'tags') {
        fonts.sort((a, b) => {
            const ta = getFontTagIds(a).map((id) => getTagDef(id)?.name || '').join(',');
            const tb = getFontTagIds(b).map((id) => getTagDef(id)?.name || '').join(',');
            if (!ta && tb) return 1;
            if (ta && !tb) return -1;
            return ta.localeCompare(tb, 'zh-Hans-CN');
        });
    }

    renderTagFilterBar(document.getElementById('nytw_tag_filter_bar'), {
        active: importActiveTag,
        onChange: (tagId) => {
            importActiveTag = tagId || '';
            renderImportedFontsList();
        },
    });

    const countEl = document.getElementById('nytw_font_count');
    if (countEl) {
        countEl.textContent = allFonts.length
            ? `显示 ${fonts.length} / 共 ${allFonts.length} 个字体`
            : '';
    }

    updateTagFilterBarState();

    if (!allFonts.length) {
        const empty = document.createElement('div');
        empty.className = 'nytw-help';
        empty.textContent = '暂无已导入字体。';
        container.appendChild(empty);
        return;
    }

    if (!fonts.length) {
        const empty = document.createElement('div');
        empty.className = 'nytw-help';
        empty.textContent = importSearchText
            ? `没有匹配「${importSearchText}」的字体。`
            : '该分类下还没有字体。';
        container.appendChild(empty);
        return;
    }

    const frag = document.createDocumentFragment();
    for (const font of fonts) {
        frag.appendChild(buildFontRow(font));
    }
    container.appendChild(frag);

    updateBatchBar();
}

function updateTagFilterBarState() {
    const toggle = document.getElementById('nytw_tag_filter_toggle');
    const wrap = document.getElementById('nytw_tag_filter_wrap');
    const summary = document.getElementById('nytw_tag_filter_summary');
    if (!toggle || !wrap) return;

    const collapsed = settings.tagFilterCollapsed === true;
    wrap.classList.toggle('is-collapsed', collapsed);
    toggle.classList.toggle('is-open', !collapsed);
    toggle.setAttribute('aria-expanded', String(!collapsed));

    if (summary) {
        const activeDef = importActiveTag && importActiveTag !== UNCATEGORIZED_ID ? getTagDef(importActiveTag) : null;
        if (importActiveTag === UNCATEGORIZED_ID) {
            summary.textContent = collapsed ? '· 未分类' : '';
        } else {
            summary.textContent = collapsed && activeDef ? `· ${activeDef.name}` : '';
        }
    }
}

function updateBatchBar() {
    const bar = document.getElementById('nytw_batch_bar');
    if (bar) bar.hidden = !importBatchMode;

    const countEl = document.getElementById('nytw_batch_count');
    if (countEl) countEl.textContent = `已选 ${importSelectedIds.size} 个`;

    const toggleBtn = document.getElementById('nytw_batch_toggle');
    if (toggleBtn) {
        toggleBtn.classList.toggle('is-active', importBatchMode);
        toggleBtn.innerHTML = importBatchMode
            ? '<i class="fa-solid fa-check"></i> 完成'
            : '<i class="fa-solid fa-square-check"></i> 多选';
    }
}

function toggleBatchMode(force) {
    importBatchMode = typeof force === 'boolean' ? force : !importBatchMode;
    if (!importBatchMode) importSelectedIds.clear();
    renderImportedFontsList();
}

function applyBatchTags(mode, tagIds) {
    const ids = tagIds.filter(Boolean);
    if (!ids.length || !importSelectedIds.size) return;

    let affected = 0;
    for (const font of settings.importedFonts) {
        if (!importSelectedIds.has(font.id)) continue;
        affected++;

        if (mode === 'replace') {
            font.tags = [...new Set(ids)];
            continue;
        }

        const current = new Set(getFontTagIds(font));
        if (mode === 'remove') {
            for (const id of ids) current.delete(id);
        } else {
            for (const id of ids) current.add(id);
        }
        font.tags = [...current];
    }

    saveSettingsDebounced();
    renderImportedFontsList();

    const label = mode === 'remove' ? '移除' : (mode === 'replace' ? '替换' : '添加');
    notify('success', `已为 ${affected} 个字体${label}标签。`);
}

export function initImportTab() {
    ensureTagSupport();

    const importedFontsToggle = document.getElementById('nytw_imported_fonts_toggle');
    const importedFontsPanel = document.getElementById('nytw_imported_fonts_panel');
    if (importedFontsToggle) {
        importedFontsToggle.addEventListener('click', () => {
            const isOpen = importedFontsPanel?.classList.contains('is-open');
            setImportedFontsPanelOpen(!isOpen);
        });

    }

    // 搜索框
    const searchEl = document.getElementById('nytw_font_search');
    if (searchEl instanceof HTMLInputElement) {
        // 放大镜图标在输入框内部左侧，用内联 important 保证留白不会被美化覆盖
        searchEl.style.setProperty('padding-left', '28px', 'important');
        searchEl.style.setProperty('text-indent', '0', 'important');
        searchEl.addEventListener('input', () => {
            importSearchText = searchEl.value.trim().toLowerCase();
            renderImportedFontsList();
        });
    }

    // 排序
    const sortEl = document.getElementById('nytw_font_sort');
    if (sortEl instanceof HTMLSelectElement) {
        sortEl.value = importSortMode;
        sortEl.addEventListener('change', () => {
            importSortMode = sortEl.value || 'default';
            renderImportedFontsList();
        });
    }

    // 标签筛选折叠
    const tagFilterToggle = document.getElementById('nytw_tag_filter_toggle');
    if (tagFilterToggle) {
        tagFilterToggle.addEventListener('click', () => {
            settings.tagFilterCollapsed = settings.tagFilterCollapsed !== true;
            saveSettingsDebounced();
            updateTagFilterBarState();
        });
    }

    // 多选
    const batchToggleBtn = document.getElementById('nytw_batch_toggle');
    if (batchToggleBtn) {
        batchToggleBtn.addEventListener('click', (event) => {
            event.stopPropagation();
            toggleBatchMode();
        });
    }

    const batchTagBtn = document.getElementById('nytw_batch_tag_btn');
    if (batchTagBtn) {
        batchTagBtn.addEventListener('click', (event) => {
            event.stopPropagation();
            if (!importSelectedIds.size) {
                notify('warning', '先选择要处理的字体。');
                return;
            }
            openBatchTagEditor(batchTagBtn, importSelectedIds.size, (mode, ids) => applyBatchTags(mode, ids));
        });
    }

    const batchDeleteBtn = document.getElementById('nytw_batch_delete_btn');
    if (batchDeleteBtn) {
        batchDeleteBtn.addEventListener('click', async (event) => {
            event.stopPropagation();
            if (!importSelectedIds.size) {
                notify('warning', '先选择要删除的字体。');
                return;
            }
            const count = importSelectedIds.size;
            const ok = window.confirm(`确定删除选中的 ${count} 个字体吗？此操作不可恢复。`);
            if (!ok) return;

            const targets = settings.importedFonts.filter((f) => importSelectedIds.has(f.id));
            await deleteFontEntries(targets);
            importSelectedIds.clear();
            saveSettingsDebounced();
            renderImportedFontsList();
            queueApplyFonts();
            notify('success', `已删除 ${targets.length} 个字体。`);
        });
    }

    const batchClearBtn = document.getElementById('nytw_batch_clear_btn');
    if (batchClearBtn) {
        batchClearBtn.addEventListener('click', () => {
            importSelectedIds.clear();
            renderImportedFontsList();
        });
    }

    // 标签管理
    const tagManagerBtn = document.getElementById('nytw_tag_manager_btn');
    if (tagManagerBtn) {
        tagManagerBtn.addEventListener('click', (event) => {
            event.stopPropagation();
            openTagManager(tagManagerBtn, () => refreshFontTagsUI());
        });
    }

    const fileBtn = document.getElementById('nytw_font_file_btn');
    const fileInput = document.getElementById('nytw_font_file');
    const fileDisplay = document.getElementById('nytw_font_file_display');
    const cssUrlInput = document.getElementById('nytw_font_css_url');
    const importBtn = document.getElementById('nytw_import_font');
    const exportConfigBtn = document.getElementById('nytw_export_font_config');
    const importConfigBtn = document.getElementById('nytw_import_font_config');
    const configFileInput = document.getElementById('nytw_font_config_file');

    const updateImportBtnState = () => {
        const hasFile = fileInput?.files?.length > 0;
        const hasUrl = Boolean(cssUrlInput?.value?.trim());
        if (hasFile || hasUrl) {
            importBtn?.classList.add('nytw-import-ready');
        } else {
            importBtn?.classList.remove('nytw-import-ready');
        }
    };

    cssUrlInput?.addEventListener('input', updateImportBtnState);

    exportConfigBtn?.addEventListener('click', async () => {
        if (exportConfigBtn instanceof HTMLButtonElement) exportConfigBtn.disabled = true;
        try {
            await exportFontConfig();
        } catch (error) {
            console.error('[NyTW] Failed to export font config', error);
            notify('error', `字体配置导出失败：${error?.message || error}`);
        } finally {
            if (exportConfigBtn instanceof HTMLButtonElement) exportConfigBtn.disabled = false;
        }
    });

    importConfigBtn?.addEventListener('click', () => {
        if (configFileInput instanceof HTMLInputElement) {
            configFileInput.value = '';
            configFileInput.click();
        }
    });

    configFileInput?.addEventListener('change', async () => {
        const file = configFileInput instanceof HTMLInputElement ? configFileInput.files?.[0] : null;
        if (!file) return;

        if (importConfigBtn instanceof HTMLButtonElement) importConfigBtn.disabled = true;
        try {
            await importFontConfigFromFile(file);
        } catch (error) {
            console.error('[NyTW] Failed to import font config', error);
            notify('error', `字体配置导入失败：${error?.message || error}`);
        } finally {
            if (configFileInput instanceof HTMLInputElement) configFileInput.value = '';
            if (importConfigBtn instanceof HTMLButtonElement) importConfigBtn.disabled = false;
        }
    });

    fileBtn?.addEventListener('click', () => {
        fileInput?.click();
    });

    fileInput?.addEventListener('change', () => {
        const file = fileInput.files?.[0];
        if (file) {
            if (fileDisplay instanceof HTMLInputElement) fileDisplay.value = file.name;
        } else {
            if (fileDisplay instanceof HTMLInputElement) fileDisplay.value = '';
        }
        updateImportBtnState();
    });

    importBtn?.addEventListener('click', async () => {
        const fileEl = document.getElementById('nytw_font_file');
        const cssUrlEl = document.getElementById('nytw_font_css_url');

        const file = fileEl instanceof HTMLInputElement ? fileEl.files?.[0] : null;
        const rawCssUrl = cssUrlEl instanceof HTMLInputElement ? cssUrlEl.value : '';
        const cssUrl = normalizeExternalStylesheetUrl(rawCssUrl);

        if (!file && rawCssUrl && !cssUrl) {
            notify('warning', 'CSS 链接无效。');
            return;
        }

        if (!file && !cssUrl) {
            notify('warning', '请填写 CSS 链接。');
            return;
        }

        if (file) {
            const fallbackName = file.name.replace(/\.[^.]+$/, '');
            const family = uniqueFontFamily(fallbackName);
            const format = inferFontFormatFromFileName(file.name);
            const id = createFontId();

            try {
                await putFontBlob(id, file);
            } catch (error) {
                console.error('[NyTW] Failed to store font', error);
                notify('error', '字体导入失败（无法写入浏览器存储）。');
                return;
            }

            settings.importedFonts.push({
                id,
                kind: 'file',
                name: family,
                family,
                fileName: file.name,
                size: file.size,
                format,
                tags: currentImportTags(),
            });

            saveSettingsDebounced();
            renderImportedFontsList();
            setImportedFontsPanelOpen(true);
            queueApplyFonts();

            if (fileEl instanceof HTMLInputElement) fileEl.value = '';
            const fileDisplayEl = document.getElementById('nytw_font_file_display');
            if (fileDisplayEl instanceof HTMLInputElement) fileDisplayEl.value = '';
            if (cssUrlEl instanceof HTMLInputElement) cssUrlEl.value = '';
            updateImportBtnState();
            notify('success', `已导入字体：${getFontFamilyDisplayLabel(family) || family}`);
            return;
        }

        let families = inferFamiliesFromGoogleFontsCssUrl(cssUrl);

        if (!families.length) {
            try {
                const response = await fetch(cssUrl, { cache: 'force-cache' });
                if (response.ok) {
                    const cssText = await response.text();
                    families = extractFontFamiliesFromCssText(cssText);
                }
            } catch (error) {
                console.warn('[NyTW] Failed to fetch/parse CSS font URL', error);
            }
        }

        families = Array.from(new Set(families.map(normalizeFontFamily).filter(Boolean))).slice(0, 20);
        if (!families.length) {
            notify('warning', '无法从 CSS 链接识别字体名称，暂不支持导入。');
            return;
        }

        const existingFamilies = new Set(settings.importedFonts.map(f => String(f?.family || '').trim()));
        const added = [];
        for (const family of families) {
            if (!family || existingFamilies.has(family)) continue;
            settings.importedFonts.push({
                id: createFontId(),
                kind: 'css',
                family,
                cssUrl,
                tags: currentImportTags(),
            });
            added.push(family);
        }

        if (!added.length) {
            notify('warning', '没有导入新字体（已存在）。');
            return;
        }

        saveSettingsDebounced();
        renderImportedFontsList();
        setImportedFontsPanelOpen(true);
        queueApplyFonts();

        if (cssUrlEl instanceof HTMLInputElement) cssUrlEl.value = '';
        updateImportBtnState();
        notify('success', `已导入 CSS 字体：${added.map(f => getFontFamilyDisplayLabel(f) || f).join('、')}`);
    });

    const importedContainer = document.getElementById('nytw_imported_fonts');
    importedContainer?.addEventListener('click', async (event) => {
        const target = event.target;
        if (!(target instanceof HTMLElement)) return;
        const row = target.closest('.nytw-font-row');
        if (!row) return;

        const fontId = row.getAttribute('data-font-id') || '';
        const font = settings.importedFonts.find(f => f.id === fontId);
        if (!font) return;

        if (importBatchMode && !target.closest('.nytw-tag-chip')) {
            if (importSelectedIds.has(fontId)) importSelectedIds.delete(fontId);
            else importSelectedIds.add(fontId);
            row.classList.toggle('is-selected', importSelectedIds.has(fontId));
            const check = row.querySelector('.nytw-row-check');
            if (check) check.innerHTML = importSelectedIds.has(fontId) ? '<i class="fa-solid fa-check"></i>' : '';
            updateBatchBar();
            return;
        }

        const tagBtnEl = target.closest('.nytw-font-tag-btn');
        if (tagBtnEl) {
            openFontTagEditor(tagBtnEl, font, () => refreshFontTagsUI());
            return;
        }

        if (target.classList.contains('nytw-font-use-global')) {
            const family = String(font.family || '').trim();
            settings.globalFont = getFontFamilyDisplayLabel(family) || family;
            const el = document.getElementById('nytw_global_font');
            if (el instanceof HTMLInputElement) {
                el.value = settings.globalFont;
                el.style.fontFamily = toCssFontFamilyValue(el.value);
            }
            saveSettingsDebounced();
            queueApplyFonts();
            return;
        }

        if (target.classList.contains('nytw-font-use-body')) {
            const family = String(font.family || '').trim();
            settings.bodyFont = getFontFamilyDisplayLabel(family) || family;
            const el = document.getElementById('nytw_body_font');
            if (el instanceof HTMLInputElement) {
                el.value = settings.bodyFont;
                el.style.fontFamily = toCssFontFamilyValue(el.value);
            }
            saveSettingsDebounced();
            queueApplyFonts();
            return;
        }

        if (target.classList.contains('nytw-font-use-dialogue')) {
            const family = String(font.family || '').trim();
            settings.dialogueFont = getFontFamilyDisplayLabel(family) || family;
            const el = document.getElementById('nytw_dialogue_font');
            if (el instanceof HTMLInputElement) {
                el.value = settings.dialogueFont;
                el.style.fontFamily = toCssFontFamilyValue(el.value);
            }
            saveSettingsDebounced();
            queueApplyFonts();
            return;
        }

        if (target.classList.contains('nytw-font-use-custom')) {
            const family = String(font.family || '').trim();
            settings.customFont = getFontFamilyDisplayLabel(family) || family;
            const el = document.getElementById('nytw_custom_font');
            if (el instanceof HTMLInputElement) {
                el.value = settings.customFont;
                el.style.fontFamily = toCssFontFamilyValue(el.value);
            }

            // Let the settings-tab handler manage UI + scan via change event.
            const wrapToggle = document.getElementById('nytw_custom_font_wrap_enabled');
            if (wrapToggle instanceof HTMLInputElement && !wrapToggle.checked) {
                wrapToggle.checked = true;
                wrapToggle.dispatchEvent(new Event('change'));
            }

            saveSettingsDebounced();
            queueApplyFonts();
            return;
        }

        if (target.classList.contains('nytw-font-delete')) {
            settings.importedFonts = settings.importedFonts.filter(f => f.id !== fontId);
            const deletedFamily = String(font.family || '').trim();

            if (deletedFamily) {
                const matchesDeletedFamily = (value) => {
                    const families = parseFontFamilyList(value);
                    return families.length === 1 && families[0] === deletedFamily;
                };

                if (matchesDeletedFamily(settings.globalFont)) settings.globalFont = '';
                if (matchesDeletedFamily(settings.bodyFont)) settings.bodyFont = '';
                if (matchesDeletedFamily(settings.dialogueFont)) settings.dialogueFont = '';
                if (matchesDeletedFamily(settings.customFont)) settings.customFont = '';

                const globalInput = document.getElementById('nytw_global_font');
                if (globalInput instanceof HTMLInputElement) {
                    globalInput.value = settings.globalFont;
                    globalInput.style.fontFamily = toCssFontFamilyValue(globalInput.value);
                }
                const bodyInput = document.getElementById('nytw_body_font');
                if (bodyInput instanceof HTMLInputElement) {
                    bodyInput.value = settings.bodyFont;
                    bodyInput.style.fontFamily = toCssFontFamilyValue(bodyInput.value);
                }
                const dialogueInput = document.getElementById('nytw_dialogue_font');
                if (dialogueInput instanceof HTMLInputElement) {
                    dialogueInput.value = settings.dialogueFont;
                    dialogueInput.style.fontFamily = toCssFontFamilyValue(dialogueInput.value);
                }
                const customInput = document.getElementById('nytw_custom_font');
                if (customInput instanceof HTMLInputElement) {
                    customInput.value = settings.customFont;
                    customInput.style.fontFamily = toCssFontFamilyValue(customInput.value);
                }
            }

            try {
                if (getImportedFontKind(font) === 'file') {
                    await deleteFontBlob(fontId);
                }
            } catch (error) {
                console.warn('[NyTW] Failed to delete font blob', error);
            }

            saveSettingsDebounced();
            renderImportedFontsList();
            queueApplyFonts();
            notify('success', '已删除字体。');
        }
    });

    renderImportedFontsList();
    updateImportBtnState();
}

