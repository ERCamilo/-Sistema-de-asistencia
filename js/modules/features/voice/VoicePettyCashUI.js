import { escapeHTML, escapeAttr } from '../../utils/Sanitize.js';
import { voiceIcon } from './VoiceVisuals.js';
import { voiceBlocked } from './VoiceCore.js';

const fields = ['amount', 'concept', 'date', 'category', 'note', 'paidTo'];
function realDate(value) {
    const date = new Date(`${value}T12:00:00Z`);
    return /^\d{4}-\d{2}-\d{2}$/.test(value || '') && Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

// A separate presentation for the same petty-cash draft and saving operation.
export class VoicePettyCashUI {
    constructor(adapter) { this.adapter = adapter; this.generation = 0; }
    mount() {
        this.dialog = document.createElement('dialog');
        this.dialog.className = 'voice-dialog voice-cash-dialog';
        this.dialog.setAttribute('aria-label', 'Nuevo gasto de Caja Chica');
        document.body.append(this.dialog);
        this.dialog.addEventListener('cancel', event => { event.preventDefault(); if (!this.busy) this.run(() => this.cancel()); });
        this.dialog.addEventListener('keydown', event => { if (['Escape', 'Tab'].includes(event.key)) event.stopPropagation(); });
        this.dialog.addEventListener('click', event => {
            const button = event.target.closest('[data-cash-action]');
            if (button && !button.disabled) this.run(() => this.action(button.dataset.cashAction));
        });
        this.dialog.addEventListener('change', event => this.run(() => this.change(event.target)));
        this.dialog.addEventListener('input', event => {
            const field = event.target.dataset.cashField;
            if (!fields.includes(field) || this.busy) return;
            this.draft[field] = field === 'amount' ? event.target.value === '' ? null : Number(event.target.value) : event.target.value;
            this.record.dirty = true;
            this.updateReady();
        });
        this.unsubscribes = [this.adapter.subscribeSession, this.adapter.subscribeScope, this.adapter.subscribeEnabled].map(subscribe => subscribe?.(() => {
            if (!this.record) return;
            try { this.guard(); } catch (_) { this.close(); }
        }));
        this.onWipe = () => this.close(); window.addEventListener('sa:voice-wipe', this.onWipe);
        return this;
    }
    guard(generation = this.generation) {
        if (generation !== this.generation || !this.record) throw Error('El borrador ya no está abierto.');
        this.bridge.guard();
    }
    async run(callback) {
        const generation = this.generation;
        try { await callback(); } catch (error) {
            if (generation !== this.generation || !this.record) return;
            this.message = error.message; this.busy = false; this.render();
        }
    }
    async open(record, bridge) {
        this.close(); this.record = record; this.bridge = bridge; this.message = ''; this.busy = false;
        this.guard();
        const context = this.adapter.getContext();
        const source = record.result.pettyCash;
        const ambiguousDate = record.result.issues.some(issue => /date|fecha/i.test(issue.field || '') || /DATE|FECHA/.test(issue.code));
        record.cashDraft ||= {
            id: `voice-cash-${record.requestId}`, type: 'gasto', amount: source.amount,
            concept: source.concept || '', date: source.date || (ambiguousDate ? '' : record.context.localDate),
            note: source.note || '', paidTo: source.paidTo || '',
            category: context.categories.find(c => c.toLocaleLowerCase() === source.spokenCategory?.toLocaleLowerCase()) || '',
            periodId: context.selectedPeriodId || '', hasReceipt: false
        };
        this.draft = record.cashDraft;
        this.render(); this.dialog.showModal();
        await bridge.save();
    }
    close() {
        this.generation++; this.record = null; this.draft = null; this.proposal = null; this.busy = false;
        if (this.dialog?.open) this.dialog.close();
        this.dialog?.replaceChildren();
    }
    async cancel() {
        this.guard(); const bridge = this.bridge, generation = this.generation;
        this.busy = true; this.render();
        try { await this.adapter.discard?.(this.draft); this.guard(generation); await bridge.remove(); this.close(); }
        finally { if (generation === this.generation) this.busy = false; }
    }
    problem() {
        if (voiceBlocked(this.record?.result)) return 'La instrucción no permite registrar un gasto.';
        if (!(Number.isFinite(this.draft?.amount) && this.draft.amount > 0)) return 'Indica un monto mayor que cero.';
        if (!this.draft.concept.trim()) return 'Escribe el concepto.';
        if (!realDate(this.draft.date)) return 'Selecciona una fecha válida.';
        if (!this.adapter.getContext().categories.includes(this.draft.category)) return 'Selecciona la categoría.';
        const period = this.adapter.getContext().periods.find(p => p.id === this.draft.periodId);
        if (!period || !this.adapter.getContext().projects.some(p => p.id === period.projectId)) return 'Selecciona una caja y un periodo abierto.';
        if ((this.record.result.needsReview || this.record.result.issues.length) && !this.draft.reviewed) return 'Revisa los campos pendientes.';
        return '';
    }
    updateReady() {
        const problem = this.problem();
        const confirm = this.dialog.querySelector('[data-cash-action=save]');
        if (confirm) confirm.disabled = this.busy || !!problem;
        const hint = this.dialog.querySelector('[data-cash-hint]');
        if (hint) hint.textContent = problem;
    }
    async change(input) {
        if (!this.record || this.busy) return;
        this.guard();
        const generation = this.generation;
        if (input.matches('[data-cash-file]')) {
            const file = input.files?.[0]; if (!file) return;
            if (this.draft.pendingMovement) throw Error('Reintenta el registro pendiente antes de cambiar su comprobante.');
            this.busy = true; this.message = ''; this.render();
            try {
                const capture = await this.adapter.preparePhoto(file); this.guard(generation);
                this.draft.photoCapture = capture; this.draft.photoDataUrl = capture.processingDataUrl;
                this.draft.photoPreviewDataUrl = capture.previewDataUrl; this.draft.hasReceipt = true;
                this.draft.ocr = null; this.proposal = null;
                this.record.dirty = true; await this.bridge.save();
            } finally { if (generation === this.generation) { this.busy = false; this.render(); } }
            return;
        }
        if (input.dataset.cashPeriod !== undefined) this.draft.periodId = input.value;
        if (input.dataset.cashReviewed !== undefined) this.draft.reviewed = input.checked;
        if (fields.includes(input.dataset.cashField)) this.draft[input.dataset.cashField] = input.dataset.cashField === 'amount' ? input.value === '' ? null : Number(input.value) : input.value;
        this.record.dirty = true; await this.bridge.save(); this.guard(generation); this.updateReady();
    }
    async action(action) {
        if (this.busy) return;
        this.guard();
        if (action === 'cancel') return this.cancel();
        if (action === 'back') {
            if (this.draft.pendingMovement) throw Error('Reintenta el registro pendiente o cancela este borrador.');
            const generation = this.generation;
            await this.bridge.save(); this.guard(generation);
            const bridge = this.bridge; this.close(); bridge.back(); return;
        }
        if (action === 'remove-photo') {
            if (this.draft.pendingMovement) throw Error('Reintenta el registro pendiente antes de quitar su comprobante.');
            this.draft.photoCapture = null; this.draft.photoDataUrl = null; this.draft.photoPreviewDataUrl = null;
            this.draft.hasReceipt = false; this.draft.ocr = null; this.proposal = null;
            this.record.dirty = true; await this.bridge.save(); this.render(); return;
        }
        if (action === 'apply-ocr') {
            const selected = [...this.dialog.querySelectorAll('[data-cash-ocr]:checked')].map(input => input.dataset.cashOcr);
            const mapping = { amount: 'amount', description: 'concept', date: 'date', category: 'category', paidTo: 'paidTo' };
            for (const key of selected) if (mapping[key]) this.draft[mapping[key]] = this.proposal[key];
            // Fiscal details are accepted separately from the editable expense fields.
            if (selected.includes('fiscal')) this.draft.ocr = this.proposal.fiscal;
            this.record.dirty = true; this.proposal = null; await this.bridge.save(); this.render(); return;
        }
        const generation = this.generation;
        if (action === 'scan') {
            this.busy = true; this.message = 'Leyendo foto…'; this.render();
            try {
                const proposal = await this.adapter.scan(this.draft); this.guard(generation);
                this.proposal = proposal;
                this.message = proposal.got || proposal.description ? 'Elige qué datos aplicar.' : 'No se pudo leer la foto. Puedes completar el gasto a mano.';
            } finally { if (generation === this.generation) { this.busy = false; this.render(); } }
            return;
        }
        if (action === 'save') {
            const problem = this.problem(); if (problem) throw Error(problem);
            this.busy = true; this.message = 'Registrando…'; this.render();
            try {
                await this.bridge.save(); this.guard(generation);
                const movement = await this.adapter.save(this.draft, { requestId: this.record.requestId, guard: () => this.guard(generation) });
                this.guard(generation);
                if (!movement?.id) throw Error('El cargo no se pudo registrar. Conservamos el borrador.');
                // A failed audio cleanup must never turn a registered expense into another save.
                this.record.completedCashId = movement.id;
                try { await this.bridge.remove(); } catch (_) { this.adapter.notify?.('El cargo se guardó; el audio temporal no pudo eliminarse.', 'warning'); }
                this.close(); this.adapter.onSaved(movement);
            } finally { if (generation === this.generation) { this.busy = false; this.render(); } }
        }
    }
    render() {
        if (!this.record) return;
        const open = [...this.dialog.querySelectorAll('details[open]')].map(node => node.dataset.cashDetails);
        const context = this.adapter.getContext(), draft = this.draft;
        const button = (action, text) => `<button type="button" data-cash-action="${action}" ${this.busy ? 'disabled' : ''}>${text}</button>`;
        const input = (field, label, type = 'text') => `<label>${label}<input data-cash-field="${field}" type="${type}" value="${escapeAttr(draft[field] ?? '')}" ${this.busy ? 'disabled' : ''}></label>`;
        const options = `<option value="">Caja y periodo</option>${context.periods.map(period => `<option value="${escapeAttr(period.id)}" ${draft.periodId === period.id ? 'selected' : ''}>${escapeHTML(context.projects.find(project => project.id === period.projectId)?.name || context.projects.find(project => project.id === period.projectId)?.label || 'Caja')} · ${escapeHTML(period.label || 'Periodo')}</option>`).join('')}`;
        const warnings = this.record.result.issues.map(issue => `<p>${escapeHTML(issue.message)}</p>`).join('');
        const labels = { amount: 'Monto', description: 'Concepto', date: 'Fecha', category: 'Categoría', paidTo: 'Proveedor' };
        const proposal = this.proposal ? `<section class="voice-cash-proposal"><strong>Datos de la foto</strong>${Object.entries(labels).filter(([key]) => this.proposal[key] != null && this.proposal[key] !== '').map(([key, label]) => `<label><input type="checkbox" data-cash-ocr="${key}"> ${label}: ${escapeHTML(this.proposal[key])}</label>`).join('')}<label><input type="checkbox" data-cash-ocr="fiscal"> Datos del comprobante</label>${button('apply-ocr', 'Aplicar selección')}</section>` : '';
        this.dialog.innerHTML = `<header class="voice-header"><h2>${voiceIcon('receipt')} Caja chica <small>Voz</small></h2>${button('cancel', `${voiceIcon('close')}<span class="voice-sr">Cerrar</span>`)}</header><div class="voice-body voice-cash-body"><label class="voice-cash-amount"><span class="voice-sr">Monto en pesos dominicanos</span><span>RD$</span><input aria-label="Monto en pesos dominicanos" data-cash-field="amount" type="number" inputmode="decimal" step="0.01" min="0" value="${escapeAttr(draft.amount ?? '')}" ${this.busy ? 'disabled' : ''}></label>${input('concept', 'Concepto')}<div class="voice-cash-row">${input('date', 'Fecha', 'date')}<label>Categoría<select data-cash-field="category" ${this.busy ? 'disabled' : ''}><option value="">Seleccionar</option>${context.categories.map(category => `<option ${draft.category === category ? 'selected' : ''}>${escapeHTML(category)}</option>`).join('')}</select></label></div><label class="voice-cash-destination">${voiceIcon('building')}<select aria-label="Caja y periodo" data-cash-period ${this.busy ? 'disabled' : ''}>${options}</select></label><div class="voice-cash-photo">${draft.photoPreviewDataUrl ? `<img src="${escapeAttr(draft.photoPreviewDataUrl)}" alt="Comprobante adjunto"><div>${button('scan', 'Leer foto')}${button('remove-photo', 'Quitar')}</div>` : `<label class="voice-cash-photo-button">${voiceIcon('camera')} Agregar foto <span>Opcional</span><input data-cash-file type="file" accept="image/*" capture="environment" ${this.busy ? 'disabled' : ''}></label><label class="voice-cash-file">Elegir archivo<input data-cash-file type="file" accept="image/*,application/pdf" ${this.busy ? 'disabled' : ''}></label>`}</div>${proposal}<details data-cash-details="note"><summary>Nota y proveedor</summary>${input('note', 'Nota opcional')}${input('paidTo', 'Proveedor')}</details><details data-cash-details="text"><summary>Ver texto reconocido</summary><p>${escapeHTML(this.record.transcript)}</p>${this.bridge.back && !draft.pendingMovement ? button('back', 'Volver al audio') : ''}</details>${warnings || this.record.result.needsReview ? `<section class="voice-cash-review">${warnings}<label><input type="checkbox" data-cash-reviewed ${draft.reviewed ? 'checked' : ''} ${this.busy ? 'disabled' : ''}> Revisé los campos pendientes</label></section>` : ''}<p class="voice-cash-status" role="status">${escapeHTML(this.message || '')}</p></div><footer class="voice-footer">${button('cancel', 'Cancelar')}${button('save', `${voiceIcon('check')} Registrar gasto`)}<span data-cash-hint></span></footer>`;
        for (const key of open) this.dialog.querySelector(`[data-cash-details="${key}"]`)?.setAttribute('open', '');
        this.updateReady();
    }
    destroy() { this.close(); this.unsubscribes?.forEach(unsubscribe => unsubscribe?.()); window.removeEventListener('sa:voice-wipe', this.onWipe); this.dialog.remove(); }
}
