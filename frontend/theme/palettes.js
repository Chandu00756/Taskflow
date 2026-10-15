// Theme palettes. Tailwind's color utilities read CSS variables
// (--c-<palette>-<shade>), so each theme can remap the whole palette without
// touching component class names. Used by tailwind.config.js.
const colors = require('tailwindcss/colors');

const SHADES = ['50', '100', '200', '300', '400', '500', '600', '700', '800', '900', '950'];
const NEUTRALS = ['slate', 'gray', 'zinc', 'neutral', 'stone'];
const CHROMATIC = ['red', 'orange', 'amber', 'yellow', 'lime', 'green', 'emerald', 'teal', 'cyan', 'sky', 'blue', 'indigo', 'violet', 'purple', 'fuchsia', 'pink', 'rose'];
const PALETTES = [...NEUTRALS, ...CHROMATIC];

function triplet(hex) {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return `${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255}`;
}

function vars(palette, scale) {
  const out = {};
  SHADES.forEach((s) => {
    out[`--c-${palette}-${s}`] = triplet(scale[s]);
  });
  return out;
}

/** Tailwind color config: every shade reads its variable and keeps opacity modifiers. */
function tailwindColors() {
  const out = {};
  PALETTES.forEach((p) => {
    out[p] = {};
    SHADES.forEach((s) => {
      out[p][s] = `rgb(var(--c-${p}-${s}) / <alpha-value>)`;
    });
  });
  return out;
}

// --- Classic: Tailwind defaults -------------------------------------------
function classicVars() {
  return Object.assign({}, ...PALETTES.map((p) => vars(p, colors[p])), {
    '--surface': '255 255 255',
    '--surface-alpha': '1',
  });
}

// --- Dark ------------------------------------------------------------------
const DARK_NEUTRAL = {
  50: '#020617',
  100: '#1e293b',
  200: '#273449',
  300: '#3b4a63',
  400: '#64748b',
  500: '#94a3b8',
  600: '#a9b6c9',
  700: '#cbd5e1',
  800: '#e2e8f0',
  900: '#f1f5f9',
  950: '#f8fafc',
};
// Light tints become deep tints and dark text shades become light ones, so
// badges like "bg-emerald-50 text-emerald-700" read well on dark surfaces.
const DARK_CHROMATIC_MAP = { 50: '950', 100: '900', 200: '800', 300: '700', 400: '400', 500: '500', 600: '600', 700: '400', 800: '300', 900: '200', 950: '100' };

function darkVars() {
  const out = { '--surface': '15 23 42', '--surface-alpha': '1' };
  NEUTRALS.forEach((p) => Object.assign(out, vars(p, DARK_NEUTRAL)));
  CHROMATIC.forEach((p) => {
    const scale = {};
    SHADES.forEach((s) => (scale[s] = colors[p][DARK_CHROMATIC_MAP[s]]));
    Object.assign(out, vars(p, scale));
  });
  return out;
}

// --- Crimson: warm neutrals and a deep crimson accent -----------------------
const CRIMSON = {
  50: '#fff1f3',
  100: '#ffe0e6',
  200: '#ffc6d1',
  300: '#ff9aae',
  400: '#f9607f',
  500: '#ef3456',
  600: '#d11a40',
  700: '#b01236',
  800: '#921233',
  900: '#7c1331',
  950: '#450516',
};

function crimsonVars() {
  return Object.assign(
    {},
    vars('slate', colors.stone),
    vars('gray', colors.stone),
    vars('blue', CRIMSON),
    vars('sky', colors.orange),
    vars('indigo', colors.rose),
    { '--surface': '255 255 255', '--surface-alpha': '1' }
  );
}

// --- Glass: default palette with translucent surfaces -----------------------
function glassVars() {
  return { '--surface': '255 255 255', '--surface-alpha': '0.72' };
}

/** Tailwind plugin that emits the variables for every theme. */
function themePlugin({ addBase }) {
  addBase({
    ':root': classicVars(),
    '[data-theme="glass"]': glassVars(),
    '[data-theme="dark"]': darkVars(),
    '[data-theme="crimson"]': crimsonVars(),
  });
}

module.exports = { tailwindColors, themePlugin, triplet };
