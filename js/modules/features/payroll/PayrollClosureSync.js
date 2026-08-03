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

    /** The durable local write always completes before its cloud intent is queued. */
    async record(closure) {
        const saved = await this.localStore.save(closure);
        await this.outbox.enqueuePayrollClosure(saved);
        return saved;
    }

    async pullPage(options = {}) {
        const page = await this.remoteRepository.loadPage(options);
        return { ...page, ...await this.importClosures(page.items) };
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
