import {
    buildMiniAttendanceApplyPlan,
    excludeMiniAttendanceDraftRow,
    reviewMiniAttendanceConflict,
    reviewMiniAttendanceDraftRow
} from '../features/attendance/MiniAttendanceDraft.js';
import { isSafeBulkSaConflict } from '../features/attendance/MultiDayAttendanceResolver.js';

/** Presentation bridge to the shared comparison list. The pasted draft and its
 * canonical conflict plan remain authoritative; no P2P records are synthesized. */
export class MiniTextComparisonAdapter {
    constructor(controller) {
        this.controller = controller;
        this.stage = 'sa';
    }

    get workDates() { return [this.controller.draft.confirmedDate]; }
    get models() { return this.controller.buildReviewView().items; }
    get items() {
        return this.models.map(model => ({
            id: `text-${this.controller.reviewItemKey(model)}`,
            textReviewKey: this.controller.reviewItemKey(model),
            confirmed: model.confirmed,
            needsDetailedReview: model.probableDuplicate || model.isInactive ||
                !model.employee || model.sourceIndexes.length > 1 || model.existingBreakdown.length > 1 ||
                model.issue === 'identity' || model.issue === 'duplicate',
            saEmployeeId: model.employee?.id || null,
            workDate: this.workDates[0],
            status: model.employee ? 'resolved' : 'identity_conflict',
            displayName: model.employee?.name || model.occurrences[0]?.name || '',
            displayNumber: model.employee?.number || model.occurrences[0]?.number || '',
            normalHours: model.allocation.normalHours,
            overtimeHours: model.allocation.overtimeHours,
            adjustedAllocation: model.confirmed && model.decision?.action === 'use_imported' &&
                (model.appliedAllocation.normalHours !== model.allocation.normalHours ||
                    model.appliedAllocation.overtimeHours !== model.allocation.overtimeHours)
                ? model.appliedAllocation : null,
            sourceStatus: 'present',
            sources: model.occurrences.map(row => ({
                deviceId: 'Texto pegado', number: row.number, name: row.name,
                normalHours: row.totalHours, overtimeHours: 0
            }))
        }));
    }

    get summary() {
        const items = this.items;
        return {
            totalItems: items.length,
            resolvedCount: this.models.filter(model => model.confirmed).length,
            unresolvedIdentityCount: items.filter(item => !item.saEmployeeId).length,
            hoursConflictCount: 0
        };
    }

    getConsolidatedView() {
        return { mode: 'day', groups: [{ workDate: this.workDates[0], items: this.items }] };
    }

    getDayState(date) {
        if (date !== this.workDates[0]) return null;
        const controller = this.controller;
        const applied = controller.applyStatus === 'success';
        const ready = !controller.conflictPlan.hasBlockingIssues &&
            controller.applyStatus !== 'pending';
        return {
            date, status: applied ? 'applied' : ready ? 'ready' : 'stage_b_conflict',
            stageABlockers: [], canApply: ready && !applied,
            conflictPlan: controller.conflictPlan,
            applyPlan: ready ? buildMiniAttendanceApplyPlan(controller.conflictPlan, {
                expectedDraftRevision: controller.draft.revision
            }) : null
        };
    }

    getMultiDaySummary() {
        const day = this.getDayState(this.workDates[0]);
        return {
            totalDays: 1, workDates: this.workDates,
            readyDaysCount: day.status === 'ready' ? 1 : 0,
            appliedDaysCount: day.status === 'applied' ? 1 : 0
        };
    }

    assertEditable() {
        if (['pending', 'success'].includes(this.controller.applyStatus)) {
            throw new Error('La importación ya se está aplicando o fue aplicada.');
        }
    }

    resolveDayConflict(date, employeeId, { action, targetPositionId } = {}) {
        this.assertEditable();
        if (date !== this.workDates[0]) throw new Error('Fecha de revisión inválida.');
        const controller = this.controller;
        const model = this.models.find(candidate => candidate.employee?.id === employeeId);
        const item = this.items.find(candidate => candidate.saEmployeeId === employeeId);
        if (!model || item.needsDetailedReview) throw new Error('Resuelve esta fila en detalle.');
        model.sourceIndexes.forEach(index => {
            controller.draft = reviewMiniAttendanceDraftRow(controller.draft, index, { approved: true });
        });
        controller.rebuildConflictPlan();
        const rowIndex = controller.conflictPlan.rows.findIndex(row => row.employeeId === employeeId);
        controller.conflictPlan = reviewMiniAttendanceConflict(controller.conflictPlan, rowIndex, {
            action, acknowledged: true,
            ...(targetPositionId ? { targetPositionId } : {})
        });
        controller.resetApplyState();
    }

    resolveDaySafeBulkConflicts(date, action) {
        const controller = this.controller;
        const candidates = this.items.filter(item => !item.needsDetailedReview &&
            isSafeBulkSaConflict(item, controller.conflictPlan.rows.find(row =>
                row.employeeId === item.saEmployeeId), controller.employees));
        candidates.forEach(item => this.resolveDayConflict(date, item.saEmployeeId, { action }));
    }

    excludeItem(id) {
        this.assertEditable();
        const item = this.items.find(candidate => candidate.id === id);
        const model = this.models.find(candidate => this.controller.reviewItemKey(candidate) === item?.textReviewKey);
        if (!model) return;
        model.sourceIndexes.forEach(index => {
            this.controller.draft = excludeMiniAttendanceDraftRow(this.controller.draft, index);
        });
        this.controller.rebuildConflictPlan();
    }

    async applyDay(date) {
        if (!this.getDayState(date)?.canApply) throw new Error('Resuelve los pendientes antes de aplicar.');
        return this.controller.applyCurrentPlan();
    }

    async applyReadyDays() { return this.applyDay(this.workDates[0]); }
}
