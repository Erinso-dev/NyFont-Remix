import './nytwCore.js';
import { initChatFontImporter } from './nytwChatFontImporter.js';
import { setupSettingsUi } from './nytwSettingsUi.js';

initChatFontImporter();
setupSettingsUi();

/* ---------------- 出错提示（临时排查用） ---------------- */
function showRuntimeError(message) {
    try {
        const id = 'nytw-error-banner';
        let el = document.getElementById(id);
        if (!el) {
            el = document.createElement('div');
            el.id = id;
            el.setAttribute('style', [
                'position:fixed', 'left:8px', 'right:8px', 'top:8px',
                'z-index:2147483005', 'padding:10px 12px', 'border-radius:10px',
                'background:rgba(120,20,20,0.95)', 'color:#fff',
                'font:12px/1.5 ui-monospace,monospace', 'white-space:pre-wrap',
                'box-shadow:0 6px 18px rgba(0,0,0,0.45)', 'pointer-events:auto',
            ].join(';'));
            el.addEventListener('click', () => el.remove());
            document.body?.appendChild(el);
        }
        el.textContent = 'Ny 字体管理器出错（点一下关闭）：\n' + String(message || '').slice(0, 400);
    } catch { /* no-op */ }
}

window.addEventListener('error', (event) => {
    if (!event || !event.message) return;
    showRuntimeError(event.message + (event.filename ? '\n' + String(event.filename).split('/').pop() + ':' + event.lineno : ''));
});

window.addEventListener('unhandledrejection', (event) => {
    const reason = event?.reason;
    showRuntimeError(reason && reason.message ? reason.message : String(reason));
});
