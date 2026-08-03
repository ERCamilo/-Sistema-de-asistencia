import payrollClosureSync from './PayrollClosureSync.js';

let unsubscribe = null;

export const PayrollClosureLiveSync = {
    start(options = {}) {
        this.stop();
        unsubscribe = payrollClosureSync.subscribeRecent(options.onApply, {
            limit: options.limit || 100,
            onError: options.onError
        });
        return unsubscribe;
    },

    stop() {
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
