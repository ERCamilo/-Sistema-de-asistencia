import { ComponentBase } from './ComponentBase.js';

export class BadgeComponent extends ComponentBase {
    constructor(props) {
        super(props);
        // props: { text, variant?, size? }
    }

    render() {
        const { text, variant = 'default', size = 'medium' } = this.props;

        return `
                    <span class="badge badge-${variant} badge-${size}">
                        ${text}
                    </span>
                `;
    }
}
