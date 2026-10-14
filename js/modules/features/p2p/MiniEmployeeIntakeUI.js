import { state } from '../../core/AppState.js';
import { escapeHTML as esc, escapeAttr } from '../../utils/Sanitize.js';
import { getEntityScope, entityInScope } from '../projects/ProjectContext.js';
import { getActivePayrollSettings, refreshActivePayrollSettings } from '../payroll/ActivePayrollSettings.js';
import { getDateKey } from '../../utils/DateUtils.js';
import { DOMDiff } from '../../utils/DOMDiff.js';
import { intakeSuggestions, intakeReviewVersion } from './MiniEmployeeIntake.js';
import { miniEmployeeIntakeStore, currentIntakeOwner } from './MiniEmployeeIntakeStore.js';
import { sendEmployeeIntakeResult } from './MiniEmployeeIntakeBridge.js';

export async function renderEmployeeIntakeReview(host,entry,{onBack=()=>{},projectName='',store=miniEmployeeIntakeStore,readState=()=>state,resolveScope=getEntityScope,sendResult=sendEmployeeIntakeResult,readOwner=currentIntakeOwner}={}) {
    const owner=readOwner(), scope=await resolveScope();
    if(scope.projectId!==entry.payload.saProjectId || !scope.enabled || readOwner()!==owner)throw new Error('Selecciona la obra de esta propuesta para revisarla.');
    await refreshActivePayrollSettings({render:false});
    const model=readState(), hours=Number(getActivePayrollSettings(model)?.regularHoursPerDay)||8;
    const version=intakeReviewVersion(model,scope,hours);
    const employees=model.employees.filter(e=>!e.deletedAt&&entityInScope(e,scope)), positions=model.positions.filter(p=>!p.deletedAt&&entityInScope(p,scope));
    const links=await store.linksFor(entry.peerId,scope.projectId);
    if(readOwner()!==owner || (await resolveScope()).projectId!==scope.projectId)throw new Error('La cuenta o la obra cambiaron. Vuelve a abrir la revisión.');
    const today=getDateKey(new Date());
    const choices=entry.payload.employees.map(row=>{
        const known=entry.mappings?.find(m=>m.miniLocalId===row.miniLocalId) || links[row.miniLocalId];
        const target=known&&employees.find(e=>e.id===known.saEmployeeId);
        return {miniLocalId:row.miniLocalId,action:target?'link':intakeSuggestions(row,employees,scope).length?'pending':'create',employeeId:target?.id||'',positionId:'',hireDate:today,update:false,confirmDifferent:false,reactivate:false,fields:{...row},accepted:!!entry.mappings?.some(m=>m.miniLocalId===row.miniLocalId)};
    });
    let saving=false;
    const existingFields=employee=>{
        const p=positions.find(p=>p.id===employee.positions?.[0]);
        const hourly=employee.positionSalaries?.[p?.id]??p?.hourlyRate;
        return {number:String(employee.number||''),name:employee.name||'',position:p?.name||'',dailySalary:hourly>0?Math.round(hourly*hours*100)/100:null,phone:employee.phone||'',email:employee.email||''};
    };
    choices.forEach(choice=>{if(choice.employeeId)choice.fields={...choice.fields,...existingFields(employees.find(e=>e.id===choice.employeeId))};});
    const input=(i,name,label,type='text')=>`<label class="sa-p2p-field"><span>${label}</span><input data-intake-field="${name}" data-intake-index="${i}" type="${type}" ${type==='number'?'min="0.01" step="0.01" inputmode="decimal"':''} value="${escapeAttr(choices[i].fields[name]??'')}" ${choices[i].action==='link'&&!choices[i].update?'disabled':''}></label>`;
    const render=()=>{
        const opened=new Set([...host.querySelectorAll('[data-intake-row][open]')].map(el=>Number(el.dataset.intakeRow)));
        DOMDiff.apply(host,`<section class="sa-p2p-step sa-mini-intake"><button type="button" class="btn btn-secondary" data-intake-back>Volver</button>
            <div><h3>Personal recibido de Mini</h3><p>${esc(entry.peerName||'Mini')} · ${esc(projectName||'Obra seleccionada')}</p></div>
            <p>Revisa ficha, puesto y salario por día. Los cambios se aplican al aceptar.</p>
            <p>Jornada de SA: ${hours} horas. La tarifa confirmada es individual.</p>
            <div class="sa-p2p-status" data-intake-message role="status">${entry.status==='resolved'?`${entry.mappings.length} empleados aceptados en SA.`:entry.status==='discarded'?'Propuesta descartada. Prepara un nuevo envío desde Mini.':''}</div>
            <div class="sa-mini-intake-list">${choices.map((choice,i)=>{
                const source=entry.payload.employees[i], candidates=intakeSuggestions({...source,...choice.fields},employees,scope);
                return `<details class="sa-mini-intake-card" data-intake-row="${i}" ${opened.has(i)?'open':''}><summary><strong>${esc(source.name)}</strong><span>Ficha ${esc(source.number)} · ${choice.accepted?'Aceptado':candidates.length?'Revisar coincidencia':'Nuevo'}</span></summary>
                    <div class="sa-mini-intake-fields"><p>Mini: ${esc(source.position||'Sin puesto')} · ${source.dailySalary===null?'Sin salario':`${source.dailySalary} por día`}</p>
                    ${source.phone||source.email?`<p>Contacto de Mini: ${esc(source.phone)} ${esc(source.email)}</p>`:''}
                    ${candidates.length?`<p>Coincidencias en SA: ${candidates.map(e=>`${esc(e.name)} (${esc(e.number)})`).join(', ')}</p>`:''}
                    <label class="sa-p2p-field"><span>Qué hacer</span><select data-intake-action="${i}" ${choice.accepted?'disabled':''}>${[['pending','Dejar pendiente'],['create','Crear empleado'],['link','Vincular con empleado SA']].map(([v,l])=>`<option value="${v}" ${choice.action===v?'selected':''}>${l}</option>`).join('')}</select></label>
                    ${choice.action==='link'?`<label class="sa-p2p-field"><span>Empleado de SA</span><select data-intake-target="${i}" ${choice.accepted?'disabled':''}><option value="">Seleccionar empleado</option>${employees.map(e=>`<option value="${escapeAttr(e.id)}" ${choice.employeeId===e.id?'selected':''}>${esc(e.name)} · ${esc(e.number)}${e.active===false?' · Pausado':''}</option>`).join('')}</select></label>
                    ${!choice.accepted?`<label class="sa-mini-intake-check"><input type="checkbox" data-intake-update="${i}" ${choice.update?'checked':''}><span>Actualizar su ficha con los datos revisados</span></label><label class="sa-mini-intake-check"><input type="checkbox" data-intake-reactivate="${i}" ${choice.reactivate?'checked':''}><span>Reactivar si está pausado</span></label>`:''}`:''}
                    ${choice.action!=='pending'?`${input(i,'name','Nombre')}${input(i,'number','Número de ficha')}${input(i,'dailySalary','Salario por día','number')}${input(i,'phone','Teléfono (opcional)','tel')}${input(i,'email','Correo (opcional)','email')}
                    ${choice.action==='create'?`<label class="sa-p2p-field"><span>Fecha de ingreso</span><input type="date" data-intake-hire="${i}" max="${today}" value="${escapeAttr(choice.hireDate)}"></label><p>Para aprobar asistencia anterior, revisa cuándo empezó a trabajar.</p>`:''}
                    ${(choice.action==='create'||choice.update)?`<label class="sa-p2p-field"><span>Puesto en SA</span><select data-intake-position="${i}"><option value="">Usar puesto con el mismo nombre</option>${positions.map(p=>`<option value="${escapeAttr(p.id)}" ${choice.positionId===p.id?'selected':''} ${p.active===false?'disabled':''}>${esc(p.name)}${p.active===false?' · Pausado':''}</option>`).join('')}<option value="new" ${choice.positionId==='new'?'selected':''}>Crear un puesto nuevo</option></select></label>${input(i,'position','Nombre del puesto')}`:''}
                    ${choice.action==='create'&&candidates.length?`<label class="sa-mini-intake-check"><input type="checkbox" data-intake-different="${i}" ${choice.confirmDifferent?'checked':''}><span>Son personas distintas; revisé la coincidencia</span></label>`:''}`:''}
                    </div></details>`;
            }).join('')}</div>
            <div class="sa-p2p-actions">${entry.status==='pending'?`<button type="button" class="btn btn-primary" data-intake-accept>Aceptar personal revisado</button><button type="button" class="btn btn-secondary" data-intake-duplicates>Resolver duplicados en SA</button><button type="button" class="btn btn-secondary" data-intake-discard>Descartar propuesta</button>`:`<button type="button" class="btn btn-primary" data-intake-done>Volver a conexiones</button>`}</div>
            ${entry.status==='pending'?'<p>Descartar conserva los empleados que ya aceptaste.</p>':''}
        </section>`);
        host.querySelector('[data-intake-back]').onclick=()=>{if(!saving)onBack();};
        const done=host.querySelector('[data-intake-done]');if(done)done.onclick=onBack;
        const duplicates=host.querySelector('[data-intake-duplicates]');if(duplicates)duplicates.onclick=()=>globalThis.startMaintenanceWizard?.();
        const discard=host.querySelector('[data-intake-discard]');if(discard)discard.onclick=async()=>{if(saving)return;saving=true;try{await store.discard(entry.id,scope);onBack();}catch(error){host.querySelector('[data-intake-message]').textContent=error.message;}finally{saving=false;}};
        host.querySelectorAll('[data-intake-field]').forEach(el=>el.oninput=()=>{const choice=choices[Number(el.dataset.intakeIndex)];choice.fields[el.dataset.intakeField]=el.dataset.intakeField==='dailySalary'?(el.value===''?null:Number(el.value)):el.value;});
        host.querySelectorAll('[data-intake-hire]').forEach(el=>el.oninput=()=>{choices[Number(el.dataset.intakeHire)].hireDate=el.value;});
        host.querySelectorAll('[data-intake-action]').forEach(el=>el.onchange=()=>{const choice=choices[Number(el.dataset.intakeAction)];choice.action=el.value;choice.update=false;choice.fields={...entry.payload.employees[Number(el.dataset.intakeAction)]};if(choice.action==='link'&&choice.employeeId)Object.assign(choice.fields,existingFields(employees.find(e=>e.id===choice.employeeId)));render();});
        host.querySelectorAll('[data-intake-target]').forEach(el=>el.onchange=()=>{const choice=choices[Number(el.dataset.intakeTarget)];choice.employeeId=el.value;const employee=employees.find(e=>e.id===el.value);if(employee)Object.assign(choice.fields,existingFields(employee));render();});
        for(const [attr,key] of [['update','update'],['reactivate','reactivate'],['different','confirmDifferent']])host.querySelectorAll(`[data-intake-${attr}]`).forEach(el=>el.onchange=()=>{choices[Number(el.dataset[`intake${attr[0].toUpperCase()+attr.slice(1)}`])][key]=el.checked;render();});
        host.querySelectorAll('[data-intake-position]').forEach(el=>el.onchange=()=>{const choice=choices[Number(el.dataset.intakePosition)];choice.positionId=el.value;const p=positions.find(p=>p.id===el.value);if(p)choice.fields.position=p.name;render();});
        const acceptButton=host.querySelector('[data-intake-accept]');if(acceptButton)acceptButton.onclick=accept;
    };
    const accept=async()=>{
        if(saving)return;
        const message=host.querySelector('[data-intake-message]');
        if(!choices.some(c=>!c.accepted&&c.action!=='pending')){message.textContent='Selecciona al menos un empleado para aceptar.';return;}
        saving=true;host.querySelector('[data-intake-accept]').disabled=true;
        try{
            if(readOwner()!==owner)throw new Error('La cuenta cambió. Vuelve a abrir la revisión.');
            const currentScope=await resolveScope();if(currentScope.projectId!==scope.projectId)throw new Error('La obra cambió. Vuelve a revisar.');
            const outcome=await store.accept(entry.id,choices.map(({accepted,...choice})=>choice),{scope,hoursPerDay:hours,version});
            entry.mappings=outcome.result.mappings;entry.status=entry.mappings.length===entry.payload.employees.length?'resolved':'pending';
            const sent=sendResult(entry.peerId,outcome.result);
            await renderEmployeeIntakeReview(host,entry,{onBack,projectName,store,readState,resolveScope,sendResult,readOwner});
            const updatedMessage=host.querySelector('[data-intake-message]');
            updatedMessage.textContent=`${outcome.result.mappings.length} empleados aceptados en SA. ${sent?'Respuesta enviada a Mini.':'Vuelve a enviar la propuesta desde Mini para recuperar los vínculos.'}${outcome.syncWarning?' La sincronización con la nube sigue pendiente.':''}`;
        }catch(error){
            try{if(readOwner()!==owner||(await resolveScope()).projectId!==scope.projectId){host.replaceChildren();onBack();return;}}catch(_){host.replaceChildren();onBack();return;}
            render();host.querySelector('[data-intake-message]').textContent=error.message||'No se pudo aceptar. Tus cambios siguen en esta revisión.';host.querySelector('[data-intake-accept]').disabled=false;
        }
        finally{saving=false;}
    };
    render();return {choices,entry};
}
