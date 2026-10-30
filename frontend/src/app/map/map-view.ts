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
import { LootEntry, MapMarker, itemKey, markId } from '../core/map-data.model';
import { MapDataService } from '../core/map-data.service';
import { MapFocus } from '../core/map-focus.service';
import { ProgressStore } from '../core/progress.store';
import { Halo, TeamStore } from '../core/team.store';
import { ProgressLegend } from './progress-legend';

// Icon size per zoom level, and the zoom from which each label kind shows.
const iconSize = (zoom: number): number =>
  zoom <= -4 ? 14 : zoom <= -3 ? 20 : zoom <= -2 ? 26 : 32;
// Landmarks to find your way: bigger than the other icons, and never greyed out once marked.
const LANDMARK_CATS = new Set(['start', 'fastTravel']);
const LANDMARK_SCALE = 1.4;
const pixels = (cat: string, size: number): number =>
  LANDMARK_CATS.has(cat) ? Math.round(size * LANDMARK_SCALE) : size;
// Fixed popup size: the largest the content ever got (longest names, wrapped) was 301 x 106 px.
const POPUP_SIZE = { minWidth: 300, maxWidth: 300 };
const LABEL_MIN_ZOOM: Record<string, number> = { region: -5, areaName: -2.5 };
// Resource dot radius per zoom level. The category icon is drawn over the dots from
// DOT_ICON_MIN_RADIUS (zoom -1.5): before that most of the island is in view, the dots
// would hide the map, and drawing an icon over each of up to ~77,000 dots would make
// every redraw ~3x slower.
const dotRadius = (zoom: number): number => (zoom <= -4 ? 4 : zoom <= -2 ? 5 : zoom <= -1 ? 7 : 9);
const DOT_ICON_MIN_RADIUS = 7;
// Loot items found in the same chest sit about a metre apart: one click lists them all.
const STACKED_CATS = new Set(['unique', 'cosmetic', 'collectible']);
const STACK_RADIUS = 3;
// Halo of a POI: blue = only I marked it, violet = me and some others, orange = others did and I did not, green = everyone did.
const HALO_COLORS: Record<Halo, string> = {
  none: '#000',
  alone: '#3b82f6', // not the light blue glow of fast-travel icons (#7cc4ff)
  mine: '#b36cf0',
  others: '#ffa53a',
  all: '#6fe06f',
};

interface Placed {
  m: MapMarker;
  layer: L.Marker | L.CircleMarker;
  id: string | null; // null for labels: they cannot be marked
  key: string;
  /** Loot markers lying together (this one included): drawn as a single icon, listed in one popup. */
  stack?: Placed[];
  /** Passes the filters (a stacked marker may still be hidden behind another one). */
  wanted?: boolean;
}

/** A category icon as a white and a dark silhouette (for dark and light dots), once loaded. */
interface DotIcon {
  light?: HTMLCanvasElement;
  dark?: HTMLCanvasElement;
}

function tinted(image: HTMLImageElement, color: string): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(image, 0, 0);
  ctx.globalCompositeOperation = 'source-in';
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  return canvas;
}

/** Perceived lightness (0..1) of a #rgb or #rrggbb colour. */
function lightness(color: string): number {
  const hex = color.length === 4 ? [...color.slice(1)].map((c) => c + c).join('') : color.slice(1);
  const n = parseInt(hex, 16);
  return (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
}

// Leaflet 1.9 internals of a circle drawn by the canvas renderer (see Canvas._updateCircle).
interface CanvasCircle {
  _renderer: {
    _ctx: CanvasRenderingContext2D;
    _drawing: boolean;
    _updateCircle(dot: L.CircleMarker): void;
  };
  _point: L.Point;
  _radius: number;
  _empty(): boolean;
}

/** A resource dot of the canvas renderer, with its category icon drawn over it. */
class IconDot extends L.CircleMarker {
  icon: DotIcon = {};

  // Replaces L.CircleMarker._updatePath, called by the renderer for each dot it draws.
  _updatePath(): void {
    const self = this as unknown as CanvasCircle;
    const renderer = self._renderer;
    renderer._updateCircle(this);
    if (!renderer._drawing || self._empty() || self._radius < DOT_ICON_MIN_RADIUS) return;
    const fill = this.options.fillColor ?? '#000';
    const image = lightness(fill) > 0.6 ? this.icon.dark : this.icon.light;
    if (!image) return;
    const size = self._radius * 1.4;
    const ctx = renderer._ctx;
    ctx.globalAlpha = this.options.fillOpacity ?? 1;
    ctx.drawImage(image, self._point.x - size / 2, self._point.y - size / 2, size, size);
  }
}

interface DotLayer {
  layer: L.FeatureGroup;
  dots: IconDot[];
}

type MarkedDot = IconDot & { markId: string; index: number };

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
  imports: [ProgressLegend],
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
  private readonly focus = inject(MapFocus);
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
  private readonly dotIcons = new Map<string, DotIcon>();
  private readonly dotRenderer = L.canvas({ padding: 0.3, tolerance: 3 });
  private openActions: HTMLElement[] = [];

  constructor() {
    inject(DestroyRef).onDestroy(() => this.map?.remove());
    afterNextRender(() => {
      this.init();
      this.ready.set(true);
      void this.mapData.loadResources();
    });
    effect(() => {
      const points = this.focus.points();
      if (!points || !this.ready()) return;
      untracked(() => {
        this.focus.points.set(null);
        // the map may have just been un-hidden: measure it again before framing
        setTimeout(() => {
          this.map.invalidateSize();
          this.frame(points);
        });
      });
    });
    effect(() => this.applyVisibility());
    effect(() => this.applyLanguage());
    effect(() => this.applyDone());
    effect(() => {
      this.auth.user();
      this.progress.done();
      this.team.others();
      this.team.total();
      for (const box of this.openActions) this.renderActions(box);
    });
  }

  /** Zooms on the points (one point: a close view of it). */
  private frame(points: readonly { x: number; z: number }[]): void {
    const bounds = L.latLngBounds(points.map((p) => this.latLng(p.x, p.z)));
    this.map.fitBounds(bounds.pad(0.1), { maxZoom: 0 });
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
      const boxes = e.popup.getElement()?.querySelectorAll<HTMLElement>('.popup-actions') ?? [];
      this.openActions = Array.from(boxes);
      for (const box of this.openActions) this.renderActions(box);
    });
    this.map.on('popupclose', () => (this.openActions = []));

    for (const m of this.mapData.data.markers) this.place(m);
    this.linkStacks();
    for (const group of this.groups.values()) group.addTo(this.map);
    this.map.invalidateSize();
  }

  /** Groups the loot markers that lie within STACK_RADIUS of each other, directly or through a neighbour. */
  private linkStacks(): void {
    const loot = this.placed.filter((p) => STACKED_CATS.has(p.m.cat));
    const seen = new Set<Placed>();
    for (const first of loot) {
      if (seen.has(first)) continue;
      const stack = [first];
      seen.add(first);
      for (const near of stack)
        // the stack grows while it is walked: neighbours of neighbours join
        for (const q of loot)
          if (!seen.has(q) && Math.hypot(q.m.x - near.m.x, q.m.z - near.m.z) <= STACK_RADIUS) {
            seen.add(q);
            stack.push(q);
          }
      stack.sort((a, b) => this.placed.indexOf(a) - this.placed.indexOf(b));
      for (const p of stack) p.stack = stack;
    }
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
        zIndexOffset: LANDMARK_CATS.has(m.cat) ? 500 : 0, // above the icons around them
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
      layer.bindTooltip(
        () => {
          const more = this.stackAt(p).length - 1;
          return el('span', '', m.name[this.lang.index()] + (more > 0 ? ` +${more}` : ''));
        },
        { direction: 'top', offset: [0, -pixels(m.cat, iconSize(this.map.getZoom())) / 2] },
      );
    }
    layer.bindPopup(() => this.markerPopup(p), POPUP_SIZE);
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
      const px = pixels(m.cat, size);
      icon = L.icon({
        iconUrl: this.mapData.data.categories[m.cat].icon!,
        iconSize: [px, px],
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
    const radius = dotRadius(zoom);
    if (radius !== dotRadius(this.zoom()))
      for (const dl of this.dotLayers.values()) dl.dots.forEach((dot) => dot.setRadius(radius));
    const previous = iconSize(this.zoom());
    this.zoom.set(zoom);
    const size = iconSize(zoom);
    if (size === previous) return;
    for (const p of this.placed) {
      const cat = this.mapData.data.categories[p.m.cat];
      if (cat.kind === 'icon' && cat.icon && p.layer instanceof L.Marker) {
        p.layer.setIcon(this.iconFor(p.m, size)); // builds a new element: ghost style again below
        const tooltip = p.layer.getTooltip();
        if (tooltip) tooltip.options.offset = L.point(0, -pixels(p.m.cat, size) / 2);
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
      const matches = this.filters.matchesText(...p.m.name, p.m.raw);
      // Labels only show from their zoom level, unless they match a search.
      const zoomOk =
        !(p.m.cat in LABEL_MIN_ZOOM) || zoom >= LABEL_MIN_ZOOM[p.m.cat] || (searching && matches);
      p.wanted = this.filters.isShown(p.m.cat, p.key) && matches && zoomOk;
    }
    for (const p of this.placed) {
      const group = this.groups.get(p.m.cat)!;
      // One icon per stack: the first shown item stands for all of them.
      const visible = p.wanted && (!p.stack || p.stack.find((q) => q.wanted) === p);
      if (visible && !group.hasLayer(p.layer)) group.addLayer(p.layer);
      if (!visible && group.hasLayer(p.layer)) group.removeLayer(p.layer);
    }
    untracked(() => this.styleMarkers()); // a stack's icon shows the state of everything it stands for
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
    this.styleMarkers();
    for (const [r, dl] of this.dotLayers)
      dl.dots.forEach((dot, i) => this.styleDot(r, dot, r.ids[i]));
  }

  private styleMarkers(): void {
    for (const p of this.placed) this.styleMarker(p);
  }

  /** One halo for several items: green only when all are, orange while an item waits on me, blue when I am alone on all that are marked, else violet. */
  private stackHalo(halos: Halo[]): Halo {
    if (halos.every((h) => h === 'all')) return 'all';
    if (halos.every((h) => h === 'none')) return 'none';
    if (halos.includes('others')) return 'others';
    return halos.filter((h) => h !== 'none').every((h) => h === 'alone') ? 'alone' : 'mine';
  }

  // Marked by me: a faint "ghost" (.done). The halo colour: blue = only me, violet = me and some others, orange = others only, green = all.
  private styleMarker(p: Placed): void {
    if (!p.id || !(p.layer instanceof L.Marker)) return;
    const ids = this.stackAt(p).map((q) => q.id!);
    const halo = this.stackHalo(ids.map((id) => this.team.halo(id)));
    const classes = p.layer.getElement()?.classList;
    classes?.toggle(
      'done',
      !LANDMARK_CATS.has(p.m.cat) && ids.every((id) => this.progress.done().has(id)),
    );
    for (const h of ['alone', 'mine', 'others', 'all'] as const)
      classes?.toggle('halo-' + h, halo === h);
  }

  private styleDot(r: PlacedResource, dot: L.CircleMarker, id: string): void {
    const halo = this.team.halo(id);
    const mine = this.progress.done().has(id);
    dot.setStyle({
      fillOpacity: mine ? 0.6 : 0.95,
      fillColor: mine ? '#ccc' : r.data.color,
      opacity: halo === 'none' ? 0.8 : 1,
      color: HALO_COLORS[halo],
      weight: halo === 'none' ? 1 : 2.5,
    });
  }

  // ---- resources: one canvas for tens of thousands of dots ----

  private buildDots(r: PlacedResource): DotLayer {
    const layer = L.featureGroup();
    const dots: IconDot[] = [];
    const { pts } = r.data;
    const radius = dotRadius(this.map.getZoom());
    const icon = this.dotIcon(r.cat);
    for (let i = 0; i < pts.length; i += 3) {
      const dot = new IconDot(this.latLng(pts[i], pts[i + 1]), {
        renderer: this.dotRenderer,
        radius,
        weight: 1,
        color: '#000',
        opacity: 0.8,
        fillColor: r.data.color,
        fillOpacity: 0.95,
      }) as MarkedDot;
      dot.icon = icon;
      dot.index = i / 3;
      dot.markId = r.ids[i / 3];
      this.styleDot(r, dot, dot.markId);
      dots.push(dot);
      layer.addLayer(dot);
    }
    layer.on('contextmenu', (e) => this.toggle((e.propagatedFrom as MarkedDot).markId));
    layer.on('mouseover', (e) => {
      const dot = e.propagatedFrom as MarkedDot;
      dot
        .bindTooltip(() => el('span', '', r.data.name[this.lang.index()]), {
          direction: 'top',
          offset: [0, -dot.getRadius()],
        })
        .openTooltip();
    });
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

  // Loaded once per category; the dots already drawn are redrawn when it arrives.
  private dotIcon(cat: string): DotIcon {
    let icon = this.dotIcons.get(cat);
    if (icon) return icon;
    icon = {};
    this.dotIcons.set(cat, icon);
    const url = this.mapData.data.categories[cat].icon;
    if (url) {
      const image = new Image();
      const loaded = icon;
      image.onload = () => {
        loaded.light = tinted(image, '#fff');
        loaded.dark = tinted(image, '#1b1b1b');
        for (const [r, dl] of this.dotLayers)
          if (r.cat === cat) dl.dots.forEach((dot) => dot.redraw());
      };
      image.src = url;
    }
    return icon;
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

  private markerPopup(p: Placed): HTMLElement {
    const { m, id } = p;
    const stack = this.stackAt(p);
    if (stack.length > 1) return this.stackPopup(stack);
    const i = this.lang.index();
    const fast = m.fastTravel && m.cat !== 'fastTravel' ? ' · ' + this.lang.t('fastTravel') : '';
    const root = this.popup(m.name[i], this.mapData.data.categories[m.cat].label[i] + fast, id);
    const picture = m.item && this.itemPicture(m.item, 'popup-picture');
    if (picture) root.prepend(picture);
    const title = m.item ? 'alsoGuaranteed' : 'guaranteedItems';
    if (m.loot?.length) root.append(this.lootList(m.loot, this.lang.t(title)));
    if (picture || m.loot?.length) root.classList.add('popup-tall');
    return root;
  }

  /** The loot markers shown together with this one, itself included. */
  private stackAt(p: Placed): Placed[] {
    const shown = p.stack?.filter((q) => q.wanted);
    return shown?.length ? shown : [p];
  }

  /** Several items at one spot: a list, each with its own mark button. */
  private stackPopup(stack: Placed[]): HTMLElement {
    const i = this.lang.index();
    const root = el('div');
    root.append(el('div', 'popup-name', `${stack.length} ${this.lang.t('itemsHere')}`));
    const list = el('div', 'popup-list');
    for (const q of stack) {
      const row = el('div', 'popup-row');
      const picture = q.m.item && this.itemPicture(q.m.item, 'popup-icon');
      if (picture) row.append(picture);
      const label = el('div', 'popup-item');
      label.append(
        el('div', 'popup-item-name', q.m.name[i]),
        el('div', 'popup-meta', this.mapData.data.categories[q.m.cat].label[i]),
      );
      const state = el('div', 'popup-state');
      state.dataset['id'] = q.id!;
      row.append(label, state);
      list.append(row);
    }
    root.append(list);
    // One button for the whole stack, at the bottom.
    const actions = el('div', 'popup-actions');
    actions.dataset['ids'] = stack.map((q) => q.id!).join(',');
    const loot = stack.flatMap((q) => q.m.loot ?? []);
    if (loot.length) root.append(this.lootList(loot, this.lang.t('alsoGuaranteed')));
    root.append(actions);
    root.classList.add('popup-tall');
    return root;
  }

  /** The game's picture of an item, or null when there is none. */
  private itemPicture(item: string, className: string): HTMLImageElement | null {
    const icon = this.mapData.data.items?.[item]?.icon;
    if (!icon) return null;
    const img = el('img', className);
    img.src = icon;
    img.alt = '';
    img.loading = 'lazy';
    return img;
  }

  /** Items always found here, with their picture and amount (not markable). */
  private lootList(loot: readonly LootEntry[], title: string): HTMLElement {
    const i = this.lang.index();
    const box = el('div', 'popup-loot');
    box.append(el('div', 'popup-loot-title', title));
    for (const entry of loot) {
      const info = this.mapData.data.items?.[entry.item];
      if (!info) continue;
      const row = el('div', 'popup-loot-row');
      const picture = this.itemPicture(entry.item, 'popup-icon');
      row.append(picture ?? el('span', 'popup-icon'));
      const name = el('span', 'popup-loot-name', info.name[i]);
      row.append(name, el('span', 'popup-loot-amount', `×${entry.amount}`));
      box.append(row);
    }
    return box;
  }

  private resourcePopup(r: PlacedResource, dot: MarkedDot): HTMLElement {
    const i = this.lang.index();
    const size = r.data.sizes ? ` · ${this.lang.t('size')} ≈ ${r.data.sizes[dot.index]} m³` : '';
    const root = this.popup(
      r.data.name[i],
      this.mapData.data.categories[r.cat].label[i] + size,
      dot.markId,
    );
    const loot = r.data.loot?.[dot.index];
    if (loot?.length) {
      root.append(this.lootList(loot, this.lang.t('guaranteedItems')));
      root.classList.add('popup-tall');
    }
    return root;
  }

  private renderActions(box: HTMLElement): void {
    const ids = box.dataset['ids']?.split(',');
    if (ids) return this.renderStackActions(box, ids);
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

  /** The stack popup: who marked each item, and one button that marks (or unmarks) all of them. */
  private renderStackActions(box: HTMLElement, ids: string[]): void {
    box.replaceChildren();
    for (const state of box.parentElement?.querySelectorAll<HTMLElement>('.popup-state') ?? []) {
      const id = state.dataset['id']!;
      const names = this.team.markedBy(id);
      state.textContent = names.length ? '✓ ' + (this.team.team() ? names.join(', ') : '') : '';
      state.title = names.join(', ');
    }
    if (!this.auth.user()) return;
    const all = ids.every((id) => this.progress.done().has(id));
    const button = el(
      'button',
      all ? '' : 'primary',
      all ? this.lang.t('unmarkAll') : '✓ ' + this.lang.t('markAllDone'),
    );
    button.type = 'button';
    button.onclick = (e) => {
      L.DomEvent.stop(e);
      void this.progress.setAll(
        ids.filter((id) => this.catalog.markIndex().has(id)),
        !all,
      );
    };
    box.append(button);
  }

  private toggle(id: string): void {
    if (!this.catalog.markIndex().has(id)) return;
    if (!this.auth.user()) this.auth.dialog.set('login');
    else void this.progress.toggle(id);
  }
}
