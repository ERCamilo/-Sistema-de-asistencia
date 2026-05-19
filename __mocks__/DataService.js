/**
 * Mock de DataService.js
 */
const dataService = {
    save: jest.fn().mockResolvedValue(undefined),
    load: jest.fn().mockResolvedValue(null),
    clear: jest.fn().mockResolvedValue(undefined)
};

export default dataService;
