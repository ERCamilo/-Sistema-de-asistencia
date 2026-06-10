/**
 * Mock for IndexedDBService.js
 * All methods are jest.fn() so individual tests can override behavior with
 * mockResolvedValueOnce / mockReturnValueOnce.
 *
 * ⚠️ API parity: el módulo real exporta `indexedDBService` (instancia,
 * named), `IndexedDBService` (clase) y default. PettyCashStore importa la
 * instancia NOMBRADA — si el mock no la exporta, recibe undefined y todos
 * sus try/catch se tragan el fallo en silencio.
 */
const mockService = {
    saveState: jest.fn().mockResolvedValue(undefined),
    loadState: jest.fn().mockResolvedValue(null),
    loadFullState: jest.fn().mockResolvedValue(null),
    clear: jest.fn().mockResolvedValue(undefined),
    clearAll: jest.fn().mockResolvedValue(undefined),
    isSupported: jest.fn().mockReturnValue(true),
    isAvailable: jest.fn().mockReturnValue(true),
    // Comprobantes de caja chica (v9)
    saveReceipt: jest.fn().mockResolvedValue(true),
    getReceipt: jest.fn().mockResolvedValue(null),
    deleteReceipt: jest.fn().mockResolvedValue(true),
    listPendingReceipts: jest.fn().mockResolvedValue([]),
    // Métodos genéricos usados por PettyCashStore (caja chica v10)
    getAll: jest.fn().mockResolvedValue([]),
    update: jest.fn().mockResolvedValue(1),
    delete: jest.fn().mockResolvedValue(undefined),
    batchUpdate: jest.fn().mockResolvedValue(0)
};

export const IndexedDBService = mockService;
export const indexedDBService = mockService;
export default mockService;
