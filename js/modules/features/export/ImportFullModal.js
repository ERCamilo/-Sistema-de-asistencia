/**
 * 📥 ImportFullModal — Template for the "paste FULL backup JSON" modal.
 *
 * Rendered when state.showImportFullModal is true. Submitting it calls
 * confirmImportFull (ExportController), which validates the JSON and
 * shows a confirm dialog before replacing all state.
 */

import { state } from '../../core/AppState.js';

export function ImportFullModal() {
    if (!state.showImportFullModal) return '';

    return `
        <div class="modal-overlay animate-fade-in" data-app-close-on-self="close-import-full" style="background: rgba(0,0,0,0.45); z-index: 10002;">
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
                    Importar datos FULL
                </div>
                <div style="font-size: 0.75rem; color: #94a3b8; margin-bottom: 12px;">
                    Pega aquí el JSON generado en Compartir FULL.
                </div>
                <textarea
                    oninput="setImportFullText(this.value)"
                    placeholder="{ ... }"
                    style="width: 100%;
                           min-height: 220px;
                           resize: vertical;
                           background: #0f172a;
                           color: #e2e8f0;
                           border: 1px solid #334155;
                           border-radius: 10px;
                           padding: 12px;
                           font-size: 0.8rem;
                           line-height: 1.4;
                           outline: none;"
                >${state.importFullText || ''}</textarea>

                <div style="display: flex; gap: 8px; margin-top: 12px;">
                    <button type="button" data-app-fn="confirmImportFull"
                            style="flex: 1;
                                   padding: 10px 12px;
                                   background: linear-gradient(135deg, #06b6d4, #3b82f6);
                                   border: none;
                                   border-radius: 10px;
                                   color: #fff;
                                   font-weight: 700;
                                   cursor: pointer;">
                        Aceptar
                    </button>
                    <button type="button" data-app-fn="closeImportFullModal"
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
