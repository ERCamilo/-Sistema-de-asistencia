import { ComponentBase } from './ComponentBase.js';

export class TooltipComponent extends ComponentBase {
    constructor(props) {
        super(props);
        // props: { content, position?, trigger? }
    }

    render() {
        const { content, position = 'top', trigger } = this.props;

        return `
                    <div class="tooltip-wrapper" data-tooltip="${content}" data-position="${position}">
                        ${trigger}
                    </div>
                `;
    }
}
