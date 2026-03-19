import { Modal } from '../components/Modal.js';
import { icons } from '../ui/IconSystem.js';

/**
 * 🛰️ SyncConflictModal - Interfaz para resolver inconsistencias de datos
 */
export class SyncConflictModal extends Modal {
    constructor(options = {}) {
        super({
            title: `${icons.get('alert')} Conflicto de Integridad de Datos`,
            size: 'medium',
            closable: false, // Forzar decisión
            ...options
        });
        
        this.error = options.error || '';
        this.supabaseService = options.supabaseService;
        this.onResolved = options.onResolved;
    }

    renderContent() {
        return `
            <div class="sync-conflict-container" style="padding: 10px;">
                <p style="color: #f87171; font-weight: 500; margin-bottom: 15px;">
                    Se ha detectado una inconsistencia crítica al intentar sincronizar los datos. 
                    Esto suele ocurrir cuando la base de datos local tiene registros que colisionan con los de la nube.
                </p>
                
                ${this.error ? `<div style="background: #1e293b; padding: 10px; border-radius: 8px; font-family: monospace; font-size: 0.85em; color: #94a3b8; margin-bottom: 20px; border-left: 4px solid #ef4444;">
                    ${this.error}
                </div>` : ''}

                <div class="sync-options-grid" style="display: grid; gap: 15px;">
                    <button class="sync-option-card" id="btn-force-cloud">
                        <div class="option-icon">${icons.get('download')}</div>
                        <div class="option-info">
                            <strong>Usar datos de la NUBE (Recomendado)</strong>
                            <p>Borra tus datos locales y descarga todo de Supabase. Soluciona la mayoría de errores.</p>
                        </div>
                    </button>

                    <button class="sync-option-card" id="btn-force-local">
                        <div class="option-icon">${icons.get('upload')}</div>
                        <div class="option-info">
                            <strong>Usar datos LOCALES</strong>
                            <p>Tus datos actuales reemplazarán a los de la nube. Cuidado si usas varios dispositivos.</p>
                        </div>
                    </button>

                    <button class="sync-option-card" id="btn-retry-merge">
                        <div class="option-icon">${icons.get('sync')}</div>
                        <div class="option-info">
                            <strong>Reintentar Combinar (Merge)</strong>
                            <p>Intenta fusionar los datos de nuevo con una limpieza profunda.</p>
                        </div>
                    </button>

                    <button class="sync-option-card" id="btn-disconnect">
                        <div class="option-icon">${icons.get('cloud-off')}</div>
                        <div class="option-info">
                            <strong>Desconectar Nube</strong>
                            <p>Deja de sincronizar y trabaja solo de forma local.</p>
                        </div>
                    </button>
                </div>
                
                <div id="sync-loading-overlay" style="display: none; position: absolute; inset: 0; background: rgba(15, 23, 42, 0.8); backdrop-filter: blur(4px); align-items: center; justify-content: center; flex-direction: column; z-index: 10;">
                    <div class="spinner"></div>
                    <p id="sync-status-text" style="margin-top: 15px; font-weight: 500;">Procesando...</p>
                </div>
            </div>

            <style>
                .sync-option-card {
                    display: flex;
                    align-items: center;
                    gap: 15px;
                    background: #1e293b;
                    border: 1px solid #334155;
                    border-radius: 12px;
                    padding: 15px;
                    text-align: left;
                    cursor: pointer;
                    transition: all 0.2s;
                    color: inherit;
                    width: 100%;
                }
                .sync-option-card:hover {
                    background: #334155;
                    border-color: #6366f1;
                    transform: translateY(-2px);
                }
                .option-icon {
                    font-size: 1.5em;
                    color: #6366f1;
                    background: rgba(99, 102, 241, 0.1);
                    padding: 10px;
                    border-radius: 10px;
                }
                .option-info strong { display: block; margin-bottom: 4px; color: #f1f5f9; }
                .option-info p { margin: 0; font-size: 0.85em; color: #94a3b8; }
                
                .spinner {
                    width: 40px;
                    height: 40px;
                    border: 4px solid rgba(255,255,255,0.1);
                    border-left-color: #6366f1;
                    border-radius: 50%;
                    animation: spin 1s linear infinite;
                }
                @keyframes spin { to { transform: rotate(360deg); } }
            </style>
        `;
    }

    onOpen() {
        this.updateContent(this.renderContent());
        
        const overlay = this.element.querySelector('#sync-loading-overlay');
        const statusText = this.element.querySelector('#sync-status-text');
        
        const setStatus = (text) => {
            overlay.style.display = 'flex';
            statusText.innerText = text;
        };

        // Forzar Nube
        this.element.querySelector('#btn-force-cloud').onclick = async () => {
            if (!confirm('Esta acción borrará tus datos locales actuales. ¿Continuar?')) return;
            setStatus('Limpiando base de datos local...');
            try {
                await this.supabaseService.forceDownloadContents();
                this.close();
                if (this.onResolved) this.onResolved('cloud');
            } catch (err) {
                alert('No se pudo completar la acción: ' + err.message);
                overlay.style.display = 'none';
            }
        };

        // Forzar Local
        this.element.querySelector('#btn-force-local').onclick = async () => {
            if (!confirm('Tus datos locales SOBREESCRIBIRÁN la nube. ¿Estás seguro?')) return;
            setStatus('Subiendo datos locales...');
            try {
                await this.supabaseService.forceUploadContents();
                this.close();
                if (this.onResolved) this.onResolved('local');
            } catch (err) {
                alert('Error al subir: ' + err.message);
                overlay.style.display = 'none';
            }
        };

        // Reintentar Merge
        this.element.querySelector('#btn-retry-merge').onclick = async () => {
            setStatus('Intentando combinación limpia...');
            try {
                await this.supabaseService.retryMerge();
                this.close();
                if (this.onResolved) this.onResolved('merge');
            } catch (err) {
                alert('El merge volvió a fallar. Por favor elige una de las opciones de reemplazo total.');
                overlay.style.display = 'none';
            }
        };

        // Desconectar
        this.element.querySelector('#btn-disconnect').onclick = () => {
            if (confirm('¿Deseas trabajar solo en modo local? La nube se desactivará.')) {
                window.state.useSupabase = false;
                window.localStorage.setItem('useSupabase', 'false');
                this.close();
                location.reload(); // Recargar para aplicar cambios
            }
        };
    }
}
