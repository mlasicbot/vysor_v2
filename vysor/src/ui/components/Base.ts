// src/ui/components/Base.ts
export abstract class Component<P = unknown> {
  el: HTMLElement;
  protected props!: P;

  constructor(tag = 'div', cls?: string) {
    this.el = document.createElement(tag);
    if (cls) this.el.className = cls;
  }

  /** Append to parent, set props, render, and return the instance for chaining */
  mount(parent: HTMLElement, props: P): this {
    this.props = props;
    parent.appendChild(this.el);
    this.render();
    return this;
  }

  /** Replace props and re-render; returns the instance for chaining */
  update(next: P): this {
    this.props = next;
    this.render();
    return this;
  }

  /** Remove from DOM */
  destroy(): void {
    this.el.remove();
    // @ts-expect-error intentional clear for GC
    this.props = undefined;
  }

  protected abstract render(): void;
}
