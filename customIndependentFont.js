import { isLikelyNytwMarkdownTableSource, isWithinNytwProtectedContent } from './nytwProtectedContent.js';

export const CUSTOM_INDEPENDENT_FONT_CLASS = 'ny-custom-font';

export const CUSTOM_INDEPENDENT_FONT_MARK_ATTR = 'data-nytw-custom-font';
const MARK_KIND_VALUE = 'mark';
const WRAP_KIND_VALUE = 'wrap';

const processedSigByContainer = new WeakMap();

function addScopedClass(el, baseClass) {
    if (!el || !(el instanceof HTMLElement)) return;
    const base = String(baseClass || '').trim();
    if (!base) return;
    el.classList.add(base);
    if (!base.startsWith('custom-')) {
        el.classList.add(`custom-${base}`);
    }
}

function removeScopedClass(el, baseClass) {
    if (!el || !(el instanceof HTMLElement)) return;
    const base = String(baseClass || '').trim();
    if (!base) return;
    el.classList.remove(base);
    if (!base.startsWith('custom-')) {
        el.classList.remove(`custom-${base}`);
    }
}

function unwrapElement(el) {
    const parent = el?.parentNode;
    if (!parent) return;

    const frag = document.createDocumentFragment();
    while (el.firstChild) frag.appendChild(el.firstChild);
    parent.replaceChild(frag, el);
}

function clearCustomIndependentFont(containerEl) {
    if (!containerEl || !(containerEl instanceof HTMLElement)) return;

    const marked = Array.from(containerEl.querySelectorAll(`[${CUSTOM_INDEPENDENT_FONT_MARK_ATTR}]`));
    for (const el of marked) {
        if (!(el instanceof HTMLElement)) continue;
        const kind = el.getAttribute(CUSTOM_INDEPENDENT_FONT_MARK_ATTR);
        if (kind === WRAP_KIND_VALUE) {
            unwrapElement(el);
            continue;
        }
        removeScopedClass(el, CUSTOM_INDEPENDENT_FONT_CLASS);
        el.removeAttribute(CUSTOM_INDEPENDENT_FONT_MARK_ATTR);
    }
}

function countOccurrences(text, token, max = 50) {
    const raw = String(text || '');
    const t = String(token || '');
    if (!raw || !t) return 0;

    let count = 0;
    let idx = 0;
    while (count < max) {
        idx = raw.indexOf(t, idx);
        if (idx === -1) break;
        count += 1;
        idx += t.length || 1;
    }
    return count;
}

function getContainerSignature(containerEl, rules = []) {
    const text = containerEl?.textContent || '';
    const markerCount = containerEl?.querySelectorAll
        ? containerEl.querySelectorAll(`[${CUSTOM_INDEPENDENT_FONT_MARK_ATTR}]`).length
        : 0;

    return JSON.stringify({
        rules: rules.map((rule) => ({
            open: rule.open,
            close: rule.close,
            openCount: countOccurrences(text, rule.open),
            closeCount: countOccurrences(text, rule.close),
        })),
        len: text.length,
        markerCount,
    });
}

function collectEligibleTextNodes(rootEl) {
    if (!rootEl || !(rootEl instanceof HTMLElement)) return [];

    const walker = document.createTreeWalker(rootEl, NodeFilter.SHOW_TEXT, {
        acceptNode(node) {
            if (!node || !node.nodeValue) return NodeFilter.FILTER_REJECT;
            if (isLikelyNytwMarkdownTableSource(node.nodeValue)) return NodeFilter.FILTER_REJECT;
            const parent = node.parentElement;
            if (!parent) return NodeFilter.FILTER_REJECT;
            if (isWithinNytwProtectedContent(parent)) return NodeFilter.FILTER_REJECT;
            return NodeFilter.FILTER_ACCEPT;
        },
    });

    const nodes = [];
    let n = walker.nextNode();
    while (n) {
        nodes.push(/** @type {Text} */ (n));
        n = walker.nextNode();
        if (nodes.length >= 20000) break;
    }
    return nodes;
}

function findDelimitedRanges(text, openToken, closeToken) {
    const open = String(openToken || '');
    const close = String(closeToken || '');
    const raw = String(text || '');
    if (!raw || !open || !close) return [];

    const ranges = [];
    const openLen = open.length;
    const closeLen = close.length;

    let idx = 0;
    while (idx < raw.length && ranges.length < 200) {
        const openIdx = raw.indexOf(open, idx);
        if (openIdx === -1) break;

        const searchFrom = openIdx + openLen;
        const closeIdx = raw.indexOf(close, searchFrom);
        if (closeIdx === -1) {
            idx = searchFrom;
            continue;
        }

        ranges.push([openIdx, closeIdx + closeLen]);
        idx = closeIdx + closeLen;
    }

    return ranges;
}

function wrapTextNodeRange(textNode, startOffset, endOffset, fontCss = '') {
    if (!textNode?.parentNode) return;
    const value = textNode.nodeValue || '';
    if (!value) return;

    const start = Math.max(0, Math.min(value.length, startOffset));
    const end = Math.max(0, Math.min(value.length, endOffset));
    if (end <= start) return;

    /** @type {Text} */
    let middle = textNode;
    if (start > 0) middle = middle.splitText(start);

    const middleValue = middle.nodeValue || '';
    const middleLen = middleValue.length;
    const desiredLen = Math.min(middleLen, end - start);
    if (desiredLen < middleLen) middle.splitText(desiredLen);

    const wrapper = document.createElement('span');
    addScopedClass(wrapper, CUSTOM_INDEPENDENT_FONT_CLASS);
    wrapper.setAttribute(CUSTOM_INDEPENDENT_FONT_MARK_ATTR, WRAP_KIND_VALUE);
    // 每条规则可以用不同字体，直接写在元素上
    if (fontCss) {
        wrapper.style.fontFamily = fontCss;
        wrapper.dataset.nytwCustomFont = fontCss;
    }
    middle.parentNode.replaceChild(wrapper, middle);
    wrapper.appendChild(middle);
}

function markTypewriterCharSpan(textNode) {
    const parent = textNode?.parentElement;
    if (!parent) return null;
    if (!parent.matches('.ny-tw-char, .custom-ny-tw-char')) return null;
    addScopedClass(parent, CUSTOM_INDEPENDENT_FONT_CLASS);
    parent.setAttribute(CUSTOM_INDEPENDENT_FONT_MARK_ATTR, MARK_KIND_VALUE);
    return parent;
}

function applySegmentsToTextNode(textNode, segments) {
    if (!textNode || !segments?.length) return;

    const raw = textNode.nodeValue || '';
    const fullLen = raw.length;

    // Process from the end so splitText offsets remain valid.
    const sorted = segments
        .map((seg) => ({
            start: Number(seg.start ?? seg[0]) || 0,
            end: Number(seg.end ?? seg[1]) || 0,
            css: seg.css || '',
        }))
        .filter((seg) => seg.end > seg.start)
        .sort((a, b) => (b.start - a.start) || (b.end - a.end));

    for (const seg of sorted) {
        if (seg.start <= 0 && seg.end >= fullLen) {
            const marked = markTypewriterCharSpan(textNode);
            if (marked) continue;
        }
        wrapTextNodeRange(textNode, seg.start, seg.end, seg.css);
    }
}

export function applyCustomIndependentFont(containerEl, { enabled, rules, openToken, closeToken } = {}) {
    if (!containerEl || !(containerEl instanceof HTMLElement)) return;

    // 兼容旧调用：单组 open/close
    let ruleList = Array.isArray(rules) ? rules : [];
    if (!ruleList.length && (openToken || closeToken)) {
        ruleList = [{ open: openToken, close: closeToken, fontCss: '' }];
    }
    ruleList = ruleList
        .map((rule) => ({
            open: String(rule?.open || '').trim(),
            close: String(rule?.close || '').trim(),
            fontCss: String(rule?.fontCss || '').trim(),
        }))
        .filter((rule) => rule.open && rule.close);

    const active = Boolean(enabled) && ruleList.length > 0;

    if (!active) {
        clearCustomIndependentFont(containerEl);
        processedSigByContainer.delete(containerEl);
        return;
    }

    const prevSig = processedSigByContainer.get(containerEl);
    const nextSig = getContainerSignature(containerEl, ruleList);
    if (prevSig === nextSig) return;

    clearCustomIndependentFont(containerEl);

    const textNodes = collectEligibleTextNodes(containerEl);
    if (!textNodes.length) {
        processedSigByContainer.set(containerEl, getContainerSignature(containerEl, ruleList));
        return;
    }

    let fullText = '';
    const infos = [];
    let offset = 0;

    for (const node of textNodes) {
        const value = node.nodeValue || '';
        if (!value) continue;
        const start = offset;
        const end = offset + value.length;
        infos.push({ node, start, end });
        fullText += value;
        offset = end;
        if (offset >= 50000) break;
    }

    // 收集所有规则的匹配区间，再按位置去重（先到先得，不嵌套覆盖）
    const allRanges = [];
    for (const rule of ruleList) {
        for (const [s, e] of findDelimitedRanges(fullText, rule.open, rule.close)) {
            allRanges.push({ start: s, end: e, css: rule.fontCss });
        }
    }
    allRanges.sort((a, b) => (a.start - b.start) || (a.end - b.end));

    const ranges = [];
    let lastEnd = -1;
    for (const range of allRanges) {
        if (range.end <= range.start) continue;
        if (range.start < lastEnd) continue;
        ranges.push(range);
        lastEnd = range.end;
    }

    if (!ranges.length) {
        processedSigByContainer.set(containerEl, getContainerSignature(containerEl, ruleList));
        return;
    }

    /** @type {Map<Text, Array<{start:number,end:number,css:string}>>} */
    const segmentsByNode = new Map();
    let nodeIdx = 0;

    for (const range of ranges) {
        while (nodeIdx < infos.length && infos[nodeIdx].end <= range.start) nodeIdx += 1;

        let j = nodeIdx;
        while (j < infos.length && infos[j].start < range.end) {
            const info = infos[j];
            const segStart = Math.max(info.start, range.start) - info.start;
            const segEnd = Math.min(info.end, range.end) - info.start;
            if (segEnd > segStart) {
                const existing = segmentsByNode.get(info.node) || [];
                existing.push({ start: segStart, end: segEnd, css: range.css });
                segmentsByNode.set(info.node, existing);
            }
            if (info.end >= range.end) break;
            j += 1;
        }

        nodeIdx = j;
    }

    segmentsByNode.forEach((segments, node) => applySegmentsToTextNode(node, segments));
    processedSigByContainer.set(containerEl, getContainerSignature(containerEl, ruleList));
}
