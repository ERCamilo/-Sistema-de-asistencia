import { createSettingsSaveHarness } from './helpers/SettingsSaveHarness.js';
import { SettingsGeneralTab } from '../modules/ui/settings/SettingsGeneralTab.js';
import { SettingsTabCalendar } from '../modules/ui/settings/SettingsCalendarTab.js';
import { SettingsDataTab } from '../modules/ui/settings/SettingsDataTab.js';
import { HelpController } from '../modules/components/HelpController.js';
import { DOMDiff } from '../modules/utils/DOMDiff.js';
import { state, stateManager, renderOptimizer } from '../modules/core/AppState.js';
import { render, setRootComponent } from '../modules/core/RenderManager.js';
import { discardSettingsDraft, refreshSettingsDraftBar } from '../modules/ui/settings/SettingsDraftBar.js';
import { SettingsTab, initSettingsUI } from '../modules/ui/SettingsUI.js';

const icons = { get: () => '', getAvailableSets: () => ['unicode'] };
const settings = () => ({companyName:'Empresa',regularHoursPerDay:8,overtimeFactor:1.5,holidayFactor:2,restDayFactor:1.5,defaultDeductionPercentage:2,holidays:[],payPeriod:{},helpMode:'always'});
const context = st => ({ state:st, icons, holidayService:{renderSettingsCalendar:()=>''}, calculateStorageStats:()=>({percentage:0,usedMB:0,available:5}), currentUser:null });

afterEach(() => { discardSettingsDraft({});document.body.innerHTML='';jest.restoreAllMocks();delete window.helpController;delete window.showNotification;setRootComponent(null); });

describe('Ajustes: ejecución del handler real de guardado', () => {
    test.each(['regularHoursPerDay','overtimeFactor','holidayFactor','restDayFactor','defaultDeductionPercentage'])('rechaza %s vacío sin mutar ni anunciar éxito', field => {
        document.body.innerHTML=`<input type="number" id="${field}" value="">`;
        const harness=createSettingsSaveHarness();const before=JSON.stringify(harness.state);
        harness.save();
        expect(JSON.stringify(harness.state)).toBe(before);
        expect(harness.saveApplicationData).not.toHaveBeenCalled();
        expect(harness.showNotification).toHaveBeenCalledWith(expect.any(String),'error');
    });
    test('0 % sobrevive al guardar y volver a renderizar Calendario', () => {
        document.body.innerHTML='<input type="number" id="defaultDeductionPercentage" value="0">';
        const h=createSettingsSaveHarness();h.save();
        expect(h.state.settings.defaultDeductionPercentage).toBe(0);
        document.body.innerHTML=SettingsTabCalendar(context({...h.state,settings:{...h.state.settings,holidays:[]}}));
        expect(document.getElementById('defaultDeductionPercentage').value).toBe('0');
    });
});

describe('Ajustes: selector real de ayuda y controlador', () => {
    test.each([['always',true],['first-time',true],['off',false]])('change aplica y persiste %s desde el select', (mode,show) => {
        const st={settings:settings()}; const persist=jest.fn();
        window.helpController=new HelpController({getSettings:()=>st.settings,getSeenMap:()=>({}),persist});
        document.body.innerHTML=SettingsGeneralTab(context(st));
        const select=document.getElementById('helpModeSelect');
        select.value=mode;select.dispatchEvent(new Event('change',{bubbles:true}));
        expect(select.value).toBe(mode);
        expect(st.settings.helpMode).toBe(mode);
        expect(window.helpController.shouldAutoShow('field')).toBe(show);
        expect(persist).toHaveBeenCalledTimes(1);
    });
});

test('Datos: dos errores de avatar terminan en respaldo local sin nuevas URLs remotas', () => {
    const ctx=context({settings:settings(),snapshots:[]});ctx.currentUser={uid:'account',displayName:'Ana Perez',email:'a@example.invalid',photoURL:'https://lh3.googleusercontent.com/missing.png'};
    const root=document.createElement('div');document.body.append(root);DOMDiff.apply(root,SettingsDataTab(ctx));
    const img=root.querySelector('.stg-user-card img');
    // jsdom does not fetch images or execute inline handlers; execute the actual attribute.
    const onerror=new Function(img.getAttribute('onerror'));
    onerror.call(img);onerror.call(img);
    expect(root.querySelector('.stg-user-card img')).toBeNull();
    DOMDiff.apply(root,SettingsDataTab(ctx));
    expect(root.querySelector('.stg-user-card img')).toBeNull();
    expect(root.querySelector('.stg-user-card').textContent).toContain('AP');
});

test('Render real conserva un borrador ante cambio remoto del mismo campo y mantiene aviso', () => {
    stateManager.batchSetState(raw=>{raw.activeTab='settings';raw.settingsActiveTab='general';raw.settings={...raw.settings,...settings()};});
    document.body.innerHTML='<div id="root"></div>';
    initSettingsUI(context(state));setRootComponent(()=>SettingsTab());
    jest.spyOn(renderOptimizer,'scheduleRender').mockImplementation(callback=>callback());
    render();const input=document.getElementById('companyName');input.value='Mi borrador';refreshSettingsDraftBar(document);
    stateManager.batchSetState(raw=>{raw.settings.companyName='Nombre remoto';});render();
    expect(document.getElementById('companyName').value).toBe('Mi borrador');
    expect(document.getElementById('settings-draft-bar').hidden).toBe(false);
    expect(document.getElementById('settings-draft-bar').textContent).toMatch(/otro dispositivo|conflicto|cambi[oó]/i);
});

describe('Ajustes: límites y números no finitos',()=>{
    test.each([
        ['regularHoursPerDay',0],['regularHoursPerDay',25],
        ['overtimeFactor',0],['overtimeFactor',6],['holidayFactor',0],['holidayFactor',6],
        ['restDayFactor',0],['restDayFactor',6],['defaultDeductionPercentage',-1],['defaultDeductionPercentage',101]
    ])('rechaza %s=%s sin guardar', (field,value)=>{
        document.body.innerHTML=`<input type="number" id="${field}" value="${value}">`;
        const h=createSettingsSaveHarness();h.save();expect(h.saveApplicationData).not.toHaveBeenCalled();
    });
    test.each([NaN,Infinity,-Infinity])('rechaza valores no finitos ya presentes en la base: %s', value=>{
        const h=createSettingsSaveHarness();h.state.settings.regularHoursPerDay=value;h.save();
        expect(h.saveApplicationData).not.toHaveBeenCalled();
    });
    test('guardar con proyecto activo conserva 0 % en su configuración',async()=>{
        document.body.innerHTML='<input type="number" id="defaultDeductionPercentage" value="0">';
        let cfg=settings();const h=createSettingsSaveHarness({isProjectsEnabled:()=>true,payrollUIRuntime:{getCurrentView:()=>({config:cfg,projectId:'A'}),updateConfig:jest.fn(async mutate=>{cfg=mutate(cfg);})}});
        await h.save();expect(cfg.defaultDeductionPercentage).toBe(0);expect(h.state.settings.defaultDeductionPercentage).toBe(2);
    });
});

test.each(['general','calendar'])('todos los campos visibles de %s tienen etiquetas asociadas', tab=>{
    const st={settings:settings()};document.body.innerHTML=tab==='general'?SettingsGeneralTab(context(st)):SettingsTabCalendar(context(st));
    for (const el of document.querySelectorAll('input,select')) expect(el.labels.length || el.getAttribute('aria-label') || el.getAttribute('aria-labelledby')).toBeTruthy();
});

test.each([['once','first-time'],['hidden','off']])('preferencia anterior %s conserva su significado al mostrar Ajustes', (legacy,mode)=>{
    const st={settings:{...settings(),helpMode:legacy}};
    document.body.innerHTML=SettingsGeneralTab(context(st));
    expect(document.getElementById('helpModeSelect').value).toBe(mode);
    expect(new HelpController({getSettings:()=>st.settings}).getMode()).toBe(mode);
});

test('un guardado propio con texto normalizado no genera un falso conflicto remoto',()=>{
    stateManager.batchSetState(raw=>{raw.activeTab='settings';raw.settingsActiveTab='general';raw.settings={...raw.settings,...settings()};});
    document.body.innerHTML='<div id="root"></div>';initSettingsUI(context(state));setRootComponent(()=>SettingsTab());
    jest.spyOn(renderOptimizer,'scheduleRender').mockImplementation(callback=>callback());render();
    document.getElementById('companyName').value='  Empresa ajustada  ';
    const h=createSettingsSaveHarness({state,stateManager,render});h.save();
    expect(state.settings.companyName).toBe('Empresa ajustada');
    expect(document.getElementById('companyName').value).toBe('Empresa ajustada');
    expect(document.getElementById('settings-draft-bar').hidden).toBe(true);
});

test.each([false,true])('guardar incorpora un cambio remoto antes del próximo frame (borrador=%s)', dirty=>{
    stateManager.batchSetState(raw=>{raw.activeTab='settings';raw.settingsActiveTab='general';raw.settings={...raw.settings,...settings()};});
    document.body.innerHTML='<div id="root"></div>';initSettingsUI(context(state));setRootComponent(()=>SettingsTab());
    jest.spyOn(renderOptimizer,'scheduleRender').mockImplementation(callback=>callback());render();
    if(dirty) document.getElementById('companyName').value='Borrador';
    renderOptimizer.scheduleRender.mockImplementation(()=>{});
    stateManager.batchSetState(raw=>{raw.settings.companyName='Llegó antes del frame';});
    const ask=jest.fn();const previous=window.showConfirm;window.showConfirm=ask;
    try {
        const h=createSettingsSaveHarness({state,stateManager,render});h.save();
        if(dirty) {
            expect(document.getElementById('companyName').value).toBe('Borrador');
            expect(ask).toHaveBeenCalledTimes(1);expect(h.saveApplicationData).not.toHaveBeenCalled();
        } else {
            expect(state.settings.companyName).toBe('Llegó antes del frame');expect(h.saveApplicationData).toHaveBeenCalledTimes(1);
        }
    } finally {window.showConfirm=previous;}
});
