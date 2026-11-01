#!/usr/bin/env node
// Builds the portfolio's smart-home-widget.html from the ApartmentLights project's
// "Apartment layout in 3D.html", and copies the three.js files it loads.
//
//   node scripts/prepare-smart-home-widget.mjs \
//     --source "/path/to/ApartmentLights/app/build/generated/model-assets/model" \
//     --out . --vendor assets/vendor
//
// The source page already falls back to an on-screen-only preview when its lamp bridge
// is unreachable; the patches below make that fallback permanent, strip the Android
// wrapper, and add a ?widget=1 mode for the portfolio pop-out. Every patch asserts on its
// anchor text, so an upstream edit fails loudly here instead of silently doing nothing.

import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';

const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i].replace(/^--/, ''), process.argv[i + 1]);

const sourceDir = args.get('source');
const outDir = resolve(args.get('out') || '.');
const vendorDir = args.get('vendor') || 'assets/vendor';
if (!sourceDir) {
  console.error('Usage: node scripts/prepare-smart-home-widget.mjs --source <ApartmentLights model dir> [--out .] [--vendor assets/vendor]');
  process.exit(1);
}

const SOURCE_PAGE = 'Apartment layout in 3D.html';
const VENDOR_FILES = ['three.min.js', 'OrbitControls.js'];

let html = await readFile(resolve(sourceDir, SOURCE_PAGE), 'utf8');

/** Replace `find` with `replacement`, requiring exactly `count` occurrences. */
function patch(find, replacement, count = 1) {
  const found = html.split(find).length - 1;
  if (found !== count) throw new Error(`Expected ${count} occurrence(s) of:\n${find.slice(0, 120)}\n...but found ${found}.`);
  html = html.replaceAll(find, replacement);
}

// 1. The file ships wrapped in the Android WebView's own document. Keep only the real page.
html = html.slice(html.indexOf('<!DOCTYPE html>'));
patch('</html>\n\n</body></html>', '</html>\n');

// 2. Name it for the portfolio.
patch('<title>Apartment layout in 3D</title>', '<title>Custom 3D Smart Home Widget</title>');

// 3. ?widget=1 — the pop-out borrows the Android widget's chrome-free look.
patch(
  'if (window.AndroidLamps) document.documentElement.classList.add("app");',
  `if (window.AndroidLamps) document.documentElement.classList.add("app");
// ?widget=1: the pop-out on the portfolio page. It borrows the Android widget's look — the apartment
// alone on a transparent background, no toolbar — but the bulbs are still the on-screen demo ones.
if (new URLSearchParams(location.search).has("widget")) document.documentElement.classList.add("app", "widget");`,
);

// 4. The wrapper document supplied this; .demo and .dimmer set their own display, which
//    outranks the browser's [hidden] rule, so without it they are visible from the start.
patch('html,body{height:100%;margin:0}', `[hidden]{display:none!important}
html,body{height:100%;margin:0}`);

// 5. Keep the per-lamp tooltip in the pop-out — it is the only hint left once the toolbar is hidden.
patch('html.app .bar, html.app .tip, html.app #demo{ display:none; }', `html.app .bar, html.app .tip, html.app #demo{ display:none; }
html.widget .tip{ display:block; }`);

// 6. A dark color-scheme makes the browser paint an opaque backdrop behind an iframe, which
//    would hide the page under the pop-out. !important because the dark-mode block outranks this.
patch('html.app body{ background:transparent; }', `html.app body{ background:transparent; }
html.widget, html.widget body{ background:transparent !important; color-scheme:normal !important; }`);

// 7. A badge for the standalone page, saying the bulbs are not real. Hidden in the pop-out,
//    where the card beside it already explains what this is.
patch('.demo{position:absolute;', `.note{position:absolute;top:14px;left:50%;transform:translateX(-50%);width:max-content;max-width:calc(100% - 24px);
  background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:7px 12px;
  backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);text-align:center;line-height:1.35}
.note b{display:block;font-size:.8rem;font-weight:600;color:var(--navy)}
.note span{display:block;font-size:.72rem;color:var(--muted)}
html.app .note, html.embed .note{ display:none }
.demo{position:absolute;`);

patch('  <div class="bar" role="toolbar" aria-label="View controls">', `  <p class="note">
    <b>Demo &middot; not connected to real bulbs</b>
    <span>Tap a lamp to switch it &middot; drag &#x2195; on it to dim &middot; drag the room to orbit, scroll to zoom</span>
  </p>
  <div class="bar" role="toolbar" aria-label="View controls">`);

// 8. Transparent rendering in widget mode, the same way snapshot and app mode do it.
patch(
  `const APP = !!window.AndroidLamps;   // inside the Android app (see the top of the page)
const renderer = new THREE.WebGLRenderer({ antialias:true, alpha:SNAPSHOT || APP, preserveDrawingBuffer:SNAPSHOT });`,
  `const APP = !!window.AndroidLamps;   // inside the Android app (see the top of the page)
const WIDGET = document.documentElement.classList.contains("widget");   // the portfolio pop-out (see the top of the page)
const renderer = new THREE.WebGLRenderer({ antialias:true, alpha:SNAPSHOT || APP || WIDGET, preserveDrawingBuffer:SNAPSHOT });`,
);

patch(
  '  if (SNAPSHOT || APP){ scene.background = null; scene.fog = null; ground.visible = false; }   // only the apartment, on transparent',
  '  if (SNAPSHOT || APP || WIDGET){ scene.background = null; scene.fog = null; ground.visible = false; }   // only the apartment, on transparent',
);

// 9. Open in the evening, where the lamps carry the room.
patch(
  'if (SNAPSHOT){ demoTime = new Date(); demoTime.setHours(13, 0, 0, 0); }   // same midday light in every snapshot',
  `if (SNAPSHOT){ demoTime = new Date(); demoTime.setHours(13, 0, 0, 0); }   // same midday light in every snapshot
else { demoTime = new Date(); demoTime.setHours(20, 15, 0, 0); }          // the demo opens in the evening, where the lamps do the work`,
);

// 10. Never reach for the lamp bridge: this copy is a demo, so nothing leaves the page.
patch(
  `  : fetch(\`/api/lamps/\${encodeURIComponent(alias)}/\${what}\`, {
      method:"POST", headers:{ "Content-Type":"application/json" }, body: body && JSON.stringify(body)
    }).then(r => r.ok ? r.json() : null).catch(() => null);`,
  '  : Promise.resolve(null);   // portfolio demo: nothing is sent, the bulbs live only on screen',
);

patch(
  `    if (APP) list = JSON.parse(window.AndroidLamps.states());
    else {
      const r = await fetch("/api/lamps", { cache:"no-store" });
      if (!r.ok) throw 0;
      list = await r.json();
    }`,
  `    if (APP) list = JSON.parse(window.AndroidLamps.states());
    else throw 0;   // portfolio demo: no bridge to read, so every lamp stays on screen only`,
);

patch(
  'if (!SNAPSHOT){ pollLamps(); setInterval(() => { if (!document.hidden && shownInDash) pollLamps(); }, APP ? 500 : 5000); }',
  `if (!SNAPSHOT) pollLamps();   // demo: one pass to settle into preview mode, then nothing to poll
// With no bridge to read, the demo opens part-lit instead of dark: the lamps a room is usually left with
// in the evening, so reflections and dimming are visible before anything is touched.
setLamp("Living Room Lamp - Light 1", true, 100);
setLamp("Living Room Lamp - Light 3", true, 55);
setLamp("Mike's Light", true, 70);`,
);

// 11. In the pop-out the host sizes the iframe as it places it, which a window resize event
//     does not always follow. Without this the scene never draws its first frame.
patch('window.addEventListener("resize", resize);', `window.addEventListener("resize", resize);
// In the portfolio pop-out the page is an iframe the host resizes as it places it, which a window
// resize event doesn't always follow, so watch the element itself.
if (window.ResizeObserver) new ResizeObserver(resize).observe(app);`);

// 12. Point at the copied three.js instead of the Android bridge's vendor/ directory.
for (const file of VENDOR_FILES) patch(`<script src="vendor/${file}"></script>`, `<script src="${vendorDir}/${file}"></script>`);

const target = resolve(outDir, 'smart-home-widget.html');
await writeFile(target, html);
await mkdir(resolve(outDir, vendorDir), { recursive: true });
for (const file of VENDOR_FILES) await copyFile(resolve(sourceDir, 'vendor', file), resolve(outDir, vendorDir, file));

console.log(`Wrote ${basename(target)} and ${VENDOR_FILES.length} vendor files into ${vendorDir}/.`);
