import { escapeHTML } from '../../utils/Sanitize.js';

/** Inline status: explicit text and an SVG; no frame around the employee. */
export function renderPayrollStatus(message, level = 'warning', icon = 'alert') {
    const severity = ['error', 'attention', 'warning'].includes(level) ? level : 'warning';
    const shape = icon === 'pause'
        ? '<path d="M9 5v14M15 5v14"/>'
        : '<path d="M10.3 3.9 2.1 18.1A2 2 0 0 0 3.8 21h16.4a2 2 0 0 0 1.7-2.9L13.7 3.9a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4m0 4h.01"/>';
    return `<span class="payroll-status payroll-status--${severity}"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${shape}</svg><span>${escapeHTML(message)}</span></span>`;
}
