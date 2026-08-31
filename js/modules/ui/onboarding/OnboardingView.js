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
    addEmployee, removeEmployee, cycleDemo, markAllPresent, cycleWeek
} from './OnboardingCore.js';
import { COLOR_PALETTE } from '../../utils/Constants.js';
const C = { bg: '#0f172a', panel: '#1e293b', panel2: '#334155', border: '#334155', text: '#f8fafc', dim: '#94a3b8', faint: '#64748b', accent: '#06b6d4', onAccent: '#0f172a', good: '#10b981', warn: '#f59e0b', bad: '#ef4444' };
const POS_COLORS = COLOR_PALETTE.slice(0, 4);
const FIELD_STYLE = `width:100%;height:48px;padding:0 15px;border-radius:11px;border:1px solid ${C.border};background:${C.panel};font-size:16px;font-family:inherit;color:inherit;box-sizing:border-box;`;
const LBL = `display:block;font-size:12px;font-weight:600;color:${C.dim};margin-bottom:8px;`;
export function esc(v) {
    return String(v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
const money = n => '$' + Math.round(n).toLocaleString('es-DO');
const input = (id, field, value, placeholder, attrs = '') => `<input id="${id}" class="odv-input" data-field="${field}" value="${esc(value)}" placeholder="${esc(placeholder)}" autocomplete="off" ${attrs}style="${FIELD_STYLE}">`;
export const chip = (text, mb = 16) => `<div style="display:inline-flex;align-items:center;gap:8px;height:26px;padding:0 11px;border-radius:20px;background:${C.panel2};border:1px solid ${C.border};font-size:11px;font-weight:600;letter-spacing:.05em;text-transform:uppercase;color:${C.accent};margin-bottom:${mb}px;white-space:nowrap;">${text}</div>`;
export function topbar(stepCounter, showSkip, progress = null) {
    const skip = showSkip ? `<button type="button" data-act="goLast" aria-label="Omitir guía y elegir inicio" style="height:36px;min-height:36px;padding:0 13px;border-radius:8px;border:none;background:transparent;color:${C.faint};cursor:pointer;font-size:12.5px;font-weight:500;">Omitir guía</button>` : '';
    const bar = progress ? `<div role="progressbar" aria-valuemin="1" aria-valuemax="${progress.max}" aria-valuenow="${progress.now}" aria-label="Progreso del asistente" style="position:absolute;left:0;bottom:-1px;height:2px;width:${Math.round(progress.now / progress.max * 100)}%;background:${C.accent};"></div>` : '';
    return `<div data-od-id="od-topbar" style="position:relative;display:flex;align-items:center;justify-content:space-between;padding:18px 26px;border-bottom:1px solid ${C.border};"><div style="display:flex;align-items:center;gap:11px;"><img src="icon-512.png" alt="" width="30" height="30" onerror="this.style.display='none'" style="width:30px;height:30px;border-radius:8px;display:block;"><div style="line-height:1.15;"><div style="font-size:13.5px;font-weight:600;">Control de Asistencia</div><div style="font-size:11px;color:${C.faint};">Contrutek</div></div></div><div style="display:flex;align-items:center;gap:16px;"><span aria-live="polite" style="font-family:'IBM Plex Mono',monospace;font-size:11.5px;color:${C.faint};">${esc(stepCounter)}</span>${skip}</div>${bar}</div>`;
}
export function footer(s, showDots, hint, nextLabel, last) {
    let dots = '';
    if (showDots) {
        dots = '<div style="display:flex;align-items:center;gap:7px;">' + STEPS.map((st, n) =>
            `<button type="button" data-act="dot" data-n="${n + 1}" title="${esc(st.title)}" aria-label="Ir al paso ${n + 1} de ${STEPS.length}: ${esc(st.title)}" aria-current="${s.step === n + 1 ? 'step' : 'false'}" style="width:${s.step === n + 1 ? 22 : 8}px;height:8px;border-radius:5px;border:none;cursor:pointer;padding:0;background:${s.step === n + 1 ? C.accent : C.border};"></button>`).join('') + '</div>';
    }
    const prevDisabled = (s.phase === 'guide' && s.step === 1) || s.phase === 'ready';
    return `<div data-od-id="od-footer" style="display:flex;align-items:center;justify-content:space-between;padding:16px 26px;border-top:1px solid ${C.border};"><button type="button" data-act="back" aria-label="Volver al paso anterior" aria-disabled="${prevDisabled ? 'true' : 'false'}" style="display:flex;align-items:center;gap:7px;height:42px;min-height:42px;padding:0 16px;border-radius:10px;border:1px solid ${C.border};background:transparent;color:${C.dim};font-size:13.5px;font-weight:500;cursor:pointer;${prevDisabled ? 'opacity:.35;pointer-events:none;' : ''}"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 6l-6 6 6 6"/></svg>Atrás</button><div style="display:flex;align-items:center;gap:12px;">${dots}${hint ? `<span data-od-hint aria-live="polite" style="font-size:12px;color:${C.faint};">${esc(hint)}</span>` : ''}</div><button type="button" data-act="next" aria-label="${esc(nextLabel)}" aria-disabled="${canAdvance(s) ? 'false' : 'true'}" style="display:flex;align-items:center;gap:7px;height:42px;min-height:42px;padding:0 20px;border-radius:10px;border:none;background:${C.accent};color:${C.onAccent};font-size:13.5px;font-weight:600;cursor:pointer;${canAdvance(s) ? '' : 'opacity:.4;pointer-events:none;'}">${esc(nextLabel)}${last ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7"/></svg>' : '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>'}</button></div>`;
}
export function guideCopy(s) {
    const step = STEPS[s.step - 1];
    const tips = step.tips.map(t =>
        `<div style="display:flex;gap:11px;align-items:flex-start;"><span style="width:20px;height:20px;flex:none;border-radius:6px;background:${C.accent};color:${C.onAccent};display:flex;align-items:center;justify-content:center;margin-top:1px;" aria-hidden="true"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7"/></svg></span><span style="font-size:13.5px;color:${C.dim};line-height:1.5;">${esc(t)}</span></div>`).join('');
    return `<div data-od-id="od-guide-copy" style="padding:38px 34px;display:flex;flex-direction:column;justify-content:center;">${chip(esc(step.kicker))}<h1 style="margin:0;font-size:27px;font-weight:700;letter-spacing:-.015em;line-height:1.18;">${esc(step.title)}</h1><p style="margin:12px 0 0;font-size:14.5px;color:${C.dim};line-height:1.55;">${esc(step.body)}</p><div style="margin-top:24px;display:grid;gap:11px;">${tips}</div></div>`;
}
export function choiceSection(s) {
    const card = (id, icon, title, desc) =>
        `<button type="button" role="radio" aria-checked="${s.source === id ? 'true' : 'false'}" aria-label="${title}. ${desc}" data-act="pick" data-v="${id}" style="display:flex;gap:14px;align-items:flex-start;text-align:left;width:100%;padding:16px 18px;min-height:48px;border-radius:14px;cursor:pointer;font:inherit;color:inherit;background:${s.source === id ? C.panel2 : 'transparent'};border:1px solid ${s.source === id ? C.accent : C.border};"><span style="width:40px;height:40px;flex:none;border-radius:11px;display:flex;align-items:center;justify-content:center;background:${s.source === id ? C.accent : C.panel2};color:${s.source === id ? C.onAccent : C.dim};border:1px solid ${s.source === id ? C.accent : C.border};" aria-hidden="true">${icon}</span><span style="flex:1;min-width:0;"><span style="display:block;font-size:14.5px;font-weight:600;">${title}</span><span style="display:block;font-size:12.5px;color:${C.dim};margin-top:3px;line-height:1.45;">${desc}</span></span></button>`;
    return `<div data-od-id="od-choice" style="min-height:434px;padding:38px 34px;display:flex;flex-direction:column;justify-content:center;max-width:620px;margin:0 auto;">${chip('Punto de partida')}<h1 style="margin:0;font-size:26px;font-weight:700;letter-spacing:-.015em;line-height:1.2;">¿Cómo quieres empezar?</h1><p style="margin:11px 0 24px;font-size:14.5px;color:${C.dim};line-height:1.55;">Configura la app desde cero o recupera datos que ya tengas guardados.</p><div role="radiogroup" aria-label="Opciones para empezar" style="display:grid;gap:11px;">${card('scratch', '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>', 'Empezar desde cero', 'Seis pasos: empresa, días de trabajo, jornada, posiciones y personal.')}${card('backup', '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7z"/><path d="M14 2v5h5"/><path d="M12 12.5V18"/><path d="m9.5 15 2.5-2.5 2.5 2.5"/></svg>', 'Cargar desde un backup', 'Restaura un archivo .json exportado desde esta app.')}${card('google', '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20 16.2A4.5 4.5 0 0 0 17.5 8h-1.8A7 7 0 1 0 4.4 15.3"/><path d="M12 11v7"/><path d="m8.5 14.5 3.5 3.5 3.5-3.5"/></svg>', 'Continuar con Google', 'Tu respaldo vive en tu cuenta: al iniciar sesión, la sincronización restaura tus datos automáticamente.')}${card('demo', '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="m10 8.5 5 3.5-5 3.5z"/></svg>', 'Explorar con datos de prueba', 'Carga una obra de ejemplo para probar la app sin registrar nada real.')}</div><div style="display:flex;justify-content:center;margin-top:18px;"><button type="button" data-act="skipOnboarding" aria-label="Saltar configuración inicial por ahora" style="height:36px;min-height:36px;padding:0 12px;border:none;background:transparent;color:${C.faint};font-family:inherit;font-size:12px;cursor:pointer;text-decoration:underline;text-underline-offset:3px;">Saltar por ahora</button></div>${s._choiceError ? `<div role="alert" aria-live="assertive" style="margin-top:16px;padding:12px 15px;border-radius:11px;border:1px solid #ef4444;background:rgba(239,68,68,.09);color:#fca5a5;font-size:13px;line-height:1.5;">${esc(s._choiceError)}</div>` : ''}</div>`;
}
export function setupSection(s) {
    const su = s.setupStep;
    const setup = SETUP[su - 1] || SETUP[0];
    let b = `<div data-od-id="od-setup" style="min-height:434px;padding:32px 34px 34px;max-width:620px;margin:0 auto;width:100%;">`;
    b += `<div style="height:3px;border-radius:3px;background:${C.panel2};margin-bottom:26px;overflow:hidden;"><div style="height:100%;width:${Math.round(su / SETUP_TOTAL * 100)}%;background:${C.accent};border-radius:3px;"></div></div>`;
    b += chip(esc(setup.kicker), 14);
    b += `<h1 style="margin:0;font-size:23px;font-weight:700;letter-spacing:-.012em;line-height:1.25;">${esc(setup.title)}</h1><p style="margin:10px 0 24px;font-size:14px;color:${C.dim};line-height:1.55;">${esc(setup.body)}</p>`;
    if (su === 1) {
        b += `<label style="${LBL}" for="f-company">Nombre de la empresa o proyecto</label>${input('f-company', 'company', s.company, 'Ej: Constructora Horizon S.R.L.', 'aria-required="true" ')}`;
        b += `<div style="display:flex;align-items:center;gap:11px;margin-top:20px;padding:14px 16px;border-radius:12px;background:${C.panel2};border:1px solid ${C.border};"><img src="icon-512.png" alt="" width="32" height="32" onerror="this.style.display='none'" style="width:32px;height:32px;border-radius:9px;display:block;"><div style="min-width:0;"><div style="font-size:10px;letter-spacing:.06em;text-transform:uppercase;color:${C.faint};font-weight:600;">Así se verá en la cabecera</div><div data-mirror="company" style="font-size:14.5px;font-weight:700;margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(s.company.trim() || 'Constructora Horizon')}</div></div></div>`;
    }
    if (su === 2) {
        const chips = DAY_LABELS.map((lb, n) =>
            `<button type="button" data-act="day" data-n="${n}" title="${DAY_NAMES[n]}" aria-label="${DAY_NAMES[n]}, ${s.days[n] ? 'seleccionado' : 'no seleccionado'}" aria-pressed="${s.days[n] ? 'true' : 'false'}" style="width:46px;height:52px;border-radius:12px;cursor:pointer;font-size:14px;font-weight:700;font-family:'IBM Plex Mono',monospace;${s.days[n] ? `background:${C.accent};color:${C.onAccent};border:none;` : `background:transparent;color:${C.faint};border:1px solid ${C.border};`}">${lb}</button>`).join('');
        const on = s.days.filter(Boolean).length;
        b += `<div role="group" aria-label="Días laborables semanales" class="odv-days-grid" style="display:flex;gap:8px;flex-wrap:wrap;">${chips}</div><div style="display:flex;align-items:center;gap:10px;margin-top:20px;font-size:13px;color:${C.dim};">${esc(on + (on === 1 ? ' día seleccionado' : ' días seleccionados'))} · ${esc((on * s.hours) + 'h por semana')}</div>`;
    }
    if (su === 3) {
        const presets = [8, 9, 10].map(h =>
            `<button type="button" data-act="hours" data-v="${h}" aria-pressed="${s.hours === h ? 'true' : 'false'}" aria-label="Jornada de ${h} horas por día" style="height:38px;min-height:38px;padding:0 15px;border-radius:9px;cursor:pointer;font-size:13px;font-weight:600;${s.hours === h ? `background:${C.accent};color:${C.onAccent};border:none;` : `background:transparent;color:${C.dim};border:1px solid ${C.border};`}">${h}h</button>`).join('');
        b += `<div style="display:flex;align-items:center;gap:16px;"><button type="button" data-act="hMinus" title="Menos horas" aria-label="Reducir jornada en 1 hora" style="width:46px;height:46px;min-width:44px;min-height:44px;border-radius:12px;border:1px solid ${C.border};background:transparent;color:${C.dim};cursor:pointer;font-size:22px;line-height:1;display:flex;align-items:center;justify-content:center;">−</button><div style="min-width:96px;text-align:center;" aria-live="polite"><div style="font-family:'IBM Plex Mono',monospace;font-size:38px;font-weight:700;line-height:1;">${s.hours}h</div><div style="font-size:11px;color:${C.faint};margin-top:5px;">por día</div></div><button type="button" data-act="hPlus" title="Más horas" aria-label="Aumentar jornada en 1 hora" style="width:46px;height:46px;min-width:44px;min-height:44px;border-radius:12px;border:1px solid ${C.border};background:transparent;color:${C.dim};cursor:pointer;font-size:22px;line-height:1;display:flex;align-items:center;justify-content:center;">+</button><div style="display:flex;gap:7px;margin-left:8px;">${presets}</div></div>`;
        b += `<div style="margin-top:22px;padding:14px 16px;border-radius:12px;background:${C.panel2};border:1px solid ${C.border};display:flex;justify-content:space-between;align-items:baseline;"><span style="font-size:13px;color:${C.dim};">Jornada semanal resultante</span><span style="font-family:'IBM Plex Mono',monospace;font-size:17px;font-weight:700;color:${C.accent};">${(s.days.filter(Boolean).length * s.hours)}h por semana</span></div>`;
    }
    if (su === 4) {
        const sw = POS_COLORS.map((c, n) =>
            `<button type="button" role="radio" aria-checked="${s.posColorIdx === n ? 'true' : 'false'}" data-act="swatch" data-n="${n}" title="Color ${n + 1}" aria-label="Color ${n + 1}" style="width:36px;height:36px;min-width:36px;min-height:36px;border-radius:9px;cursor:pointer;background:${c};border:2px solid ${s.posColorIdx === n ? C.text : 'transparent'};"></button>`).join('');
        const dayRate = money((parseFloat(s.posRate) || 0) * s.hours);
        b += `<div style="display:grid;gap:16px;"><div style="display:grid;grid-template-columns:minmax(0,1.6fr) minmax(0,1fr);gap:12px;"><div><label style="${LBL}" for="f-posname">Nombre de la posición</label>${input('f-posname', 'posName', s.posName, 'Ej: Ayudante', 'aria-required="true" ')}</div><div><label style="${LBL}" for="f-posrate">Tarifa por hora</label>${input('f-posrate', 'posRate', s.posRate, '112.50', 'inputmode="decimal" ')}</div></div>`;
        b += `<div><span id="lbl-pos-colors" style="${LBL}">Color de identificación</span><div role="radiogroup" aria-labelledby="lbl-pos-colors" style="display:flex;gap:9px;">${sw}</div></div>`;
        b += `<div style="padding:14px 16px;border-radius:12px;background:${C.panel2};border:1px solid ${C.border};border-left:3px solid ${POS_COLORS[s.posColorIdx] || C.accent};display:flex;justify-content:space-between;align-items:center;"><div><div data-mirror="posName" style="font-size:14px;font-weight:600;">${esc(s.posName.trim() || 'Ayudante')}</div><div style="font-size:11.5px;color:${C.faint};margin-top:3px;">Tarifa del día completo</div></div><span data-mirror="dayRate" style="font-family:'IBM Plex Mono',monospace;font-size:16px;font-weight:700;">${dayRate}</span></div></div>`;
    }
    if (su === 5) {
        const rows = s.employees.map(emp =>
            `<div style="display:flex;align-items:center;gap:13px;padding:12px 14px;border-radius:11px;background:${C.panel2};border:1px solid ${C.border};"><span style="font-family:'IBM Plex Mono',monospace;font-size:14px;font-weight:600;color:${POS_COLORS[s.posColorIdx] || C.accent};">${esc(emp.code)}</span><div style="flex:1;min-width:0;"><div style="font-size:13.5px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(emp.name)}</div><div style="font-size:11px;color:${C.faint};">${esc(emp.pos)}</div></div><button type="button" data-act="rmEmp" data-code="${esc(emp.code)}" title="Quitar a ${esc(emp.name)}" aria-label="Quitar a ${esc(emp.name)}" style="width:36px;height:36px;min-width:36px;min-height:36px;border-radius:8px;border:1px solid ${C.border};background:transparent;color:${C.faint};cursor:pointer;display:flex;align-items:center;justify-content:center;"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div>`).join('');
        const empBlock = s.employees.length
            ? `<div style="margin-top:18px;display:grid;gap:8px;">${rows}<div aria-live="polite" style="font-size:11.5px;color:${C.faint};margin-top:2px;">${esc(s.employees.length + (s.employees.length === 1 ? ' empleado agregado' : ' empleados agregados'))}</div></div>`
            : `<div style="margin-top:18px;padding:26px;border-radius:12px;border:1px dashed ${C.border};text-align:center;font-size:13px;color:${C.faint};">Aún no has agregado a nadie.</div>`;
        b += `<div class="odv-emp-form-grid" style="display:grid;grid-template-columns:88px minmax(0,1fr) auto;gap:10px;align-items:flex-end;"><div><label style="${LBL}" for="f-empcode">Número</label>${input('f-empcode', 'newEmpCode', s.newEmpCode, '001', 'inputmode="numeric" ')}</div><div><label style="${LBL}" for="f-empname">Nombre del empleado</label>${input('f-empname', 'newEmpName', s.newEmpName, 'Ej: Franklin Henrriquez')}</div><button type="button" data-act="addEmp" class="odv-add-emp-btn" aria-label="Agregar empleado a la lista" style="height:48px;min-height:48px;padding:0 18px;border-radius:11px;border:none;background:${C.accent};color:${C.onAccent};font-size:13.5px;font-weight:600;cursor:pointer;display:flex;align-items:center;gap:7px;"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>Agregar</button></div>${empBlock}`;
    }
    if (su === 6) {
        /* Respaldo real llega en fase 3; por ahora solo se muestra la explicación. */
        b += `<div style="padding:16px;border-radius:12px;background:${C.panel2};border:1px dashed ${C.border};color:${C.dim};font-size:13px;line-height:1.55;">La vinculación con Google estará disponible más adelante. Sin ella, tus datos se guardan solo en este dispositivo; podrás hacerlo desde Ajustes → Datos.</div>`;
    }
    if (s._setupError) b += `<div role="alert" aria-live="assertive" style="margin-top:16px;padding:12px 15px;border-radius:11px;border:1px solid #ef4444;background:rgba(239,68,68,.09);color:#fca5a5;font-size:13px;line-height:1.5;">${esc(s._setupError)}</div>`;
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
/* ---------- guía: panel demo derecho (portado del prototipo) ---------- */
const SVG_CHK = '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7"/></svg>';
const SVG_CRX = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>';
const DEMO_PEOPLE = [
    { code: '001', name: 'Franklin Henrriquez', pos: 'Operador Ctk' },
    { code: '002', name: 'Pauliny Buchamps', pos: 'Capataz' },
    { code: '003', name: 'Varnet Gran Pierre', pos: 'Ayudante' }
];
const DEMO_ICONS = [
    '<path d="M13 3L5.5 13H10l-1 8 8.5-11H13z"/>',
    '<path d="M2.4 18a1 1 0 0 0 1 1h17.2a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1H3.4a1 1 0 0 0-1 1z"/><path d="M10.3 4.8h3.4"/><path d="M10.3 4.8L9.1 9.4M13.7 4.8l1.2 4.6"/><path d="M4 15v-2.7a6.1 6.1 0 0 1 6.1-6.1"/><path d="M13.9 6.2a6.1 6.1 0 0 1 6.1 6.1V15"/>',
    '<path d="M12 3.5l8 4v9l-8 4-8-4v-9z"/><path d="M4 7.5l8 4 8-4M12 11.5V20"/>'
];
const mono = "font-family:'IBM Plex Mono',monospace;";
function demoWelcome() {
    return `<div class="odv-glow" style="position:absolute;width:240px;height:240px;border-radius:50%;background:${C.accent};filter:blur(80px);"></div>`
        + `<div style="position:relative;display:flex;flex-direction:column;align-items:center;gap:20px;"><img src="icon-512.png" alt="" width="112" height="112" onerror="this.style.display='none'" style="width:112px;height:112px;border-radius:28px;display:block;"><div style="text-align:center;"><div style="font-size:17px;font-weight:700;">Control de Asistencia</div><div style="${mono}font-size:11.5px;color:${C.faint};margin-top:5px;">v1.7.0</div></div></div>`;
}
function demoAttendance(s) {
    const present = s.demoStates.filter(v => v === 'p').length;
    const hours = present * s.hours;
    const rows = DEMO_PEOPLE.map((d, n) => {
        const statusLabel = s.demoStates[n] === 'p' ? 'Presente' : s.demoStates[n] === 'a' ? 'Ausente' : 'Sin marcar';
        const mark = s.demoStates[n] === 'p'
            ? `<span style="position:absolute;inset:0;border-radius:10px;background:${C.good};color:${C.panel};display:flex;align-items:center;justify-content:center;">${SVG_CHK}</span>`
            : s.demoStates[n] === 'a'
                ? `<span style="position:absolute;inset:0;border-radius:10px;background:${C.bad};color:${C.panel};display:flex;align-items:center;justify-content:center;">${SVG_CRX}</span>` : '';
        return `<button type="button" data-act="demoRow" data-n="${n}" title="Clic para alternar: presente · ausente · sin marcar" aria-label="${esc(d.name)} (${esc(d.pos)}): ${statusLabel}. Clic para alternar." style="position:relative;overflow:hidden;display:flex;width:100%;align-items:center;gap:12px;padding:11px 13px;border:none;background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer;border-bottom:1px solid ${C.border};">`
            + `<span style="position:absolute;right:56px;top:50%;transform:translateY(-50%);color:${POS_COLORS[n % POS_COLORS.length]};opacity:.12;pointer-events:none;"><svg width="60" height="60" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6">${DEMO_ICONS[n]}</svg></span>`
            + `<span style="${mono}font-size:15px;font-weight:600;color:${POS_COLORS[n % POS_COLORS.length]};position:relative;">${esc(d.code)}</span>`
            + `<span style="flex:1;min-width:0;position:relative;"><span style="display:block;font-size:12.5px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(d.name)}</span><span style="display:block;font-size:10.5px;color:${C.faint};">${esc(d.pos)}</span></span>`
            + `<span style="position:relative;width:38px;height:38px;flex:none;"><span style="position:absolute;inset:0;border-radius:10px;border:1px dashed ${C.border};"></span>${mark}</span></button>`;
    }).join('');
    const stat = (label, value, barColor) => `<div style="flex:1;background:${C.panel};border:1px solid ${C.border};border-left:3px solid ${barColor};border-radius:10px;padding:11px 13px;"><div style="font-size:9.5px;letter-spacing:.07em;text-transform:uppercase;color:${C.faint};font-weight:600;">${label}</div><div style="${mono}font-size:22px;font-weight:700;line-height:1;margin-top:4px;">${value}</div></div>`;
    return `<div data-od-id="od-demo-attendance" style="position:relative;width:100%;max-width:330px;"><div style="display:flex;gap:9px;margin-bottom:14px;">${stat('Presentes', present, C.good)}${stat('Horas', hours + 'h', C.accent)}</div>`
        + `<div style="background:${C.panel};border:1px solid ${C.border};border-radius:12px;overflow:hidden;">${rows}</div>`
        + `<button type="button" data-act="markAll" title="Marca a los tres como presentes" aria-label="Marcar a todos los empleados como presentes" style="margin-top:13px;display:flex;width:100%;align-items:center;justify-content:center;gap:8px;height:40px;min-height:40px;border-radius:9px;border:none;background:${C.accent};color:${C.onAccent};font-size:12.5px;font-weight:600;cursor:pointer;"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12.5l4 4L14 8M12 16.5l2 2L20 10"/></svg>Marcar todos presentes</button></div>`;
}
function demoWeek(s) {
    const ST = { p: { c: C.good, g: '✓' }, a: { c: C.bad, g: '✕' }, f: { c: C.warn, g: 'F' } };
    const heads = ['L', 'M', 'X', 'J', 'V', 'S'].map(d => `<div style="text-align:center;font-size:9px;font-weight:600;color:${C.faint};">${d}</div>`).join('');
    let total = 0;
    const rows = s.weekData.map((r, rn) => {
        const hrs = r.pattern.filter(x => x === 'p').length * s.hours;
        total += hrs;
        const cells = r.pattern.map((cs, cn) => {
            const d = ST[cs];
            const cellStatus = cs === 'p' ? 'Presente' : cs === 'a' ? 'Ausente' : cs === 'f' ? 'Feriado' : 'Sin marcar';
            const fill = d ? `<span style="position:absolute;inset:0;border-radius:6px;background:${d.c};color:${C.panel};display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;">${d.g}</span>` : '';
            return `<button type="button" data-act="weekCell" data-r="${rn}" data-c="${cn}" title="Alternar: presente · ausente · feriado · sin marcar" aria-label="${DAY_NAMES[cn]} para empleado ${esc(r.code)}: ${cellStatus}. Clic para alternar." style="position:relative;height:28px;min-height:28px;border-radius:6px;background:${C.panel2};border:1px solid ${C.border};cursor:pointer;padding:0;font:inherit;color:inherit;">${fill}</button>`;
        }).join('');
        return `<div style="display:grid;grid-template-columns:62px repeat(6,1fr) 34px;gap:5px;align-items:center;margin-bottom:5px;"><span style="${mono}font-size:11.5px;color:${C.faint};">${esc(r.code)}</span>${cells}<span style="${mono}font-size:11px;font-weight:600;text-align:right;">${hrs}h</span></div>`;
    }).join('');
    return `<div data-od-id="od-demo-week" style="width:100%;max-width:330px;background:${C.panel};border:1px solid ${C.border};border-radius:12px;padding:14px;">`
        + `<div style="display:grid;grid-template-columns:62px repeat(6,1fr) 34px;gap:5px;margin-bottom:7px;"><div></div>${heads}<div style="text-align:right;font-size:9px;font-weight:600;color:${C.faint};">Tot</div></div>${rows}`
        + `<div style="margin-top:11px;padding-top:9px;border-top:1px dashed ${C.border};display:flex;align-items:center;gap:12px;font-size:9.5px;color:${C.faint};flex-wrap:wrap;"><span style="display:inline-flex;align-items:center;gap:4px;"><span style="width:8px;height:8px;border-radius:3px;background:${C.good};"></span>Presente</span><span style="display:inline-flex;align-items:center;gap:4px;"><span style="width:8px;height:8px;border-radius:3px;background:${C.bad};"></span>Ausente</span><span style="display:inline-flex;align-items:center;gap:4px;"><span style="width:8px;height:8px;border-radius:3px;background:${C.warn};"></span>Feriado</span><span style="margin-left:auto;">Clic en una celda para alternar</span></div>`
        + `<div style="margin-top:9px;display:flex;justify-content:space-between;font-size:11px;"><span style="color:${C.dim};">Total de la semana</span><span style="${mono}font-weight:700;color:${C.accent};">${total}h</span></div></div>`;
}
function demoPayroll() {
    const rows = ['Período', 'Deducciones', 'Bonificaciones', 'Vista previa'].map((label, n) =>
        `<div style="display:flex;align-items:center;gap:12px;background:${C.panel};border:1px solid ${C.border};border-radius:10px;padding:11px 13px;"><span style="width:22px;height:22px;flex:none;border-radius:50%;display:flex;align-items:center;justify-content:center;${mono}font-size:11px;font-weight:600;background:${C.good};color:${C.panel};">${n + 1}</span><span style="font-size:12.5px;font-weight:500;white-space:nowrap;">${label}</span><span style="margin-left:auto;width:20px;height:20px;border-radius:50%;background:${C.good};color:${C.panel};display:flex;align-items:center;justify-content:center;">${SVG_CHK.replace('17', '13')}</span></div>`).join('');
    return `<div data-od-id="od-demo-payroll" style="width:100%;max-width:330px;"><div style="display:grid;gap:8px;margin-bottom:16px;">${rows}</div>`
        + `<div style="background:${C.panel};border:1px solid ${C.border};border-radius:12px;padding:16px;"><div style="font-size:10px;letter-spacing:.07em;text-transform:uppercase;color:${C.faint};font-weight:600;">Neto a pagar</div><div id="cnt-net" style="${mono}font-size:26px;font-weight:700;color:${C.accent};margin-top:5px;line-height:1;">${money(48750)}</div><div style="font-size:11px;color:${C.faint};margin-top:6px;">7 empleados · 1 – 15 may 2026</div></div></div>`;
}
function demoPortfolio() {
    const debts = [
        { code: '004', name: 'Wadne Exilien', amount: 8660, pct: 100 },
        { code: '014', name: 'Wilson Riche', amount: 8400, pct: 97 },
        { code: '001', name: 'Franklin H.', amount: 8350, pct: 96 },
        { code: '002', name: 'Pauliny Buchamps', amount: 6400, pct: 74 }
    ];
    const rows = debts.map((d, n) =>
        `<div><div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:6px;"><span style="display:flex;align-items:center;gap:7px;font-size:11.5px;"><span style="${mono}font-size:10.5px;color:${C.faint};">${d.code}</span><span style="color:${C.dim};">${esc(d.name)}</span></span><span style="${mono}font-size:11.5px;font-weight:600;">${money(d.amount)}</span></div>`
        + `<div style="height:4px;border-radius:4px;background:${C.panel2};overflow:hidden;"><div style="height:100%;border-radius:4px;width:${d.pct}%;background:${n === 0 ? C.bad : (n < 3 ? C.warn : C.accent)};"></div></div></div>`).join('');
    return `<div data-od-id="od-demo-portfolio" style="width:100%;max-width:330px;background:${C.panel};border:1px solid ${C.border};border-radius:12px;padding:16px;"><div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:15px;"><span style="font-size:10px;letter-spacing:.07em;text-transform:uppercase;color:${C.faint};font-weight:600;">Saldo pendiente</span><span id="cnt-port" style="${mono}font-size:18px;font-weight:700;">${money(31810)}</span></div><div style="display:grid;gap:13px;">${rows}</div></div>`;
}
function demoReady() {
    const items = ['Marcar asistencia diaria', 'Revisar y corregir la semana', 'Generar y exportar nómina', 'Controlar préstamos del personal'].map(text =>
        `<div style="display:flex;align-items:center;gap:10px;background:${C.panel};border:1px solid ${C.border};border-radius:9px;padding:10px 13px;"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="${C.good}" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7"/></svg><span style="font-size:12.5px;color:${C.dim};">${text}</span></div>`).join('');
    return `<div class="odv-glow" style="position:absolute;width:210px;height:210px;border-radius:50%;background:${C.good};filter:blur(80px);"></div>`
        + `<div style="position:relative;width:100%;max-width:300px;display:grid;gap:10px;"><div style="display:flex;justify-content:center;margin-bottom:6px;"><div style="width:62px;height:62px;border-radius:50%;background:${C.good};color:${C.panel};display:flex;align-items:center;justify-content:center;"><svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7"/></svg></div></div>${items}</div>`;
}
function demoPanel(s) {
    const inner = [demoWelcome, demoAttendance, demoWeek, demoPayroll, demoPortfolio, demoReady][s.step - 1](s);
    return `<div data-od-id="od-demo-${s.step}" class="odv-demo-panel" style="position:relative;border-left:1px solid ${C.border};background:${C.bg};display:flex;align-items:center;justify-content:center;padding:32px;min-height:280px;overflow:hidden;">${inner}</div>`;
}
export function renderOnboarding(s, chrome = '') {
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
    const demo = demoPanel(s);
    const body = s.phase === 'guide' ? `<div class="odv-guide-grid" style="display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);min-height:434px;">${guideCopy(s)}${demo}</div>`
        : s.phase === 'choice' ? choiceSection(s)
        : s.phase === 'setup' ? setupSection(s)
        : readySection(s);
    const progress = (s.phase === 'guide' || s.phase === 'setup') ? { now: s.phase === 'guide' ? s.step : s.setupStep, max: STEPS.length } : null;
    return `<div class="od-wrap odv-wrap" style="min-height:100vh;min-height:100dvh;display:flex;align-items:center;justify-content:center;padding:28px;background:${C.bg};color:${C.text};"><div class="odv-card" style="position:relative;width:100%;max-width:980px;background:${C.panel};border:1px solid ${C.border};border-radius:22px;overflow:hidden;">${chrome}${topbar(stepCounter, s.phase === 'guide' && s.step < STEPS.length, progress)}${body}${footer(s, s.phase === 'guide', hint, nextLabel, s.phase === 'ready')}</div></div>`;
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
    demoRow: (s, el) => cycleDemo(s, parseInt(el.dataset.n, 10)),
    markAll: s => markAllPresent(s),
    weekCell: (s, el) => cycleWeek(s, parseInt(el.dataset.r, 10), parseInt(el.dataset.c, 10)),
    input: (s, el) => setField(s, el.dataset.field, el.value)
};
// Delegación para el host futuro: act = data-act (o 'input' para inputs[data-field]).
export function handleAction(act, el, state) {
    const fn = ACTIONS[act];
    return fn ? fn(state, el) : state;
}
