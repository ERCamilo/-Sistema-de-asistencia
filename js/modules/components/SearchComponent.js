import { icons } from '../ui/IconSystem.js';
import { ComponentBase } from './ComponentBase.js';

export class SearchComponent extends ComponentBase {
    constructor(props) {
        super(props);
        // props: { placeholder, onSearch, debounceTime? }
    }

    render() {
        const { placeholder, onSearch, debounceTime = 300 } = this.props;

        return `
                    <div class="search-component">
                        <span class="search-icon">${icons.get('edit')}</span>
                        <input 
                            type="text" 
                            class="search-input" 
                            placeholder="${placeholder || 'Buscar...'}"
                            oninput="debounce(${onSearch}, ${debounceTime})(event.target.value)">
                    </div>
                `;
    }
}
