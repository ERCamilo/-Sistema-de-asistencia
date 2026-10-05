// La ficha anterior sigue disponible con «Vista anterior»; estas pruebas la cubren.
beforeEach(() => { localStorage.setItem('loans-account-view', 'classic'); });
afterAll(() => { localStorage.removeItem('loans-account-view'); });
import './LoansLedgerUITests.js';
