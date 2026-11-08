import { indexedDB } from 'fake-indexeddb';
import { voiceAliasCollisions } from '../modules/features/voice/VoiceSettingsData.js';
import { VoiceSettingsPersonView } from '../modules/features/voice/VoiceSettingsAliasesView.js';
import { VoiceSettingsUI } from '../modules/features/voice/VoiceSettingsUI.js';
import { VoiceAliasView } from '../modules/features/voice/VoiceAliasView.js';
import { VoiceStore } from '../modules/features/voice/VoiceStore.js';
import { resolveVoiceEmployees, pickAutomaticVoiceMatch } from '../modules/features/voice/VoiceMatching.js';

const people = [
    { id:'a', number:'00017', name:'Ana Peña', active:true },
    { id:'b', number:'00028', name:'Ana Gómez', active:true },
    { id:'c', number:'00039', name:'Pedro <script>x</script>', active:true }
];
if (!globalThis.structuredClone) globalThis.structuredClone = value => JSON.parse(JSON.stringify(value));

const aliasRows = [
    { employeeId:'a', aliases:['anita', 'pedro'] },
    { employeeId:'b', aliases:['anita'] },
    { employeeId:'c', aliases:['anita'] }
];
const adapter = { getEmployees:()=>people, getPositions:()=>[] };
const ui = {
    adapter, aliases:aliasRows, employeeId:'a', busy:false,
    employee:()=>people[0],
    aliasesFor:id=>aliasRows.find(row=>row.employeeId===id)?.aliases||[]
};

test('308: collision discovery includes accented full names, name parts and other employee aliases', () => {
    expect(voiceAliasCollisions('ANITA', 'a', people, aliasRows).map(x=>x.id)).toEqual(['b','c']);
    expect(voiceAliasCollisions('ána', 'a', people, aliasRows).map(x=>x.id)).toEqual(['b']);
    expect(voiceAliasCollisions('Pedro', 'a', people, aliasRows).map(x=>x.id)).toEqual(['c']);
});

test('308: employee detail lists all shared owners by visible name and employee number', () => {
    const html = VoiceSettingsPersonView(ui);
    const node = document.createElement('section'); node.innerHTML=html;
    const item = [...node.querySelectorAll('.vs-alias-row')].find(x=>x.textContent.includes('anita'));
    expect(item).toBeDefined();
    expect(item.textContent).toContain('Compartida');
    expect(item.textContent).toContain('Ana Gómez');
    expect(item.textContent).toContain('00028');
    expect(item.textContent).toContain('Pedro <script>x</script>');
    expect(item.textContent).toContain('00039');
    expect(item.querySelector('script')).toBeNull();
});

test('308: edit warning includes every competing employee name AND number, without blocking legitimate sharing', () => {
    const instance = new VoiceSettingsUI(adapter);
    instance.dialog=document.createElement('section');
    instance.dialog.innerHTML='<input data-vs-alias-input><button data-vs-action="save-alias"></button><p data-vs-alias-warning hidden></p>';
    instance.aliases=aliasRows;instance.employeeId='a';instance.aliasText='anita';instance.editing='anita';instance.busy=false;
    instance.updateAliasWarning();
    const warning=instance.dialog.querySelector('[data-vs-alias-warning]');
    expect(warning.hidden).toBe(false);
    expect(warning.textContent).toContain('Ana Gómez');
    expect(warning.textContent).toContain('00028');
    expect(warning.textContent).toContain('00039');
    expect(instance.dialog.querySelector('[data-vs-action="save-alias"]').disabled).toBe(false);
});

test('308: confirmation warns when speech matches a different employee canonical name even without prior aliases', () => {
    const result = VoiceAliasView({
        adapter, busy:false, employeeAliases:[],
        aliasSelection:{ employeeId:'a', spokenName:'Ana Gómez' }
    }, (action, label)=>'<button>'+action+':'+label+'</button>');
    expect(result).toContain('compartida');
    expect(result).toContain('Ana Gómez');
    expect(result).toContain('00028');
});

test('308: a collision never teaches automatically nor removes another employee local association', async () => {
    const store = new VoiceStore({indexedDB,name:'voice-308-independent-'+Math.random()});
    try {
        await store.saveAlias('u','p','a','anita');
        await store.saveAlias('u','p','b','anita');
        await store.saveAlias('other','p','b','anita');
        await store.saveAlias('u','other-project','b','anita');
        const automatic=pickAutomaticVoiceMatch(resolveVoiceEmployees({spokenName:'anita'},people,await store.aliases('u','p')));
        expect(automatic).toBeNull();
        await store.editAlias('u','p','a','anita','ana pequeña');
        expect((await store.aliases('u','p')).find(x=>x.employeeId==='b').aliases).toEqual(['anita']);
        expect((await store.aliases('u','other-project')).find(x=>x.employeeId==='b').aliases).toEqual(['anita']);
        expect((await store.aliases('other','p')).find(x=>x.employeeId==='b').aliases).toEqual(['anita']);
        expect(people[0].name).toBe('Ana Peña');
    } finally { store.close(); }
});
