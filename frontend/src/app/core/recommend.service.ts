import { Injectable, computed, inject } from '@angular/core';
import { GearService } from './gear.service';
import { PlannerStore } from './planner.store';
import { Alert, recommend } from './recommend.logic';

/** The worn pieces whose level is too low for the character (see recommend.logic). */
@Injectable({ providedIn: 'root' })
export class Recommendations {
  private readonly gear = inject(GearService);
  private readonly planner = inject(PlannerStore);

  readonly alerts = computed(() =>
    recommend(
      this.gear.data(),
      this.planner.gear(),
      this.planner.upgrades(),
      this.planner.itemLevels(),
      this.planner.level(),
    ),
  );
  readonly bySlot = computed(() => new Map<string, Alert>(this.alerts().map((a) => [a.slot, a])));
}
