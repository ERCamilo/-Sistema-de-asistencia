/**
 * OnboardingView.js — renderizadores HTML (string) del onboarding v2, portados del
 * prototipo Onboarding-funcional.html (fases guía / elección / configuración / listo).
 * Esta fase: sin animaciones ni demos interactivos en la guía; las cuatro
 * opciones de elección ejecutan acciones reales vía OnboardingActions (el host
 * decide cuándo). El host pinta renderOnboarding(state)
 * y delega cada interacción en handleAction(act, el, state).
 */
import {
    STEPS, SETUP, SETUP_TOTAL, DAY_LABELS, DAY_NAMES,
    canAdvance, navNext, navBack, goGuideStep, pick, toggleDay,
    setHours, hMinus, hPlus, setPosColor, setField,
    addEmployee, removeEmployee
} from './OnboardingCore.js';
import { COLOR_PALETTE } from '../../utils/Constants.js';
const C = { bg: '#0f172a', panel: '#1e293b', panel2: '#334155', border: '#334155', text: '#f8fafc', dim: '#94a3b8', faint: '#64748b', accent: '#06b6d4', onAccent: '#0f172a', good: '#10b981' };
const POS_COLORS = COLOR_PALETTE.slice(0, 4);
const FIELD_STYLE = `width:100%;height:46px;padding:0 15px;border-radius:11px;border:1px solid ${C.border};background:${C.panel};font-size:15px;font-family:inherit;color:inherit;`;
const LBL = `display:block;font-size:12px;font-weight:600;color:${C.dim};margin-bottom:8px;`;
export function esc(v) {
    return String(v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
const money = n => '$' + Math.round(n).toLocaleString('es-DO');
const input = (id, field, value, placeholder, attrs = '') => `<input id="${id}" data-field="${field}" value="${esc(value)}" placeholder="${esc(placeholder)}" autocomplete="off" ${attrs}style="${FIELD_STYLE}">`;
export const chip = (text, mb = 16) => `<div style="display:inline-flex;align-items:center;gap:8px;height:26px;padding:0 11px;border-radius:20px;background:${C.panel2};border:1px solid ${C.border};font-size:11px;font-weight:600;letter-spacing:.05em;text-transform:uppercase;color:${C.accent};margin-bottom:${mb}px;white-space:nowrap;">${text}</div>`;
export function topbar(stepCounter, showSkip) {
    const skip = showSkip ? `<button data-act="goLast" style="height:32px;padding:0 13px;border-radius:8px;border:none;background:transparent;color:${C.faint};cursor:pointer;font-size:12.5px;font-weight:500;">Omitir guía</button>` : '';
    return `<div data-od-id="od-topbar" style="display:flex;align-items:center;justify-content:space-between;padding:18px 26px;border-bottom:1px solid ${C.border};"><div style="display:flex;align-items:center;gap:11px;"><img src="icon-512.png" alt="" width="30" height="30" onerror="this.style.display='none'" style="width:30px;height:30px;border-radius:8px;display:block;"><div style="line-height:1.15;"><div style="font-size:13.5px;font-weight:600;">Control de Asistencia</div><div style="font-size:11px;color:${C.faint};">Contrutek</div></div></div><div style="display:flex;align-items:center;gap:16px;"><span style="font-family:'IBM Plex Mono',monospace;font-size:11.5px;color:${C.faint};">${esc(stepCounter)}</span>${skip}</div></div>`;
}
export function footer(s, showDots, hint, nextLabel, last) {
    let dots = '';
    if (showDots) {
        dots = '<div style="display:flex;align-items:center;gap:7px;">' + STEPS.map((st, n) =>
            `<button data-act="dot" data-n="${n + 1}" title="${esc(st.title)}" style="width:${s.step === n + 1 ? 22 : 8}px;height:8px;border-radius:5px;border:none;cursor:pointer;padding:0;background:${s.step === n + 1 ? C.accent : C.border};"></button>`).join('') + '</div>';
    }
    const prevDisabled = (s.phase === 'guide' && s.step === 1) || s.phase === 'ready';
    return `<div data-od-id="od-footer" style="display:flex;align-items:center;justify-content:space-between;padding:16px 26px;border-top:1px solid ${C.border};"><button data-act="back" style="display:flex;align-items:center;gap:7px;height:40px;padding:0 16px;border-radius:10px;border:1px solid ${C.border};background:transparent;color:${C.dim};font-size:13.5px;font-weight:500;cursor:pointer;${prevDisabled ? 'opacity:.35;pointer-events:none;' : ''}"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 6l-6 6 6 6"/></svg>Atrás</button><div style="display:flex;align-items:center;gap:12px;">${dots}${hint ? `<span style="font-size:12px;color:${C.faint};">${esc(hint)}</span>` : ''}</div><button data-act="next" style="display:flex;align-items:center;gap:7px;height:40px;padding:0 20px;border-radius:10px;border:none;background:${C.accent};color:${C.onAccent};font-size:13.5px;font-weight:600;cursor:pointer;${canAdvance(s) ? '' : 'opacity:.4;pointer-events:none;'}">${esc(nextLabel)}${last ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7"/></svg>' : '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>'}</button></div>`;
}
export function guideCopy(s) {
    const step = STEPS[s.step - 1];
    const tips = step.tips.map(t =>
        `<div style="display:flex;gap:11px;align-items:flex-start;"><span style="width:20px;height:20px;flex:none;border-radius:6px;background:${C.accent};color:${C.onAccent};display:flex;align-items:center;justify-content:center;margin-top:1px;"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7"/></svg></span><span style="font-size:13.5px;color:${C.dim};line-height:1.5;">${esc(t)}</span></div>`).join('');
    return `<div data-od-id="od-guide-copy" style="padding:38px 34px;display:flex;flex-direction:column;justify-content:center;">${chip(esc(step.kicker))}<h1 style="margin:0;font-size:27px;font-weight:700;letter-spacing:-.015em;line-height:1.18;">${esc(step.title)}</h1><p style="margin:12px 0 0;font-size:14.5px;color:${C.dim};line-height:1.55;">${esc(step.body)}</p><div style="margin-top:24px;display:grid;gap:11px;">${tips}</div></div>`;
}
export function choiceSection(s) {
    const card = (id, icon, title, desc) =>
        `<button type="button" data-act="pick" data-v="${id}" style="display:flex;gap:14px;align-items:flex-start;text-align:left;width:100%;padding:18px;border-radius:14px;cursor:pointer;font:inherit;color:inherit;background:${s.source === id ? C.panel2 : 'transparent'};border:1px solid ${s.source === id ? C.accent : C.border};"><span style="width:40px;height:40px;flex:none;border-radius:11px;display:flex;align-items:center;justify-content:center;background:${s.source === id ? C.accent : C.panel2};color:${s.source === id ? C.onAccent : C.dim};border:1px solid ${s.source === id ? C.accent : C.border};">${icon}</span><span style="flex:1;min-width:0;"><span style="display:block;font-size:14.5px;font-weight:600;">${title}</span><span style="display:block;font-size:12.5px;color:${C.dim};margin-top:3px;line-height:1.45;">${desc}</span></span></button>`;
    return `<div data-od-id="od-choice" style="min-height:434px;padding:38px 34px;display:flex;flex-direction:column;justify-content:center;max-width:620px;margin:0 auto;">${chip('Punto de partida')}<h1 style="margin:0;font-size:26px;font-weight:700;letter-spacing:-.015em;line-height:1.2;">¿Cómo quieres empezar?</h1><p style="margin:11px 0 24px;font-size:14.5px;color:${C.dim};line-height:1.55;">Configura la app desde cero o recupera datos que ya tengas guardados.</p><div style="display:grid;gap:11px;">${card('scratch', '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>', 'Empezar desde cero', 'Seis pasos: empresa, días de trabajo, jornada, posiciones y personal.')}${card('backup', '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7z"/><path d="M14 2v5h5"/><path d="M12 12.5V18"/><path d="m9.5 15 2.5-2.5 2.5 2.5"/></svg>', 'Cargar desde un backup', 'Restaura un archivo .json exportado desde esta app.')}${card('google', '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20 16.2A4.5 4.5 0 0 0 17.5 8h-1.8A7 7 0 1 0 4.4 15.3"/><path d="M12 11v7"/><path d="m8.5 14.5 3.5 3.5 3.5-3.5"/></svg>', 'Continuar con Google', 'Tu respaldo vive en tu cuenta: al iniciar sesión, la sincronización restaura tus datos automáticamente.')}${card('demo', '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="m10 8.5 5 3.5-5 3.5z"/></svg>', 'Explorar con datos de prueba', 'Carga una obra de ejemplo para probar la app sin registrar nada real.')}</div>${s._choiceError ? `<div role="alert" style="margin-top:16px;padding:12px 15px;border-radius:11px;border:1px solid #ef4444;background:rgba(239,68,68,.09);color:#fca5a5;font-size:13px;line-height:1.5;">${esc(s._choiceError)}</div>` : ''}</div>`;
}
export function setupSection(s) {
    const su = s.setupStep;
    const setup = SETUP[su - 1] || SETUP[0];
    let b = `<div data-od-id="od-setup" style="min-height:434px;padding:32px 34px 34px;max-width:620px;margin:0 auto;width:100%;">`;
    b += `<div style="height:3px;border-radius:3px;background:${C.panel2};margin-bottom:26px;overflow:hidden;"><div style="height:100%;width:${Math.round(su / SETUP_TOTAL * 100)}%;background:${C.accent};border-radius:3px;"></div></div>`;
    b += chip(esc(setup.kicker), 14);
    b += `<h1 style="margin:0;font-size:23px;font-weight:700;letter-spacing:-.012em;line-height:1.25;">${esc(setup.title)}</h1><p style="margin:10px 0 24px;font-size:14px;color:${C.dim};line-height:1.55;">${esc(setup.body)}</p>`;
    if (su === 1) {
        b += `<label style="${LBL}" for="f-company">Nombre de la empresa o proyecto</label>${input('f-company', 'company', s.company, 'Ej: Constructora Horizon S.R.L.')}`;
        b += `<div style="display:flex;align-items:center;gap:11px;margin-top:20px;padding:14px 16px;border-radius:12px;background:${C.panel2};border:1px solid ${C.border};"><img src="icon-512.png" alt="" width="32" height="32" onerror="this.style.display='none'" style="width:32px;height:32px;border-radius:9px;display:block;"><div style="min-width:0;"><div style="font-size:10px;letter-spacing:.06em;text-transform:uppercase;color:${C.faint};font-weight:600;">Así se verá en la cabecera</div><div style="font-size:14.5px;font-weight:700;margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(s.company.trim() || 'Constructora Horizon')}</div></div></div>`;
    }
    if (su === 2) {
        const chips = DAY_LABELS.map((lb, n) =>
            `<button type="button" data-act="day" data-n="${n}" title="${DAY_NAMES[n]}" style="width:46px;height:52px;border-radius:12px;cursor:pointer;font-size:14px;font-weight:700;font-family:'IBM Plex Mono',monospace;${s.days[n] ? `background:${C.accent};color:${C.onAccent};border:none;` : `background:transparent;color:${C.faint};border:1px solid ${C.border};`}">${lb}</button>`).join('');
        const on = s.days.filter(Boolean).length;
        b += `<div style="display:flex;gap:8px;flex-wrap:wrap;">${chips}</div><div style="display:flex;align-items:center;gap:10px;margin-top:20px;font-size:13px;color:${C.dim};">${esc(on + (on === 1 ? ' día seleccionado' : ' días seleccionados'))} · ${esc((on * s.hours) + 'h por semana')}</div>`;
    }
    if (su === 3) {
        const presets = [8, 9, 10].map(h =>
            `<button type="button" data-act="hours" data-v="${h}" style="height:36px;padding:0 15px;border-radius:9px;cursor:pointer;font-size:13px;font-weight:600;${s.hours === h ? `background:${C.accent};color:${C.onAccent};border:none;` : `background:transparent;color:${C.dim};border:1px solid ${C.border};`}">${h}h</button>`).join('');
        b += `<div style="display:flex;align-items:center;gap:16px;"><button type="button" data-act="hMinus" title="Menos" style="width:44px;height:44px;border-radius:12px;border:1px solid ${C.border};background:transparent;color:${C.dim};cursor:pointer;font-size:22px;line-height:1;">−</button><div style="min-width:96px;text-align:center;"><div style="font-family:'IBM Plex Mono',monospace;font-size:38px;font-weight:700;line-height:1;">${s.hours}h</div><div style="font-size:11px;color:${C.faint};margin-top:5px;">por día</div></div><button type="button" data-act="hPlus" title="Más" style="width:44px;height:44px;border-radius:12px;border:1px solid ${C.border};background:transparent;color:${C.dim};cursor:pointer;font-size:22px;line-height:1;">+</button><div style="display:flex;gap:7px;margin-left:8px;">${presets}</div></div>`;
        b += `<div style="margin-top:22px;padding:14px 16px;border-radius:12px;background:${C.panel2};border:1px solid ${C.border};display:flex;justify-content:space-between;align-items:baseline;"><span style="font-size:13px;color:${C.dim};">Jornada semanal resultante</span><span style="font-family:'IBM Plex Mono',monospace;font-size:17px;font-weight:700;color:${C.accent};">${(s.days.filter(Boolean).length * s.hours)}h por semana</span></div>`;
    }
    if (su === 4) {
        const sw = POS_COLORS.map((c, n) =>
            `<button type="button" data-act="swatch" data-n="${n}" title="Color ${n + 1}" style="width:32px;height:32px;border-radius:9px;cursor:pointer;background:${c};border:2px solid ${s.posColorIdx === n ? C.text : 'transparent'};"></button>`).join('');
        const dayRate = money((parseFloat(s.posRate) || 0) * s.hours);
        b += `<div style="display:grid;gap:16px;"><div style="display:grid;grid-template-columns:minmax(0,1.6fr) minmax(0,1fr);gap:12px;"><div><label style="${LBL}" for="f-posname">Nombre de la posición</label>${input('f-posname', 'posName', s.posName, 'Ej: Ayudante')}</div><div><label style="${LBL}" for="f-posrate">Tarifa por hora</label>${input('f-posrate', 'posRate', s.posRate, '112.50', 'inputmode="decimal" ')}</div></div>`;
        b += `<div><label style="${LBL}" for="">Color de identificación</label><div style="display:flex;gap:9px;">${sw}</div></div>`;
        b += `<div style="padding:14px 16px;border-radius:12px;background:${C.panel2};border:1px solid ${C.border};border-left:3px solid ${POS_COLORS[s.posColorIdx] || C.accent};display:flex;justify-content:space-between;align-items:center;"><div><div style="font-size:14px;font-weight:600;">${esc(s.posName.trim() || 'Ayudante')}</div><div style="font-size:11.5px;color:${C.faint};margin-top:3px;">Tarifa del día completo</div></div><span style="font-family:'IBM Plex Mono',monospace;font-size:16px;font-weight:700;">${dayRate}</span></div></div>`;
    }
    if (su === 5) {
        const rows = s.employees.map(emp =>
            `<div style="display:flex;align-items:center;gap:13px;padding:12px 14px;border-radius:11px;background:${C.panel2};border:1px solid ${C.border};"><span style="font-family:'IBM Plex Mono',monospace;font-size:14px;font-weight:600;color:${POS_COLORS[s.posColorIdx] || C.accent};">${esc(emp.code)}</span><div style="flex:1;min-width:0;"><div style="font-size:13.5px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(emp.name)}</div><div style="font-size:11px;color:${C.faint};">${esc(emp.pos)}</div></div><button type="button" data-act="rmEmp" data-code="${esc(emp.code)}" title="Quitar" style="width:30px;height:30px;border-radius:8px;border:1px solid ${C.border};background:transparent;color:${C.faint};cursor:pointer;display:flex;align-items:center;justify-content:center;"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div>`).join('');
        const empBlock = s.employees.length
            ? `<div style="margin-top:18px;display:grid;gap:8px;">${rows}<div style="font-size:11.5px;color:${C.faint};margin-top:2px;">${esc(s.employees.length + (s.employees.length === 1 ? ' empleado agregado' : ' empleados agregados'))}</div></div>`
            : `<div style="margin-top:18px;padding:26px;border-radius:12px;border:1px dashed ${C.border};text-align:center;font-size:13px;color:${C.faint};">Aún no has agregado a nadie.</div>`;
        b += `<div style="display:grid;grid-template-columns:88px minmax(0,1fr) auto;gap:10px;align-items:flex-end;"><div><label style="${LBL}" for="f-empcode">Número</label>${input('f-empcode', 'newEmpCode', s.newEmpCode, '001', 'inputmode="numeric" ')}</div><div><label style="${LBL}" for="f-empname">Nombre del empleado</label>${input('f-empname', 'newEmpName', s.newEmpName, 'Ej: Franklin Henrriquez')}</div><button type="button" data-act="addEmp" style="height:46px;padding:0 18px;border-radius:11px;border:none;background:${C.accent};color:${C.onAccent};font-size:13.5px;font-weight:600;cursor:pointer;display:flex;align-items:center;gap:7px;"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>Agregar</button></div>${empBlock}`;
    }
    if (su === 6) {
        /* Respaldo real llega en fase 3; por ahora solo se muestra la explicación. */
        b += `<div style="padding:16px;border-radius:12px;background:${C.panel2};border:1px dashed ${C.border};color:${C.dim};font-size:13px;line-height:1.55;">La vinculación con Google estará disponible más adelante. Sin ella, tus datos se guardan solo en este dispositivo; podrás hacerlo desde Ajustes → Datos.</div>`;
    }
    return b + '</div>';
}
export function readySection(s) {
    const scratch = s.source === 'scratch';
    const daysOn = s.days.filter(Boolean).length;
    const row = (label, value) => `<div style="display:flex;align-items:center;justify-content:space-between;gap:14px;padding:13px 16px;border-bottom:1px solid ${C.border};"><span style="font-size:12.5px;color:${C.faint};">${esc(label)}</span><span style="font-size:13px;font-weight:600;text-align:right;">${esc(value)}</span></div>`;
    const box = scratch
        ? `<div style="border:1px solid ${C.border};border-radius:14px;overflow:hidden;">${row('Empresa', s.company.trim() || '—')}${row('Semana laboral', `${daysOn} días · ${DAY_LABELS.filter((_, n) => s.days[n]).join(' ')}`)}${row('Jornada', `${s.hours}h por día · ${daysOn * s.hours}h semanales`)}${row('Posiciones', s.posName.trim() ? s.posName.trim() + (s.posRate ? ` · $${s.posRate}/hr` : '') : '—')}${row('Personal', `${s.employees.length}${s.employees.length === 1 ? ' empleado' : ' empleados'}`)}${row('Respaldo', 'Solo en este dispositivo')}</div>`
        : `<div style="padding:12px 16px;border-radius:12px;background:${C.panel2};border:1px solid ${C.border};margin-bottom:12px;font-size:12.5px;color:${C.dim};">Restauración de datos disponible en una fase posterior.</div><div style="border:1px solid ${C.border};border-radius:14px;overflow:hidden;">${row('Origen', s.source === 'google' ? 'Google Drive' : 'Archivo local')}${row('Empresa', s.company.trim() || '—')}${row('Personal', `${s.employees.length}${s.employees.length === 1 ? ' empleado' : ' empleados'}`)}</div>`;
    const title = scratch ? 'Todo listo para empezar' : 'Datos restaurados';
    const bodyTxt = scratch ? 'Tu espacio de trabajo quedó configurado. Puedes cambiar cualquier ajuste más adelante.' : 'Recuperamos tu información. Ya puedes seguir marcando la asistencia donde la dejaste.';
    return `<div data-od-id="od-ready" style="min-height:434px;padding:34px;max-width:620px;margin:0 auto;width:100%;display:flex;flex-direction:column;justify-content:center;"><div style="display:flex;align-items:center;gap:14px;margin-bottom:22px;"><div style="width:52px;height:52px;flex:none;border-radius:50%;background:${C.good};color:${C.onAccent};display:flex;align-items:center;justify-content:center;"><svg width="27" height="27" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7"/></svg></div><div><h1 style="margin:0;font-size:24px;font-weight:700;letter-spacing:-.012em;">${esc(title)}</h1><p style="margin:6px 0 0;font-size:13.5px;color:${C.dim};line-height:1.5;">${esc(bodyTxt)}</p></div></div>${box}</div>`;
}
export function renderOnboarding(s) {
    const stepCounter = s.phase === 'guide' ? `${s.step} / ${STEPS.length}`
        : s.phase === 'setup' ? `Configuración ${s.setupStep} / ${SETUP_TOTAL}`
        : s.phase === 'choice' ? 'Punto de partida' : 'Listo';
    const hintMap = { 1: 'Escribe un nombre para continuar', 2: 'Selecciona al menos un día', 3: '', 4: 'Ponle nombre a la posición', 5: 'Agrega al menos un empleado', 6: '' };
    const hint = s.phase === 'setup' && !canAdvance(s) ? (hintMap[s.setupStep] || '')
        : (s.phase === 'choice' && !canAdvance(s) ? 'Elige una opción para continuar' : '');
    const nextLabel = s.phase === 'guide' ? (s.step === STEPS.length ? 'Configurar la app' : 'Siguiente')
        : s.phase === 'choice' ? 'Continuar'
        : s.phase === 'setup' ? (s.setupStep === SETUP_TOTAL ? 'Finalizar' : 'Siguiente')
        : 'Entrar a la app';
    const demo = `<div data-od-id="od-demo-${s.step}" style="border-left:1px solid ${C.border};background:${C.bg};display:flex;align-items:center;justify-content:center;padding:32px;min-height:280px;"><div style="max-width:300px;text-align:center;padding:26px;border-radius:14px;border:1px dashed ${C.border};color:${C.faint};font-size:13px;line-height:1.5;">Demo interactiva del paso ${s.step} en camino<br><span style="font-size:11.5px;">Esta pieza visual llega en una fase posterior.</span></div></div>`;
    const body = s.phase === 'guide' ? `<div style="display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);min-height:434px;">${guideCopy(s)}${demo}</div>`
        : s.phase === 'choice' ? choiceSection(s)
        : s.phase === 'setup' ? setupSection(s)
        : readySection(s);
    return `<div class="od-wrap" style="min-height:100vh;display:flex;align-items:center;justify-content:center;padding:28px;background:${C.bg};color:${C.text};"><div style="width:100%;max-width:980px;background:${C.panel};border:1px solid ${C.border};border-radius:22px;overflow:hidden;">${topbar(stepCounter, s.phase === 'guide' && s.step < STEPS.length)}${body}${footer(s, s.phase === 'guide', hint, nextLabel, s.phase === 'ready')}</div></div>`;
}
const ACTIONS = {
    next: s => navNext(s),
    back: s => navBack(s),
    goLast: s => goGuideStep(s, STEPS.length),
    dot: (s, el) => goGuideStep(s, parseInt(el.dataset.n, 10) || 1),
    pick: (s, el) => pick(s, el.dataset.v),
    day: (s, el) => toggleDay(s, parseInt(el.dataset.n, 10)),
    hours: (s, el) => setHours(s, parseInt(el.dataset.v, 10)),
    hMinus,
    hPlus,
    swatch: (s, el) => setPosColor(s, parseInt(el.dataset.n, 10)),
    addEmp: s => addEmployee(s),
    rmEmp: (s, el) => removeEmployee(s, el.dataset.code),
    input: (s, el) => setField(s, el.dataset.field, el.value)
};
// Delegación para el host futuro: act = data-act (o 'input' para inputs[data-field]).
export function handleAction(act, el, state) {
    const fn = ACTIONS[act];
    return fn ? fn(state, el) : state;
}
