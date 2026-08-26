/**
 * OnboardingActions.js — acciones REALES detrás de las cuatro opciones del
 * onboarding v2 (demo / scratch / backup / google). Todo acceso a servicios
 * reales llega inyectado en `deps`; los defaults se resuelven LAZY en el
 * momento de la llamada (nunca import app.js: riesgo de ciclo).
 *
 * Contrato: executeChoiceAction(source, state, deps?) → Promise<{completed, error?}>.
 */
import { loadDemoDataIntoDB } from '../../services/PersistenceService.js';
import { resetDomainData } from '../../services/DomainResetService.js';
import FirebaseService from '../../services/FirebaseService.js';
import { state } from '../../core/AppState.js';

export const COMPLETED_KEY = 'onboardingCompleted';
const GOOGLE_TIMEOUT_MS = 30000;

/* Clave compartida con el arranque real (app.js) y el reopen-safety del host:
 * marcarla equivale a "el usuario ya completó el onboarding". */
export function markCompleted(storage) {
    try { storage.setItem(COMPLETED_KEY, 'true'); } catch (e) { /* storage no disponible */ }
}

const errText = e => (e && e.message ? String(e.message) : String(e));

/* Defaults perezosos: se evalúan dentro de resolveDeps(), en call time. */
function resolveDeps(deps = {}) {
    return {
        loadBackupFromFile: deps.loadBackupFromFile || ((file, hooks) => window.loadBackupFromFile(file, hooks)),
        showConfirm: deps.showConfirm || (opts => new Promise(resolve => {
            window.showConfirm({ ...opts, onConfirm: () => resolve(true), onCancel: () => resolve(false) });
        })),
        hasAnyData: deps.hasAnyData || (() =>
            !!(state.employees.length || state.positions.length || state.leaders.length ||
               Object.keys(state.attendance || {}).length)),
        /* Reset total de dominio vía DomainResetService (positions/leaders/
         * employees/attendance/settings + coherencia), el mismo comportamiento
         * que tenía clearAllData en el wizard legacy. */
        clearData: deps.clearData || (async () => { resetDomainData(); }),
        loadDemoData: deps.loadDemoData || (() => loadDemoDataIntoDB()),
        loginWithGoogle: deps.loginWithGoogle || (() => FirebaseService.loginWithGoogle()),
        onAuthStateChanged: deps.onAuthStateChanged || (cb => FirebaseService.onAuthStateChanged(cb)),
        storage: deps.storage || localStorage
    };
}

async function runDemo(deps) {
    await deps.loadDemoData(); /* PersistenceService ya marca el modo demo interno */
    markCompleted(deps.storage);
    return { completed: true };
}

async function runScratch(deps) {
    if (deps.hasAnyData()) {
        const ok = await deps.showConfirm({
            title: '¿Borrar los datos actuales?',
            message: 'Empezar de cero eliminará todo lo registrado en este dispositivo: personal, asistencia y ajustes. Esta acción no se puede deshacer.',
            confirmText: 'Borrar y empezar de cero',
            type: 'danger'
        });
        if (!ok) return { completed: false };
    }
    await deps.clearData();
    markCompleted(deps.storage);
    return { completed: true };
}

/* El flag solo se marca vía onSuccess del hook; la cancelación (sin archivo)
 * resuelve silenciosamente sin marcar nada. */
function runBackup(deps) {
    return new Promise(resolve => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json';
        input.setAttribute('data-onb-v2-file', '');
        input.style.display = 'none';
        document.body.appendChild(input);
        const finish = result => {
            input.remove();
            resolve(result);
        };
        input.addEventListener('change', () => {
            const file = input.files && input.files[0];
            if (!file) { finish({ completed: false }); return; }
            deps.loadBackupFromFile(file, {
                onSuccess: () => { markCompleted(deps.storage); finish({ completed: true }); },
                onError: err => finish({ completed: false, error: errText(err) })
            });
        });
        input.addEventListener('cancel', () => finish({ completed: false }));
        input.click();
    });
}

/* Login popup + listener one-shot con guard de 30 s: el éxito exige confirmación
 * del auth state; error o timeout → {completed:false, error} sin notificar acá
 * (la UX la decide el host/arnés). */
async function runGoogle(deps) {
    let unsubscribe = null;
    const userReady = new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Tiempo de espera agotado al vincular la cuenta')), GOOGLE_TIMEOUT_MS);
        unsubscribe = deps.onAuthStateChanged(user => {
            if (!user) return;
            clearTimeout(timer);
            resolve(user);
        });
    });
    userReady.catch(() => {}); // sumidero: un timeout tardío no debe quedar sin manejar
    try {
        await deps.loginWithGoogle();
        await userReady;
        markCompleted(deps.storage);
        return { completed: true };
    } catch (err) {
        return { completed: false, error: errText(err) };
    } finally {
        if (typeof unsubscribe === 'function') unsubscribe();
    }
}

export async function executeChoiceAction(source, state, deps) {
    const d = resolveDeps(deps);
    switch (source) {
        case 'demo': return runDemo(d);
        case 'scratch': return runScratch(d);
        case 'backup': return runBackup(d);
        case 'google': return runGoogle(d);
        default: return { completed: false, error: 'Opción desconocida' };
    }
}
