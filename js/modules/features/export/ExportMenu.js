/**
 * 📤 ExportMenu — Template for the bottom-anchored export popover.
 *
 * Rendered when state.showExportMenu is true. Offers Share (FULL/MINI),
 * Import FULL, Download. Shows a loading spinner when state.isExporting.
 */

import { state } from '../../core/AppState.js';

export function ExportMenu() {
    if (!state.showExportMenu) return '';

    const data = state.exportMenuData;
    const canShare = true;
    const isLoading = state.isExporting;
    const showShareOptions = !!state.showShareOptions;

    return `
        <div class="modal-overlay animate-fade-in" ${isLoading ? '' : 'data-app-close-on-self="close-export-menu"'} style="background: rgba(0,0,0,0.3);">
            <div class="export-menu animate-slide-up"
                 data-app-stop-only="1"
                 style="position: fixed;
                        left: 50%;
                        bottom: 20px;
                        transform: translateX(-50%);
                        background: #1e293b;
                        border-radius: 16px;
                        padding: 8px;
                        box-shadow: 0 20px 60px rgba(0,0,0,0.5);
                        border: 1px solid #334155;
                        max-width: 90%;
                        width: 320px;
                        z-index: 10001;">

                ${isLoading ? `
                    <!-- Loading State -->
                    <div style="padding: 40px 20px; text-align: center;">
                        <div style="display: inline-block; width: 50px; height: 50px; border: 4px solid #334155; border-top-color: #06b6d4; border-radius: 50%; animation: spin 1s linear infinite;"></div>
                        <div style="margin-top: 16px; color: #94a3b8; font-weight: 600;">Procesando...</div>
                    </div>
                ` : `
                    <!-- Header -->
                    <div style="padding: 12px 16px; border-bottom: 1px solid #334155;">
                        <div style="font-size: 0.875rem; color: #94a3b8; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px;">
                            Exportar
                        </div>
                        <div style="font-size: 0.75rem; color: #64748b; margin-top: 4px; word-break: break-all;">
                            ${data.filename}
                        </div>
                    </div>

                    <!-- Opciones -->
                    <div style="padding: 4px;">
                        ${canShare ? `
                            <button type="button" data-app-fn="toggleShareOptions"
                                    class="export-menu-option"
                                    style="width: 100%;
                                           display: flex;
                                           align-items: center;
                                           gap: 12px;
                                           padding: 14px 16px;
                                           background: ${showShareOptions ? '#334155' : 'transparent'};
                                           border: none;
                                           border-radius: 12px;
                                           color: #f1f5f9;
                                           cursor: pointer;
                                           transition: all 0.2s;
                                           text-align: left;
                                           font-size: 0.9375rem;"
                                    onmouseover="this.style.background='#334155'"
                                    onmouseout="this.style.background='${showShareOptions ? '#334155' : 'transparent'}'">
                                <div style="width: 40px;
                                           height: 40px;
                                           background: linear-gradient(135deg, #06b6d4, #3b82f6);
                                           border-radius: 10px;
                                           display: flex;
                                           align-items: center;
                                           justify-content: center;
                                           font-size: 1.25rem;">
                                    📤
                                </div>
                                <div style="flex: 1;">
                                    <div style="font-weight: 600; color: #f1f5f9;">Compartir</div>
                                    <div style="font-size: 0.75rem; color: #94a3b8; margin-top: 2px;">Copiar datos al portapapeles</div>
                                </div>
                                <div style="color:#94a3b8;font-size:1rem;">${showShareOptions ? '▾' : '▸'}</div>
                            </button>

                            ${showShareOptions ? `
                                <div style="padding: 6px 8px 10px 60px; display: grid; gap: 6px;">
                                    <button type="button" data-app-fn="shareExportFull"
                                            style="width: 100%;
                                                   display: flex;
                                                   align-items: center;
                                                   gap: 10px;
                                                   padding: 10px 12px;
                                                   background: #0f172a;
                                                   border: 1px solid #334155;
                                                   border-radius: 10px;
                                                   color: #f1f5f9;
                                                   cursor: pointer;
                                                   transition: all 0.2s;
                                                   text-align: left;
                                                   font-size: 0.875rem;"
                                            onmouseover="this.style.borderColor='#06b6d4'"
                                            onmouseout="this.style.borderColor='#334155'">
                                        <span style="color:#06b6d4; font-weight:700;">FULL</span>
                                        <span style="font-size:0.75rem;color:#94a3b8;">Respaldo completo</span>
                                    </button>
                                    <button type="button" data-app-fn="shareExportMini"
                                            style="width: 100%;
                                                   display: flex;
                                                   align-items: center;
                                                   gap: 10px;
                                                   padding: 10px 12px;
                                                   background: #0f172a;
                                                   border: 1px solid #334155;
                                                   border-radius: 10px;
                                                   color: #f1f5f9;
                                                   cursor: pointer;
                                                   transition: all 0.2s;
                                                   text-align: left;
                                                   font-size: 0.875rem;"
                                            onmouseover="this.style.borderColor='#06b6d4'"
                                            onmouseout="this.style.borderColor='#334155'">
                                        <span style="color:#10b981; font-weight:700;">MINI</span>
                                        <span style="font-size:0.75rem;color:#94a3b8;">Formato compatible con Mini</span>
                                    </button>
                                </div>
                            ` : ''}
                        ` : ''}

                        <button type="button" data-app-fn="openImportFullModal"
                                class="export-menu-option"
                                style="width: 100%;
                                       display: flex;
                                       align-items: center;
                                       gap: 12px;
                                       padding: 14px 16px;
                                       background: transparent;
                                       border: none;
                                       border-radius: 12px;
                                       color: #f1f5f9;
                                       cursor: pointer;
                                       transition: all 0.2s;
                                       text-align: left;
                                       font-size: 0.9375rem;
                                       margin-top: ${canShare ? '4px' : '0'};"
                                onmouseover="this.style.background='#334155'"
                                onmouseout="this.style.background='transparent'">
                            <div style="width: 40px;
                                       height: 40px;
                                       background: linear-gradient(135deg, #f59e0b, #fbbf24);
                                       border-radius: 10px;
                                       display: flex;
                                       align-items: center;
                                       justify-content: center;
                                       font-size: 1.25rem;">
                                📥
                            </div>
                            <div style="flex: 1;">
                                <div style="font-weight: 600; color: #f1f5f9;">Importar FULL</div>
                                <div style="font-size: 0.75rem; color: #94a3b8; margin-top: 2px;">Pegar respaldo completo</div>
                            </div>
                        </button>

                        <button type="button" data-app-fn="performDownload"
                                class="export-menu-option"
                                style="width: 100%;
                                       display: flex;
                                       align-items: center;
                                       gap: 12px;
                                       padding: 14px 16px;
                                       background: transparent;
                                       border: none;
                                       border-radius: 12px;
                                       color: #f1f5f9;
                                       cursor: pointer;
                                       transition: all 0.2s;
                                       text-align: left;
                                       font-size: 0.9375rem;
                                       margin-top: 4px;"
                                onmouseover="this.style.background='#334155'"
                                onmouseout="this.style.background='transparent'">
                            <div style="width: 40px;
                                       height: 40px;
                                       background: linear-gradient(135deg, #10b981, #059669);
                                       border-radius: 10px;
                                       display: flex;
                                       align-items: center;
                                       justify-content: center;
                                       font-size: 1.25rem;">
                                💾
                            </div>
                            <div style="flex: 1;">
                                <div style="font-weight: 600; color: #f1f5f9;">Descargar</div>
                                <div style="font-size: 0.75rem; color: #94a3b8; margin-top: 2px;">Guardar en este dispositivo</div>
                            </div>
                        </button>
                    </div>

                    <!-- Botón Cancelar -->
                    <div style="padding: 8px 12px; border-top: 1px solid #334155; margin-top: 4px;">
                        <button type="button" data-app-fn="closeExportMenu"
                                style="width: 100%;
                                       padding: 10px;
                                       background: transparent;
                                       border: 1px solid #334155;
                                       border-radius: 8px;
                                       color: #94a3b8;
                                       cursor: pointer;
                                       font-weight: 600;
                                       transition: all 0.2s;"
                                onmouseover="this.style.background='#334155'; this.style.color='#f1f5f9'"
                                onmouseout="this.style.background='transparent'; this.style.color='#94a3b8'">
                            Cancelar
                        </button>
                    </div>
                `}
            </div>
        </div>
    `;
}
