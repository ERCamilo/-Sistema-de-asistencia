import { MainSyncStore } from '../../services/MainSyncStore.js';
import payrollClosureStore from './PayrollClosureStore.js';
import { PayrollClosureConflictError } from './PayrollClosureMerge.js';
import { PayrollClosureRepository } from './PayrollClosureRepository.js';

export class PayrollClosureSync {
    constructor({
        localStore = payrollClosureStore,
        remoteRepository = PayrollClosureRepository,
        outbox = MainSyncStore
    } = {}) {
        this.localStore = localStore;
        this.remoteRepository = remoteRepository;
        this.outbox = outbox;
    }

    /** Closure, affected employees, and cloud intent share one local transaction. */
    async record(closure, { employees = [], schemaVersion = null, queuedAt = Date.now() } = {}) {
        return this.localStore.saveWithEmployees(closure, employees, {
            enqueueCloud: true,
            schemaVersion,
            queuedAt
        });
    }

    async pullPage(options = {}) {
        return this.remoteRepository.loadPage(options);
    }

    async pullDetail(id) {
        const closure = await this.remoteRepository.loadById(id);
        if (!closure) return null;
        return this.localStore.save(closure);
    }

    async pullPeriod(periodStart, periodEnd) {
        const closures = await this.remoteRepository.loadByPeriod(periodStart, periodEnd);
        return { closures, ...await this.importClosures(closures) };
    }

    async importClosures(closures = []) {
        const conflicts = [];
        let imported = 0;
        for (const closure of closures || []) {
            try {
                await this.localStore.save(closure);
                imported++;
            } catch (error) {
                if (!(error instanceof PayrollClosureConflictError)) throw error;
                conflicts.push({ id: closure?.id || null, error });
            }
        }
        return { imported, conflicts };
    }

    subscribeRecent(onApply = null, options = {}) {
        const onError = typeof options.onError === 'function'
            ? options.onError
            : error => console.error('Payroll closure live sync failed:', error);
        return this.remoteRepository.subscribeRecent(closures => {
            this.importClosures(closures)
                .then(result => {
                    if (typeof onApply === 'function') onApply(result);
                })
                .catch(onError);
        }, options);
    }
}

export const payrollClosureSync = new PayrollClosureSync();
export default payrollClosureSync;
