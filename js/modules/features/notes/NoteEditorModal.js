/**
 * 📝 NoteEditorModal — Template for the single-note edit modal.
 *
 * Rendered when state.showNoteModal is true. Wired through data-app-fn
 * to NotesController handlers (saveNoteModal, deleteNoteModal, closeNoteModal).
 */

import { state } from '../../core/AppState.js';
import { getDateKey } from '../../utils/DateUtils.js';

export function NoteEditorModal() {
    if (!state.showNoteModal) return '';

    const emp = state.employees.find(e => e.id === state.noteModalEmployeeId);
    const empName = emp ? `${emp.number || ''} - ${emp.name}` : 'Empleado';

    return `
        <div class="modal-overlay animate-fade-in" data-app-close-on-self="close-note-modal" style="background: rgba(0,0,0,0.45); z-index: 10002;">
            <div class="export-menu animate-slide-up"
                 data-app-stop-only="1"
                 style="position: fixed;
                        left: 50%;
                        top: 50%;
                        transform: translate(-50%, -50%);
                        background: #1e293b;
                        border-radius: 16px;
                        padding: 16px;
                        box-shadow: 0 20px 60px rgba(0,0,0,0.5);
                        border: 1px solid #334155;
                        max-width: 92%;
                        width: 520px;">
                <div style="font-size: 0.95rem; color: #f1f5f9; font-weight: 700; margin-bottom: 6px;">
                    Nota de asistencia
                </div>
                <div style="font-size: 0.75rem; color: #94a3b8; margin-bottom: 12px;">
                    ${empName}
                </div>

                <div style="display: grid; gap: 10px; margin-bottom: 12px;">
                    <div>
                        <label style="font-size: 0.75rem; color: #94a3b8; display:block; margin-bottom: 6px;">Fecha</label>
                        <input type="date"
                               value="${state.noteModalDate || getDateKey(new Date())}"
                               onchange="setNoteModalDate(this.value)"
                               style="width: 100%;
                                      background: #0f172a;
                                      color: #e2e8f0;
                                      border: 1px solid #334155;
                                      border-radius: 8px;
                                      padding: 8px 10px;
                                      font-size: 0.85rem;">
                    </div>
                    <div>
                        <label style="font-size: 0.75rem; color: #94a3b8; display:block; margin-bottom: 6px;">Nota</label>
                        <textarea
                            oninput="setNoteModalText(this.value)"
                            placeholder="Escribe la nota..."
                            style="width: 100%;
                                   min-height: 160px;
                                   resize: vertical;
                                   background: #0f172a;
                                   color: #e2e8f0;
                                   border: 1px solid #334155;
                                   border-radius: 10px;
                                   padding: 12px;
                                   font-size: 0.8rem;
                                   line-height: 1.4;
                                   outline: none;"
                        >${state.noteModalText || ''}</textarea>
                    </div>
                </div>

                <div style="display: flex; gap: 8px;">
                    <button type="button" data-app-fn="saveNoteModal"
                            style="flex: 1;
                                   padding: 10px 12px;
                                   background: linear-gradient(135deg, #06b6d4, #3b82f6);
                                   border: none;
                                   border-radius: 10px;
                                   color: #fff;
                                   font-weight: 700;
                                   cursor: pointer;">
                        Guardar
                    </button>
                    <button type="button" data-app-fn="deleteNoteModal"
                            style="padding: 10px 12px;
                                   background: #1e293b;
                                   border: 1px solid #ef4444;
                                   border-radius: 10px;
                                   color: #ef4444;
                                   font-weight: 700;
                                   cursor: pointer;">
                        Eliminar
                    </button>
                    <button type="button" data-app-fn="closeNoteModal"
                            style="flex: 1;
                                   padding: 10px 12px;
                                   background: transparent;
                                   border: 1px solid #334155;
                                   border-radius: 10px;
                                   color: #94a3b8;
                                   font-weight: 700;
                                   cursor: pointer;">
                        Cancelar
                    </button>
                </div>
            </div>
        </div>
    `;
}
