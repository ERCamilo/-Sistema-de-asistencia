import { SettingsGeneralTab } from '../modules/ui/settings/SettingsGeneralTab.js';
import { DOMDiff } from '../modules/utils/DOMDiff.js';
import { handleRemoteSettings } from '../modules/services/SettingsLiveSync.js';
import { captureSettingsDraft, restoreSettingsDraft, refreshSettingsDraftBar, discardSettingsDraft, guardSettingsDraftBeforeSave } from '../modules/ui/settings/SettingsDraftBar.js';

const icons={get:()=>'',getAvailableSets:()=>['unicode']};
let st;
function draw(scope='global') {
    const root=document.getElementById('root');
    const snapshot=captureSettingsDraft(document);
    DOMDiff.apply(root,`<div id="settings-screen" data-settings-draft-tab="general" data-settings-draft-scope="${scope}">${SettingsGeneralTab({state:st,icons})}</div>`);
    restoreSettingsDraft(snapshot,document);refreshSettingsDraftBar(document);
}
function remote(values) {
    handleRemoteSettings({state:st,batchSetState:callback=>callback(),remoteDoc:{settings:{...values,localUpdatedAt:2000},lastChangedBy:'remote'},deps:{getDeviceId:()=> 'local'}});
    draw();
}
beforeEach(()=>{document.body.innerHTML='<div id="root"></div>';st={employees:[{id:'1'}],settings:{companyName:'Base',iconSet:'unicode',localUpdatedAt:1000}};draw();});
afterEach(()=>{discardSettingsDraft({});document.body.innerHTML='';delete window.showNotification;});

test('nuevo valor remoto del mismo campo conserva el borrador y exige confirmar',()=>{
    document.getElementById('companyName').value='Borrador';remote({companyName:'Remoto'});
    expect(document.getElementById('companyName').value).toBe('Borrador');
    const proceed=jest.fn();let options;
    expect(guardSettingsDraftBeforeSave({showConfirm:opts=>{options=opts;},onProceed:proceed}).blocked).toBe(true);
    expect(proceed).not.toHaveBeenCalled();
    // Focus moves into the real confirmation dialog; this is not another edit.
    const button=document.createElement('button');document.body.append(button);button.focus();
    options.onConfirm();expect(proceed).toHaveBeenCalledTimes(1);
    expect(guardSettingsDraftBeforeSave({}).blocked).toBe(false);
});
test('actualización de otro campo se incorpora sin perder el borrador ni pedir conflicto',()=>{
    document.getElementById('companyName').value='Borrador';remote({scrollbarMode:'hidden'});
    expect(document.getElementById('companyName').value).toBe('Borrador');
    expect(document.getElementById('scrollbarMode').value).toBe('hidden');
    expect(guardSettingsDraftBeforeSave({}).blocked).toBe(false);
});
test('descartar después del conflicto usa el valor remoto más reciente',()=>{
    document.getElementById('companyName').value='Borrador';remote({companyName:'Remoto'});
    discardSettingsDraft({});expect(document.getElementById('companyName').value).toBe('Remoto');
    expect(guardSettingsDraftBeforeSave({}).blocked).toBe(false);
});
test('un eco local no cambia la base ni genera conflicto',()=>{
    document.getElementById('companyName').value='Borrador';
    handleRemoteSettings({state:st,batchSetState:cb=>cb(),remoteDoc:{settings:{companyName:'Eco',localUpdatedAt:9999},lastChangedBy:'local'},deps:{getDeviceId:()=> 'local'}});draw();
    expect(document.getElementById('companyName').value).toBe('Borrador');
    expect(guardSettingsDraftBeforeSave({}).blocked).toBe(false);
});
test('convergencia con el valor remoto elimina el conflicto sin sobrescritura',()=>{
    document.getElementById('companyName').value='Borrador';remote({companyName:'Borrador'});
    expect(guardSettingsDraftBeforeSave({}).blocked).toBe(false);
    expect(document.getElementById('settings-draft-bar').hidden).toBe(true);
});
test('cambio de proyecto conserva el borrador pero bloquea guardarlo hasta descartarlo',()=>{
    document.getElementById('companyName').value='Borrador';st.settings.companyName='Otra obra';draw('project-b');
    const proceed=jest.fn();const ask=jest.fn();
    expect(guardSettingsDraftBeforeSave({showConfirm:ask,onProceed:proceed}).blocked).toBe(true);
    expect(ask).not.toHaveBeenCalled();expect(proceed).not.toHaveBeenCalled();
    discardSettingsDraft({});expect(document.getElementById('companyName').value).toBe('Otra obra');
    expect(guardSettingsDraftBeforeSave({}).blocked).toBe(false);
});
test('confirmación obsoleta no sobrescribe otra actualización mientras el diálogo está abierto',()=>{
    document.getElementById('companyName').value='Borrador';remote({companyName:'Remoto'});
    let options;let revision=1;const proceed=jest.fn();
    guardSettingsDraftBeforeSave({showConfirm:opts=>{options=opts;},onProceed:proceed,getRevision:()=>revision});
    revision=2;options.onConfirm();expect(proceed).not.toHaveBeenCalled();
    expect(guardSettingsDraftBeforeSave({showConfirm:()=>{}}).blocked).toBe(true);
});
test('otro cambio renderizado invalida la confirmación anterior',()=>{
    document.getElementById('companyName').value='Borrador';remote({companyName:'Remoto'});
    let options;const proceed=jest.fn();guardSettingsDraftBeforeSave({showConfirm:opts=>{options=opts;},onProceed:proceed});
    st.settings.companyName='Más reciente';draw();options.onConfirm();expect(proceed).not.toHaveBeenCalled();
});
test('sin confirmación disponible, un conflicto sigue bloqueado',()=>{
    document.getElementById('companyName').value='Borrador';remote({companyName:'Remoto'});
    const previous=window.showConfirm;delete window.showConfirm;
    expect(guardSettingsDraftBeforeSave({}).blocked).toBe(true);window.showConfirm=previous;
});

test('un panel de carga temporal conserva el borrador hasta que reaparecen los campos',()=>{
    document.getElementById('companyName').value='Borrador';
    const snapshot=captureSettingsDraft(document);
    DOMDiff.apply(document.getElementById('root'),'<div id="settings-screen" data-settings-draft-tab="general" data-settings-draft-scope="project-b">Cargando…</div>');
    restoreSettingsDraft(snapshot,document);refreshSettingsDraftBar(document);
    expect(document.getElementById('settings-draft-bar').hidden).toBe(false);
    st.settings.companyName='Base B';draw('project-b');
    expect(document.getElementById('companyName').value).toBe('Borrador');
    expect(guardSettingsDraftBeforeSave({}).blocked).toBe(true);
    discardSettingsDraft({});expect(document.getElementById('companyName').value).toBe('Base B');
});
test('select y checkbox editados sobreviven a actualizaciones de sus bases',()=>{
    document.getElementById('scrollbarMode').value='hidden';
    document.getElementById('showAttendanceCardDeficit').checked=true;
    remote({scrollbarMode:'on-scroll',showAttendanceCardDeficit:true});
    expect(document.getElementById('scrollbarMode').value).toBe('hidden');
    expect(document.getElementById('showAttendanceCardDeficit').checked).toBe(true);
    expect(guardSettingsDraftBeforeSave({showConfirm:()=>{}}).blocked).toBe(true);
});
