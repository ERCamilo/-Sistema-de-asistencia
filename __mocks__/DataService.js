export class DataService {
    constructor() {}
    save() { return Promise.resolve(); }
    load() { return Promise.resolve(null); }
    clear() { return Promise.resolve(); }
    saveAll() {}
    loadAll() { return false; }
}

const dataService = new DataService();
dataService.save = jest.fn().mockResolvedValue(undefined);
dataService.load = jest.fn().mockResolvedValue(null);
dataService.clear = jest.fn().mockResolvedValue(undefined);
dataService.saveAll = jest.fn();
dataService.loadAll = jest.fn().mockReturnValue(false);
export default dataService;
