import * as L from 'leaflet';
import { LangService } from '../core/lang.service';
import { Category, MapMarker } from '../core/map-data.model';
import { CustomMarker, MarkerDraft, MarkerStore } from '../core/marker.store';
import {
  ALTAR_LEVELS,
  MARKER_COLORS,
  MARKER_ICONS,
  altarBounds,
  altarSide,
  markerIconUrl,
  markerColorToken,
} from '../core/markers.logic';
import { inAltarZone, topCounts } from '../core/markers.zone';
import { TeamStore } from '../core/team.store';

const FORM_SIZE = { minWidth: 340, maxWidth: 340, className: 'cm-popup' };

const token = (name: string): string =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim();

/** The layers control writes labels as HTML: a player's name must not become markup. */
const escapeHtml = (s: string): string => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className = '',
  text = '',
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  node.textContent = text; // text only, never HTML: names and notes come from players
  return node;
}

/**
 * The player's custom markers on the map: mine (editable, one layer) and one read-only layer per teammate who
 * shares. Not map elements: not in the progress, not under the category filters. Every text from a player is set
 * as text, never as HTML.
 */
export class MarkerLayer {
  private readonly groups = new Map<string, L.LayerGroup>();
  private readonly byId = new Map<string, L.Marker>(); // '<layer key>:<marker id>' -> its marker
  private button?: HTMLButtonElement;
  private seq = 0;
  private savedBounds?: L.LatLngBounds;

  constructor(
    private readonly map: L.Map,
    private readonly control: L.Control.Layers,
    private readonly world: number,
    private readonly store: MarkerStore,
    private readonly team: TeamStore,
    private readonly lang: LangService,
    /** The map's categories: their icons are the game's (a data file without one leaves an empty ring). */
    private readonly categories: Record<string, Category>,
    /** The map's elements: what lies in an altar's zone is counted from them when its popup opens. */
    private readonly points: readonly MapMarker[],
  ) {
    const Add = L.Control.extend({
      onAdd: () => {
        const box = L.DomUtil.create('div', 'leaflet-bar cm-control');
        this.button = L.DomUtil.create('button', 'cm-add', box);
        this.button.type = 'button';
        L.DomEvent.disableClickPropagation(box);
        this.button.addEventListener('click', (e) => this.toggle(e.detail === 0));
        return box;
      },
    });
    new Add({ position: 'topleft' }).addTo(map);
    // Leaflet's own pan (animated) may still be running at the first frame: look again once it is over
    map.on('popupopen', () => {
      this.fit();
      setTimeout(() => this.fit(), 350);
    });
    map.on('popupclose', () => {
      if (!this.savedBounds) return;
      this.map.setMaxBounds(this.savedBounds);
      this.savedBounds = undefined;
    });
    map.on('click', (e: L.LeafletMouseEvent) => {
      const moving = store.moving();
      if (moving) void this.move(moving, e.latlng);
      else if (store.placing()) this.place(e.latlng);
    });
    map.on('overlayadd overlayremove', (e: L.LeafletEvent) => {
      const layer = (e as L.LayersControlEvent).layer;
      for (const [key, group] of this.groups)
        if (group === layer) {
          store.setLayerShown(key, e.type === 'overlayadd'); // kept for the next visit
        }
    });
    // Escape cancels a placing or a move, wherever the focus is (after a click on a popup button it is nowhere)
    const cancel = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return;
      store.placing.set(false);
      store.moving.set(null);
      store.measuring.set(false);
    };
    document.addEventListener('keydown', cancel);
    map.on('unload', () => document.removeEventListener('keydown', cancel));
  }

  /** The button's text and state (language and placing change). */
  syncButton(): void {
    const on = this.store.placing();
    if (!this.button) return;
    this.map.getContainer().classList.toggle('cm-placing', on || !!this.store.moving());
    this.button.textContent = this.lang.t('markerAdd');
    this.button.setAttribute('aria-pressed', String(on));
    this.button.title = on ? this.lang.t('markerPlacing') : '';
  }

  /** A click on the button places at once at the centre of the view when it came from the keyboard (no pointer to click with). */
  private toggle(fromKeyboard: boolean): void {
    if (fromKeyboard) this.place(this.map.getCenter());
    else {
      this.store.measuring.set(false); // one map mode at a time
      this.store.moving.set(null);
      this.store.placing.update((on) => !on);
    }
  }

  /**
   * Keeps the open marker popup inside the map. Leaflet pans once, before the form has its final height, and the map
   * cannot pan past its bounds: so pan, then, if the popup is still too tall for the room above its marker, let its
   * content scroll (the buttons stay in view).
   */
  private fit(): void {
    requestAnimationFrame(() => {
      const open = this.map.getContainer().querySelectorAll<HTMLElement>('.cm-popup');
      const popup = open[open.length - 1]; // the newest: the one before it may still be fading out
      const content = popup?.querySelector<HTMLElement>('.leaflet-popup-content');
      if (!popup || !content) return;
      const margin = 8;
      content.style.maxHeight = ''; // the CSS limit, measured again
      const room = (): DOMRect => this.map.getContainer().getBoundingClientRect();
      let p = popup.getBoundingClientRect();
      let m = room();
      const dx =
        p.left < m.left + margin
          ? p.left - m.left - margin
          : Math.max(0, p.right - m.right + margin);
      const dy = p.top < m.top + margin ? p.top - m.top - margin : 0;
      if (dx || dy) this.map.panBy([dx, dy], { animate: false });
      p = popup.getBoundingClientRect();
      if (m.top + margin - p.top > 0) {
        // the map stops at its bounds: let it go further while the popup is open (restored when it closes)
        const bounds = this.map.options.maxBounds;
        if (bounds && !this.savedBounds) {
          this.savedBounds = bounds as L.LatLngBounds; // set as bounds.pad() in map-view.ts
          this.map.setMaxBounds(this.savedBounds.pad(1));
        }
        this.map.panBy([0, p.top - m.top - margin], { animate: false });
        p = popup.getBoundingClientRect();
      }
      m = room();
      const over = m.top + margin - p.top; // what is still above the map
      if (over > 0) content.style.maxHeight = `${Math.max(160, content.clientHeight - over)}px`;
    });
  }

  private clamp(v: number): number {
    return Math.min(this.world, Math.max(0, Math.round(v)));
  }

  /** The next click on the map (or, from the keyboard, the centre of the view) is the marker's new point. */
  private beginMove(m: CustomMarker, fromKeyboard: boolean): void {
    this.map.closePopup();
    this.store.placing.set(false);
    this.store.measuring.set(false);
    this.store.moveFailed.set(false);
    if (fromKeyboard) void this.move(m, this.map.getCenter());
    else this.store.moving.set(m);
  }

  private async move(m: CustomMarker, at: L.LatLng): Promise<void> {
    this.store.moving.set(null);
    const { id, ...fields } = m; // name, note, kind, level, icon, colour and sharing stay as they are
    try {
      await this.store.change(id, {
        ...fields,
        x: this.clamp(at.lng),
        z: this.clamp(at.lat + this.world),
      });
    } catch {
      this.store.moveFailed.set(true);
    }
  }

  private place(at: L.LatLng): void {
    this.store.placing.set(false);
    this.store.measuring.set(false);
    const draft: MarkerDraft = {
      x: this.clamp(at.lng),
      z: this.clamp(at.lat + this.world),
      name: '',
      note: '',
      kind: 'pin',
      level: null,
      icon: null,
      color: null,
      shared: false,
    };
    this.openForm(draft, null);
  }

  /** Draws every layer again from the stores. */
  render(): void {
    for (const group of this.groups.values()) {
      this.control.removeLayer(group);
      group.remove();
    }
    this.groups.clear();
    this.byId.clear();
    this.add('me', this.lang.t('markerMine'), this.store.mine(), null);
    for (const member of this.store.team())
      this.add(
        `u${member.user_id}`,
        this.lang.t('markerMemberLayer', { name: escapeHtml(member.username) }),
        member.markers,
        member.username,
      );
  }

  private add(
    key: string,
    label: string,
    markers: readonly CustomMarker[],
    owner: string | null,
  ): void {
    const group = L.layerGroup();
    for (const m of markers) {
      // an altar is always orange; another marker has the colour its owner chose
      const color = token(m.kind === 'altar' ? '--marker-altar' : markerColorToken(m.color));
      if (m.kind === 'altar' && m.level)
        L.rectangle(altarBounds(m.x, m.z, m.level, this.world), {
          color,
          weight: 2,
          fillOpacity: 0.12,
          interactive: false, // the square must not swallow the clicks of what lies under it
        }).addTo(group);
      // the disc is the marker's colour; the picture is the game's map icon (an altar: the Flame Altar's)
      const icon = el('span', 'cm-pin');
      icon.style.background = color;
      const url = m.kind === 'altar' ? this.categories['flameAltar']?.icon : markerIconUrl(m.icon);
      if (url) {
        const picture = el('img');
        picture.src = url;
        picture.alt = '';
        icon.append(picture);
      }
      const marker = L.marker([m.z - this.world, m.x], {
        icon: L.divIcon({ html: icon, className: 'cm-icon', iconSize: [28, 28] }),
        title: m.name,
        keyboard: true,
      })
        .bindPopup(() => (owner === null ? this.form(m, m.id) : this.view(m, owner)), FORM_SIZE)
        .addTo(group);
      this.byId.set(`${key}:${m.id}`, marker);
    }
    this.groups.set(key, group);
    this.control.addOverlay(group, label);
    if (!this.store.hiddenLayers.has(key)) group.addTo(this.map);
  }

  /** Centres the map on a marker and opens its popup (from the list in the menu); a layer the player had unticked is shown again. */
  reveal(key: string, id: number): void {
    const marker = this.byId.get(`${key}:${id}`);
    const group = this.groups.get(key);
    if (!marker || !group) return;
    if (!this.map.hasLayer(group)) group.addTo(this.map);
    this.map.setView(marker.getLatLng(), Math.max(this.map.getZoom(), -2), { animate: false });
    marker.openPopup();
  }

  private view(m: CustomMarker, owner: string): HTMLElement {
    const root = el('div', 'cm-view');
    root.append(
      el('div', 'popup-name', m.name),
      el('div', 'popup-meta', this.lang.t('markerOwner', { name: owner })),
    );
    if (m.kind === 'altar' && m.level)
      root.append(el('div', 'popup-meta', this.lang.t('markerArea', { n: altarSide(m.level) })));
    if (m.note) root.append(el('p', 'cm-note', m.note));
    if (m.kind === 'altar' && m.level) root.append(this.zoneBlock(m.x, m.z, m.level));
    return root;
  }

  /** What the map holds inside an altar's build area, per category (computed when the popup opens, not while drawing). */
  private zoneBlock(x: number, z: number, level: number): HTMLElement {
    const box = el('div', 'cm-zone');
    const zone = inAltarZone(
      this.points,
      { x, z, level },
      (cat) => this.categories[cat]?.kind === 'label',
    );
    box.append(el('div', 'cm-zone-title', this.lang.t('markerZone', { total: zone.total })));
    if (!zone.total) return box;
    const { top, others } = topCounts(zone.counts);
    const list = el('ul');
    const i = this.lang.index();
    for (const { cat, n } of top) {
      const item = el('li');
      const url = this.categories[cat]?.icon;
      if (url) {
        const img = el('img');
        img.src = url;
        img.alt = '';
        item.append(img);
      }
      item.append(el('span', '', this.categories[cat]?.label[i] ?? cat), el('b', '', String(n)));
      list.append(item);
    }
    if (others)
      list.append(el('li', 'cm-zone-others', this.lang.t('markerZoneOthers', { n: others })));
    box.append(list);
    return box;
  }

  private openForm(draft: MarkerDraft, id: number | null): void {
    const popup = L.popup(FORM_SIZE)
      .setLatLng([draft.z - this.world, draft.x])
      .setContent(this.form({ ...draft, id: id ?? 0 }, id))
      .openOn(this.map);
    popup.getElement()?.querySelector<HTMLInputElement>('input[name=name]')?.focus();
  }

  /** The form of a marker of mine (id null: a new one). */
  private form(m: CustomMarker, id: number | null): HTMLElement {
    const uid = `cm${++this.seq}`;
    const form = el('form', 'cm-form');
    const field = (label: string, input: HTMLElement): HTMLLabelElement => {
      const l = el('label', 'cm-field');
      l.append(el('span', '', label), input);
      return l;
    };
    const name = el('input');
    name.name = 'name';
    name.maxLength = 40;
    name.required = true;
    name.value = m.name;
    const note = el('textarea');
    note.maxLength = 500;
    note.rows = 2;
    note.value = m.note;
    form.append(field(this.lang.t('markerName'), name), field(this.lang.t('markerNote'), note));

    const radios = (
      legend: string,
      group: string,
      options: [string, string][],
      current: string,
    ) => {
      const set = el('fieldset', 'cm-radios');
      set.append(el('legend', '', legend));
      for (const [value, text] of options) {
        const l = el('label');
        const r = el('input');
        r.type = 'radio';
        r.name = `${group}-${uid}`;
        r.value = value;
        r.checked = value === current;
        l.append(r, el('span', '', text));
        set.append(l);
      }
      return set;
    };
    const kind = radios(
      this.lang.t('markerType'),
      'kind',
      [
        ['pin', this.lang.t('markerPin')],
        ['altar', this.lang.t('markerAltar')],
      ],
      m.kind,
    );
    const level = radios(
      this.lang.t('markerLevel'),
      'level',
      ALTAR_LEVELS.map((n): [string, string] => [String(n), String(n)]),
      String(m.level ?? 1),
    );
    const kindNow = (): string =>
      form.querySelector<HTMLInputElement>(`input[name=kind-${uid}]:checked`)?.value ?? 'pin';
    const colors = this.colorPicker(`color-${uid}`, m.color);
    const icons = this.iconPicker(`icon-${uid}`, m.icon ?? MARKER_ICONS[0]);
    const showKind = (): void => {
      level.hidden = kindNow() !== 'altar';
      // an altar has its own icon and colour: only the level is left to choose
      icons.hidden = colors.hidden = kindNow() === 'altar';
    };
    // the zone's contents follow the level and the type while the form is open
    const zoneBox = el('div');
    const refreshZone = (): void => {
      zoneBox.replaceChildren();
      const lv = Number(
        form.querySelector<HTMLInputElement>(`input[name=level-${uid}]:checked`)?.value ?? 1,
      );
      if (kindNow() === 'altar') zoneBox.append(this.zoneBlock(m.x, m.z, lv));
    };
    kind.addEventListener('change', () => {
      showKind();
      refreshZone();
      this.fit();
    });
    level.addEventListener('change', () => {
      refreshZone();
      this.fit();
    });
    form.append(kind, level, colors, icons);
    showKind(); // once the pickers are in the form: kindNow() reads the checked type from it
    refreshZone();

    let share: HTMLInputElement | undefined;
    if (this.team.team()) {
      const l = el('label', 'cm-share');
      share = el('input');
      share.type = 'checkbox';
      share.checked = m.shared;
      l.append(share, el('span', '', this.lang.t('markerShare')));
      form.append(l);
    }

    form.append(zoneBox);
    const error = el('p', 'cm-error');
    error.setAttribute('role', 'alert');
    const actions = el('div', 'cm-actions');
    const save = el('button', 'primary', this.lang.t('markerSave'));
    save.type = 'submit';
    actions.append(save);
    if (id !== null) {
      const del = el('button', '', this.lang.t('delete'));
      del.type = 'button';
      del.addEventListener('click', () => void this.run(error, () => this.store.remove(id)));
      actions.append(del);
    }
    if (id !== null) {
      const move = el('button', '', this.lang.t('markerMove'));
      move.type = 'button';
      move.addEventListener('click', (e) => this.beginMove(m, e.detail === 0));
      actions.append(move);
    }
    const cancel = el('button', '', this.lang.t('cancel'));
    cancel.type = 'button';
    cancel.addEventListener('click', () => this.map.closePopup());
    actions.append(cancel);
    form.append(error, actions);

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const isAltar = kindNow() === 'altar';
      const draft: MarkerDraft = {
        x: m.x,
        z: m.z,
        name: name.value.trim(),
        note: note.value,
        kind: isAltar ? 'altar' : 'pin',
        level: isAltar
          ? Number(
              form.querySelector<HTMLInputElement>(`input[name=level-${uid}]:checked`)?.value ?? 1,
            )
          : null,
        icon: isAltar
          ? null
          : (form.querySelector<HTMLInputElement>(`input[name=icon-${uid}]:checked`)?.value ??
            null),
        color: isAltar
          ? null
          : (form.querySelector<HTMLInputElement>(`input[name=color-${uid}]:checked`)?.value ??
            null),
        shared: share?.checked ?? false,
      };
      void this.run(error, () =>
        id === null ? this.store.add(draft) : this.store.change(id, draft),
      );
    });
    return form;
  }

  /** The 8 colours of the game's custom markers, as round swatches on one line. */
  private colorPicker(group: string, current: string | null): HTMLFieldSetElement {
    const set = el('fieldset', 'cm-colors');
    set.append(el('legend', '', this.lang.t('markerColor')));
    const chosen = MARKER_COLORS.find((c) => c === current) ?? MARKER_COLORS[0];
    for (const key of MARKER_COLORS) {
      const l = el('label');
      const r = el('input');
      r.type = 'radio';
      r.name = group;
      r.value = key;
      r.checked = key === chosen;
      r.title = this.lang.t(`markerColor_${key}`);
      r.setAttribute('aria-label', r.title);
      const swatch = el('span', 'cm-swatch');
      swatch.style.background = `var(${markerColorToken(key)})`;
      l.append(r, swatch);
      set.append(l);
    }
    return set;
  }

  /** The 10 icons of the game's own custom markers, to pick one for a simple marker. */
  private iconPicker(group: string, current: string): HTMLFieldSetElement {
    const set = el('fieldset', 'cm-icons');
    set.append(el('legend', '', this.lang.t('markerIcon')));
    const chosen = MARKER_ICONS.find((key) => key === current) ?? MARKER_ICONS[0];
    for (const key of MARKER_ICONS) {
      const l = el('label');
      const r = el('input');
      r.type = 'radio';
      r.name = group;
      r.value = key;
      r.checked = key === chosen;
      const img = el('img');
      img.src = markerIconUrl(key);
      img.alt = this.lang.t(`markerIcon_${key}`);
      img.title = img.alt;
      l.append(r, img);
      set.append(l);
    }
    return set;
  }

  private async run(error: HTMLElement, action: () => Promise<void>): Promise<void> {
    try {
      await action();
      this.map.closePopup();
    } catch {
      error.textContent = this.lang.t('markerError');
    }
  }
}
