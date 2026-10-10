import { indexedDB } from 'fake-indexeddb';
import { VoiceStore } from '../modules/features/voice/VoiceStore.js';
import { voiceRetentionPolicy, voiceStorageStatus, VOICE_AUDIO_BUDGET, VOICE_DAY } from '../modules/features/voice/VoiceRetention.js';

// Preserve native Blob data in environments without structuredClone.
if (!globalThis.structuredClone) globalThis.structuredClone = function clone(value) {
    if (value instanceof Blob) return value.slice(0, value.size, value.type);
    if (Array.isArray(value)) return value.map(clone);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k,v]) => [k, clone(v)]));
    return value;
};
const now = Date.UTC(2026,9,9,14);
let store;
beforeEach(() => { store = new VoiceStore({ indexedDB, name: 'voice-retention-' + Math.random() }); });
afterEach(() => store.close());
const loan = (overrides = {}) => ({ uid: 'one', projectKey: 'project', requestId: 'request', createdAt: now - VOICE_DAY, registeredAt: now, completedLoanId: 'loan', selectedEmployeeId: 'worker', audio: new Blob(['audio']), ...overrides });
test('five days are counted from registration; expiry removes audio but preserves receipt', async () => {
    await store.put(loan());
    await store.maintain('one', { keep:true, days:5 }, now + 5*VOICE_DAY - 1);
    expect((await store.get('one','request')).audio).toBeDefined();
    await store.maintain('one', { keep:true, days:5 }, now + 5*VOICE_DAY);
    expect(await store.get('one','request')).toMatchObject({ completedLoanId:'loan', selectedEmployeeId:'worker' });
    expect((await store.get('one','request')).audio).toBeUndefined();
});
test('no retention removes only this user’s loan audio; clear also discards pending drafts', async () => {
    await store.put(loan()); await store.put(loan({uid:'two'}));
    await store.put(loan({requestId:'pending',completedLoanId:null}));
    await store.maintain('one',{keep:false,days:5},now);
    expect((await store.get('one','request')).audio).toBeUndefined();
    expect((await store.get('two','request')).audio).toBeDefined();
    await store.clearAudio('one');
    expect(await store.get('one','pending')).toBeUndefined();
    expect((await store.get('two','request')).audio).toBeDefined();
});
test('shortening retention does not resurrect or extend a previously shortened deadline', async () => {
    await store.put(loan()); await store.maintain('one',{keep:true,days:2},now);
    await store.maintain('one',{keep:true,days:5},now);
    expect((await store.get('one','request')).audioExpiresAt).toBe(now + 2*VOICE_DAY);
    await store.maintain('one',{keep:true,days:5},now+2*VOICE_DAY);
    expect((await store.get('one','request')).audio).toBeUndefined();
});
test('an abandoned draft expires after one day, without changing another recent draft', async () => {
    await store.put(loan({completedLoanId:null,createdAt:now-VOICE_DAY}));
    await store.put(loan({completedLoanId:null,requestId:'recent',createdAt:now}));
    await store.maintain('one',{keep:true,days:5},now);
    expect(await store.get('one','request')).toBeUndefined();
    expect((await store.get('one','recent')).audio).toBeDefined();
});
test('storage warning detects own budget and shared quota, including browsers without estimates', async () => {
    expect(await voiceStorageStatus([{audio:{size:VOICE_AUDIO_BUDGET*.8}}],()=>null)).toMatchObject({low:true});
    expect(await voiceStorageStatus([],()=>({quota:100,usage:90}))).toMatchObject({low:true,available:10});
    expect(await voiceStorageStatus([],()=>Promise.reject(Error('unsupported')))).toMatchObject({low:false,available:null});
    expect(voiceRetentionPolicy()).toEqual({keep:true,days:5});
    expect(voiceRetentionPolicy({voiceAudioRetentionDays:10,voiceKeepLoanAudio:false})).toEqual({keep:false,days:5});
});
