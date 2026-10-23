import {
  Component,
  DestroyRef,
  ElementRef,
  ViewEncapsulation,
  afterNextRender,
  effect,
  inject,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import * as L from 'leaflet';
import { AuthService } from '../core/auth.service';
import { Catalog, PlacedResource } from '../core/catalog.service';
import { FilterStore } from '../core/filter.store';
import { LangService } from '../core/lang.service';
import { MapMarker, itemKey, markId } from '../core/map-data.model';
import { MapDataService } from '../core/map-data.service';
import { ProgressStore } from '../core/progress.store';
import { TeamStore } from '../core/team.store';

// Icon size per zoom level, and the zoom from which each label kind shows.
const iconSize = (zoom: number): number =>
  zoom <= -4 ? 14 : zoom <= -3 ? 20 : zoom <= -2 ? 26 : 32;
// Fixed popup size: the largest the content ever got (longest names, wrapped) was 301 x 106 px.
const POPUP_SIZE = { minWidth: 300, maxWidth: 300 };
const LABEL_MIN_ZOOM: Record<string, number> = { region: -5, areaName: -2.5 };

interface Placed {
  m: MapMarker;
  layer: L.Marker | L.CircleMarker;
  id: string | null; // null for labels: they cannot be marked
  key: string;
}

interface DotLayer {
  layer: L.FeatureGroup;
  dots: L.CircleMarker[];
}

type MarkedDot = L.CircleMarker & { markId: string; index: number };

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className = '',
  text = '',
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  node.textContent = text;
  return node;
}

@Component({
  selector: 'app-map',
  encapsulation: ViewEncapsulation.None, // styles reach the elements Leaflet creates
  templateUrl: './map-view.html',
  styleUrl: './map-view.css',
})
export class MapView {
  private readonly mapData = inject(MapDataService);
  private readonly catalog = inject(Catalog);
  private readonly filters = inject(FilterStore);
  private readonly lang = inject(LangService);
  private readonly auth = inject(AuthService);
  private readonly progress = inject(ProgressStore);
  private readonly team = inject(TeamStore);
  private readonly host = viewChild.required<ElementRef<HTMLElement>>('host');

  protected readonly coords = signal('');
  protected readonly biomes = signal<{ color: string; label: string }[]>([]);
  protected readonly legendOn = signal(false);

  private readonly ready = signal(false);
  private readonly zoom = signal(0);
  private readonly size = this.mapData.data.worldSize;
  private map!: L.Map;
  private biomesLayer!: L.ImageOverlay;
  private layersControl!: L.Control.Layers;
  private readonly placed: Placed[] = [];
  private readonly groups = new Map<string, L.LayerGroup>();
  private readonly icons = new Map<string, L.Icon>();
  private readonly dotLayers = new Map<PlacedResource, DotLayer>();
  private readonly dotRenderer = L.canvas({ padding: 0.3, tolerance: 3 });
  private openActions: HTMLElement | null = null;

  constructor() {
    inject(DestroyRef).onDestroy(() => this.map?.remove());
    afterNextRender(() => {
      this.init();
      this.ready.set(true);
      void this.mapData.loadResources();
    });
    effect(() => this.applyVisibility());
    effect(() => this.applyLanguage());
    effect(() => this.applyDone());
    effect(() => {
      this.auth.user();
      this.progress.done();
      this.team.others();
      this.team.total();
      if (this.openActions) this.renderActions(this.openActions);
    });
  }

  // The world is placed at lat = z - size (all negative) so that tile rows
  // start at the north edge with y = 0 at every zoom level.
  private latLng(x: number, z: number): L.LatLngTuple {
    return [z - this.size, x];
  }

  private init(): void {
    const bounds = L.latLngBounds([
      [-this.size, 0],
      [0, this.size],
    ]);
    this.map = L.map(this.host().nativeElement, {
      crs: L.CRS.Simple,
      minZoom: -5,
      maxZoom: 2,
      zoomSnap: 0.5,
      attributionControl: false,
      maxBounds: bounds.pad(0.15),
    });
    this.map.fitBounds(bounds);
    L.tileLayer('tiles/{z}/{x}_{y}.jpg', {
      minNativeZoom: -5,
      maxNativeZoom: 0,
      minZoom: -5,
      maxZoom: 2,
      tileSize: 256,
      noWrap: true,
      bounds,
      keepBuffer: 4,
    }).addTo(this.map);
    this.biomesLayer = L.imageOverlay('biomes.png', bounds, { opacity: 0.85 });
    this.layersControl = L.control
      .layers(undefined, undefined, { position: 'topright' })
      .addTo(this.map);
    this.zoom.set(this.map.getZoom());

    this.map.on('overlayadd overlayremove', (e: L.LeafletEvent) => {
      if ((e as L.LayersControlEvent).layer === this.biomesLayer)
        this.legendOn.set(e.type === 'overlayadd');
    });
    this.map.on('mousemove', (e: L.LeafletMouseEvent) =>
      this.coords.set(`X ${Math.round(e.latlng.lng)} · Z ${Math.round(e.latlng.lat + this.size)}`),
    );
    this.map.on('mouseout', () => this.coords.set(''));
    this.map.on('zoomend', () => this.onZoom());
    this.map.on('popupopen', (e: L.PopupEvent) => {
      this.openActions = e.popup.getElement()?.querySelector<HTMLElement>('.popup-actions') ?? null;
      if (this.openActions) this.renderActions(this.openActions);
    });
    this.map.on('popupclose', () => (this.openActions = null));

    for (const m of this.mapData.data.markers) this.place(m);
    for (const group of this.groups.values()) group.addTo(this.map);
    this.map.invalidateSize();
  }

  private place(m: MapMarker): void {
    const cat = this.mapData.data.categories[m.cat];
    const at = this.latLng(m.x, m.z);
    let layer: L.Marker | L.CircleMarker;
    if (cat.kind === 'label') layer = L.marker(at, { icon: this.labelIcon(m), keyboard: false });
    else if (cat.icon)
      layer = L.marker(at, {
        icon: this.iconFor(m, iconSize(this.map.getZoom())),
        riseOnHover: true,
      });
    else
      layer = L.circleMarker(at, {
        radius: 4,
        color: '#000',
        weight: 1,
        fillColor: '#ccc',
        fillOpacity: 0.9,
      });

    const id = cat.kind === 'label' ? null : markId(m.cat, m.x, m.z);
    const p: Placed = { m, layer, id, key: itemKey(m.name) };
    if (cat.kind !== 'label') {
      // Elements, not strings: Leaflet would put a string in innerHTML.
      layer.bindTooltip(() => el('span', '', m.name[this.lang.index()]), {
        direction: 'top',
        offset: [0, -iconSize(this.map.getZoom()) / 2],
      });
    }
    layer.bindPopup(() => this.markerPopup(m, id), POPUP_SIZE);
    if (id) {
      layer.on('contextmenu', () => this.toggle(id));
      layer.on('add', () => this.styleMarker(p));
    }
    this.placed.push(p);
    if (!this.groups.has(m.cat)) this.groups.set(m.cat, L.layerGroup());
    this.groups.get(m.cat)!.addLayer(layer);
  }

  private iconFor(m: MapMarker, size: number): L.Icon {
    const key = `${m.cat}|${m.fastTravel}|${size}`;
    let icon = this.icons.get(key);
    if (!icon) {
      icon = L.icon({
        iconUrl: this.mapData.data.categories[m.cat].icon!,
        iconSize: [size, size],
        className: 'marker-icon' + (m.fastTravel ? ' fast-travel' : ''),
      });
      this.icons.set(key, icon);
    }
    return icon;
  }

  private labelIcon(m: MapMarker): L.DivIcon {
    const label = el('div', `map-label ${m.cat}`, m.name[this.lang.index()]);
    label.style.transform = 'translate(-50%,-50%)';
    return L.divIcon({ className: '', iconSize: undefined, html: label });
  }

  private onZoom(): void {
    const zoom = this.map.getZoom();
    const previous = iconSize(this.zoom());
    this.zoom.set(zoom);
    const size = iconSize(zoom);
    if (size === previous) return;
    for (const p of this.placed) {
      const cat = this.mapData.data.categories[p.m.cat];
      if (cat.kind === 'icon' && cat.icon && p.layer instanceof L.Marker) {
        p.layer.setIcon(this.iconFor(p.m, size)); // builds a new element: ghost style again below
        const tooltip = p.layer.getTooltip();
        if (tooltip) tooltip.options.offset = L.point(0, -size / 2);
      }
    }
    this.applyDone();
  }

  // ---- filters, language, done marks ----

  private applyVisibility(): void {
    if (!this.ready()) return;
    const zoom = this.zoom();
    this.filters.overrides();
    const searching = this.filters.query().trim() !== '';
    for (const p of this.placed) {
      const group = this.groups.get(p.m.cat)!;
      const matches = this.filters.matchesText(...p.m.name, p.m.raw);
      // Labels only show from their zoom level, unless they match a search.
      const zoomOk =
        !(p.m.cat in LABEL_MIN_ZOOM) || zoom >= LABEL_MIN_ZOOM[p.m.cat] || (searching && matches);
      const visible = this.filters.isShown(p.m.cat, p.key) && matches && zoomOk;
      if (visible && !group.hasLayer(p.layer)) group.addLayer(p.layer);
      if (!visible && group.hasLayer(p.layer)) group.removeLayer(p.layer);
    }
    for (const r of this.catalog.resources()) {
      const visible =
        this.filters.isShown(r.cat, r.key) && this.filters.matchesText(...r.data.name);
      let dl = this.dotLayers.get(r);
      if (visible && !dl) dl = untracked(() => this.buildDots(r));
      if (!dl) continue;
      if (visible && !this.map.hasLayer(dl.layer)) dl.layer.addTo(this.map);
      if (!visible && this.map.hasLayer(dl.layer)) this.map.removeLayer(dl.layer);
    }
  }

  private applyLanguage(): void {
    if (!this.ready()) return;
    const index = this.lang.index();
    for (const p of this.placed) {
      if (this.mapData.data.categories[p.m.cat].kind === 'label')
        (p.layer as L.Marker).setIcon(this.labelIcon(p.m));
    }
    this.layersControl
      .removeLayer(this.biomesLayer)
      .addOverlay(this.biomesLayer, this.lang.t('biomes'));
    this.biomes.set(
      Object.values(this.mapData.data.biomes).map((b) => ({
        color: b.color,
        label: b.label[index],
      })),
    );
  }

  private applyDone(): void {
    if (!this.ready()) return;
    this.progress.done();
    this.team.others();
    this.team.total();
    for (const p of this.placed) this.styleMarker(p);
    for (const [r, dl] of this.dotLayers)
      dl.dots.forEach((dot, i) => this.styleDot(r, dot, r.ids[i]));
  }

  // Marked by me: a faint "ghost" (.done). The halo colour is the team's progress (.halo-some / .halo-all).
  private styleMarker(p: Placed): void {
    if (!p.id || !(p.layer instanceof L.Marker)) return;
    const classes = p.layer.getElement()?.classList;
    const halo = this.team.halo(p.id);
    classes?.toggle('done', this.progress.done().has(p.id));
    classes?.toggle('halo-some', halo === 'some');
    classes?.toggle('halo-all', halo === 'all');
  }

  private styleDot(r: PlacedResource, dot: L.CircleMarker, id: string): void {
    const halo = this.team.halo(id);
    const mine = this.progress.done().has(id);
    dot.setStyle({
      fillOpacity: mine ? 0.6 : 0.95,
      fillColor: mine ? '#ccc' : r.data.color,
      opacity: halo === 'none' ? 0.8 : 1,
      color: halo === 'none' ? '#000' : halo === 'all' ? '#6fe06f' : '#ffa53a',
      weight: halo === 'none' ? 1 : 2.5,
    });
  }

  // ---- resources: one canvas for tens of thousands of dots ----

  private buildDots(r: PlacedResource): DotLayer {
    const layer = L.featureGroup();
    const dots: L.CircleMarker[] = [];
    const { pts } = r.data;
    for (let i = 0; i < pts.length; i += 3) {
      const dot = L.circleMarker(this.latLng(pts[i], pts[i + 1]), {
        renderer: this.dotRenderer,
        radius: 4,
        weight: 1,
        color: '#000',
        opacity: 0.8,
        fillColor: r.data.color,
        fillOpacity: 0.95,
      }) as MarkedDot;
      dot.index = i / 3;
      dot.markId = r.ids[i / 3];
      this.styleDot(r, dot, dot.markId);
      dots.push(dot);
      layer.addLayer(dot);
    }
    layer.on('contextmenu', (e) => this.toggle((e.propagatedFrom as MarkedDot).markId));
    layer.on('mouseover', (e) =>
      (e.propagatedFrom as MarkedDot)
        .bindTooltip(() => el('span', '', r.data.name[this.lang.index()]), {
          direction: 'top',
          offset: [0, -4],
        })
        .openTooltip(),
    );
    layer.on('click', (e) => {
      const dot = e.propagatedFrom as MarkedDot;
      L.popup(POPUP_SIZE)
        .setLatLng(e.latlng)
        .setContent(this.resourcePopup(r, dot))
        .openOn(this.map);
    });
    const dl = { layer, dots };
    this.dotLayers.set(r, dl);
    return dl;
  }

  // ---- popups ----

  private popup(name: string, meta: string, id: string | null): HTMLElement {
    const root = el('div');
    root.append(el('div', 'popup-name', name), el('div', 'popup-meta', meta));
    if (id) {
      const actions = el('div', 'popup-actions');
      actions.dataset['id'] = id;
      root.append(actions);
    }
    return root;
  }

  private markerPopup(m: MapMarker, id: string | null): HTMLElement {
    const i = this.lang.index();
    const fast = m.fastTravel && m.cat !== 'fastTravel' ? ' · ' + this.lang.t('fastTravel') : '';
    return this.popup(m.name[i], this.mapData.data.categories[m.cat].label[i] + fast, id);
  }

  private resourcePopup(r: PlacedResource, dot: MarkedDot): HTMLElement {
    const i = this.lang.index();
    const size = r.data.sizes ? ` · ${this.lang.t('size')} ≈ ${r.data.sizes[dot.index]} m³` : '';
    return this.popup(
      r.data.name[i],
      this.mapData.data.categories[r.cat].label[i] + size,
      dot.markId,
    );
  }

  private renderActions(box: HTMLElement): void {
    const id = box.dataset['id']!;
    box.replaceChildren();
    // Clicks are stopped here: the button is replaced, and a click on a detached element would close the popup.
    if (!this.auth.user()) {
      const hint = el('span', 'hint');
      const link = el('a', '', this.lang.t('login'));
      link.tabIndex = 0;
      link.onclick = (e) => {
        L.DomEvent.stop(e);
        this.auth.dialog.set('login');
      };
      hint.append(link, ' ' + this.lang.t('loginToTrack'));
      box.append(hint);
      return;
    }
    const done = this.progress.done().has(id);
    const button = el(
      'button',
      done ? '' : 'primary',
      done ? this.lang.t('unmark') : '✓ ' + this.lang.t('markDone'),
    );
    button.type = 'button';
    button.onclick = (e) => {
      L.DomEvent.stop(e);
      this.toggle(id);
    };
    box.append(button);
    const names = this.team.markedBy(id);
    if (this.team.team() && names.length) {
      const by = el('div', 'popup-team', this.lang.t('markedBy') + ' ' + names.join(', '));
      by.title = by.textContent ?? '';
      box.append(by);
    }
  }

  private toggle(id: string): void {
    if (!this.catalog.markIndex().has(id)) return;
    if (!this.auth.user()) this.auth.dialog.set('login');
    else void this.progress.toggle(id);
  }
}
