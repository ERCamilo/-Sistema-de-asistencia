/**
 * OnboardingCore.js — máquina de estados del onboarding v2 (puerto del prototipo
 * Onboarding-funcional.html). Puro: sin DOM ni estado global; cada acción muta el
 * estado recibido y lo devuelve para que el host decida cuándo persistir/renderizar.
 */
export const STEPS = [
    { kicker: 'Bienvenido', title: 'Tu obra, bajo control', body: 'Registra la jornada del equipo, calcula la nómina y lleva los préstamos — todo en un solo lugar, incluso sin señal.', tips: ['Funciona offline: los cambios se sincronizan solos', 'Pensado para usarse a pie de obra', 'Esta guía cubre asistencia, semana, nómina y cartera'] },
    { kicker: 'Paso 1 · Asistencia', title: 'Marca el día en un toque', body: 'Cada empleado tiene un solo botón. Un clic lo marca presente, otro lo pasa a ausente y un tercero lo deja sin marcar.', tips: ['«Marcar todos presentes» cierra el día completo', 'Las horas por defecto se ajustan arriba', 'El aviso te dice a quién falta marcar'] },
    { kicker: 'Paso 2 · Semana', title: 'Revisa la semana completa', body: 'La vista semanal muestra los seis días en una sola tabla. Haz clic en cualquier celda para alternar presente, ausente o feriado.', tips: ['El total de horas por empleado se calcula solo', 'Corrige días pasados sin salir de la tabla', 'El color indica el estado de un vistazo'] },
    { kicker: 'Paso 3 · Nómina', title: 'Genera la nómina en 4 pasos', body: 'Elige el período, define deducciones y bonificaciones, y revisa la vista previa antes de exportar.', tips: ['Los montos se recalculan al instante', 'Exporta a JSON para tu sistema de pagos', 'Puedes volver a cualquier paso sin perder datos'] },
    { kicker: 'Paso 4 · Cartera', title: 'Préstamos y adelantos claros', body: 'Registra préstamos por empleado, aplica abonos y consulta el saldo pendiente de toda la cartera.', tips: ['Cada abono actualiza el saldo al momento', 'Refinancia o salda un préstamo en un clic', 'El resumen nunca modifica saldos por sí solo'] },
    { kicker: 'Listo', title: 'Ya puedes empezar', body: 'Eso es todo lo que necesitas para operar. Puedes volver a esta guía desde Ajustes cuando quieras.', tips: ['Tus datos quedan guardados en el dispositivo', 'Invita a tus líderes para que marquen su cuadrilla', '¿Dudas? La guía sigue en Ajustes'] }
];
export const SETUP = [
    { kicker: 'Configuración · 1 de 6', title: '¿Cómo se llama la empresa o el proyecto?', body: 'Aparecerá en la cabecera, en los reportes y en la nómina que exportes.' },
    { kicker: 'Configuración · 2 de 6', title: '¿Qué días se trabaja cada semana?', body: 'Define la semana laboral por defecto. Podrás marcar excepciones y feriados cualquier día.' },
    { kicker: 'Configuración · 3 de 6', title: '¿Cuántas horas se trabajan al día?', body: 'Es el valor que se asigna al marcar presente. Siempre puedes ajustarlo por empleado.' },
    { kicker: 'Configuración · 4 de 6', title: 'Crea la primera posición', body: 'Las posiciones agrupan al personal y fijan la tarifa. Después puedes añadir todas las que necesites.' },
    { kicker: 'Configuración · 5 de 6', title: 'Agrega a tu primer empleado', body: 'Con uno basta para empezar a marcar asistencia. Puedes añadir más ahora o desde Personal.' },
    { kicker: 'Configuración · 6 de 6', title: 'Guarda tus datos en la nube', body: 'Vincula tu cuenta de Google para respaldar la información y recuperarla en otro dispositivo.' }
];
export const SETUP_TOTAL = SETUP.length;
export const DAY_LABELS = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];
export const DAY_NAMES = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
const STORAGE_KEY = 'onboarding-pos';
export function defaultState() {
    return {
        phase: 'guide', step: 1, setupStep: 1, source: null,
        company: '', days: [true, true, true, true, true, true, false], hours: 8,
        posName: '', posRate: '', posColorIdx: 0, employees: [], newEmpName: '', newEmpCode: '', googleConnected: false
    };
}
export function canAdvance(s) {
    if (s.phase === 'guide') return true;
    if (s.phase === 'choice') return !!s.source;
    if (s.phase === 'setup') {
        const su = s.setupStep;
        if (su === 1) return s.company.trim().length > 0;
        if (su === 2) return s.days.filter(Boolean).length > 0;
        if (su === 3) return s.hours > 0;
        if (su === 4) return s.posName.trim().length > 0;
        if (su === 5) return s.employees.length > 0;
        return true;
    }
    return false;
}
export function navNext(s) {
    if (!canAdvance(s)) return s;
    if (s.phase === 'guide') {
        if (s.step < STEPS.length) s.step++; else s.phase = 'choice';
    } else if (s.phase === 'choice') {
        if (s.source === 'scratch') { s.phase = 'setup'; s.setupStep = 1; } else s.phase = 'ready';
    } else if (s.phase === 'setup') {
        if (s.setupStep < SETUP_TOTAL) s.setupStep++; else s.phase = 'ready';
    }
    return s;
}
export function navBack(s) {
    if (s.phase === 'ready' || (s.phase === 'guide' && s.step === 1)) return s;
    if (s.phase === 'guide') s.step = Math.max(1, s.step - 1);
    else if (s.phase === 'choice') { s.phase = 'guide'; s.step = STEPS.length; }
    else if (s.phase === 'setup') {
        if (s.setupStep > 1) s.setupStep--; else s.phase = 'choice';
    }
    return s;
}
export function goGuideStep(s, n) { s.step = n; return s; }
export function toggleDay(s, i) { s.days[i] = !s.days[i]; return s; }
export function setHours(s, h) { s.hours = h; return s; }
export function hMinus(s) { s.hours = Math.max(1, s.hours - 1); return s; }
export function hPlus(s) { s.hours = Math.min(16, s.hours + 1); return s; }
export function setPosColor(s, n) { s.posColorIdx = n; return s; }
/* source acepta cualquier string; los valores del flujo son:
 * null | 'scratch' | 'backup' | 'google' | 'demo'. Solo 'scratch' entra a setup;
 * el resto va directo a listo (navNext). */
export function pick(s, src) { s.source = src; return s; }
/* Solo campos string del flujo: evita que un data-field del DOM toque colecciones. */
export function setField(s, f, v) {
    if (v != null && typeof s[f] === 'string') s[f] = String(v);
    return s;
}
/* Código automático: máximo número existente + 1, sin colisiones; si no hay números, longitud + 1. */
function nextEmployeeCode(employees) {
    const nums = employees.map(e => parseInt(e.code, 10)).filter(Number.isFinite);
    const taken = new Set(employees.map(e => e.code));
    let n = nums.length ? Math.max(...nums) + 1 : employees.length + 1;
    while (taken.has(String(n).padStart(3, '0'))) n++;
    return String(n).padStart(3, '0');
}
export function addEmployee(s) {
    const name = s.newEmpName.trim();
    if (!name) return s;
    const code = s.newEmpCode.trim() || nextEmployeeCode(s.employees);
    s.employees.push({ code, name, pos: s.posName.trim() || 'Sin posición' });
    s.newEmpName = '';
    s.newEmpCode = '';
    return s;
}
export function removeEmployee(s, code) {
    s.employees = s.employees.filter(e => e.code !== code);
    return s;
}
export function clearProgress(storage) {
    try { storage.removeItem(STORAGE_KEY); } catch (e) { /* storage no disponible */ }
}
export function saveProgress(storage, s) {
    try {
        if (!storage) return;
        if (s.phase === 'ready') { clearProgress(storage); return; }
        storage.setItem(STORAGE_KEY, JSON.stringify({ phase: s.phase, step: s.step, setupStep: s.setupStep }));
    } catch (e) { /* cuota o storage no disponible */ }
}
/* Restauración defensiva: JSON inválido o valores fuera de rango conservan el estado recibido. */
export function restoreProgress(storage, s) {
    try {
        const p = JSON.parse(storage.getItem(STORAGE_KEY) || 'null');
        if (!p || typeof p !== 'object') return s;
        const okG = p.phase === 'guide' && Number.isFinite(p.step) && p.step >= 1 && p.step <= STEPS.length;
        const okS = p.phase === 'setup' && Number.isFinite(p.setupStep) && p.setupStep >= 1 && p.setupStep <= SETUP_TOTAL;
        if (okG) { s.phase = 'guide'; s.step = p.step; }
        else if (p.phase === 'choice') s.phase = 'choice';
        else if (okS) { s.phase = 'setup'; s.setupStep = p.setupStep; }
    } catch (e) { /* JSON corrupto */ }
    return s;
}
