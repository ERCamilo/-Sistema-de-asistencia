import { Modal } from '../../components/Modal.js';
import { getState, context } from '../../features/employees/EmployeesUI.js';
import { positionsChanged } from '../../features/employees/Employee.js';
import icons from '../../ui/IconSystem.js';
import { swapEmployeeNumbers, mergeEmployees, enqueueCloudEmployeeDelete } from '../../services/PersistenceService.js';
import { toStoredHourly, fromStoredHourly } from '../../features/payroll/SalaryConversion.js';
import { collectPositionDays, reassignPositionDays } from '../../services/AttendancePositionAudit.js';
import { escapeHTML } from '../../utils/Sanitize.js';
import { stateManager, buildAttendanceIndex } from '../../core/AppState.js';

export class EmployeeModal {
    static open(employeeId = null) {
        const state = getState();
        const emp = employeeId ? (state.employees.find(e => e.id === employeeId) || state.employees.find(e => e.key === employeeId)) : null;
        const isEdit = !!emp;
        const mainTitle = isEdit ? 'Editar Empleado' : 'Nuevo Empleado';
        const subtitle = isEdit ? emp.name : null;

        // Lógica de número sugerido
        const suggestedNumber = isEdit ? emp.number : (() => {
            const maxNum = Math.max(0, ...state.employees.map(e => parseInt(e.number) || 0));
            return String(maxNum + 1).padStart(3, '0');
        })();

        // Estado temporal para sueldos personalizados (se limpia al cerrar o se aplica al guardar)
        state.tempPositionSalaries = emp?.positionSalaries || {};
        state.tempPositionSalaryModes = emp?.positionSalaryModes || {};
        state.showOptionalFields = !!(emp?.phone || emp?.email || emp?.notes);

        const hireDateValue = emp?.hireDate || new Date().toISOString().split('T')[0];
        const regularHours = state.settings.regularHoursPerDay || 8;

        const contentHTML = `
            <div style="max-height: 70vh; overflow-y: auto; padding-right: 8px;" id="employee-modal-form">
                <div class="form-group">
                    <label class="form-label" style="display: flex; align-items: center; justify-content: space-between;">
                        <span>🔢 Número de Empleado</span>
                        ${!isEdit ? `<span id="auto-gen-badge" style="background: rgba(16, 185, 129, 0.1); color: #10b981; border: 1px solid rgba(16, 185, 129, 0.2); padding: 2px 8px; border-radius: 99px; font-size: 0.65rem; font-weight: 700; animation: pulse 2s infinite;">✨ GENERADO AUTOMÁTICAMENTE</span>` : ''}
                    </label>
                    <input type="text" id="empNumber" class="form-input" 
                           value="${suggestedNumber}" 
                           placeholder="001" 
                           required 
                           pattern="[0-9A-Za-z-]+" 
                           maxlength="10"
                           style="${!isEdit ? 'border-color: rgba(16, 185, 129, 0.5); background: rgba(16, 185, 129, 0.05); color: #10b981; font-weight: 700;' : ''}">
                </div>
                
                <div class="form-group">
                    <label class="form-label">📝 Nombre Completo *</label>
                    <input type="text" id="empName" class="form-input" value="${emp?.name || ''}" placeholder="Ej: Miguel Rodríguez" required>
                </div>
                
                <div class="form-group">
                    <label class="form-label">📅 Fecha de Contratación</label>
                    <input type="date" id="empHireDate" class="form-input" value="${hireDateValue}">
                </div>
                
                <div class="form-group">
                    <label class="form-label">🎯 Posiciones Asignadas * (Selecciona al menos una)</label>
                    <div style="display: flex; flex-direction: column; gap: 8px; margin-top: 10px; max-height: 250px; overflow-y: auto; padding-right: 4px;">
                        ${state.positions.filter(p => p.active || emp?.positions?.includes(p.id)).map(pos => {
                            const isChecked = emp?.positions?.includes(pos.id);
                            const posSalary = pos.hourlyRate || 0;
                            const storedCustom = state.tempPositionSalaries[pos.id];
                            const rowMode = state.tempPositionSalaryModes[pos.id] === 'daily' ? 'daily' : 'hourly';
                            const customSalary = storedCustom
                                ? Math.round(fromStoredHourly(storedCustom, rowMode, regularHours) * 100) / 100
                                : '';

                            return `
                                <div style="background: #1e293b; padding: 12px; border-radius: 10px; border: 1px solid ${isChecked ? '#334155' : '#1e293b'}; transition: all 0.2s;" class="position-selection-card">
                                    <label class="form-checkbox" style="cursor: pointer; margin-bottom: 0; display: flex; align-items: center; gap: 10px;">
                                        <input type="checkbox" name="empPosition" value="${pos.id}" ${isChecked ? 'checked' : ''} class="position-checkbox">
                                        <span style="display: flex; align-items: center; gap: 10px; flex: 1;">
                                            <span style="width: 12px; height: 12px; border-radius: 50%; background: ${pos.color}; flex-shrink: 0; box-shadow: 0 0 10px ${pos.color}44;"></span>
                                            <span style="font-size: 0.9rem; font-weight: 600; color: #f1f5f9;">${pos.name}</span>
                                            <span style="margin-left: auto; font-size: 0.75rem; color: #94a3b8;">$${posSalary.toLocaleString()}/h</span>
                                        </span>
                                    </label>
                                    <div class="custom-salary-container" style="display: ${isChecked ? 'block' : 'none'}; margin-top: 10px; padding-top: 10px; border-top: 1px solid rgba(255,255,255,0.05); margin-left: 26px;">
                                        <label style="font-size: 0.7rem; color: #64748b; display: block; margin-bottom: 6px;">
                                            💰 Tarifa personalizada p/ esta posición (opcional):
                                        </label>
                                        <div style="display: flex; gap: 6px; align-items: center;">
                                            <div style="position: relative; flex: 1;">
                                                <span style="position: absolute; left: 10px; top: 50%; transform: translateY(-50%); color: #64748b; font-size: 0.8rem;">$</span>
                                                <input type="number" inputmode="decimal"
                                                       class="form-input custom-salary-input"
                                                       style="font-size: 0.8rem; padding: 6px 10px 6px 22px; background: #0f172a; width: 100%;"
                                                       data-pos-id="${pos.id}"
                                                       value="${customSalary}"
                                                       placeholder="Usar base: $${posSalary.toLocaleString()}"
                                                       min="0"
                                                       step="any">
                                            </div>
                                            <select class="custom-salary-mode" data-pos-id="${pos.id}" style="font-size: 0.72rem; padding: 6px 4px; background: #0f172a; border: 1px solid #334155; border-radius: 6px; color: #94a3b8;">
                                                <option value="hourly" ${rowMode === 'hourly' ? 'selected' : ''}>por hora</option>
                                                <option value="daily" ${rowMode === 'daily' ? 'selected' : ''}>por día</option>
                                            </select>
                                        </div>
                                    </div>
                                </div>
                            `;
                        }).join('')}
                    </div>
                </div>
                
                <!-- Botón para expandir campos opcionales -->
                <div style="margin: 20px 0;">
                    <button type="button" id="toggleOptionalBtn"
                            style="width: 100%; padding: 12px; background: rgba(30, 41, 59, 0.5); border: 1px dashed #334155; border-radius: 10px; color: #94a3b8; cursor: pointer; font-size: 0.8rem; font-weight: 600; transition: all 0.2s; display: flex; align-items: center; justify-content: center; gap: 8px;">
                        <span id="optionalIcon">${state.showOptionalFields ? '▼' : '▶'}</span>
                        <span>${state.showOptionalFields ? 'Ocultar' : 'Mostrar'} campos opcionales</span>
                        <span style="opacity: 0.5; font-weight: 400;">(teléfono, email, notas)</span>
                    </button>
                </div>
                
                <!-- Campos opcionales colapsables -->
                <div id="optionalFieldsContainer" style="display: ${state.showOptionalFields ? 'block' : 'none'}; animation: fadeIn 0.3s ease-out;">
                    <div class="form-group">
                        <label class="form-label">📞 Teléfono</label>
                        <input type="tel" id="empPhone" class="form-input" value="${emp?.phone || ''}" placeholder="+1-809-555-1234">
                    </div>
                    
                    <div class="form-group">
                        <label class="form-label">📧 Correo Electrónico</label>
                        <input type="email" id="empEmail" class="form-input" value="${emp?.email || ''}" placeholder="empleado@ejemplo.com">
                    </div>
                    
                    <div class="form-group">
                        <label class="form-label">📝 Notas Internas</label>
                        <textarea id="empNotes" class="form-textarea" placeholder="Habilidades, observaciones, historial..." style="min-height: 80px;">${emp?.notes || ''}</textarea>
                    </div>
                </div>
                
                ${isEdit ? `
                    <div style="margin-top: 16px; padding: 12px; background: rgba(6, 182, 212, 0.05); border-radius: 10px; border: 1px solid rgba(6, 182, 212, 0.1);">
                        <div style="font-size: 0.65rem; color: #06b6d4; margin-bottom: 6px; text-transform: uppercase; font-weight: 800; letter-spacing: 0.05em;">
                            Metadatos del Sistema
                        </div>
                        <div style="display: flex; flex-direction: column; gap: 4px; font-size: 0.75rem;">
                            <div style="display: flex; justify-content: space-between;"><span style="color: #64748b;">ID Interno:</span> <span style="color: #94a3b8; font-family: monospace;">${emp.id}</span></div>
                            <div style="display: flex; justify-content: space-between;"><span style="color: #64748b;">Estado:</span> <span style="color: ${emp.active ? '#10b981' : '#f43f5e'}; font-weight: 700;">${emp.active ? 'ACTIVO' : 'INACTIVO'}</span></div>
                        </div>
                    </div>
                ` : ''}
            </div>
        `;

        const modal = new Modal({
            title: `👤 ${mainTitle}`,
            subtitle: subtitle,
            content: contentHTML,
            size: 'medium',
            buttons: [
                { text: 'Cancelar', class: 'btn-secondary', onClick: function() { this.close(); } },
                { text: '💾 Guardar Empleado', class: 'btn-primary', onClick: function() { EmployeeModal.save(this, emp); } }
            ]
        });

        modal.open();

        // Listeners Locales
        const body = modal.element;
        
        // Toggle campos opcionales
        const toggleBtn = body.querySelector('#toggleOptionalBtn');
        const optionalContainer = body.querySelector('#optionalFieldsContainer');
        const optionalIcon = body.querySelector('#optionalIcon');
        
        toggleBtn.addEventListener('click', () => {
            state.showOptionalFields = !state.showOptionalFields;
            optionalContainer.style.display = state.showOptionalFields ? 'block' : 'none';
            optionalIcon.textContent = state.showOptionalFields ? '▼' : '▶';
            toggleBtn.querySelector('span:nth-child(2)').textContent = `${state.showOptionalFields ? 'Ocultar' : 'Mostrar'} campos opcionales`;
        });

        // Checkboxes de posición
        body.querySelectorAll('.position-checkbox').forEach(cb => {
            cb.addEventListener('change', (e) => {
                const card = e.target.closest('.position-selection-card');
                const customContainer = card.querySelector('.custom-salary-container');
                
                if (e.target.checked) {
                    customContainer.style.display = 'block';
                    card.style.borderColor = '#334155';
                } else {
                    customContainer.style.display = 'none';
                    card.style.borderColor = '#1e293b';
                    // Limpiar valor si se desactiva
                    customContainer.querySelector('.custom-salary-input').value = '';
                }
            });
        });

        // Toggle hora/día por puesto: al cambiar el modo, convierte el monto de esa fila
        // para que el pago real no cambie. Se guarda siempre por hora.
        body.querySelectorAll('.custom-salary-mode').forEach(sel => {
            let prevMode = sel.value;
            sel.addEventListener('change', () => {
                const input = body.querySelector(`.custom-salary-input[data-pos-id="${sel.dataset.posId}"]`);
                const cur = input ? Number.parseFloat(input.value) : NaN;
                if (input && Number.isFinite(cur)) {
                    const hourly = toStoredHourly(cur, prevMode, regularHours);
                    input.value = Math.round(fromStoredHourly(hourly, sel.value, regularHours) * 100) / 100;
                }
                prevMode = sel.value;
            });
        });

        // Input de número (remediar el estilo si el usuario escribe)
        const numInput = body.querySelector('#empNumber');
        numInput.addEventListener('input', () => {
            if (numInput.value !== suggestedNumber) {
                numInput.style.borderColor = '';
                numInput.style.background = '';
                numInput.style.color = '';
                numInput.style.fontWeight = '';
                const badge = body.querySelector('#auto-gen-badge');
                if (badge) badge.style.display = 'none';
            }
        });
    }

    static save(modalInstance, existingEmp) {
        const el = modalInstance.element;
        const number = el.querySelector('#empNumber').value.trim();
        const name = el.querySelector('#empName').value.trim();
        const hireDate = el.querySelector('#empHireDate').value;
        const phone = el.querySelector('#empPhone').value.trim();
        const email = el.querySelector('#empEmail').value.trim();
        const notes = el.querySelector('#empNotes').value.trim();
        
        const selectedPositions = Array.from(el.querySelectorAll('input[name="empPosition"]:checked')).map(cb => cb.value);
        
        // Validaciones
        if (!number) return window.showAlert('El número de empleado es obligatorio', 'error');
        if (!name) return window.showAlert('El nombre es obligatorio', 'error');
        if (selectedPositions.length === 0) return window.showAlert('Debes asignar al menos una posición', 'error');

        const state = getState();

        // Sueldos personalizados (común a todos los caminos)
        const regularHours = state.settings.regularHoursPerDay || 8;
        const positionSalaries = {};
        const positionSalaryModes = {};
        el.querySelectorAll('.custom-salary-input').forEach(input => {
            const raw = parseFloat(input.value);
            if (!isNaN(raw) && raw > 0) {
                const posId = input.dataset.posId;
                const modeSel = el.querySelector(`.custom-salary-mode[data-pos-id="${posId}"]`);
                const mode = modeSel?.value === 'daily' ? 'daily' : 'hourly';
                // Se guarda SIEMPRE por hora; si el modo es 'día', se convierte.
                positionSalaries[posId] = toStoredHourly(raw, mode, regularHours);
                if (mode === 'daily') positionSalaryModes[posId] = 'daily';
            }
        });

        // Decisiones del modal de impacto por posiciones removidas con
        // historial (llenadas por _showPositionRemovalImpact). Viven acá para
        // que TODOS los caminos de guardado (normal, intercambio, fusión) las
        // apliquen exactamente una vez, dentro de applyFields.
        let _reassignDecisions = [];
        const _reassignTouchedDates = [];

        // Aplica los campos del formulario al empleado (existente o nuevo) con
        // el número indicado. Devuelve el id del empleado afectado.
        const applyFields = (numberToUse) => {
            if (existingEmp) {
                const empToEdit = state.employees.find(e => e.id === existingEmp.id) || state.employees.find(e => e.key === existingEmp.id);
                if (!empToEdit) return null;
                // Detectar si los puestos cambiaron ANTES de reasignarlos: este
                // modal re-asigna positions en cada guardado, así que sólo se
                // estampa positionsUpdatedAt cuando de verdad cambian (si no,
                // editar el teléfono pisaría los puestos del otro dispositivo).
                const posChanged = positionsChanged(
                    empToEdit.positions, selectedPositions,
                    empToEdit.positionSalaries, positionSalaries
                );
                empToEdit.number = numberToUse;
                empToEdit.name = name;
                empToEdit.positions = selectedPositions;
                empToEdit.positionSalaries = positionSalaries;
                empToEdit.positionSalaryModes = positionSalaryModes;
                empToEdit.hireDate = hireDate;
                empToEdit.phone = phone;
                empToEdit.email = email;
                empToEdit.notes = notes;
                const now = Date.now();
                empToEdit.updatedAt = now;
                if (posChanged) empToEdit.positionsUpdatedAt = now;
                empToEdit._isDirty = true;

                // Reasignación de días decidida en el modal de impacto: los
                // días trabajados con la posición removida se reescriben a la
                // posición elegida, dentro de batchSetState y con rebuild del
                // índice (mismo contrato que el purge de historial). Las
                // fechas tocadas se acumulan para subirlas por el canal daily.
                if (_reassignDecisions.length > 0) {
                    stateManager.batchSetState(() => {
                        for (const d of _reassignDecisions) {
                            const r = reassignPositionDays(state.attendance, {
                                employeeId: empToEdit.id, fromId: d.fromId, toId: d.toId
                            });
                            _reassignTouchedDates.push(...r.dateKeys);
                        }
                        buildAttendanceIndex();
                    });
                }
                return empToEdit.id;
            }
            const newId = 'emp-' + Date.now();
            const nowNew = Date.now();
            state.employees.push({
                id: newId, key: newId, number: numberToUse, name,
                positions: selectedPositions, positionSalaries, positionSalaryModes, active: true,
                hireDate, phone, email, notes,
                statusHistory: [{ date: hireDate, active: true, timestamp: nowNew }],
                // Empleado nuevo: sus puestos se asignan por primera vez ahora,
                // así que positionsUpdatedAt arranca con el mismo timestamp.
                updatedAt: nowNew, positionsUpdatedAt: nowNew, _isDirty: true
            });
            return newId;
        };

        const finish = (msg) => {
            // El toast lo emite SaveOutcomeNotifier con el resultado REAL del
            // guardado. El msg (puede traer HTML del icono) se usa como label.
            const label = msg ? String(msg).replace(/<[^>]*>/g, '').trim() : null;
            const opts = label ? { announce: label } : {};
            // Fechas reasignadas → suben por el canal daily en el MISMO
            // guardado (un daily por fecha, un solo mirror). immediate: un
            // cambio de montos históricos no debe perderse en un F5 dentro
            // de la ventana de debounce.
            if (_reassignTouchedDates.length > 0) {
                opts.dateKeys = [...new Set(_reassignTouchedDates)];
                opts.immediate = true;
            }
            context.saveToLocalStorage(Object.keys(opts).length > 0 ? opts : undefined);
            context.render();
            modalInstance.close();
        };

        const continueSave = () => {
            // 🔢 Conflicto de número: otro empleado ya tiene esta ficha.
            // En vez de bloquear, ofrecemos resolución: cancelar, intercambiar
            // o fusionar (misma persona).
            const duplicate = state.employees.find(e => e.number === number && (!existingEmp || e.id !== existingEmp.id));
            if (duplicate) {
                EmployeeModal._showNumberConflict({
                    intendedNumber: number, editingName: name, existingEmp, duplicate,
                    applyFields, finish, state
                });
                return;
            }

            applyFields(number);
            // Label de ACCIÓN para el toast (el SaveOutcomeNotifier lo envuelve en
            // "Guardando — … · en este equipo"). Sin "correctamente" ni ícono: el
            // mensaje de éxito lo arma el notifier con el resultado real.
            finish(`Empleado ${name} ${existingEmp ? 'actualizado' : 'creado'}`);
        };

        // 🛡️ Posiciones REMOVIDAS con días trabajados: interponer el modal de
        // impacto ANTES de aplicar nada. El default del producto es conservar
        // el historial (el pasado es un hecho); reasignar esos días a otra
        // posición del empleado es opt-in explícito con el impacto a la vista.
        if (existingEmp) {
            const current = state.employees.find(e => e.id === existingEmp.id) || state.employees.find(e => e.key === existingEmp.id);
            const prevPositions = Array.isArray(current?.positions) ? current.positions : [];
            const removedWithHistory = prevPositions
                .filter(pid => !selectedPositions.includes(pid))
                .map(pid => ({ pid, audit: collectPositionDays(state.attendance, { employeeId: current.id, positionId: pid }) }))
                .filter(x => x.audit.count > 0);
            if (removedWithHistory.length > 0) {
                EmployeeModal._showPositionRemovalImpact({
                    emp: current, items: removedWithHistory, remaining: selectedPositions, state,
                    onDecide: (decisions) => { _reassignDecisions = decisions; continueSave(); }
                });
                return; // Cancelar en el modal de impacto aborta el guardado (el form queda abierto)
            }
        }
        continueSave();
    }

    /**
     * Modal de resolución de conflicto de número de ficha.
     * Opciones: Cancelar · Intercambiar (solo al editar) · Fusionar.
     */
    static _showNumberConflict({ intendedNumber, editingName, existingEmp, duplicate, applyFields, finish, state }) {
        const oldNumber = existingEmp ? existingEmp.number : null;
        const who = editingName || (existingEmp && existingEmp.name) || 'Este empleado';

        const content = `
            <div style="padding:4px 2px;">
                <p style="color:#e2e8f0;margin:0 0 10px;line-height:1.4;">
                    El número <strong>#${intendedNumber}</strong> ya está asignado a
                    <strong>${duplicate.name}</strong>.
                </p>
                <p style="color:#94a3b8;font-size:0.85rem;margin:0;">¿Qué deseas hacer?</p>
            </div>`;

        const buttons = [
            { text: 'Cancelar', class: 'btn-secondary', onClick: function () { this.close(); } }
        ];

        // Intercambiar solo tiene sentido al editar un empleado con número previo.
        if (existingEmp && oldNumber && String(oldNumber) !== String(intendedNumber)) {
            buttons.push({
                text: `🔁 Intercambiar (#${oldNumber} ↔ #${intendedNumber})`,
                class: 'btn-primary',
                onClick: function () {
                    applyFields(oldNumber);                       // aplica edits con el número viejo
                    swapEmployeeNumbers(existingEmp.id, duplicate.id); // luego intercambia
                    this.close();
                    finish(`🔁 Números intercambiados: ${who} #${intendedNumber}, ${duplicate.name} #${oldNumber}`);
                }
            });
        }

        buttons.push({
            text: '🤝 Es la misma persona (fusionar)',
            class: 'btn-primary',
            onClick: function () {
                const editedId = applyFields(intendedNumber);
                if (!editedId) { this.close(); return; }
                // Master = el de más asistencia (conserva la identidad más completa).
                // Fase 1 (U2c): un tombstone no cuenta como asistencia real.
                const attCount = (id) => {
                    const prefix = `${id}-`;
                    return Object.entries(state.attendance || {})
                        .filter(([k, v]) => k.startsWith(prefix) && v.deletedAt == null).length;
                };
                let masterId = duplicate.id, dupId = editedId;
                if (attCount(editedId) >= attCount(duplicate.id)) { masterId = editedId; dupId = duplicate.id; }
                mergeEmployees(masterId, dupId);
                enqueueCloudEmployeeDelete(dupId); // borra el doc huérfano del eliminado
                this.close();
                finish(`🤝 ${who} y ${duplicate.name} fusionados en un solo empleado (#${intendedNumber})`);
            }
        });

        new Modal({ title: '⚠️ Número de ficha en uso', content, size: 'small', buttons }).open();
    }

    /**
     * Modal de impacto al REMOVER una posición con días trabajados.
     *
     * Muestra el alcance real (días, rango de fechas, horas y plata estimada)
     * y ofrece, en este orden de seguridad:
     *   1. Conservar historial (recomendado): el pasado queda intacto — la
     *      posición sigue en el catálogo, así que esos días siguen resolviendo
     *      su nombre y tarifa. Solo se desasigna hacia adelante.
     *   2. Reasignar esos días a otra posición del empleado: reescritura
     *      EXPLÍCITA del pasado, con advertencia de que los montos históricos
     *      cambian (si ya se pagaron, los reportes dejan de cuadrar).
     *   3. Cancelar: aborta el guardado entero (el formulario queda abierto).
     *
     * Si se removieron varias posiciones con historial, se decide una por una
     * (cadena secuencial de modales). onDecide recibe las reasignaciones
     * elegidas [{fromId, toId}] (vacío si conservó todo).
     */
    static _showPositionRemovalImpact({ emp, items, remaining, state, onDecide }) {
        const rateOf = (posId) =>
            Number(emp.positionSalaries?.[posId]) ||
            Number((state.positions.find(p => p.id === posId) || {}).hourlyRate) || 0;
        const posName = (posId) => (state.positions.find(p => p.id === posId) || {}).name || String(posId);

        const decisions = [];
        const step = (i) => {
            if (i >= items.length) {
                onDecide(decisions.filter(Boolean));
                return;
            }
            const { pid, audit } = items[i];
            const fromRate = rateOf(pid);
            const fromMoney = Math.round(audit.totalHours * fromRate);
            const destinations = remaining.filter(id => id !== pid);
            const selectId = `reassign-dest-select-${i}`;

            const options = destinations.map(id => {
                const r = rateOf(id);
                const est = Math.round(audit.totalHours * r);
                return `<option value="${escapeHTML(id)}">${escapeHTML(posName(id))} — $${r}/hr (≈ $${est.toLocaleString()})</option>`;
            }).join('');

            const content = `
                <div style="padding:4px 2px; display:flex; flex-direction:column; gap:10px;">
                    <p style="color:#e2e8f0;margin:0;line-height:1.5;">
                        <strong>${escapeHTML(emp.name)}</strong> trabajó
                        <strong>${audit.count} día${audit.count === 1 ? '' : 's'}</strong> como
                        <strong>${escapeHTML(posName(pid))}</strong>
                        entre <strong>${audit.firstDate}</strong> y <strong>${audit.lastDate}</strong>
                        (${audit.totalHours}h ≈ $${fromMoney.toLocaleString()}).
                    </p>
                    <p style="color:#94a3b8;font-size:0.85rem;margin:0;line-height:1.5;">
                        Al quitarle la posición, su historial NO se pierde: esos días
                        seguirán registrados como ${escapeHTML(posName(pid))}. Solo deja
                        de estar disponible hacia adelante.
                    </p>
                    ${destinations.length > 0 ? `
                    <div style="background:rgba(234,179,8,0.08);border:1px solid rgba(234,179,8,0.25);border-radius:8px;padding:10px;">
                        <p style="color:#eab308;font-size:0.85rem;margin:0 0 8px;line-height:1.5;">
                            ⚠️ Si preferís reasignar esos días a otra de sus posiciones,
                            los montos históricos de nómina CAMBIAN — y si esos días ya
                            fueron pagados, tus reportes dejarán de cuadrar con lo pagado.
                        </p>
                        <label for="${selectId}" style="color:#94a3b8;font-size:0.8rem;">Reasignar a:</label>
                        <select id="${selectId}" class="form-input" style="width:100%;margin-top:4px;">${options}</select>
                    </div>` : ''}
                </div>`;

            const buttons = [
                {
                    text: '🛡️ Conservar historial (recomendado)',
                    class: 'btn-primary',
                    onClick: function () {
                        decisions.push(null);
                        this.close();
                        step(i + 1);
                    }
                }
            ];
            if (destinations.length > 0) {
                buttons.push({
                    text: '🔁 Reasignar esos días',
                    class: 'btn-secondary',
                    onClick: function () {
                        const sel = document.getElementById(selectId);
                        const toId = sel && sel.value ? sel.value : destinations[0];
                        decisions.push({ fromId: pid, toId });
                        this.close();
                        step(i + 1);
                    }
                });
            }
            buttons.push({
                // Cancelar aborta TODO el guardado: ni step(i+1) ni onDecide.
                text: 'Cancelar',
                class: 'btn-secondary',
                onClick: function () { this.close(); }
            });

            new Modal({
                title: `⚠️ ${escapeHTML(posName(pid))}: días trabajados`,
                content, size: 'medium', buttons
            }).open();
        };
        step(0);
    }
}
