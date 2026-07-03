/**
 * 📝 NotesCenter — Template for the full-screen notes browser modal.
 *
 * Renders when state.showNotesCenter is true. Two views:
 *   - Employee list (when no employee is selected) — every employee that
 *     has at least one note, sorted by most recent note date.
 *   - Single-employee timeline (when state.notesCenterEmployeeId is set) —
 *     all notes for that employee, newest first, with a "+ Nueva nota" CTA.
 */

import { state } from '../../core/AppState.js';
import { formatDateShort } from '../../utils/DateUtils.js';
import icons from '../../ui/IconSystem.js';

export function NotesCenter() {
    if (!state.showNotesCenter) return '';

    // Group every attendance record that has a non-empty note by employee.
    const attendanceItems = Object.values(state.attendance || {});
    const notesByEmployee = new Map();

    attendanceItems.forEach(att => {
        if (att.deletedAt != null) return; // Fase 1 (U2c): un día borrado no muestra su nota vieja
        const note = (att.notes || '').trim();
        if (!note) return;
        if (!notesByEmployee.has(att.employeeId)) {
            notesByEmployee.set(att.employeeId, []);
        }
        notesByEmployee.get(att.employeeId).push({
            date: att.date,
            note
        });
    });

    // Sort notes within each employee, newest first.
    notesByEmployee.forEach(list => {
        list.sort((a, b) => b.date.localeCompare(a.date));
    });

    // Sort employees by most recent note date, then by number for ties.
    const employeesWithNotes = state.employees
        .filter(emp => notesByEmployee.has(emp.id))
        .sort((a, b) => {
            const aNotes = notesByEmployee.get(a.id) || [];
            const bNotes = notesByEmployee.get(b.id) || [];
            const aDate = aNotes[0] ? aNotes[0].date : '';
            const bDate = bNotes[0] ? bNotes[0].date : '';
            if (aDate !== bDate) return bDate.localeCompare(aDate);
            const aNum = parseInt(a.number, 10);
            const bNum = parseInt(b.number, 10);
            if (!Number.isNaN(aNum) && !Number.isNaN(bNum) && aNum !== bNum) return aNum - bNum;
            return String(a.number || '').localeCompare(String(b.number || ''), 'es', { numeric: true });
        });

    const selectedId = state.notesCenterEmployeeId;
    const selectedEmp = selectedId ? state.employees.find(e => e.id === selectedId) : null;
    const selectedNotes = selectedId ? (notesByEmployee.get(selectedId) || []) : [];

    return `
        <div class="modal-overlay" style="background: #0b1220; z-index: 10001;">
            <div style="position: fixed; inset: 0; display: flex; flex-direction: column; background: #0b1220;">
                <div style="display:flex; align-items:center; gap:12px; padding: 14px 16px; border-bottom: 1px solid #1f2a44; background: #0f172a;">
                    ${selectedEmp ? `
                        <button type="button" data-app-fn="backToNotesList" aria-label="Volver"
                                style="width: 36px; height: 36px; border-radius: 10px; border: 1px solid #334155; background: transparent; color: #e2e8f0; cursor: pointer; font-size: 1.1rem;">
                            ←
                        </button>
                    ` : `
                        <div style="width: 36px;"></div>
                    `}
                    <div style="flex:1;">
                        <div style="font-weight:700; color:#f1f5f9;">
                            ${selectedEmp ? `${selectedEmp.name}` : 'Notas de empleados'}
                        </div>
                        <div style="font-size:0.75rem; color:#94a3b8;">
                            ${selectedEmp ? `#${selectedEmp.number || ''}` : 'Solo empleados con notas'}
                        </div>
                    </div>
                    <button type="button" data-app-fn="closeNotesCenter" aria-label="Cerrar"
                            style="width: 36px; height: 36px; border-radius: 10px; border: 1px solid #334155; background: transparent; color: #e2e8f0; cursor: pointer; font-size: 1.1rem;">
                        ✕
                    </button>
                </div>

                <div style="flex: 1; overflow-y: auto; padding: 16px; background: #0b1220;">
                    ${!selectedEmp ? `
                        ${employeesWithNotes.length === 0 ? `
                            <div style="text-align:center; padding: 60px 20px; color:#94a3b8;">
                                <div style="font-size:3rem; margin-bottom:16px; opacity:0.4;">${icons.get('message')}</div>
                                <div style="font-size:1rem;">Aún no hay notas guardadas</div>
                            </div>
                        ` : employeesWithNotes.map(emp => {
        const lastNote = (notesByEmployee.get(emp.id) || [])[0];
        const preview = lastNote ? (lastNote.note.length > 60 ? `${lastNote.note.slice(0, 60)}...` : lastNote.note) : '';
        return `
                                <button type="button" data-app-fn="selectNotesEmployee" data-arg="${emp.id}"
                                        style="width: 100%;
                                               text-align: left;
                                               padding: 12px 14px;
                                               border-radius: 14px;
                                               border: 1px solid #1f2a44;
                                               background: #0f172a;
                                               color: #f1f5f9;
                                               cursor: pointer;
                                               margin-bottom: 10px;">
                                    <div style="display:flex; align-items:center; gap:10px;">
                                        <div style="width:36px; height:36px; border-radius:12px; background:#111827; display:flex; align-items:center; justify-content:center; font-weight:700; color:#06b6d4;">
                                            ${emp.number || ''}
                                        </div>
                                        <div style="flex:1;">
                                            <div style="font-weight:700;">${emp.name}</div>
                                            <div style="font-size:0.75rem; color:#94a3b8;">${lastNote ? formatDateShort(lastNote.date) : ''}</div>
                                        </div>
                                    </div>
                                    <div style="font-size:0.8rem; color:#cbd5e1; margin-top:8px;">
                                        ${preview}
                                    </div>
                                </button>
                            `;
    }).join('')}
                    ` : `
                        ${selectedNotes.length === 0 ? `
                            <div style="text-align:center; padding: 60px 20px; color:#94a3b8;">
                                <div style="font-size:2.5rem; margin-bottom:12px; opacity:0.4;">${icons.get('message')}</div>
                                <div style="font-size:0.95rem;">No hay notas para este empleado</div>
                            </div>
                        ` : selectedNotes.map(note => `
                            <div style="text-align:center; color:#64748b; font-size:0.75rem; margin: 10px 0;">
                                ${formatDateShort(note.date)}
                            </div>
                            <div role="button" tabindex="0" data-app-fn="openNoteEditor" data-arg="${selectedEmp.id}" data-arg2="${note.date}"
                                 style="max-width: 90%;
                                        background: #111827;
                                        border: 1px solid #1f2a44;
                                        color: #e2e8f0;
                                        border-radius: 18px;
                                        padding: 12px 14px;
                                        margin-bottom: 10px;">
                                <div style="white-space: pre-wrap; font-size: 0.9rem; line-height: 1.4;">
                                    ${note.note}
                                </div>
                            </div>
                        `).join('')}
                    `}
                </div>

                ${selectedEmp ? `
                    <div style="padding: 14px 16px; border-top: 1px solid #1f2a44; background: #0f172a;">
                        <button type="button" data-app-fn="openNewNote" data-arg="${selectedEmp.id}"
                                style="width: 100%;
                                       padding: 12px 14px;
                                       background: linear-gradient(135deg, #06b6d4, #10b981);
                                       border: none;
                                       border-radius: 12px;
                                       color: #000;
                                       font-weight: 800;
                                       cursor: pointer;">
                            + Nueva nota
                        </button>
                    </div>
                ` : ''}
            </div>
        </div>
    `;
}
