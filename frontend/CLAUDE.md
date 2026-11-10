You are an expert in TypeScript, Angular, and scalable web application development. You write functional, maintainable, performant, and accessible code following Angular and TypeScript best practices.

## TypeScript Best Practices

- Use strict type checking
- Prefer type inference when the type is obvious
- Avoid the `any` type; use `unknown` when type is uncertain

## Angular Best Practices

- Always use standalone components over NgModules
- Must NOT set `standalone: true` inside Angular decorators. It's the default in Angular v20+.
- Do NOT set `changeDetection: ChangeDetectionStrategy.OnPush` explicitly. `OnPush` is the default in Angular v22+.
- Use signals for state management
- Implement lazy loading for feature routes
- Do NOT use the `@HostBinding` and `@HostListener` decorators. Put host bindings inside the `host` object of the `@Component` or `@Directive` decorator instead
- Use `NgOptimizedImage` for all static images.
  - `NgOptimizedImage` does not work for inline base64 images.

## Accessibility Requirements

- It MUST pass all AXE checks.
- It MUST follow all WCAG AA minimums, including focus management, color contrast, and ARIA attributes.

## Components

- Keep components small and focused on a single responsibility
- Use `input()` and `output()` functions instead of decorators
- Use `model()` for two-way bound properties with `[(prop)]` syntax instead of pairing `input()` with `output()`
- Use `computed()` for derived state
- Use `linkedSignal()` for state derived from multiple reactive sources that must stay synchronized
- Prefer inline templates for small components
- Prefer Signal Forms (`@angular/forms/signals`) for new forms. They are stable in Angular v22+ and provide signal-based state, type-safe field access, and schema-based validation
- When not using Signal Forms, prefer Reactive forms instead of Template-driven ones
- Do NOT use `ngClass`, use `class` bindings instead
- Do NOT use `ngStyle`, use `style` bindings instead
- Do NOT import `CommonModule`, import only the directives and pipes the template uses, such as `AsyncPipe` or `DatePipe`
- When using external templates/styles, use paths relative to the component TS file.

## State Management

- Use signals for local component state
- Use `computed()` for derived state
- Keep state transformations pure and predictable
- Do NOT use `mutate` on signals, use `update` or `set` instead

## Templates

- Keep templates simple and avoid complex logic
- Use native control flow (`@if`, `@for`, `@switch`) instead of `*ngIf`, `*ngFor`, `*ngSwitch`
- Use the async pipe to handle observables
- Do not assume globals like (`new Date()`) are available.

## Services

- Design services around a single responsibility
- Use the `providedIn: 'root'` option for singleton services
- Prefer the `@Service` decorator over `@Injectable({providedIn: 'root'})` for new singleton services (Angular v22+)
- Use the `inject()` function instead of constructor injection

## Design system: "Codex of the Shroud"

Every screen, dialog and popup follows the same identity. It is enforced by `npm run lint` (`scripts/check-design.mjs`, also run in CI and `make check`), so a style that brings its own colour, font or big radius fails the build.

- **Tokens only.** Colours, fonts and the plate corners live in `src/styles.css` (`:root`). In component styles use `var(--bg|--panel|--panel-deep|--ink|--text|--muted|--gold|--gold-dim|--accent|--ok|--bad|--shroud|...)`. Need a new colour: add a token there with a comment, do not write a hex in a component. Black and white (with alpha) are allowed for shadows and outlines. Real data colours (category colours, rarity) stay in their data files, listed in the guard.
- **Colour roles.** Cold blue-slate ground (the Shroud), bronze (`--gold`, `--gold-dim`) for lines and page titles, ember (`--accent`) only for what is active, open or focused. Never use ember as decoration.
- **Type.** `--display` (IM Fell English) for titles and long reading, `--display-sc` (IM Fell English SC) for labels and tabs, in small capitals: never `text-transform: uppercase`. `--ui` (Alegreya Sans) for everything else, `--mono` for code. The fonts have one weight: no `font-weight: 700` on `--display*`. Every font file is also preloaded in `src/index.html`: add the `<link rel="preload">` when adding a font, or it loads late and the swap moves the text (measured: shifts at 2 s and 4 s on a 4K screen).
- **Plates.** A card, dialog or popup has `border: 1px solid ...`, a radius of at most 3px (50% and 999px for dots and pills), and the two bronze corners (2px lines: 1px ones vanish at fractional positions): `background: var(--plate-corners), linear-gradient(180deg, var(--panel), var(--panel-deep)); background-origin: border-box;` (`--plate-corners-lit` when hovered or chosen). Section titles (`h2`) get the diamond on the rule (see `workshop/workshop.css`).
- **Shared look.** The screens other than the map share `workshop/workshop.css` (global, scoped by `app-workshop, app-lore, ...`): add new screens to its scope list instead of restyling buttons, fields and tabs.
- **Performance.** No `background-attachment: fixed`, no large blurred shadows, no 60 fps animation of big gradients (use `steps()`); they made the e2e suite 4x slower in headless Chromium.
- **Deliberate exception**: write `design-ok` in a comment on the same line (rare; say why).
