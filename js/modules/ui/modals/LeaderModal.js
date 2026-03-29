import { Modal } from '../../components/Modal.js';
import { getState, context } from '../../features/employees/EmployeesUI.js';
import icons from '../../ui/IconSystem.js';

export class LeaderModal {
    static open(leaderId = null) {
        const state = getState();
        const ldr = leaderId ? state.leaders.find(l => l.id === leaderId) : null;
        const isEdit = !!ldr;
        const title = isEdit ? `Editar Líder - ${ldr.name}` : 'Nuevo Líder';

        // Sugerencia de número para líder
        const suggestedNumber = isEdit ? ldr.number : (() => {
            const maxNum = Math.max(10, ...state.leaders.map(l => parseInt(l.number) || 0));
            return String(maxNum + 1);
        })();

        state.showOptionalFields = !!(ldr?.phone || ldr?.email || ldr?.notes);

        const contentHTML = `
            <div style="max-height: 70vh; overflow-y: auto; padding-right: 8px;">
                <div class="form-group">
                    <label class="form-label" style="display: flex; align-items: center; justify-content: space-between;">
                        <span>🔢 Número de Líder</span>
                        ${!isEdit ? `<span style="background: rgba(6, 182, 212, 0.1); color: #06b6d4; border: 1px solid rgba(6, 182, 212, 0.2); padding: 2px 8px; border-radius: 99px; font-size: 0.65rem; font-weight: 700;">✨ AUTOMÁTICO</span>` : ''}
                    </label>
                    <input type="text" id="ldrNumber" class="form-input" value="${suggestedNumber}" placeholder="L001" required>
                </div>

                <div class="form-group">
                    <label class="form-label">📝 Nombre Completo *</label>
                    <input type="text" id="ldrName" class="form-input" value="${ldr?.name || ''}" placeholder="Ej: Carlos López" required>
                </div>
                
                <!-- Botón para expandir campos opcionales -->
                <div style="margin: 20px 0;">
                    <button type="button" id="toggleOptionalBtn"
                            style="width: 100%; padding: 12px; background: rgba(30, 41, 59, 0.5); border: 1px dashed #334155; border-radius: 10px; color: #94a3b8; cursor: pointer; font-size: 0.8rem; font-weight: 600; transition: all 0.2s; display: flex; align-items: center; justify-content: center; gap: 8px;">
                        <span id="optionalIcon">${state.showOptionalFields ? '▼' : '▶'}</span>
                        <span>${state.showOptionalFields ? 'Ocultar' : 'Mostrar'} campos opcionales</span>
                    </button>
                </div>
                
                <!-- Campos opcionales colapsables -->
                <div id="optionalFieldsContainer" style="display: ${state.showOptionalFields ? 'block' : 'none'}; animation: fadeIn 0.3s ease-out;">
                    <div class="form-group">
                        <label class="form-label">📞 Teléfono</label>
                        <input type="tel" id="ldrPhone" class="form-input" value="${ldr?.phone || ''}" placeholder="+1-809-555-1234">
                    </div>
                    
                    <div class="form-group">
                        <label class="form-label">📧 Email</label>
                        <input type="email" id="ldrEmail" class="form-input" value="${ldr?.email || ''}" placeholder="lider@ejemplo.com">
                    </div>
                    
                    <div class="form-group">
                        <label class="form-label">📋 Notas y Responsabilidades</label>
                        <textarea id="ldrNotes" class="form-textarea" placeholder="Sueldo, horarios, dependencias..." style="min-height: 80px;">${ldr?.notes || ''}</textarea>
                    </div>
                </div>
                
                ${isEdit ? `
                    <div style="margin-top: 16px; padding: 12px; background: rgba(30, 41, 59, 0.5); border-radius: 10px; border: 1px solid #334155;">
                        <div style="font-size: 0.65rem; color: #94a3b8; margin-bottom: 8px; text-transform: uppercase; font-weight: 700;">
                            Resumen de Gestión
                        </div>
                        <div style="display: flex; flex-direction: column; gap: 4px; font-size: 0.75rem;">
                            <div style="display: flex; justify-content: space-between;"><span style="color: #64748b;">Posiciones que lidera:</span> <span style="color: #06b6d4; font-weight: 700;">${state.positions.filter(p => p.leaderId === ldr.id && p.active).length}</span></div>
                        </div>
                    </div>
                ` : ''}
            </div>
        `;

        const modal = new Modal({
            title: `👑 ${title}`,
            content: contentHTML,
            size: 'medium',
            buttons: [
                { text: 'Cancelar', class: 'btn-secondary', onClick: function() { this.close(); } },
                { text: '💾 Guardar Líder', class: 'btn-primary', onClick: function() { LeaderModal.save(this, ldr); } }
            ]
        });

        modal.open();

        const body = modal.element;
        const toggleBtn = body.querySelector('#toggleOptionalBtn');
        const optionalContainer = body.querySelector('#optionalFieldsContainer');
        const optionalIcon = body.querySelector('#optionalIcon');

        toggleBtn.addEventListener('click', () => {
            state.showOptionalFields = !state.showOptionalFields;
            optionalContainer.style.display = state.showOptionalFields ? 'block' : 'none';
            optionalIcon.textContent = state.showOptionalFields ? '▼' : '▶';
            toggleBtn.querySelector('span:nth-child(2)').textContent = `${state.showOptionalFields ? 'Ocultar' : 'Mostrar'} campos opcionales`;
        });
    }

    static save(modalInstance, existingLdr) {
        const el = modalInstance.element;
        const number = el.querySelector('#ldrNumber').value.trim();
        const name = el.querySelector('#ldrName').value.trim();
        const phone = el.querySelector('#ldrPhone').value.trim();
        const email = el.querySelector('#ldrEmail').value.trim();
        const notes = el.querySelector('#ldrNotes').value.trim();

        if (!number || !name) {
            window.showAlert('El número y nombre son obligatorios', 'error');
            return;
        }

        const state = getState();

        if (existingLdr) {
            const ldrToEdit = state.leaders.find(l => l.id === existingLdr.id);
            if (ldrToEdit) {
                ldrToEdit.number = number;
                ldrToEdit.name = name;
                ldrToEdit.phone = phone;
                ldrToEdit.email = email;
                ldrToEdit.notes = notes;
                ldrToEdit.updatedAt = Date.now();
                ldrToEdit._isDirty = true;
                window.showAlert(`${icons.get('check-circle')} Líder actualizado`, 'success');
            }
        } else {
            state.leaders.push({
                id: 'ldr-' + Date.now(),
                number: number,
                name: name,
                phone: phone,
                email: email,
                notes: notes,
                active: true,
                updatedAt: Date.now(),
                _isDirty: true
            });
            window.showAlert(`${icons.get('check-circle')} Líder creado correctamente`, 'success');
        }

        context.saveToLocalStorage();
        context.render();
        modalInstance.close();
    }
}
