import { saveSettingsDebounced } from '../../../../script.js';
import { settings } from './nytwState.js';

/**
 * 标签系统：为导入字体提供分类管理。
 * 数据结构：
 *   settings.fontTagDefs = [{ id, name, color }]
 *   settings.importedFonts[i].tags = [tagId, ...]
 */

export const UNCATEGORIZED_ID = '__none__';

export const TAG_COLORS = [
    '#e05b5b',
    '#e0893c',
    '#d6b32e',
    '#5cb85c',
    '#3fa0b8',
    '#4a86e0',
    '#8a6ad9',
    '#c960a8',
    '#8d7b68',
    '#7f8c8d',
];

function cleanTagName(value) {
    return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, 24);
}

export function createTagId() {
    return `t_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export function pickNextTagColor() {
    const defs = getTagDefs();
    return TAG_COLORS[defs.length % TAG_COLORS.length];
}

/**
 * 修复/迁移标签数据：补齐字段、丢弃无效引用、为孤儿标签补定义。
 */
export function ensureTagSupport() {
    if (!Array.isArray(settings.fontTagDefs)) settings.fontTagDefs = [];

    const defs = [];
    const seen = new Set();
    for (const raw of settings.fontTagDefs) {
        if (!raw || typeof raw !== 'object') continue;
        const id = String(raw.id || '').trim();
        const name = cleanTagName(raw.name);
        if (!id || !name || seen.has(id)) continue;
        seen.add(id);
        defs.push({
            id,
            name,
            color: String(raw.color || '').trim() || TAG_COLORS[defs.length % TAG_COLORS.length],
        });
    }
    settings.fontTagDefs = defs;

    const fonts = Array.isArray(settings.importedFonts) ? settings.importedFonts : [];
    for (const font of fonts) {
        if (!font || typeof font !== 'object') continue;
        const rawTags = Array.isArray(font.tags) ? font.tags : [];
        const tags = [];
        for (const raw of rawTags) {
            const id = String(raw ?? '').trim();
            if (!id || tags.includes(id)) continue;
            if (!seen.has(id)) {
                seen.add(id);
                settings.fontTagDefs.push({
                    id,
                    name: cleanTagName(id) || '未命名',
                    color: TAG_COLORS[settings.fontTagDefs.length % TAG_COLORS.length],
                });
            }
            tags.push(id);
        }
        font.tags = tags;
    }
}

export function getTagDefs() {
    if (!Array.isArray(settings.fontTagDefs)) settings.fontTagDefs = [];
    return settings.fontTagDefs;
}

export function getTagDef(tagId) {
    if (!tagId) return null;
    return getTagDefs().find((def) => def.id === tagId) || null;
}

export function findTagByName(name) {
    const target = cleanTagName(name).toLowerCase();
    if (!target) return null;
    return getTagDefs().find((def) => def.name.toLowerCase() === target) || null;
}

export function tagColor(tagId) {
    return getTagDef(tagId)?.color || TAG_COLORS[0];
}

export function tagName(tagId) {
    return getTagDef(tagId)?.name || '';
}

export function createTag(name, color) {
    const label = cleanTagName(name);
    if (!label) return null;

    const existing = findTagByName(label);
    if (existing) return existing;

    const def = {
        id: createTagId(),
        name: label,
        color: String(color || '').trim() || pickNextTagColor(),
    };
    getTagDefs().push(def);
    saveSettingsDebounced();
    return def;
}

export function renameTag(tagId, name) {
    const def = getTagDef(tagId);
    const label = cleanTagName(name);
    if (!def || !label) return false;
    if (def.name === label) return true;

    const clash = findTagByName(label);
    if (clash && clash.id !== tagId) return false;

    def.name = label;
    saveSettingsDebounced();
    return true;
}

export function setTagColor(tagId, color) {
    const def = getTagDef(tagId);
    if (!def) return;
    def.color = String(color || '').trim() || def.color;
    saveSettingsDebounced();
}

export function cycleTagColor(tagId) {
    const def = getTagDef(tagId);
    if (!def) return;
    const index = TAG_COLORS.indexOf(def.color);
    def.color = TAG_COLORS[(index + 1) % TAG_COLORS.length];
    saveSettingsDebounced();
}

export function deleteTag(tagId) {
    if (!tagId) return;
    settings.fontTagDefs = getTagDefs().filter((def) => def.id !== tagId);
    const fonts = Array.isArray(settings.importedFonts) ? settings.importedFonts : [];
    for (const font of fonts) {
        if (Array.isArray(font?.tags)) {
            font.tags = font.tags.filter((id) => id !== tagId);
        }
    }
    saveSettingsDebounced();
}

export function getFontTagIds(font) {
    return Array.isArray(font?.tags) ? font.tags : [];
}

export function isFontUncategorized(font) {
    return getFontTagIds(font).length === 0;
}

export function toggleFontTag(font, tagId) {
    if (!font || !tagId) return;
    if (!Array.isArray(font.tags)) font.tags = [];
    if (font.tags.includes(tagId)) {
        font.tags = font.tags.filter((id) => id !== tagId);
    } else {
        font.tags = [...font.tags, tagId];
    }
    saveSettingsDebounced();
}

export function countFontsByTag() {
    const counts = new Map();
    let uncategorized = 0;
    const fonts = Array.isArray(settings.importedFonts) ? settings.importedFonts : [];
    for (const font of fonts) {
        const tags = getFontTagIds(font);
        if (!tags.length) {
            uncategorized++;
            continue;
        }
        for (const id of tags) {
            counts.set(id, (counts.get(id) || 0) + 1);
        }
    }
    return { counts, uncategorized, total: fonts.length };
}

/* ------------------------------------------------------------------ */
/* 视图：标签胶囊                                                       */
/* ------------------------------------------------------------------ */

export function createTagChip(label, options = {}) {
    const chip = document.createElement(options.tagName || 'button');
    if (chip instanceof HTMLButtonElement) chip.type = 'button';
    chip.className = 'nytw-tag-chip';
    if (options.active) chip.classList.add('is-active');
    if (options.muted) chip.classList.add('nytw-tag-chip--muted');
    if (typeof options.className === 'string' && options.className) {
        chip.classList.add(...options.className.split(/\s+/).filter(Boolean));
    }

    const dot = document.createElement('span');
    dot.className = 'nytw-tag-dot';
    dot.style.background = options.color || '#8d7b68';
    chip.appendChild(dot);

    const text = document.createElement('span');
    text.className = 'nytw-tag-label';
    text.textContent = label;
    chip.appendChild(text);

    if (Number.isFinite(options.count)) {
        const countEl = document.createElement('span');
        countEl.className = 'nytw-tag-count';
        countEl.textContent = String(options.count);
        chip.appendChild(countEl);
    }

    if (options.title) chip.title = options.title;
    if (typeof options.onClick === 'function') {
        chip.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            options.onClick(event);
        });
    }
    return chip;
}

/**
 * 渲染筛选条：全部 / 未分类 / 各标签
 */
export function renderTagFilterBar(container, { active = '', onChange } = {}) {
    if (!container) return;
    container.innerHTML = '';

    const { counts, uncategorized, total } = countFontsByTag();
    const defs = getTagDefs();

    container.appendChild(createTagChip('全部', {
        color: '#9aa0a6',
        count: total,
        active: !active,
        onClick: () => onChange?.(''),
    }));

    if (uncategorized > 0) {
        container.appendChild(createTagChip('未分类', {
            color: '#b0b0b0',
            muted: true,
            count: uncategorized,
            active: active === UNCATEGORIZED_ID,
            onClick: () => onChange?.(UNCATEGORIZED_ID),
        }));
    }

    for (const def of defs) {
        const count = counts.get(def.id) || 0;
        container.appendChild(createTagChip(def.name, {
            color: def.color,
            count,
            active: active === def.id,
            onClick: () => onChange?.(active === def.id ? '' : def.id),
        }));
    }

    if (!defs.length) {
        const hint = document.createElement('span');
        hint.className = 'nytw-tag-bar-hint';
        hint.textContent = '还没有标签，点「标签管理」新建一个试试';
        container.appendChild(hint);
    }
}

/* ------------------------------------------------------------------ */
/* 浮动面板                                                            */
/* ------------------------------------------------------------------ */

let tagLayer = null;

function getTagLayer() {
    // 面板必须挂在「扩展设置」面板内部：酒馆有“点击外部收起右栏”的逻辑，
    // 挂到 body 上会导致点一下标签就被收起。
    const host = document.getElementById('nytw_settings_root') || document.body;
    if (!tagLayer || !tagLayer.isConnected || tagLayer.parentElement !== host) {
        tagLayer = document.createElement('div');
        tagLayer.id = 'nytw_tag_layer';
        tagLayer.classList.add(host === document.body ? 'nytw-tag-layer--fixed' : 'nytw-tag-layer--inline');
        host.appendChild(tagLayer);
    }
    return tagLayer;
}

export function closeFloatingPanels() {
    if (tagLayer) tagLayer.innerHTML = '';
}

function attachPanel(anchorEl, panel) {
    const layer = getTagLayer();
    layer.innerHTML = '';
    layer.appendChild(panel);

    // 阻断冒泡：避免酒馆把“扩展面板”当成点了外部而收起。
    // 注意必须用冒泡阶段（false），否则会连面板内按钮的点击一起拦掉。
    const stopPropagation = (event) => event.stopPropagation();
    for (const type of ['pointerdown', 'mousedown', 'touchstart', 'click']) {
        panel.addEventListener(type, stopPropagation, false);
    }

    const layerRect = layer.getBoundingClientRect?.() || { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
    const rect = anchorEl?.getBoundingClientRect?.();
    const availableWidth = (layerRect.width || window.innerWidth) - 16;
    const width = Math.min(300, availableWidth);
    panel.style.width = `${width}px`;

    let left = (rect ? rect.left : layerRect.left + 8) - layerRect.left;
    left = Math.max(8, Math.min(left, Math.max(8, availableWidth - width + 8)));

    let top = (rect ? rect.bottom + 8 : 120) - layerRect.top;
    const height = panel.offsetHeight || 240;

    // 以屏幕可视区域为准，避免面板被挤出屏幕
    const viewTop = layerRect.top + top;
    if (viewTop + height > window.innerHeight - 12) {
        const upwardTop = (rect ? rect.top - 8 : viewTop) - height - layerRect.top;
        top = upwardTop > 8 ? upwardTop : Math.max(8, window.innerHeight - height - layerRect.top - 12);
    }
    top = Math.max(0, top);

    panel.style.left = `${left}px`;
    panel.style.top = `${top}px`;

    const outsideHandler = (event) => {
        if (panel.contains(event.target)) return;
        closeFloatingPanels();
        document.removeEventListener('mousedown', outsideHandler, true);
        document.removeEventListener('touchstart', outsideHandler, true);
    };
    setTimeout(() => {
        document.addEventListener('mousedown', outsideHandler, true);
        document.addEventListener('touchstart', outsideHandler, true);
    }, 0);
}

function buildPanelShell(title) {
    const panel = document.createElement('div');
    panel.className = 'nytw-tag-panel';

    const head = document.createElement('div');
    head.className = 'nytw-tag-panel-head';
    const titleEl = document.createElement('span');
    titleEl.textContent = title;
    head.appendChild(titleEl);

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'nytw-tag-panel-close';
    closeBtn.innerHTML = '<i class="fa-solid fa-xmark"></i>';
    closeBtn.addEventListener('click', () => closeFloatingPanels());
    head.appendChild(closeBtn);

    const body = document.createElement('div');
    body.className = 'nytw-tag-panel-body';

    panel.appendChild(head);
    panel.appendChild(body);
    return { panel, body };
}

/**
 * 标签管理面板：改名、换色、删除、新建
 */
export function openTagManager(anchorEl, onChange) {
    const { panel, body } = buildPanelShell('标签管理');

    const list = document.createElement('div');
    list.className = 'nytw-tag-manage-list';
    body.appendChild(list);

    const renderList = () => {
        list.innerHTML = '';
        const defs = getTagDefs();
        if (!defs.length) {
            const empty = document.createElement('div');
            empty.className = 'nytw-help nytw-help--compact';
            empty.textContent = '还没有标签。';
            list.appendChild(empty);
        }
        for (const def of defs) {
            const row = document.createElement('div');
            row.className = 'nytw-tag-manage-row';

            const dot = document.createElement('button');
            dot.type = 'button';
            dot.className = 'nytw-tag-dot nytw-tag-dot--button';
            dot.style.background = def.color;
            dot.title = '点击换颜色';
            dot.addEventListener('click', () => {
                cycleTagColor(def.id);
                renderList();
                onChange?.();
            });

            const input = document.createElement('input');
            input.type = 'text';
            input.className = 'text_pole nytw-input nytw-tag-name-input';
            input.value = def.name;
            input.maxLength = 24;
            input.addEventListener('change', () => {
                const ok = renameTag(def.id, input.value);
                if (!ok) {
                    input.value = def.name;
                    input.title = '标签名重复或为空';
                    input.classList.add('nytw-input--error');
                    setTimeout(() => input.classList.remove('nytw-input--error'), 1200);
                    return;
                }
                onChange?.();
            });

            const del = document.createElement('button');
            del.type = 'button';
            del.className = 'nytw-tag-manage-del';
            del.innerHTML = '<i class="fa-solid fa-trash-can"></i>';
            del.title = '删除标签（不会删除字体）';
            del.addEventListener('click', () => {
                deleteTag(def.id);
                renderList();
                onChange?.();
            });

            row.appendChild(dot);
            row.appendChild(input);
            row.appendChild(del);
            list.appendChild(row);
        }
    };

    const addRow = document.createElement('div');
    addRow.className = 'nytw-tag-add-row';
    const addInput = document.createElement('input');
    addInput.type = 'text';
    addInput.className = 'text_pole nytw-input';
    addInput.placeholder = '新标签名…';
    addInput.maxLength = 24;
    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'menu_button';
    addBtn.textContent = '新建';

    const commitAdd = () => {
        const def = createTag(addInput.value);
        if (!def) return;
        addInput.value = '';
        renderList();
        onChange?.();
    };
    addBtn.addEventListener('click', commitAdd);
    addInput.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
            event.preventDefault();
            commitAdd();
        }
    });

    addRow.appendChild(addInput);
    addRow.appendChild(addBtn);
    body.appendChild(addRow);

    renderList();
    attachPanel(anchorEl, panel);
}

/**
 * 单个字体的标签编辑面板
 */
export function openFontTagEditor(anchorEl, font, onChange) {
    if (!font) return;
    const { panel, body } = buildPanelShell('字体标签');

    const fontName = document.createElement('div');
    fontName.className = 'nytw-tag-panel-subtitle';
    fontName.textContent = String(font.family || font.name || '未命名');
    body.appendChild(fontName);

    const list = document.createElement('div');
    list.className = 'nytw-tag-choice-list';
    body.appendChild(list);

    const renderList = () => {
        list.innerHTML = '';
        const defs = getTagDefs();
        if (!defs.length) {
            const empty = document.createElement('div');
            empty.className = 'nytw-help nytw-help--compact';
            empty.textContent = '还没有标签，先在下面新建一个。';
            list.appendChild(empty);
        }
        const activeIds = getFontTagIds(font);
        for (const def of defs) {
            const row = document.createElement('button');
            row.type = 'button';
            row.className = 'nytw-tag-choice';
            if (activeIds.includes(def.id)) row.classList.add('is-active');

            const dot = document.createElement('span');
            dot.className = 'nytw-tag-dot';
            dot.style.background = def.color;

            const label = document.createElement('span');
            label.className = 'nytw-tag-choice-label';
            label.textContent = def.name;

            const check = document.createElement('span');
            check.className = 'nytw-tag-choice-check';
            check.innerHTML = activeIds.includes(def.id) ? '<i class="fa-solid fa-check"></i>' : '';

            row.appendChild(dot);
            row.appendChild(label);
            row.appendChild(check);

            row.addEventListener('click', () => {
                toggleFontTag(font, def.id);
                renderList();
                onChange?.();
            });
            list.appendChild(row);
        }
    };

    const addRow = document.createElement('div');
    addRow.className = 'nytw-tag-add-row';
    const addInput = document.createElement('input');
    addInput.type = 'text';
    addInput.className = 'text_pole nytw-input';
    addInput.placeholder = '新建标签…';
    addInput.maxLength = 24;
    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'menu_button';
    addBtn.textContent = '添加';

    const commitAdd = () => {
        const def = createTag(addInput.value);
        if (!def) return;
        if (!getFontTagIds(font).includes(def.id)) toggleFontTag(font, def.id);
        addInput.value = '';
        renderList();
        onChange?.();
    };
    addBtn.addEventListener('click', commitAdd);
    addInput.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
            event.preventDefault();
            commitAdd();
        }
    });
    addRow.appendChild(addInput);
    addRow.appendChild(addBtn);
    body.appendChild(addRow);

    renderList();
    attachPanel(anchorEl, panel);
}

/**
 * 批量打标签面板
 * @param {HTMLElement} anchorEl
 * @param {number} count 选中的字体数量
 * @param {(mode: 'add'|'remove'|'replace', tagIds: string[]) => void} onApply
 */
export function openBatchTagEditor(anchorEl, count, onApply) {
    const { panel, body } = buildPanelShell(`批量打标签 · 已选 ${count} 个`);

    let mode = 'add';
    const modeRow = document.createElement('div');
    modeRow.className = 'nytw-mode-row';
    const modeButtons = [];

    for (const [value, label] of [['add', '添加'], ['remove', '移除'], ['replace', '替换为']]) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'nytw-mode-btn';
        btn.dataset.mode = value;
        btn.textContent = label;
        if (value === mode) btn.classList.add('is-active');
        btn.addEventListener('click', () => {
            mode = value;
            for (const b of modeButtons) b.classList.toggle('is-active', b.dataset.mode === value);
        });
        modeButtons.push(btn);
        modeRow.appendChild(btn);
    }
    body.appendChild(modeRow);

    const hint = document.createElement('div');
    hint.className = 'nytw-help nytw-help--compact';
    hint.textContent = '勾选要处理的标签，再点「应用」。';
    body.appendChild(hint);

    const list = document.createElement('div');
    list.className = 'nytw-tag-choice-list';
    body.appendChild(list);

    const picked = new Set();

    const renderList = () => {
        list.innerHTML = '';
        const defs = getTagDefs();
        if (!defs.length) {
            const empty = document.createElement('div');
            empty.className = 'nytw-help nytw-help--compact';
            empty.textContent = '还没有标签，先建一个。';
            list.appendChild(empty);
        }
        for (const def of defs) {
            const row = document.createElement('button');
            row.type = 'button';
            row.className = 'nytw-tag-choice';
            if (picked.has(def.id)) row.classList.add('is-active');

            const dot = document.createElement('span');
            dot.className = 'nytw-tag-dot';
            dot.style.background = def.color;

            const label = document.createElement('span');
            label.className = 'nytw-tag-choice-label';
            label.textContent = def.name;

            const check = document.createElement('span');
            check.className = 'nytw-tag-choice-check';
            check.innerHTML = picked.has(def.id) ? '<i class="fa-solid fa-check"></i>' : '';

            row.appendChild(dot);
            row.appendChild(label);
            row.appendChild(check);

            row.addEventListener('click', () => {
                if (picked.has(def.id)) picked.delete(def.id);
                else picked.add(def.id);
                renderList();
            });
            list.appendChild(row);
        }
    };

    const actions = document.createElement('div');
    actions.className = 'nytw-tag-add-row';

    const applyBtn = document.createElement('button');
    applyBtn.type = 'button';
    applyBtn.className = 'menu_button nytw-batch-apply';
    applyBtn.textContent = '应用';
    applyBtn.addEventListener('click', () => {
        if (!picked.size) return;
        onApply?.(mode, [...picked]);
        closeFloatingPanels();
    });

    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'menu_button';
    cancelBtn.textContent = '取消';
    cancelBtn.addEventListener('click', () => closeFloatingPanels());

    actions.appendChild(applyBtn);
    actions.appendChild(cancelBtn);
    body.appendChild(actions);

    renderList();
    attachPanel(anchorEl, panel);
}
