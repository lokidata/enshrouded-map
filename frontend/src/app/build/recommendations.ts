import { Component, inject } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { GearService } from '../core/gear.service';
import { PlannerStore } from '../core/planner.store';
import { Recommendations } from '../core/recommend.service';

/** Pieces whose level is too low for the character, with the advice computed from the game's formulas. */
@Component({
  selector: 'app-recommendations',
  imports: [TranslocoPipe],
  template: `
    <details class="reco" open>
      <summary>
        {{ 'recoTitle' | transloco }}
        @if (reco.alerts().length) {
          <span class="count">{{ reco.alerts().length }}</span>
        }
      </summary>
      <p class="help">{{ 'recoHelp' | transloco }}</p>
      <div role="status">
        @if (reco.alerts().length) {
          <ul>
            @for (a of reco.alerts(); track a.slot) {
              <li [attr.data-severity]="a.now.severity ?? a.base.severity">
                <p class="head">
                  <span class="tag"
                    ><span aria-hidden="true">{{
                      (a.now.severity ?? a.base.severity) === 'critical' ? '⛔' : '⚠'
                    }}</span>
                    {{ 'reco_' + (a.now.severity ?? a.base.severity) | transloco }}</span
                  >
                  <b>{{ 'equipSlot_' + a.slot | transloco }}</b> ·
                  {{ name(a.slot) }}
                </p>
                <p>
                  {{
                    'recoBoth'
                      | transloco
                        : {
                            base: a.base.level,
                            baseLoss: a.base.loss,
                            now: a.now.level,
                            nowLoss: a.now.loss,
                            target: a.target,
                          }
                  }}
                  · {{ 'recoLoss' + a.kind | transloco }}
                </p>
                @if (a.capped; as c) {
                  <p class="advice">{{ 'recoCapped' | transloco: c }}</p>
                }
                <p class="advice">
                  {{ (a.state === 'still' ? 'recoStill' : 'recoCompensated') | transloco }}
                  @if (a.upgrades; as u) {
                    {{ 'recoUpgrades' | transloco: u }}
                  }
                </p>
              </li>
            }
          </ul>
        } @else {
          <p class="ok">{{ 'recoOk' | transloco }}</p>
        }
      </div>
    </details>
  `,
  styleUrl: './recommendations.css',
})
export class RecommendationsPanel {
  protected readonly reco = inject(Recommendations);
  protected readonly gear = inject(GearService);
  private readonly planner = inject(PlannerStore);

  protected name(slot: string): string {
    const item = this.gear.data()?.items[this.planner.gear()[slot as 'head'] ?? ''];
    return item ? this.gear.text(item.name) : '';
  }
}
