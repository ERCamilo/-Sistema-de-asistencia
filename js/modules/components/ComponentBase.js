export class ComponentBase {
    constructor(props = {}) {
        this.props = props;
        this.state = {};
        this.element = null;
    }

    // Método para renderizar (debe ser sobrescrito)
    render() {
        throw new Error('render() debe ser implementado por la subclase');
    }

    // Actualizar props
    updateProps(newProps) {
        this.props = { ...this.props, ...newProps };
        return this;
    }

    // Actualizar estado interno
    setState(updates) {
        this.state = { ...this.state, ...updates };
        return this;
    }

    // Crear elemento HTML desde string
    createElement(html) {
        const template = document.createElement('template');
        template.innerHTML = html.trim();
        return template.content.firstChild;
    }

    // Obtener HTML renderizado
    toHTML() {
        return this.render();
    }
}
