# Dedicated server settings (reference for the « Partie » page)

Source: Enshrouded Knowledge Base, "Server Gameplay Settings" (https://enshrouded.zendesk.com/hc/en-us/articles/20453241249821-Server-Gameplay-Settings), default file of version 0.9.0.0, read 2026-11-08. The site refuses automated fetches (403): the page was read in the browser. Out-of-range numbers are clamped by the server; invalid text stops the server from booting.

`gameSettingsPreset`: `Default` | `Relaxed` | `Hard` | `Survival` | `Custom`. Only `Custom` uses the individual `gameSettings` below.

## gameSettings (key: default, range / options)

| Key | Default | Range / options |
|---|---|---|
| playerHealthFactor | 1 | 0.25–4 |
| playerManaFactor | 1 | 0.25–4 |
| playerStaminaFactor | 1 | 0.25–4 |
| playerBodyHeatFactor | 1 | 0.5–2 (Low 0.5, Default 1, High 1.5, Max 2) |
| playerDivingTimeFactor | 1 | 0.5–2 |
| enableDurability | true | true / false |
| enableStarvingDebuff | false | true / false |
| foodBuffDurationFactor | 1 | 0.5–2 |
| fromHungerToStarving | 600000000000 (10 min) | 5–20 min, in nanoseconds |
| shroudTimeFactor | 1 | 0.5–2 |
| tombstoneMode | AddBackpackMaterials | AddBackpackMaterials / Everything / NoTombstone |
| enableGliderTurbulences | true | true / false |
| weatherFrequency | Normal | Disabled / Rare / Normal / Often |
| fishingDifficulty | Normal | VeryEasy / Easy / Normal / Hard / VeryHard |
| miningDamageFactor | 1 | 0.5–2 |
| plantGrowthSpeedFactor | 1 | 0.25–2 |
| resourceDropStackAmountFactor | 1 | 0.25–2 |
| factoryProductionSpeedFactor | 1 | 0.25–2 |
| perkUpgradeRecyclingFactor | 0.5 in the 0.9.0.0 file (the article text says 0.1) | 0–1 |
| perkCostFactor | 1 | 0.25–2 |
| experienceCombatFactor | 1 | 0.25–2 |
| experienceMiningFactor | 1 | 0–2 |
| experienceExplorationQuestsFactor | 1 | 0.25–2 |
| randomSpawnerAmount | Normal | Few / Normal / Many / Extreme |
| aggroPoolAmount | Normal | Few / Normal / Many / Extreme |
| enemyDamageFactor | 1 | 0.25–5 (not bosses) |
| enemyHealthFactor | 1 | 0.25–4 (not bosses) |
| enemyStaminaFactor | 1 | 0.5–2 (not bosses; stun resistance) |
| enemyPerceptionRangeFactor | 1 | 0.5–2 (not bosses) |
| bossDamageFactor | 1 | 0.2–5 |
| bossHealthFactor | 1 | 0.2–5 |
| threatBonus | 1 | 0.25–4 (attack frequency, not bosses) |
| pacifyAllEnemies | false | true / false |
| tamingStartleRepercussion | LoseSomeProgress | KeepProgress / LoseSomeProgress / LoseAllProgress |
| dayTimeDuration | 1800000000000 (30 min) | 2–60 min, in nanoseconds |
| nightTimeDuration | 720000000000 (12 min) | 2–60 min, in nanoseconds |
| curseModifier | Normal | Easy (off) / Normal / Hard (double chance) |

## Other keys of the default file

`name` "Enshrouded Server", `saveDirectory` "./savegame", `logDirectory` "./logs", `ip` "0.0.0.0", `queryPort` 15637, `slotCount` 16, `tags` [], `voiceChatMode` "Proximity", `enableVoiceChat` false, `enableTextChat` false, `gameSettingsPreset` "Default", `gameSettings` {...}, `userGroups` (Admin, Friend, Guest, Visitor: `name`, `password`, `canKickBan`, `canAccessInventories`, `canEditWorld`, `canEditBase`, `canExtendBase`, `reservedSlots`), `bans` [].

The presets' own values (Relaxed, Hard, Survival) are not in this article.
