import * as L from 'leaflet';
import { LangService } from '../core/lang.service';
import { MarkerStore } from '../core/marker.store';
import { measure } from '../core/measure';

/**
 * A ruler: click two points and a line with the distance in metres (and dx, dz) shows; a further click starts a new
 * measure. Nothing is kept. One map mode at a time: turning it on turns placing and moving off, and the other way round.
 */
export class MeasureTool {
  private readonly layer = L.layerGroup();
  private points: L.LatLng[] = [];
  private button?: HTMLButtonElement;

  constructor(
    private readonly map: L.Map,
    private readonly store: MarkerStore,
    private readonly world: number,
    private readonly lang: LangService,
  ) {
    this.layer.addTo(map);
    const Control = L.Control.extend({
      onAdd: () => {
        const box = L.DomUtil.create('div', 'leaflet-bar cm-control cm-control-ruler');
        this.button = L.DomUtil.create('button', 'cm-measure', box);
        this.button.type = 'button';
        L.DomEvent.disableClickPropagation(box);
        this.button.addEventListener('click', (e) => this.press(e.detail === 0));
        return box;
      },
    });
    new Control({ position: 'topleft' }).addTo(map);
    map.on('click', (e: L.LeafletMouseEvent) => {
      if (this.store.measuring()) this.add(e.latlng);
    });
  }

  /** The button's text and state, the cursor, and the line (gone when the mode ends). */
  sync(): void {
    const on = this.store.measuring();
    if (this.button) {
      this.button.textContent = this.lang.t('measureButton');
      this.button.setAttribute('aria-pressed', String(on));
    }
    this.map.getContainer().classList.toggle('cm-measuring', on);
    if (!on) this.clear();
  }

  /** With a pointer the button turns the mode on and off; from the keyboard it places a point at the centre of the view (and turns the mode on first). */
  private press(fromKeyboard: boolean): void {
    if (!fromKeyboard) return this.set(!this.store.measuring());
    this.set(true);
    this.add(this.map.getCenter());
  }

  private set(on: boolean): void {
    if (on) {
      this.store.placing.set(false);
      this.store.moving.set(null);
    }
    this.store.measuring.set(on);
  }

  private clear(): void {
    this.points = [];
    this.layer.clearLayers();
  }

  private add(at: L.LatLng): void {
    if (this.points.length === 2) this.clear(); // a third click starts a new measure
    this.points.push(at);
    L.circleMarker(at, { radius: 4, interactive: false }).addTo(this.layer);
    if (this.points.length < 2) return;
    const [a, b] = this.points;
    const m = measure({ x: a.lng, z: a.lat + this.world }, { x: b.lng, z: b.lat + this.world });
    const text = document.createElement('span');
    text.textContent = this.lang.t('measureLabel', { ...m }); // text only
    L.polyline([a, b], { weight: 3, dashArray: '6 6', interactive: false })
      .bindTooltip(text, { permanent: true, direction: 'center', className: 'cm-measure-label' })
      .addTo(this.layer);
  }
}
