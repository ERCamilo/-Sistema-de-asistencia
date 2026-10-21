import { state } from '../../core/AppState.js';
import { escapeHTML as esc, escapeAttr } from '../../utils/Sanitize.js';
import { getEntityScope, entityInScope } from '../projects/ProjectContext.js';
import { getActivePayrollSettings, refreshActivePayrollSettings } from '../payroll/ActivePayrollSettings.js';
import { getDateKey } from '../../utils/DateUtils.js';
import { DOMDiff } from '../../utils/DOMDiff.js';
import { intakeSuggestions, intakeReviewVersion } from './MiniEmployeeIntake.js';
import { miniEmployeeIntakeStore, currentIntakeOwner } from './MiniEmployeeIntakeStore.js';
import { sendEmployeeIntakeResult } from './MiniEmployeeIntakeBridge.js';
import { buildCandidateLists, positionDailySuggestion, stepsFor, aliasRecordsForLinks } from './MiniEmployeeIntakeSteps.js';
import { EmployeePositionPickerModal } from '../../ui/modals/EmployeePositionPickerModal.js';
import { miniAttendanceAliasStore } from '../../services/MiniAttendanceAliasStore.js';

const ICONS = {
    back: '<path d="m15 18-6-6 6-6"/>',
    user: '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
    link: '<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    check: '<path d="m5 12 5 5 9-10"/>'
};
const icon = (name, size = 18) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ''}</svg>`;
const button = (label, attrs = '', kind = 'primary') => `<button type="button" class="sa-p2p-button sa-p2p-button-${kind}" ${attrs}><span>${label}</span></button>`;
const money = value => `$${Number(value).toLocaleString('es-DO', { maximumFractionDigits: 2 })}`;
const STEP_TITLES = { action: 'Qué hacer', target: 'Empleado de SA', confirm: 'Confirmar', position: 'Puesto', salary: 'Sueldo', details: 'Datos' };

export async function renderEmployeeIntakeReview(host,entry,{onBack=()=>{},projectName='',store=miniEmployeeIntakeStore,readState=()=>state,resolveScope=getEntityScope,sendResult=sendEmployeeIntakeResult,readOwner=currentIntakeOwner,aliasStore=miniAttendanceAliasStore,openPositionPicker=options=>EmployeePositionPickerModal.open(options)}={}) {
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
        return {miniLocalId:row.miniLocalId,action:target?'link':'',employeeId:target?.id||'',positionId:'',hireDate:today,update:false,confirmDifferent:false,reactivate:false,fields:{...row},accepted:!!entry.mappings?.some(m=>m.miniLocalId===row.miniLocalId)};
    });
    let saving=false, view={index:null,step:'action'}, search='';
    const existingFields=employee=>{
        const p=positions.find(p=>p.id===employee.positions?.[0]);
        const hourly=employee.positionSalaries?.[p?.id]??p?.hourlyRate;
        return {number:String(employee.number||''),name:employee.name||'',position:p?.name||'',dailySalary:hourly>0?Math.round(hourly*hours*100)/100:null,phone:employee.phone||'',email:employee.email||''};
    };
    const employeeOf=choice=>employees.find(e=>e.id===choice.employeeId);
    choices.forEach(choice=>{const target=employeeOf(choice);if(target)choice.fields={...choice.fields,...existingFields(target)};});
    const sourceOf=i=>entry.payload.employees[i];
    const chosenPosition=choice=>choice.positionId&&choice.positionId!=='new'?positions.find(p=>p.id===choice.positionId):positions.find(p=>p.active!==false&&String(p.name).trim().toLowerCase()===String(choice.fields.position||'').trim().toLowerCase());
    const messageText=text=>{const el=host.querySelector('[data-intake-message]');if(el)el.textContent=text;};

    const summary=(choice)=>{
        if(choice.accepted)return 'Aceptado';
        if(choice.action==='link'){const t=employeeOf(choice);return t?`Asociar con ${t.name} · ficha ${t.number}`:'Asociar: falta elegir empleado';}
        if(choice.action==='create')return `Crear como nuevo${choice.fields.position?` · ${choice.fields.position}`:''}`;
        if(choice.action==='pending')return 'Pendiente';
        return 'Sin resolver';
    };
    const input=(i,name,label,type='text')=>`<label class="sa-p2p-field"><span>${label}</span><input data-intake-field="${name}" data-intake-index="${i}" type="${type}" ${type==='number'?'min="0.01" step="0.01" inputmode="decimal"':''} value="${escapeAttr(choices[i].fields[name]??'')}"></label>`;
    const option=(attrs,iconName,title,detail)=>`<button type="button" class="sa-p2p-capability sa-mini-intake-option" ${attrs}><span class="sa-p2p-capability-icon">${icon(iconName,16)}</span><span class="sa-p2p-capability-copy"><strong>${title}</strong><small>${detail}</small></span></button>`;
    const positionControl=(i)=>{
        const choice=choices[i], source=sourceOf(i), picked=chosenPosition(choice), suggestion=picked?positionDailySuggestion(picked,hours):null;
        const label=choice.fields.position?esc(choice.fields.position):'Sin puesto elegido';
        const origin=choice.positionId==='new'||(!picked&&choice.fields.position)?'Se creará un puesto nuevo con este nombre.':suggestion?`Sueldo del puesto: ${money(suggestion)} por día`:'';
        return `<div class="sa-p2p-status" data-intake-position-summary><strong>${label}</strong>${origin?`<br><span>${esc(origin)}</span>`:''}</div>
            <div class="sa-p2p-actions">${button('Elegir puesto',`data-intake-pick-position="${i}"`,'primary')}${source.position&&source.position!==choice.fields.position?button(`Usar «${esc(source.position)}» de Mini`,`data-intake-mini-position="${i}"`,'secondary'):''}</div>`;
    };

    const renderList=()=>{
        const undecided=choices.filter(c=>!c.accepted&&!['create','link'].includes(c.action)).length;
        return `<section class="sa-p2p-step sa-mini-intake"><button type="button" class="sa-p2p-back" data-intake-back>${icon('back',17)}<span>Volver</span></button>
            <div><h3>Personal recibido de Mini</h3><p>${esc(entry.peerName||'Mini')} · ${esc(projectName||'Obra seleccionada')} · ${choices.length} empleado${choices.length===1?'':'s'}</p></div>
            <p>Elige qué hacer con cada empleado. Los cambios se aplican al aceptar. Jornada de SA: ${hours} horas.</p>
            <div class="sa-p2p-status" data-intake-message role="status">${entry.status==='resolved'?`${entry.mappings.length} empleados aceptados en SA.`:entry.status==='discarded'?'Propuesta descartada. Prepara un nuevo envío desde Mini.':undecided===choices.length?'Toca «Resolver» en cada empleado para decidir.':''}</div>
            <div class="sa-p2p-peer-list sa-mini-intake-list">${choices.map((choice,i)=>{
                const source=sourceOf(i), similar=choice.accepted?0:buildCandidateLists(source,employees,scope).similar.length;
                const ready=['create','link'].includes(choice.action)&&!choice.accepted;
                return `<div class="sa-p2p-peer-row ${choice.accepted||ready?'is-online':''}" data-intake-row="${i}"><div class="sa-p2p-peer-avatar ${choice.accepted||ready?'is-online':''}">${icon(choice.accepted?'check':'user')}</div>
                    <div class="sa-p2p-peer-copy"><div class="sa-p2p-peer-header-line"><strong>${esc(source.name)}</strong>${similar&&!ready?'<span class="sa-p2p-peer-type">Posible coincidencia</span>':''}</div>
                    <div class="sa-p2p-peer-meta">Ficha ${esc(source.number)} · ${esc(source.position||'Sin puesto')} · ${source.dailySalary===null?'Sin salario':`${money(source.dailySalary)} por día`}</div>
                    <div class="sa-p2p-peer-meta" data-intake-summary>${esc(summary(choice))}</div></div>
                    <div class="sa-p2p-device-actions">${choice.accepted?'':button(choice.action?'Cambiar':'Resolver',`data-intake-open="${i}"`,choice.action?'secondary':'primary')}</div></div>`;
            }).join('')}</div>
            <div class="sa-p2p-actions">${entry.status==='pending'?`${button('Aceptar personal revisado','data-intake-accept','primary')}${button('Resolver duplicados en SA','data-intake-duplicates','secondary')}${button('Descartar propuesta','data-intake-discard','secondary')}`:button(entry.local?'Volver a la asistencia':'Volver a conexiones','data-intake-done','primary')}</div>
            ${entry.status==='pending'?'<p class="sa-p2p-footnote">Descartar conserva los empleados que ya aceptaste.</p>':''}
        </section>`;
    };

    const wizardHead=(steps,step)=>`<button type="button" class="sa-p2p-back" data-intake-step-back>${icon('back',17)}<span>${step===steps[0]?'Lista':'Atrás'}</span></button>
        <p class="sa-p2p-section-label">Paso ${steps.indexOf(step)+1} de ${steps.length} · ${STEP_TITLES[step]}</p>`;

    const stepAction=(i)=>{
        const choice=choices[i], source=sourceOf(i), {similar}=buildCandidateLists(source,employees,scope);
        const same=similar.filter(c=>c.sameNumber);
        const hint=similar.length?`<div class="sa-p2p-status is-warning" data-intake-similar>Hay ${similar.length} empleado${similar.length===1?'':'s'} parecido${similar.length===1?'':'s'} en SA: ${similar.map(c=>`${esc(c.employee.name)} (ficha ${esc(c.employee.number)}${c.sameNumber?', mismo número':''}${c.paused?', pausado':''})`).join('; ')}.${same.length?' La ficha de Mini ya está ocupada en SA.':''}</div>`:'';
        return `${wizardHead(stepsFor(choice),'action')}<div><h3>¿Qué quieres hacer con ${esc(source.name)}?</h3><p>Ficha ${esc(source.number)} · Mini: ${esc(source.position||'Sin puesto')} · ${source.dailySalary===null?'Sin salario':`${money(source.dailySalary)} por día`}</p></div>${hint}
            <div class="sa-mini-intake-options">${option('data-intake-action="link"','link','Asociar con un empleado de SA',similar.length?'Ya existe en SA. Se recordará la asociación.':'Elegir un empleado que ya está en SA.')}
            ${option('data-intake-action="create"','plus','Agregar como empleado nuevo','Elegirás puesto, sueldo y datos.')}
            ${option('data-intake-action="pending"','clock','Dejar pendiente','Decidirlo más tarde.')}</div>`;
    };
    const candidateRow=(candidate,selectedId)=>{
        const e=candidate.employee;
        return `<button type="button" class="sa-p2p-peer-row sa-mini-intake-target ${selectedId===e.id?'is-online':''}" data-intake-target="${escapeAttr(e.id)}" data-intake-search-text="${escapeAttr(`${e.name} ${e.number}`.toLowerCase())}"><span class="sa-p2p-peer-avatar">${icon('user')}</span>
            <span class="sa-p2p-peer-copy"><span class="sa-p2p-peer-header-line"><strong>${esc(e.name)}</strong>${candidate.sameNumber?'<span class="sa-p2p-peer-type" data-intake-same-number>Mismo número</span>':''}${candidate.paused?'<span class="sa-p2p-peer-type">Pausado</span>':''}</span><span class="sa-p2p-peer-meta">Ficha ${esc(e.number)}</span></span></button>`;
    };
    const stepTarget=(i)=>{
        const choice=choices[i], source=sourceOf(i), {similar,all}=buildCandidateLists(source,employees,scope);
        return `${wizardHead(stepsFor(choice),'target')}<div><h3>¿Con quién se asocia ${esc(source.name)}?</h3><p>Ficha de Mini: ${esc(source.number)}.</p></div>
            <label class="sa-p2p-field"><span>Buscar</span><input type="search" data-intake-search value="${escapeAttr(search)}" placeholder="Nombre o ficha"></label>
            ${similar.length?`<p class="sa-p2p-section-label">Nombres parecidos</p><div class="sa-p2p-peer-list" data-intake-similar-list>${similar.map(c=>candidateRow(c,choice.employeeId)).join('')}</div>`:''}
            <p class="sa-p2p-section-label">Todos los empleados · por ficha</p><div class="sa-p2p-peer-list" data-intake-all-list>${all.map(c=>candidateRow(c,choice.employeeId)).join('')||'<div class="sa-p2p-empty">No hay empleados en esta obra.</div>'}</div>`;
    };
    const stepConfirm=(i)=>{
        const choice=choices[i], source=sourceOf(i), target=employeeOf(choice);
        if(!target)return `${wizardHead(stepsFor(choice),'confirm')}<div class="sa-p2p-status is-error">El empleado elegido ya no está disponible.</div>`;
        const existing=existingFields(target), paused=target.active===false, remember=String(source.number)!==String(target.number);
        return `${wizardHead(stepsFor(choice),'confirm')}<div><h3>Confirmar asociación</h3><p>${esc(source.name)} (ficha ${esc(source.number)}) → ${esc(target.name)} (ficha ${esc(target.number)})</p></div>
            <div class="sa-p2p-status"><strong>${esc(existing.name)}</strong><br><span>Puesto: ${esc(existing.position||'Sin puesto')} · ${existing.dailySalary?`${money(existing.dailySalary)} por día`:'Sin salario'}</span></div>
            ${remember?`<div class="sa-p2p-status" data-intake-remember>Mini usa la ficha ${esc(source.number)} y este empleado tiene la ${esc(target.number)}. Se recordará esta asociación para próximas importaciones.</div>`:''}
            ${paused?`<div class="sa-p2p-status is-warning" data-intake-paused>Este empleado está pausado. Debes reactivarlo para vincularlo.</div><label class="sa-mini-intake-check"><input type="checkbox" data-intake-reactivate ${choice.reactivate?'checked':''}><span>Reactivar a ${esc(target.name)}</span></label>`:''}
            <label class="sa-mini-intake-check"><input type="checkbox" data-intake-update ${choice.update?'checked':''}><span>Actualizar su ficha con los datos de Mini</span></label>
            ${choice.update?`${input(i,'name','Nombre')}${input(i,'number','Número de ficha')}${input(i,'dailySalary','Salario por día','number')}${input(i,'phone','Teléfono (opcional)','tel')}${input(i,'email','Correo (opcional)','email')}${positionControl(i)}`:''}
            <div class="sa-p2p-actions">${button('Listo',`data-intake-finish ${paused&&!choice.reactivate?'disabled':''}`,'primary')}</div>`;
    };
    const stepPosition=(i)=>`${wizardHead(stepsFor(choices[i]),'position')}<div><h3>¿Qué puesto tendrá ${esc(sourceOf(i).name)}?</h3><p>Es el mismo selector que usas en Personal.</p></div>${positionControl(i)}
        <div class="sa-p2p-actions">${button('Continuar',`data-intake-next ${choices[i].fields.position?'':'disabled'}`,'primary')}</div>`;
    const salaryOptions=(i)=>{
        const choice=choices[i], source=sourceOf(i), picked=chosenPosition(choice), fromPosition=picked?positionDailySuggestion(picked,hours):null;
        return [fromPosition!==null&&{mode:'position',value:fromPosition,label:`Usar el sueldo del puesto: ${money(fromPosition)} por día`},
            source.dailySalary!==null&&{mode:'mini',value:source.dailySalary,label:`Usar el sueldo de Mini: ${money(source.dailySalary)} por día`},
            {mode:'custom',value:null,label:'Escribir otro sueldo'}].filter(Boolean);
    };
    const stepSalary=(i)=>{
        const choice=choices[i], options=salaryOptions(i);
        if(!choice.salaryMode||!options.some(o=>o.mode===choice.salaryMode)){const first=options[0];choice.salaryMode=first.mode;if(first.value!==null)choice.fields.dailySalary=first.value;}
        const radios=options.map(o=>`<label class="sa-mini-intake-check"><input type="radio" name="intake-salary-${i}" data-intake-salary-mode="${o.mode}" ${choice.salaryMode===o.mode?'checked':''}><span>${esc(o.label)}</span></label>`).join('');
        return `${wizardHead(stepsFor(choice),'salary')}<div><h3>¿Cuánto gana por día?</h3><p>${options.length>1?'Elige una sugerencia o escribe uno nuevo.':'Escribe el sueldo diario.'}</p></div>${radios}
            ${choice.salaryMode==='custom'?input(i,'dailySalary','Salario por día','number'):''}
            <div class="sa-p2p-actions">${button('Continuar',`data-intake-next ${Number(choice.fields.dailySalary)>0?'':'disabled'}`,'primary')}</div>`;
    };
    const stepDetails=(i)=>{
        const choice=choices[i], candidates=intakeSuggestions({...sourceOf(i),...choice.fields},employees,scope);
        return `${wizardHead(stepsFor(choice),'details')}<div><h3>Datos del empleado</h3><p>Revisa antes de guardar. Se agregará al aceptar.</p></div>
            ${input(i,'name','Nombre')}${input(i,'number','Número de ficha')}${input(i,'phone','Teléfono (opcional)','tel')}${input(i,'email','Correo (opcional)','email')}
            <label class="sa-p2p-field"><span>Fecha de ingreso</span><input type="date" data-intake-hire="${i}" max="${today}" value="${escapeAttr(choice.hireDate)}"></label>
            ${candidates.length?`<div class="sa-p2p-status is-warning">Coincidencias en SA: ${candidates.map(e=>`${esc(e.name)} (${esc(e.number)})`).join(', ')}</div><label class="sa-mini-intake-check"><input type="checkbox" data-intake-different ${choice.confirmDifferent?'checked':''}><span>Son personas distintas; revisé la coincidencia</span></label>`:''}
            <div class="sa-p2p-actions">${button('Listo',`data-intake-finish ${candidates.length&&!choice.confirmDifferent?'disabled':''}`,'primary')}</div>`;
    };
    const renderWizard=()=>{
        const body={action:stepAction,target:stepTarget,confirm:stepConfirm,position:stepPosition,salary:stepSalary,details:stepDetails}[view.step](view.index);
        return `<section class="sa-p2p-step sa-mini-intake" data-intake-wizard="${view.step}">${body}</section>`;
    };

    const go=(index,step)=>{view={index,step};render();};
    const nextStep=()=>{const steps=stepsFor(choices[view.index]), at=steps.indexOf(view.step);if(at+1<steps.length)go(view.index,steps[at+1]);else go(null,'action');};
    const previousStep=()=>{const steps=stepsFor(choices[view.index]), at=steps.indexOf(view.step);if(at<=0)go(null,'action');else go(view.index,steps[at-1]);};
    const setAction=(i,action)=>{
        const choice=choices[i];
        if(choice.action!==action){Object.assign(choice,{update:false,reactivate:false,confirmDifferent:false,positionId:'',salaryMode:'',fields:{...sourceOf(i)}});if(action==='link')choice.employeeId='';}
        choice.action=action;
        if(action==='pending')go(null,'action');else go(i,stepsFor(choice)[1]);
    };
    const pickTarget=(i,id)=>{
        const choice=choices[i], employee=employees.find(e=>e.id===id);
        if(!employee)return;
        Object.assign(choice,{employeeId:id,update:false,reactivate:false,positionId:'',fields:{...sourceOf(i),...existingFields(employee)}});
        go(i,'confirm');
    };
    const applyPosition=(i,position)=>{const choice=choices[i];choice.positionId=position.id;choice.fields.position=position.name;choice.salaryMode='';render();};

    const bindList=()=>{
        host.querySelector('[data-intake-back]').onclick=()=>{if(!saving)onBack();};
        const done=host.querySelector('[data-intake-done]');if(done)done.onclick=onBack;
        const duplicates=host.querySelector('[data-intake-duplicates]');if(duplicates)duplicates.onclick=()=>globalThis.startMaintenanceWizard?.();
        const discard=host.querySelector('[data-intake-discard]');if(discard)discard.onclick=async()=>{if(saving)return;saving=true;try{await store.discard(entry.id,scope);onBack();}catch(error){messageText(error.message);}finally{saving=false;}};
        host.querySelectorAll('[data-intake-open]').forEach(el=>el.onclick=()=>{if(!saving)go(Number(el.dataset.intakeOpen),'action');});
        const acceptButton=host.querySelector('[data-intake-accept]');if(acceptButton)acceptButton.onclick=accept;
    };
    const bindWizard=()=>{
        const i=view.index, choice=choices[i];
        host.querySelector('[data-intake-step-back]').onclick=previousStep;
        host.querySelectorAll('[data-intake-action]').forEach(el=>el.onclick=()=>setAction(i,el.dataset.intakeAction));
        host.querySelectorAll('[data-intake-target]').forEach(el=>el.onclick=()=>pickTarget(i,el.dataset.intakeTarget));
        const searchInput=host.querySelector('[data-intake-search]');
        const filter=()=>host.querySelectorAll('[data-intake-search-text]').forEach(el=>{el.hidden=!!search&&!el.dataset.intakeSearchText.includes(search);});
        if(searchInput){searchInput.oninput=()=>{search=searchInput.value.trim().toLowerCase();filter();};filter();}
        host.querySelectorAll('[data-intake-field]').forEach(el=>el.oninput=()=>{
            const name=el.dataset.intakeField;
            choice.fields[name]=name==='dailySalary'?(el.value===''?null:Number(el.value)):el.value;
            if(name==='dailySalary')host.querySelector('[data-intake-next]')?.toggleAttribute('disabled',!(Number(choice.fields.dailySalary)>0));
        });
        host.querySelectorAll('[data-intake-hire]').forEach(el=>el.oninput=()=>{choice.hireDate=el.value;});
        host.querySelectorAll('[data-intake-salary-mode]').forEach(el=>el.onchange=()=>{
            const option=salaryOptions(i).find(o=>o.mode===el.dataset.intakeSalaryMode);
            choice.salaryMode=option.mode;
            if(option.value!==null)choice.fields.dailySalary=option.value;
            else if(!(Number(choice.fields.dailySalary)>0))choice.fields.dailySalary=null;
            render();
        });
        host.querySelectorAll('[data-intake-pick-position]').forEach(el=>el.onclick=()=>{
            const picker=openPositionPicker({positions,assignedIds:[],regularHours:hours,onAdd:position=>{applyPosition(i,position);picker?.close?.();}});
        });
        host.querySelectorAll('[data-intake-mini-position]').forEach(el=>el.onclick=()=>{choice.positionId='';choice.fields.position=sourceOf(i).position;choice.salaryMode='';render();});
        const bind=(selector,key,beforeRender)=>host.querySelectorAll(selector).forEach(el=>el.onchange=()=>{choice[key]=el.checked;beforeRender?.();render();});
        bind('[data-intake-reactivate]','reactivate');
        bind('[data-intake-different]','confirmDifferent');
        bind('[data-intake-update]','update',()=>{
            choice.positionId='';choice.salaryMode='';
            choice.fields=choice.update?{...sourceOf(i)}:{...sourceOf(i),...existingFields(employeeOf(choice))};
        });
        const next=host.querySelector('[data-intake-next]');if(next)next.onclick=nextStep;
        const finish=host.querySelector('[data-intake-finish]');if(finish)finish.onclick=()=>go(null,'action');
    };
    const render=()=>{
        DOMDiff.apply(host,view.index===null?renderList():renderWizard());
        if(view.index===null)bindList();else bindWizard();
    };

    const accept=async()=>{
        if(saving)return;
        if(!choices.some(c=>!c.accepted&&['create','link'].includes(c.action))){messageText('Resuelve al menos un empleado (crear o asociar) para aceptar.');return;}
        saving=true;host.querySelector('[data-intake-accept]').disabled=true;
        try{
            if(readOwner()!==owner)throw new Error('La cuenta cambió. Vuelve a abrir la revisión.');
            const currentScope=await resolveScope();if(currentScope.projectId!==scope.projectId)throw new Error('La obra cambió. Vuelve a revisar.');
            const decisions=choices.map(({accepted,salaryMode,...choice})=>({...choice,action:choice.action||'pending'}));
            const outcome=await store.accept(entry.id,decisions,{scope,hoursPerDay:hours,version});
            let aliasWarning=false;
            try{for(const record of aliasRecordsForLinks(entry,decisions.filter((d,i)=>!choices[i].accepted),employees,owner,scope.projectId))await aliasStore.record(record,{allowReplace:true,actorUid:owner});}catch(_){aliasWarning=true;}
            entry.mappings=outcome.result.mappings;entry.status=entry.mappings.length===entry.payload.employees.length?'resolved':'pending';
            // A proposal built from attendance is unknown to Mini, so there is nobody to answer.
            const sent=entry.local?false:sendResult(entry.peerId,outcome.result);
            // The same person sent by another origin is resolved there too; Mini recovers it on resend if offline.
            const repeated=outcome.autoResolved||[];
            repeated.forEach(({entry:other})=>{if(!other.local)sendResult(other.peerId,other.result);});
            const repeatedCount=repeated.reduce((total,item)=>total+item.added.length,0);
            await renderEmployeeIntakeReview(host,entry,{onBack,projectName,store,readState,resolveScope,sendResult,readOwner,aliasStore,openPositionPicker});
            messageText(`${outcome.result.mappings.length} empleados aceptados en SA. ${entry.local?'Las asistencias de esos empleados ya quedaron vinculadas en la revisión de asistencia.':sent?'Respuesta enviada a Mini.':'Vuelve a enviar la propuesta desde Mini para recuperar los vínculos.'}${outcome.syncWarning?' La sincronización con la nube sigue pendiente.':''}${repeatedCount?` También se resolvió${repeatedCount===1?'':'ron'} ${repeatedCount} empleado${repeatedCount===1?'':'s'} repetido${repeatedCount===1?'':'s'} en otros orígenes.`:''}${aliasWarning?' No se pudo recordar una asociación para próximas importaciones.':''}`);
        }catch(error){
            try{if(readOwner()!==owner||(await resolveScope()).projectId!==scope.projectId){host.replaceChildren();onBack();return;}}catch(_){host.replaceChildren();onBack();return;}
            render();messageText(error.message||'No se pudo aceptar. Tus cambios siguen en esta revisión.');host.querySelector('[data-intake-accept]').disabled=false;
        }
        finally{saving=false;}
    };
    render();return {choices,entry};
}
