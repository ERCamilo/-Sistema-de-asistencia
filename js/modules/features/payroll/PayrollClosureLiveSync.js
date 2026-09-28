import payrollClosureSync from './PayrollClosureSync.js';

let epoch = 0;
let unsubscribe = null;
let unavailableReason = null;
let warnedMissingIndex = false;

export const PayrollClosureLiveSync = {
    start(options = {}) {
        this.stop();
        unavailableReason = null;
        const myEpoch = epoch;
        const isCurrent = () => myEpoch === epoch;
        const onError = error => {
            // Sin el índice compuesto, Firestore cierra el listener: no hay reintento
            // útil hasta desplegarlo. Un aviso por sesión; lo local sigue operativo.
            if (error?.code === 'PAYROLL_CLOSURE_INDEX_MISSING') {
                unavailableReason = error.code;
                if (!warnedMissingIndex) console.warn(error.message);
                warnedMissingIndex = true;
                return;
            }
            if (typeof options.onError === 'function') options.onError(error);
            else console.error('Payroll closure live sync failed:', error);
        };
        const rawUnsubscribe = payrollClosureSync.subscribeRecent(options.onApply, {
            limit: options.limit || 100,
            onError,
            isCurrent
        });
        unsubscribe = rawUnsubscribe;
        return () => this.stop();
    },

    stop() {
        epoch++;
        if (typeof unsubscribe === 'function') {
            try { unsubscribe(); } catch (error) {
                console.warn('Payroll closure unsubscribe failed:', error);
            }
        }
        unsubscribe = null;
    },

    isActive() {
        return typeof unsubscribe === 'function';
    },

    /** Motivo por el que la escucha remota quedó sin servicio (o null). */
    unavailableReason() {
        return unavailableReason;
    }
};

export default PayrollClosureLiveSync;
