/**
 * DOMDiff - A lightweight DOM diffing utility to patch the DOM instead of replacing it.
 * Designed for high-performance Vanilla JS applications where state changes should
 * not cause global UI flickering.
 * 
 * @author Antigravity (Senior Amazon Engineer)
 */
export class DOMDiff {
    /**
     * Patches an existing DOM element to match a new HTML structure.
     * @param {HTMLElement} target - The current DOM element to update.
     * @param {string|HTMLElement} source - The new HTML string or element to compare against.
     */
    static apply(target, source) {
        if (!target) return;

        let newRoot;
        if (typeof source === 'string') {
            const template = document.createElement('template');
            template.innerHTML = source.trim();
            
            // We patch the children of 'target' to match the children of the template
            this.patchChildren(target, template.content);
            return;
        }

        this.patch(target, source);
    }

    /**
     * Recursively patches oldNode to match newNode.
     * @param {Node} oldNode 
     * @param {Node} newNode 
     */
    static patch(oldNode, newNode) {
        // 1. If nodes are different types, replace entirely
        if (oldNode.nodeType !== newNode.nodeType || oldNode.nodeName !== newNode.nodeName) {
            oldNode.parentNode.replaceChild(newNode.cloneNode(true), oldNode);
            return;
        }

        // 2. Handle Text Nodes
        if (oldNode.nodeType === Node.TEXT_NODE) {
            if (oldNode.textContent !== newNode.textContent) {
                oldNode.textContent = newNode.textContent;
            }
            return;
        }

        // 3. Handle Element Nodes
        if (oldNode.nodeType === Node.ELEMENT_NODE) {
            this.patchAttributes(oldNode, newNode);
            this.patchChildren(oldNode, newNode);
        }
    }

    /**
     * Syncs attributes from newNode to oldNode.
     * @param {HTMLElement} oldNode 
     * @param {HTMLElement} newNode 
     */
    static patchAttributes(oldNode, newNode) {
        const oldAttrs = oldNode.attributes;
        const newAttrs = newNode.attributes;

        // Add or update attributes from newNode
        for (let i = 0; i < newAttrs.length; i++) {
            const { name, value } = newAttrs[i];
            if (oldNode.getAttribute(name) !== value) {
                oldNode.setAttribute(name, value);
            }
        }

        // Remove attributes that are not in newNode
        for (let i = oldAttrs.length - 1; i >= 0; i--) {
            const { name } = oldAttrs[i];
            if (!newNode.hasAttribute(name)) {
                oldNode.removeAttribute(name);
            }
        }

        // Special handling for value property in inputs/textarea
        if (oldNode.tagName === 'INPUT' || oldNode.tagName === 'TEXTAREA') {
            if (oldNode.value !== newNode.value) {
                oldNode.value = newNode.value;
            }
        }
    }

    /**
     * Syncs children of oldNode to match children of newNode.
     * @param {HTMLElement} oldNode 
     * @param {HTMLElement} newNode 
     */
    static patchChildren(oldNode, newNode) {
        const oldChildren = Array.from(oldNode.childNodes);
        const newChildren = Array.from(newNode.childNodes);

        const maxLength = Math.max(oldChildren.length, newChildren.length);

        for (let i = 0; i < maxLength; i++) {
            const oldChild = oldChildren[i];
            const newChild = newChildren[i];

            // Case 1: New child exists, but no old child -> Append
            if (!oldChild && newChild) {
                oldNode.appendChild(newChild.cloneNode(true));
                continue;
            }

            // Case 2: Old child exists, but no new child -> Remove
            if (oldChild && !newChild) {
                oldNode.removeChild(oldChild);
                continue;
            }

            // Case 3: Both exist -> Patch recursively
            if (oldChild && newChild) {
                // To optimize, if it's the same HTML, we could skip (optional)
                // But full deep patch is more reliable for simple implementations
                this.patch(oldChild, newChild);
            }
        }
    }
}
