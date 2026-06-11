import { Modal } from '../../components/Modal.js';
import { getState, context } from '../../features/employees/EmployeesUI.js';
import icons from '../../ui/IconSystem.js';
import { swapEmployeeNumbers, mergeEmployees, enqueueCloudEmployeeDelete } from '../../services/PersistenceService.js';

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
        state.showOptionalFields = !!(emp?.phone || emp?.email || emp?.notes);

        const hireDateValue = emp?.hireDate || new Date().toISOString().split('T')[0];

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
                            const customSalary = state.tempPositionSalaries[pos.id] || '';

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
                                        <div style="position: relative;">
                                            <span style="position: absolute; left: 10px; top: 50%; transform: translateY(-50%); color: #64748b; font-size: 0.8rem;">$</span>
                                            <input type="number" inputmode="decimal" 
                                                   class="form-input custom-salary-input" 
                                                   style="font-size: 0.8rem; padding: 6px 10px 6px 22px; background: #0f172a;"
                                                   data-pos-id="${pos.id}"
                                                   value="${customSalary}" 
                                                   placeholder="Usar base: $${posSalary.toLocaleString()}" 
                                                   min="0" 
                                                   step="1">
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
        const positionSalaries = {};
        el.querySelectorAll('.custom-salary-input').forEach(input => {
            const val = parseFloat(input.value);
            if (!isNaN(val) && val > 0) {
                positionSalaries[input.dataset.posId] = val;
            }
        });

        // Aplica los campos del formulario al empleado (existente o nuevo) con
        // el número indicado. Devuelve el id del empleado afectado.
        const applyFields = (numberToUse) => {
            if (existingEmp) {
                const empToEdit = state.employees.find(e => e.id === existingEmp.id) || state.employees.find(e => e.key === existingEmp.id);
                if (!empToEdit) return null;
                empToEdit.number = numberToUse;
                empToEdit.name = name;
                empToEdit.positions = selectedPositions;
                empToEdit.positionSalaries = positionSalaries;
                empToEdit.hireDate = hireDate;
                empToEdit.phone = phone;
                empToEdit.email = email;
                empToEdit.notes = notes;
                empToEdit.updatedAt = Date.now();
                empToEdit._isDirty = true;
                return empToEdit.id;
            }
            const newId = 'emp-' + Date.now();
            state.employees.push({
                id: newId, key: newId, number: numberToUse, name,
                positions: selectedPositions, positionSalaries, active: true,
                hireDate, phone, email, notes,
                statusHistory: [{ date: hireDate, active: true, timestamp: Date.now() }],
                updatedAt: Date.now(), _isDirty: true
            });
            return newId;
        };

        const finish = (msg) => {
            // El toast lo emite SaveOutcomeNotifier con el resultado REAL del
            // guardado. El msg (puede traer HTML del icono) se usa como label.
            const label = msg ? String(msg).replace(/<[^>]*>/g, '').trim() : null;
            context.saveToLocalStorage(label ? { announce: label } : undefined);
            context.render();
            modalInstance.close();
        };

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
        finish(`${icons.get('check-circle')} Empleado ${name} ${existingEmp ? 'actualizado' : 'creado correctamente'}`);
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
                const attCount = (id) => Object.keys(state.attendance || {}).filter(k => k.startsWith(`${id}-`)).length;
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
}
