/**
 * SettingsTestsTab.js — Panel de pruebas del sistema en Configuración.
 *
 * Permite ejecutar la suite de pruebas con datos aislados directamente
 * desde el navegador, sin afectar datos reales del usuario.
 */

export function SettingsTestsTab() {
    return `
        <div class="stg-panel">
            <div class="stg-header" style="margin-bottom: 20px;">
                <div>
                    <h3>Pruebas del Sistema</h3>
                    <p>
                        Ejecuta la suite de pruebas automáticas con <strong style="color:#e2e8f0;">datos de prueba aislados</strong>.
                        Ninguna prueba toca tus empleados, asistencias ni préstamos reales.
                    </p>
                </div>
                <button
                    type="button"
                    data-settings-action="run-browser-tests"
                    class="btn btn-primary"
                    style="flex-shrink: 0; padding: 10px 20px; font-size: 0.875rem; white-space: nowrap;">
                    Ejecutar Pruebas
                </button>
            </div>

            <div id="browser-test-results" style="font-family: monospace;">
                <div class="stg-card" style="color: #475569; font-size: 0.8rem; text-align: center;">
                    Presiona "Ejecutar Pruebas" para iniciar la verificación del sistema.
                </div>
            </div>

            <section class="stg-card" aria-labelledby="modal-preview-title" style="margin-top:20px;">
                <h4 id="modal-preview-title" style="margin-top:0;">Vista previa segura de modales</h4>
                <p style="color:#94a3b8;font-size:.84rem;line-height:1.5;">Abre componentes reales con datos de ejemplo. Sus acciones están desconectadas: no guardan, suben ni borran información.</p>
                <div style="display:flex;flex-wrap:wrap;gap:8px;">
                    <button type="button" class="btn btn-secondary" data-settings-action="open-modal-preview" data-value="outgoing-conflict">Conflicto nube/local</button>
                    <button type="button" class="btn btn-secondary" data-settings-action="open-modal-preview" data-value="incoming-changes">Cambios entrantes</button>
                    <button type="button" class="btn btn-secondary" data-settings-action="open-modal-preview" data-value="restore-backup">Restaurar backup</button>
                </div>
            </section>
        </div>
    `;
}
