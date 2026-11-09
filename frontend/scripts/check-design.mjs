// Design guard: the look of the site lives in the tokens of src/styles.css ("Codex of the Shroud", see CLAUDE.md).
// This script fails when a style brings its own colour, font or big radius instead of using a token.
// Run by `npm run lint:design` (make check-frontend and CI).
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = new URL('../src', import.meta.url).pathname;

// Files where a colour is data or an illustration, not part of the theme.
const COLOUR_DATA = new Set([
  'app/core/sections.ts', // the colour of each map category
  'app/core/gear.logic.ts', // rarity colours as the game gives them
  'app/map/map-view.ts', // canvas drawing: tints of the dot icons (halo colours come from the tokens)
  'app/skills/skills.ts', // the coin of the skill points, an illustration
]);
const TOKENS = 'styles.css'; // where the colours are defined

const rules = [
  {
    name: 'colour',
    // black and white, with or without alpha, are the shadows and outlines: allowed
    test: (line) =>
      [...line.matchAll(/#[0-9a-fA-F]{3,8}\b|\brgba?\([^)]*\)|\bhsla?\([^)]*\)/g)]
        .map((m) => m[0])
        .filter(
          (c) => !/^#(0{3,8}|0{3}[0-9a-f]|f{3,8}|f{3}[0-9a-f])$|^#(0{6}|f{6})[0-9a-f]{2}$/i.test(c),
        )
        .filter((c) => !/^rgba?\(\s*(0\s*,\s*0\s*,\s*0|255\s*,\s*255\s*,\s*255)\b/.test(c))
        .at(0),
    skip: (file) => file === TOKENS || COLOUR_DATA.has(file),
    hint: 'use a colour token (var(--gold), var(--ink)...) or add one to src/styles.css',
  },
  {
    name: 'uppercase',
    test: (line) =>
      /text-transform:\s*uppercase/.test(line) ? 'text-transform: uppercase' : undefined,
    hint: 'labels are small capitals: font-family: var(--display-sc), never all caps',
  },
  {
    name: 'font',
    test: (line) => {
      const m = /(?:^|[\s;{])font(?:-family)?:\s*([^;}]*)/.exec(line);
      if (!m || /^\s*inherit\b/.test(m[1])) return undefined;
      // a shorthand may carry a size before the family: fine when the family is one of the tokens
      return /\bvar\(--(ui|display|display-sc|mono)\)/.test(m[1]) ? undefined : m[0].trim();
    },
    skip: (file) => file === TOKENS,
    hint: 'use var(--ui), var(--display), var(--display-sc) or var(--mono)',
  },
  {
    name: 'radius',
    test: (line) => {
      const m = /border-radius:\s*([^;}]*)/.exec(line);
      if (!m) return undefined;
      const big = [...m[1].matchAll(/(\d+(?:\.\d+)?)px/g)].some(
        (p) => Number(p[1]) > 3 && Number(p[1]) < 100,
      );
      return big ? m[0].trim() : undefined;
    },
    hint: 'plates are cut, not round: 3px at most (50% and 999px for dots and pills)',
  },
];

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* walk(path);
    else if (/\.(css|ts|html)$/.test(name) && !name.endsWith('.spec.ts')) yield path;
  }
}

const found = [];
for (const path of walk(root)) {
  const file = relative(root, path);
  const lines = readFileSync(path, 'utf8').split('\n');
  const styled = (i) => file.endsWith('.css') || file.endsWith('.html') || inStyles(lines, i);
  lines.forEach((line, i) => {
    if (!styled(i) || line.includes('design-ok')) return;
    for (const rule of rules) {
      if (rule.skip?.(file)) continue;
      const hit = rule.test(line);
      if (hit) found.push(`${file}:${i + 1}  [${rule.name}] ${hit}  -> ${rule.hint}`);
    }
  });
}

/** In a .ts component: true on the lines of its `styles:` template literal (and its inline style attributes). */
function inStyles(lines, index) {
  for (let i = index; i >= 0; i--) {
    if (/^\s*styles:\s*`/.test(lines[i])) {
      // open until the closing backtick
      for (let j = i; j <= index; j++) if (j > i && /`/.test(lines[j])) return false;
      return true;
    }
    if (
      /^\s*(template|templateUrl|selector|host):/.test(lines[i]) ||
      /^(export|@Component)/.test(lines[i])
    )
      return false;
  }
  return false;
}

if (found.length) {
  console.error(
    `Design guard: ${found.length} style(s) outside the design tokens.\n` + found.join('\n'),
  );
  console.error('\nA deliberate exception: put "design-ok" in a comment on the same line.');
  process.exit(1);
}
console.log('Design guard: every style uses the design tokens.');
