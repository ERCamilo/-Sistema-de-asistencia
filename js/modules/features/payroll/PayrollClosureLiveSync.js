import payrollClosureSync from './PayrollClosureSync.js';

let epoch = 0;
let unsubscribe = null;

export const PayrollClosureLiveSync = {
    start(options = {}) {
        this.stop();
        const myEpoch = epoch;
        const isCurrent = () => myEpoch === epoch;
        const rawUnsubscribe = payrollClosureSync.subscribeRecent(options.onApply, {
            limit: options.limit || 100,
            onError: options.onError,
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
    }
};

export default PayrollClosureLiveSync;
