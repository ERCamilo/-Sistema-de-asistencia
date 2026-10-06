/**
 * 🧠 LoanUiMemory — qué dejó desplegado el usuario en la pantalla principal de
 * Préstamos (solo en este dispositivo). Por defecto todo empieza plegado.
 *
 *   alertsOpen   «Avisos que necesitan una decisión»
 *   historyOpen  «Historial del saldo» y historyView (saldo / mes / periodo)
 *   asideCard    tarjeta abierta del resumen de cartera (null = ninguna)
 */

const KEY = 'loans-main-ui';

export function readLoanUiMemory() {
    try {
        const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(KEY) : null;
        const value = raw ? JSON.parse(raw) : {};
        return value && typeof value === 'object' ? value : {};
    } catch (_) {
        return {};
    }
}

export function saveLoanUiMemory(patch = {}) {
    try {
        if (typeof localStorage === 'undefined') return;
        localStorage.setItem(KEY, JSON.stringify({ ...readLoanUiMemory(), ...patch }));
    } catch (_) { /* sin almacenamiento: solo dura esta sesión */ }
}
