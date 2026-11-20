// A minimal stand-in for the add-on: two custom elements with the contract's attributes (lang, active).
class Fake extends HTMLElement {
  static get observedAttributes() {
    return ['lang', 'active'];
  }
  connectedCallback() {
    if (this.querySelector('textarea')) return;
    this.innerHTML =
      '<h2>Fake add-on</h2><p class="meta" id="state"></p>' +
      '<p><label>Draft <textarea rows="2"></textarea></label></p><button type="button">Act</button>';
    this.update();
  }
  attributeChangedCallback() {
    this.update();
  }
  update() {
    const state = this.querySelector('#state');
    if (state)
      state.textContent = `lang=${this.getAttribute('lang')} active=${this.getAttribute('active')}`;
  }
}
customElements.define('addon-server', class extends Fake {});
customElements.define('addon-chestsort', class extends Fake {});
