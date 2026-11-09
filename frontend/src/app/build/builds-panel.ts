import { Component, inject, signal } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { copyText } from '../core/links';
import { PlannerStore } from '../core/planner.store';
import { SkillsService } from '../core/skills.service';

/** Name, save, new, reset, link and the saved builds: shared by the Build screen and the skill tree. */
@Component({
  selector: 'app-builds-panel',
  imports: [TranslocoPipe],
  template: `
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
  `,
  styles: `
    h3 {
      margin: 10px 0 6px;
      font-size: 0.85rem;
      font-family: var(--display-sc);
      font-weight: 400;
      text-transform: none;
      letter-spacing: 1px;
      color: var(--gold);
    }
    input {
      width: 100%;
      box-sizing: border-box;
      margin-bottom: 6px;
    }
    .row {
      display: flex;
      gap: 6px;
      flex-wrap: wrap;
      margin-bottom: 6px;
    }
    .error {
      color: var(--bad);
    }
    ul {
      list-style: none;
      margin: 0;
      padding: 0;
    }
    li {
      display: flex;
      gap: 4px;
      margin-bottom: 4px;
    }
    li > button:first-child {
      flex: 1;
      display: flex;
      justify-content: space-between;
      gap: 8px;
      text-align: left;
      background: rgba(255, 255, 255, 0.06);
      color: inherit;
      border: 1px solid var(--gold-dim);
      border-radius: 4px;
      padding: 4px 8px;
      cursor: pointer;
    }
    li > button.active {
      border-color: #ff7be8;
    }
    .drop {
      background: none;
      border: 0;
      color: var(--bad);
      cursor: pointer;
    }
    .empty {
      color: var(--muted);
    }
  `,
})
export class BuildsPanel {
  protected readonly planner = inject(PlannerStore);
  private readonly skills = inject(SkillsService);
  protected readonly copied = signal(false);

  protected points(saved: Record<string, number>): number {
    const tree = this.skills.tree();
    return tree
      ? Object.entries(saved).reduce((n, [id, l]) => n + (tree.byId.get(+id)?.cost ?? 0) * l, 0)
      : 0;
  }

  protected async copyLink(): Promise<void> {
    this.copied.set(await copyText(this.planner.link()));
  }
}
