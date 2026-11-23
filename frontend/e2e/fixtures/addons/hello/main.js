// Example add-on: no build step, one custom element with the site's contract (attributes lang, active, base).
class AddonHello extends HTMLElement {
  static get observedAttributes() {
    return ['lang', 'active', 'base'];
  }

  connectedCallback() {
    if (this.querySelector('form')) return;
    this.innerHTML =
      '<h2>Hello</h2><p class="meta" id="state"></p>' +
      '<form><label>Name <input type="text" name="who"></label>' +
      '<button type="submit" class="primary">Download JSON</button></form>';
    this.querySelector('form').addEventListener('submit', (event) => {
      event.preventDefault();
      const who = this.querySelector('input').value;
      const blob = new Blob([JSON.stringify({ hello: who })], { type: 'application/json' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = 'hello.json';
      link.click();
      URL.revokeObjectURL(link.href);
    });
    this.update();
  }

  // attributes can arrive before or after connectedCallback: update() is safe in both cases
  attributeChangedCallback() {
    this.update();
  }

  update() {
    const state = this.querySelector('#state');
    if (state) {
      state.textContent = `lang=${this.getAttribute('lang')} base=${this.getAttribute('base')} active=${this.getAttribute('active')}`;
    }
  }
}
customElements.define('addon-hello', AddonHello);
