import { PettyCashStore } from '../modules/features/pettycash/PettyCashStore.js';
import { indexedDBService } from '../modules/services/IndexedDBService.js';
test('a voice expense is not sent to remote queues when the local write fails', async () => {
    const write = jest.spyOn(indexedDBService, 'update').mockRejectedValue(Error('quota exceeded'));
    const mirror = jest.spyOn(PettyCashStore, 'enqueueMovementMirror');
    const flush = jest.spyOn(PettyCashStore, 'flush').mockImplementation(() => {});
    const flushMirror = jest.spyOn(PettyCashStore, 'flushMirror').mockImplementation(() => {});
    const warning = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
        const result = await PettyCashStore.save('movements', { id: 'voice-1', amount: 800 }, { requireLocal: true });
        expect(result.localOk).toBe(false);
        expect(write).toHaveBeenCalledTimes(1); expect(write.mock.calls[0][0]).toBe('pettyCashMovements');
        expect(mirror).not.toHaveBeenCalled(); expect(flush).not.toHaveBeenCalled(); expect(flushMirror).not.toHaveBeenCalled();
    } finally { write.mockRestore(); mirror.mockRestore(); flush.mockRestore(); flushMirror.mockRestore(); warning.mockRestore(); }
});
