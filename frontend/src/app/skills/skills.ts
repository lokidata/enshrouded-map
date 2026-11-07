import { Component, ElementRef, computed, inject, signal, viewChild } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { normalize } from '../core/filter.store';
import { copyText } from '../core/links';
import { PlannerStore } from '../core/planner.store';
import { ATTRS, attributes, fill, reachable, segments } from '../core/skills.logic';
import { SkillClass, SkillNode } from '../core/skills.model';
import { SkillsService } from '../core/skills.service';

type ClassFilter = 'all' | SkillClass;
type PanelName = 'builds' | 'summary';
interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

const CLASSES: readonly ClassFilter[] = ['all', 'Neutral', 'Warrior', 'Ranger', 'Mage'];
// the nodes the game gives a picture stay big; the others are smaller
const RADIUS = { Root: 30, Active: 40, Passive: 34, Attribute: 28 } as const;
const ICON_RADIUS = 78;
const MARGIN = 700;
const POPUP_WIDTH = 400;
const POPUP_HEIGHT = 380;

/** The skill tree drawn like the game's skill screen, and the builds a player plans on it and saves. */
@Component({
  selector: 'app-skills',
  imports: [TranslocoPipe],
  template: `
    <div
      #stage
      class="stage"
      tabindex="-1"
      (pointerdown)="stageDown()"
      (keydown.escape)="closePopup()"
    >
      <svg
        class="tree"
        role="group"
        #svg
        [attr.aria-label]="'skills' | transloco"
        [attr.viewBox]="viewBox()"
        preserveAspectRatio="xMidYMid meet"
        (wheel)="onWheel($event)"
        (pointerdown)="dragStart($event)"
        (pointermove)="dragMove($event)"
        (pointerup)="dragEnd()"
        (pointerleave)="dragEnd()"
      >
        <defs>
          <radialGradient id="medal" cx="0.5" cy="0.35" r="0.75">
            <stop offset="0" stop-color="#6b5436" />
            <stop offset="1" stop-color="#241a10" />
          </radialGradient>
        </defs>
        @if (ring(); as r) {
          <circle class="ring" [attr.cx]="r.x" [attr.cy]="r.y" [attr.r]="r.r" />
        }
        @for (l of links(); track l.key) {
          <line
            [attr.x1]="l.x1"
            [attr.y1]="l.y1"
            [attr.x2]="l.x2"
            [attr.y2]="l.y2"
            [class.on]="l.on"
          />
        }
        @for (l of labels(); track l.key) {
          <text
            class="spec"
            [class]="'spec ' + l.cls"
            [attr.x]="l.x"
            [attr.y]="l.y"
            text-anchor="middle"
            aria-hidden="true"
          >
            {{ l.text }}
          </text>
        }
        @for (n of nodes(); track n.node.id) {
          <g
            [class]="'skill ' + n.node.cls + ' ' + n.node.type + ' ' + n.state"
            [class.dim]="!n.shown"
            [class.picked]="detail() === n.node"
            [attr.transform]="'translate(' + n.node.x + ' ' + n.node.y + ')'"
            [attr.role]="n.node.type === 'Root' ? 'img' : 'button'"
            [attr.tabindex]="n.node.type === 'Root' ? null : 0"
            [attr.aria-label]="label(n.node)"
            (pointerdown)="$event.stopPropagation()"
            (click)="pick(n.node, $event)"
            (contextmenu)="drop($event, n.node)"
            (mouseenter)="show(n.node, $event)"
            (mouseleave)="hide()"
            (focus)="show(n.node, $event)"
            (blur)="hide()"
            (keydown.enter)="pick(n.node, $event)"
            (keydown.space)="pick(n.node, $event); $event.preventDefault()"
            (keydown.delete)="planner.removeLevel(n.node.id)"
            (keydown.backspace)="planner.removeLevel(n.node.id)"
          >
            <title>{{ skills.text(n.node.name) }}</title>
            <circle [attr.r]="radius(n.node)" [class.active]="n.node.type === 'Active'" />
            @if (n.node.icon; as icon) {
              <image
                [attr.href]="icon"
                [attr.x]="-radius(n.node) * 0.8"
                [attr.y]="-radius(n.node) * 0.8"
                [attr.width]="radius(n.node) * 1.6"
                [attr.height]="radius(n.node) * 1.6"
              />
            }
            @if (n.node.type !== 'Root') {
              <text class="lvl" [attr.y]="radius(n.node) + 62" text-anchor="middle">
                {{ badge(n.node) }}
              </text>
            }
          </g>
        }
      </svg>

      <header class="points" role="status">
        <svg class="emblem" viewBox="0 0 64 64" aria-hidden="true"><use href="#emblem" /></svg>
        <div>
          <span class="small">{{ 'skillUsed' | transloco }}</span> <b>{{ planner.used() }}</b
          ><br />
          <span class="small">{{ 'skillAvailable' | transloco }}</span>
          <strong class="big">{{ planner.budget() - planner.used() }}</strong>
        </div>
      </header>

      <svg class="defs" width="0" height="0" aria-hidden="true">
        <defs>
          <symbol id="emblem" viewBox="0 0 64 64">
            <circle cx="32" cy="32" r="30" fill="#7a5a1c" />
            <circle cx="32" cy="32" r="26" fill="#e8b84a" />
            <circle cx="32" cy="32" r="19" fill="#f6d77c" />
            <path
              d="M32 6l4 15 14-9-9 14 15 4-15 4 9 14-14-9-4 15-4-15-14 9 9-14-15-4 15-4-9-14 14 9z"
              fill="#a8761b"
              opacity="0.8"
            />
            <circle cx="32" cy="32" r="8" fill="#fff0b8" />
          </symbol>
        </defs>
      </svg>

      <aside class="attrs" [attr.aria-label]="'skillAttributes' | transloco">
        @for (a of attrs(); track a.key) {
          <div class="attr" [class.preview]="a.delta > 0">
            <span class="name">{{ 'skillAttr_' + a.key | transloco }}</span>
            <span class="value">
              {{ a.total }}
              @if (a.delta > 0) {
                <em class="delta">+{{ a.delta }}</em>
              }
            </span>
            @if (a.flame) {
              <span class="flame">{{ 'skillPerFlame' | transloco }}</span>
            }
          </div>
        }
      </aside>

      <nav class="tools" [attr.aria-label]="'skillTools' | transloco">
        <button
          type="button"
          class="pill"
          [attr.aria-pressed]="panel() === 'builds'"
          (click)="toggle('builds')"
        >
          {{ 'skillBuilds' | transloco }}
        </button>
        <button
          type="button"
          class="pill"
          [attr.aria-pressed]="panel() === 'summary'"
          (click)="toggle('summary')"
        >
          {{ 'skillSummary' | transloco }}
        </button>
        <button
          type="button"
          class="pill"
          (click)="zoomBy(1 / 1.25)"
          [attr.aria-label]="'skillZoomIn' | transloco"
        >
          +
        </button>
        <button
          type="button"
          class="pill"
          (click)="zoomBy(1.25)"
          [attr.aria-label]="'skillZoomOut' | transloco"
        >
          −
        </button>
        <button type="button" class="pill" (click)="fit()">{{ 'skillFit' | transloco }}</button>
      </nav>
      <p class="hint">{{ 'skillHint' | transloco }}</p>

      @if (panel() === 'builds') {
        <section class="sheet" [attr.aria-label]="'skillBuilds' | transloco">
          <input
            type="search"
            [placeholder]="'skillSearch' | transloco"
            [attr.aria-label]="'skillSearch' | transloco"
            [value]="query()"
            (input)="query.set($any($event.target).value)"
          />
          <div class="row" role="group" [attr.aria-label]="'skillClass' | transloco">
            @for (c of classes; track c) {
              <button
                type="button"
                class="pill"
                [attr.aria-pressed]="filter() === c"
                (click)="filter.set(c)"
              >
                {{ 'skillClass_' + c | transloco }}
              </button>
            }
          </div>
          <h3>{{ 'skillBuild' | transloco }}</h3>
          <input
            type="text"
            maxlength="60"
            [placeholder]="'skillName' | transloco"
            [attr.aria-label]="'skillName' | transloco"
            [value]="planner.name()"
            (input)="planner.name.set($any($event.target).value)"
          />
          <div class="row">
            <button type="button" class="pill" (click)="planner.save()">
              {{ 'skillSave' | transloco }}
            </button>
            <button type="button" class="pill" (click)="planner.create()">
              {{ 'skillNew' | transloco }}
            </button>
            <button type="button" class="pill" (click)="planner.reset()">
              {{ 'skillReset' | transloco }}
            </button>
            <button type="button" class="pill" (click)="copyLink()">
              {{ (copied() ? 'copied' : 'skillLink') | transloco }}
            </button>
          </div>
          @if (planner.error(); as error) {
            <p class="error" role="alert">{{ 'skillError_' + error | transloco }}</p>
          }
          <h3>{{ 'skillSavedBuilds' | transloco }}</h3>
          <ul class="builds">
            @for (b of planner.saved(); track b.id) {
              <li>
                <button
                  type="button"
                  [class.active]="planner.currentId() === b.id"
                  [attr.aria-pressed]="planner.currentId() === b.id"
                  (click)="planner.open(b)"
                >
                  <span>{{ b.name }}</span
                  ><b>{{ points(b.nodes) }}</b>
                </button>
                <button
                  type="button"
                  class="drop"
                  [attr.aria-label]="'skillDelete' | transloco: { name: b.name }"
                  (click)="planner.delete(b.id)"
                >
                  ✕
                </button>
              </li>
            } @empty {
              <li class="empty">{{ 'skillNoBuilds' | transloco }}</li>
            }
          </ul>
        </section>
      }

      @if (panel() === 'summary') {
        <section class="sheet" [attr.aria-label]="'skillSummary' | transloco">
          <h3>{{ 'skillSummary' | transloco }}</h3>
          <p class="line">
            {{ 'skillPoints' | transloco: { used: planner.used(), budget: planner.budget() } }}
          </p>
          <ul class="counts">
            @for (c of summary().counts; track c.type) {
              <li>
                <span>{{ 'skillTypes_' + c.type | transloco }}</span
                ><b>{{ c.taken }} / {{ c.total }}</b>
              </li>
            }
          </ul>
          <h3>{{ 'skillAttributes' | transloco }}</h3>
          <ul class="counts">
            @for (a of attrs(); track a.key) {
              <li>
                <span>{{ 'skillAttr_' + a.key | transloco }}</span
                ><b>{{ a.total }}</b>
              </li>
            }
          </ul>
          <h3>{{ 'skillTaken' | transloco }}</h3>
          <ul class="taken">
            @for (t of summary().taken; track t.node.id) {
              <li>
                <button type="button" (click)="focusOn(t.node)">
                  <span>{{ skills.text(t.node.name) }}</span
                  ><b>{{ t.level }}/{{ t.node.max }} · {{ t.node.cost * t.level }}</b>
                </button>
              </li>
            } @empty {
              <li class="empty">{{ 'skillNothing' | transloco }}</li>
            }
          </ul>
        </section>
      }

      @if (popup(); as p) {
        <article class="popup" [style.left.px]="p.x" [style.top.px]="p.y" aria-hidden="true">
          <header>
            <span class="medal">
              @if (p.node.icon) {
                <img [src]="p.node.icon" alt="" width="52" height="52" />
              }
            </span>
            <div>
              <h2>{{ skills.text(p.node.name) }}</h2>
              <p class="status" [class]="'status ' + p.status">
                @if (p.status === 'locked') {
                  <svg class="lock" viewBox="0 0 16 16">
                    <path
                      d="M5 7V5a3 3 0 016 0v2h1v7H4V7zm2 0h2V5a1 1 0 00-2 0z"
                      fill="currentColor"
                    />
                  </svg>
                }
                {{ 'skillStatus_' + p.status | transloco }}
                @if (p.node.max > 1) {
                  · {{ p.level }}/{{ p.node.max }}
                }
              </p>
            </div>
          </header>
          <div class="body">
            @for (para of p.paragraphs; track $index) {
              <p>
                @for (s of para; track $index) {
                  <span [class.bold]="s.bold" [class.italic]="s.italic">{{ s.text }}</span>
                }
              </p>
            }
            @if (p.node.attr) {
              <p class="impact">
                {{ 'skillImpact' | transloco }} :
                <b>{{ 'skillAttr_' + p.node.attr | transloco }}</b>
                @if (p.node.flame) {
                  {{ 'skillPerFlame' | transloco }}
                } @else {
                  +{{ p.node.gain }}
                }
              </p>
            }
          </div>
          @if (p.node.type !== 'Root') {
            <footer>
              <span class="keys"
                ><kbd>{{ 'skillKey' | transloco }}</kbd> {{ 'skillUnlock' | transloco }}</span
              >
              <span class="cost" [class.short]="planner.budget() - planner.used() < p.node.cost">
                <svg viewBox="0 0 64 64" aria-hidden="true"><use href="#emblem" /></svg>
                {{ planner.budget() - planner.used() }} / {{ p.node.cost }}
              </span>
            </footer>
          }
        </article>
      }
    </div>
  `,
  styleUrl: './skills.css',
})
export class Skills {
  protected readonly skills = inject(SkillsService);
  protected readonly planner = inject(PlannerStore);
  private readonly stage = viewChild.required<ElementRef<HTMLElement>>('stage');
  private readonly svg = viewChild.required<ElementRef<SVGSVGElement>>('svg');

  protected readonly classes = CLASSES;
  protected readonly query = signal('');
  protected readonly filter = signal<ClassFilter>('all');
  protected readonly panel = signal<PanelName | null>(null);
  protected readonly copied = signal(false);
  protected readonly hover = signal<{ node: SkillNode; x: number; y: number } | null>(null);
  private readonly box = signal<Box>({ x: 0, y: 0, w: 1, h: 1 });
  private drag: { x: number; y: number } | null = null;

  protected readonly viewBox = computed(() => {
    const b = this.box();
    return `${b.x} ${b.y} ${b.w} ${b.h}`;
  });
  protected readonly detail = computed(() => this.hover()?.node ?? null);

  constructor() {
    queueMicrotask(() => this.fit());
  }

  /** Nodes with how they stand: taken, available (a root or a taken node next to them), or locked. */
  protected readonly nodes = computed(() => {
    const tree = this.skills.tree();
    if (!tree) return [];
    const levels = this.planner.levels();
    const q = normalize(this.query().trim());
    const filter = this.filter();
    return this.skills.data()!.nodes.map((node) => {
      const taken = (levels[node.id] ?? 0) > 0;
      const state =
        node.type === 'Root'
          ? 'root'
          : taken
            ? 'taken'
            : reachable(tree, levels, node.id)
              ? 'available'
              : 'locked';
      const matches = !q || normalize(node.name.join(' ')).includes(q);
      return { node, state, shown: matches && (filter === 'all' || node.cls === filter) };
    });
  });

  protected readonly links = computed(() => {
    const data = this.skills.data();
    const tree = this.skills.tree();
    if (!data || !tree) return [];
    const levels = this.planner.levels();
    return data.links.map(([a, b]) => {
      const from = tree.byId.get(a)!;
      const to = tree.byId.get(b)!;
      const on =
        ((levels[a] ?? 0) > 0 || (levels[b] ?? 0) > 0) &&
        (tree.roots.has(a) || (levels[a] ?? 0) > 0) &&
        (tree.roots.has(b) || (levels[b] ?? 0) > 0);
      return { key: `${a}-${b}`, x1: from.x, y1: from.y, x2: to.x, y2: to.y, on };
    });
  });

  /** The circle the start points stand on. */
  protected readonly ring = computed(() => {
    const roots = this.skills.data()?.nodes.filter((n) => n.type === 'Root') ?? [];
    if (!roots.length) return null;
    const x = roots.reduce((n, r) => n + r.x, 0) / roots.length;
    const y = roots.reduce((n, r) => n + r.y, 0) / roots.length;
    const r = roots.reduce((n, p) => n + Math.hypot(p.x - x, p.y - y), 0) / roots.length;
    return { x, y, r };
  });

  /** The name of each specialization, outside the circle, in the colour of its class. */
  protected readonly labels = computed(() => {
    const ring = this.ring();
    const roots = this.skills.data()?.nodes.filter((n) => n.type === 'Root' && n.label) ?? [];
    if (!ring) return [];
    // past the farthest node, so the names never sit on the tree
    const far = Math.max(
      ...(this.skills.data()?.nodes ?? []).map((n) => Math.hypot(n.x - ring.x, n.y - ring.y)),
    );
    return roots.map((n) => {
      const d = Math.hypot(n.x - ring.x, n.y - ring.y) || 1;
      const out = far + 160;
      return {
        key: n.id,
        text: this.skills.text(n.label!).toUpperCase(),
        cls: n.cls,
        x: ring.x + ((n.x - ring.x) / d) * out,
        y: ring.y + ((n.y - ring.y) / d) * out + 30,
      };
    });
  });

  /** The six attributes: what the nodes taken give, and what the node under the pointer would add. */
  protected readonly attrs = computed(() => {
    const tree = this.skills.tree();
    if (!tree) return [];
    const total = attributes(tree, this.planner.levels());
    const node = this.detail();
    return ATTRS.map((key) => ({
      key,
      total: total[key],
      delta: node?.attr === key && !node.flame && this.planner.canAdd(node.id) ? node.gain : 0,
      flame: node?.attr === key && node.flame,
    }));
  });

  /** All the skills at a glance: what is taken by type, and the list of what is taken. */
  protected readonly summary = computed(() => {
    const levels = this.planner.levels();
    const nodes = this.skills.data()?.nodes ?? [];
    const taken = nodes
      .filter((n) => (levels[n.id] ?? 0) > 0)
      .map((node) => ({ node, level: levels[node.id] }));
    const counts = (['Active', 'Passive', 'Attribute'] as const).map((type) => ({
      type,
      taken: taken.filter((t) => t.node.type === type).length,
      total: nodes.filter((n) => n.type === type).length,
    }));
    return { counts, taken };
  });

  /** The popup of the node under the pointer, placed beside it. */
  protected readonly popup = computed(() => {
    const h = this.hover();
    if (!h) return null;
    const node = h.node;
    const level = this.planner.levels()[node.id] ?? 0;
    const status =
      node.type === 'Root'
        ? 'root'
        : level >= node.max
          ? 'full'
          : level > 0
            ? 'taken'
            : this.planner.canAdd(node.id)
              ? 'available'
              : reachable(this.skills.tree()!, this.planner.levels(), node.id)
                ? 'budget'
                : 'locked';
    const paragraphs = fill(this.skills.text(node.desc), node, level)
      .split('\n')
      .map((p) => segments(p));
    return { node, level, status, paragraphs, x: h.x, y: h.y };
  });

  protected radius(node: SkillNode): number {
    return node.icon ? ICON_RADIUS : RADIUS[node.type];
  }

  protected badge(node: SkillNode): string {
    return `${this.planner.levels()[node.id] ?? 0}/${node.max}`;
  }

  protected label(node: SkillNode): string {
    const name = this.skills.text(node.name);
    return node.type === 'Root' ? name : `${name} ${this.badge(node)}`;
  }

  protected points(saved: Record<string, number>): number {
    const tree = this.skills.tree();
    return tree
      ? Object.entries(saved).reduce((n, [id, l]) => n + (tree.byId.get(+id)?.cost ?? 0) * l, 0)
      : 0;
  }

  protected toggle(name: PanelName): void {
    this.panel.update((p) => (p === name ? null : name));
  }

  protected pick(node: SkillNode, event: Event): void {
    event.stopPropagation();
    this.planner.addLevel(node.id);
    this.show(node, event);
  }

  protected drop(event: Event, node: SkillNode): void {
    event.preventDefault();
    this.planner.removeLevel(node.id);
  }

  protected async copyLink(): Promise<void> {
    this.copied.set(await copyText(this.planner.link()));
  }

  // ---- the popup: beside the node, on the side with room
  protected show(node: SkillNode, event: Event): void {
    const target = (event.currentTarget as Element | null) ?? (event.target as Element);
    const at = target.getBoundingClientRect();
    const stage = this.stage().nativeElement.getBoundingClientRect();
    const right = at.right - stage.left + 18;
    const x = right + POPUP_WIDTH > stage.width ? at.left - stage.left - 18 - POPUP_WIDTH : right;
    const y = Math.min(
      Math.max(at.top - stage.top - 30, 8),
      Math.max(8, stage.height - POPUP_HEIGHT),
    );
    this.hover.set({ node, x: Math.max(8, x), y });
  }

  protected hide(): void {
    this.hover.set(null);
  }

  protected closePopup(): void {
    this.hover.set(null);
  }

  protected stageDown(): void {
    this.hover.set(null);
  }

  protected focusOn(node: SkillNode): void {
    const b = this.box();
    this.box.set({ ...b, x: node.x - b.w / 2, y: node.y - b.h / 2 });
  }

  // ---- the view: the whole tree on show, zoom on the wheel, drag to move
  protected fit(): void {
    const data = this.skills.data();
    if (!data) return;
    const xs = data.nodes.map((n) => n.x);
    const ys = data.nodes.map((n) => n.y);
    const x = Math.min(...xs) - MARGIN;
    const y = Math.min(...ys) - MARGIN;
    this.box.set({ x, y, w: Math.max(...xs) + MARGIN - x, h: Math.max(...ys) + MARGIN - y });
  }

  protected zoomBy(factor: number, at?: { x: number; y: number }): void {
    const b = this.box();
    const cx = at?.x ?? b.x + b.w / 2;
    const cy = at?.y ?? b.y + b.h / 2;
    this.hover.set(null);
    this.box.set({
      x: cx - (cx - b.x) * factor,
      y: cy - (cy - b.y) * factor,
      w: b.w * factor,
      h: b.h * factor,
    });
  }

  protected onWheel(event: WheelEvent): void {
    event.preventDefault();
    this.zoomBy(event.deltaY > 0 ? 1.15 : 1 / 1.15, this.point(event));
  }

  protected dragStart(event: PointerEvent): void {
    this.drag = { x: event.clientX, y: event.clientY };
  }

  protected dragMove(event: PointerEvent): void {
    if (!this.drag) return;
    const rect = this.svg().nativeElement.getBoundingClientRect();
    const b = this.box();
    const scale = Math.min(rect.width / b.w, rect.height / b.h);
    this.hover.set(null);
    this.box.set({
      ...b,
      x: b.x - (event.clientX - this.drag.x) / scale,
      y: b.y - (event.clientY - this.drag.y) / scale,
    });
    this.drag = { x: event.clientX, y: event.clientY };
  }

  protected dragEnd(): void {
    this.drag = null;
  }

  /** Where the pointer is, in the coordinates of the tree. */
  private point(event: MouseEvent): { x: number; y: number } {
    const rect = this.svg().nativeElement.getBoundingClientRect();
    const b = this.box();
    const scale = Math.min(rect.width / b.w, rect.height / b.h);
    const left = (rect.width - b.w * scale) / 2;
    const top = (rect.height - b.h * scale) / 2;
    return {
      x: b.x + (event.clientX - rect.left - left) / scale,
      y: b.y + (event.clientY - rect.top - top) / scale,
    };
  }
}
