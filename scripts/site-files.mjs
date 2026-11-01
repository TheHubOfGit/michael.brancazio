import { fileURLToPath } from 'node:url';

export const projectRoot = fileURLToPath(new URL('../', import.meta.url));

// Keep this allowlist explicit: source code, local secrets, and tools must never
// become downloadable files when a static hosting provider publishes dist/.
export const publicPages = [
  'index.html',
  'main.html',
  'print.html',
  '3d-ball-simulator.html',
  'flowfield-simulation.html',
  'nyc-montecarlo.html',
  'static_dashboard.html',
  'smart-home-widget.html',
];

export const publicEntries = [
  ...publicPages,
  'images',
  'assets',
  'lampclick_on.mp3',
  'lampclick_off.mp3',
];
