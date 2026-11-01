# Custom 3D Smart Home Widget — card + pop-out

How to add the apartment card and its 3D pop-out to any build of the portfolio. Everything
here is self-contained: the snippets are the finished versions, not sketches.

## What it does

A card in **Fun Projects** whose title is a link. Clicking it opens the 3D apartment in a
pop-out pinned directly above the link, on a fully transparent background, the way the
widget sits on an Android home screen. Inside it you can orbit by dragging, zoom by
scrolling, tap a lamp to toggle it, and drag up or down on a lamp to dim it. No network
calls — the bulbs live only on screen.

The page itself is the real ApartmentLights model, not a reimplementation. It already had
an on-screen-only preview mode for when its lamp bridge is unreachable; the build script
makes that mode permanent.

## Files

| File | What it is |
| --- | --- |
| `smart-home-widget.html` | The model page. Generated — see step 1. |
| `assets/vendor/three.min.js` | three.js r128, copied from ApartmentLights. ~590 KB. |
| `assets/vendor/OrbitControls.js` | Its OrbitControls. ~26 KB. |
| `scripts/prepare-smart-home-widget.mjs` | Regenerates the page from the ApartmentLights source. |

**Use the vendored three.js, not a CDN copy.** The page patches three.js shader source
strings at runtime to keep each lamp's light inside its own room; a different build silently
breaks that. If you must use a CDN, pin exactly `three@0.128.0` and re-test the lighting.

The vendor path is configurable (`--vendor`). On a build with no `assets/` directory, pass
something like `--vendor vendor` and the generated page will reference `vendor/…`.

## Step 1 — generate the model page

```bash
node scripts/prepare-smart-home-widget.mjs --source "/path/to/ApartmentLights/app/build/generated/model-assets/model" --out . --vendor assets/vendor
```

That reads `Apartment layout in 3D.html`, applies the patches below, writes
`smart-home-widget.html`, and copies the two vendor files. Every patch asserts on its anchor
text, so if ApartmentLights has moved on the script fails loudly naming the anchor instead of
producing a half-patched page.

What it changes, and why each one is needed:

1. **Strips the Android WebView wrapper** — the file ships with a second `<!doctype html>`
   document wrapped around it.
2. **Retitles** the page.
3. **Adds `?widget=1`** — sets `class="app widget"` on `<html>`, borrowing the Android
   widget's chrome-free look (no toolbar, transparent) while keeping the demo bulbs.
4. **Re-adds `[hidden]{display:none!important}`** — the wrapper document supplied this.
   `.demo` and `.dimmer` set their own `display`, which outranks the browser's `[hidden]`
   rule, so without it the time/date panel is visible on load.
5. **Keeps the per-lamp tooltip** in widget mode — the only hint left once the toolbar is gone.
6. **Forces `color-scheme: normal` and transparent backgrounds** in widget mode. See gotchas.
7. **Adds the "Demo · not connected to real bulbs" badge** for the standalone page. It is
   hidden in the pop-out, where the card beside it already explains what this is.
8. **Transparent rendering** in widget mode (`alpha` on the renderer, no scene background,
   fog or ground plane).
9. **Opens at 8:15 PM** so the lamps carry the room instead of daylight.
10. **Removes the bridge calls** — `api()` resolves to null, `pollLamps()` throws straight
    into its preview branch, the 5-second poll is gone, and three lamps start on.
11. **Adds a `ResizeObserver`** on `#app`. See gotchas.
12. **Repoints the two `<script src="vendor/…">` tags** at your vendor path.

## Step 2 — the card

Goes in the Fun Projects scroll container, wherever you want it in the order. The link
carries `data-widget-popout`; `href` is the real page so middle-click and ⌘-click still work.

```html
<!-- Smart Home Widget Card -->
<div class="card">
    <div class="card-scrollable-content">
        <div class="experience-card">
            <a class="experience-title project-link"
                data-widget-popout="smart-home-widget.html?widget=1" href="smart-home-widget.html" aria-haspopup="dialog" aria-expanded="false">Custom 3D Smart Home Widget</a>
            <div class="experience-description">
                <p><strong>What:</strong> A 3D model of my apartment where every smart bulb
                    is a light you can actually reach: tap a lamp to switch it, drag up or
                    down on it to dim it, and watch the glow and reflections spread across
                    the floors and walls. Orbit by dragging, zoom by scrolling.</p>
                <p><strong>How:</strong> Built with <strong><span
                            class="glow-tech">Three.js</span></strong> over a to-scale floor
                    plan, with per-bulb point lights, shadow casting that keeps each lamp's
                    light in its own room, and a sun position computed from the real date
                    and time. The live version drives Kasa bulbs through a local bridge and
                    an Android home-screen widget; this copy is the same model running in
                    preview mode, so nothing connects to a real light.</p>
                <p><strong>Why:</strong> Wall switches and phone apps both make you think in
                    device names. Looking at the actual room and pressing the actual lamp is
                    faster, and it turned out to be a good excuse to model the whole
                    apartment.</p>
            </div>
        </div>
    </div>
</div>
```

Note it uses `data-widget-popout`, **not** `data-modal-target`. If the build's existing modal
script binds `.project-link[data-modal-target]`, this card is invisible to it, which is what
you want — it must not open the full-screen modal.

## Step 3 — the pop-out element

One per page, as a direct child of `<body>` (it is `position: fixed`, so any transformed or
filtered ancestor would become its containing block). Put it beside the other modals.

```html
<!-- Smart home widget pop-out: the apartment floats over the page on a transparent background,
     anchored above the link that opened it, the way the widget sits on an Android home screen. -->
<div id="smart-home-popout" class="widget-popout" role="dialog" aria-label="Custom 3D smart home widget"
    aria-hidden="true" hidden>
    <button type="button" class="widget-popout-close" aria-label="Close widget">&times;</button>
    <iframe title="Custom 3D smart home widget" data-src="smart-home-widget.html?widget=1" frameborder="0"
        scrolling="no"></iframe>
</div>
```

`data-src` rather than `src`: the scene only loads when opened. The JS sets `src` on open and
removes it on close, which stops the render loop while the pop-out is shut.

## Step 4 — CSS

Into the stylesheet, or into the page's `<style>` block on an inline-CSS build.

```css
/* Smart home widget pop-out: the 3D apartment floats over the page on a transparent
   background, pinned above the link that opened it, as it does on an Android home screen. */
.widget-popout {
    position: fixed;
    z-index: 1200;
    background: none;
    border: none;
    filter: drop-shadow(0 18px 32px rgba(0, 0, 0, 0.35));
    transform: translateY(6px) scale(0.985);
    transform-origin: bottom center;
    transition: transform 0.18s ease;
}
.widget-popout.open { transform: none; }
.widget-popout iframe {
    width: 100%;
    height: 100%;
    border: 0;
    background: transparent;
    color-scheme: normal;
}
.widget-popout-close {
    position: absolute;
    top: -10px;
    right: -10px;
    z-index: 1;
    width: 28px;
    height: 28px;
    padding: 0;
    line-height: 1;
    font-size: 1.1rem;
    color: #fff;
    background: rgba(27, 42, 61, 0.85);
    border: 1px solid rgba(255, 255, 255, 0.25);
    border-radius: 50%;
    cursor: pointer;
}
.widget-popout-close:hover { background: rgba(27, 42, 61, 1); }
@media (prefers-reduced-motion: reduce) {
    .widget-popout { transition: none; }
}
```

`z-index: 1200` clears the filter box (1001) and the sticky header (999) in this project.
Check what the target build stacks above 1000.

**Do not animate `opacity` from 0.** Only `transform` is animated here, deliberately — see
gotchas.

## Step 5 — JS wiring

Inside a `DOMContentLoaded` handler, beside the existing modal wiring.

```js
// The smart home widget opens as a pop-out pinned above its link, not as a full-screen modal.
const popout = document.getElementById('smart-home-popout');
const popoutFrame = popout.querySelector('iframe');
let popoutAnchor = null;
let popoutOpenedAt = 0;

function positionPopout() {
    if (!popoutAnchor) return;
    const link = popoutAnchor.getBoundingClientRect();
    const gap = 12;
    const width = Math.min(640, window.innerWidth - 24);
    const roomAbove = link.top - gap - 12;
    const roomBelow = window.innerHeight - link.bottom - gap - 12;
    // It belongs above the link text; it only drops below when there is no room up there.
    const above = roomAbove >= 260 || roomAbove >= roomBelow;
    const height = Math.min(560, above ? roomAbove : roomBelow);
    const left = Math.min(Math.max(12, link.left + link.width / 2 - width / 2), window.innerWidth - width - 12);
    popout.style.width = width + 'px';
    popout.style.height = height + 'px';
    popout.style.left = left + 'px';
    popout.style.top = (above ? link.top - gap - height : link.bottom + gap) + 'px';
    popout.style.transformOrigin = above ? 'bottom center' : 'top center';
}

function closePopout() {
    if (popout.hidden) return;
    popout.hidden = true;
    popout.setAttribute('aria-hidden', 'true');
    popout.classList.remove('open');
    document.removeEventListener('pointerdown', closeOnOutsidePress);
    popoutFrame.removeAttribute('src');   // stop the 3D scene while it isn't on screen
    popoutAnchor?.setAttribute('aria-expanded', 'false');
    popoutAnchor?.focus();
    popoutAnchor = null;
}

function closeOnOutsidePress(event) {
    if (popout.contains(event.target) || event.target === popoutAnchor) return;
    closePopout();
}

document.querySelectorAll('.project-link[data-widget-popout]').forEach(trigger => {
    trigger.addEventListener('click', event => {
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        // clicking the link again closes it, but a stray repeat event right after opening doesn't
        if (popoutAnchor === trigger) {
            if (Date.now() - popoutOpenedAt > 400) closePopout();
            return;
        }
        popoutAnchor = trigger;
        popoutOpenedAt = Date.now();
        trigger.setAttribute('aria-expanded', 'true');
        popout.hidden = false;
        popout.setAttribute('aria-hidden', 'false');
        positionPopout();
        if (!popoutFrame.getAttribute('src')) popoutFrame.src = trigger.dataset.widgetPopout;
        requestAnimationFrame(() => popout.classList.add('open'));
        setTimeout(() => document.addEventListener('pointerdown', closeOnOutsidePress), 0);
        gtag('event', 'project_view', { event_category: 'engagement', event_label: 'smart-home-widget' });
    });
});
popout.querySelector('.widget-popout-close').addEventListener('click', closePopout);
document.addEventListener('keydown', event => { if (event.key === 'Escape') closePopout(); });
// the pop-out is pinned to a link inside a scrolling row, so it follows it
window.addEventListener('resize', positionPopout);
window.addEventListener('scroll', positionPopout, { passive: true });
document.querySelectorAll('.horizontal-scroll-container').forEach(row => {
    row.addEventListener('scroll', positionPopout, { passive: true });
});
```

If the target build has no Google Analytics, drop the `gtag(...)` line or guard it with
`typeof gtag === 'function' &&`.

## Step 6 — build and deploy

- If the build has an explicit allowlist of publishable files (in this project,
  `scripts/site-files.mjs`), add `smart-home-widget.html` to it. `assets/` is usually already
  published wholesale, which covers the vendor directory.
- If there is no build step, the files sit in the repo root and just work.
- Under a CSP, the iframe is same-origin and the vendor scripts are local, so `script-src 'self'`
  is enough — but the page loads **Google Fonts** (`fonts.googleapis.com`, `fonts.gstatic.com`).
  Either allow those or delete the two `<link>` tags; the model falls back to a system font.

## Gotchas

Each of these was hit and fixed in the real integration. They are not theoretical.

**Dark `color-scheme` paints an opaque backdrop behind an iframe.** The symptom is a solid
dark rectangle where the page should show through, even though the iframe's `html`, `body`
and canvas all compute to `rgba(0,0,0,0)`. The fix is `color-scheme: normal` on the iframe
document, with `!important` — the page's own `:root:not([data-theme="light"])` dark-mode block
has higher specificity than `html.widget`. Diagnose it by putting a brightly coloured div
behind the pop-out: if you cannot see it, this is why.

**An `opacity: 0` iframe gets throttled and never renders.** If the open animation fades
from `opacity: 0`, Chrome treats the frame as not visible, `requestAnimationFrame` never
fires inside it, and the scene draws nothing — you get a transparent rectangle forever, with
no console error. `document.hidden` inside the frame reads `true`. Hence animating only
`transform`.

**Resizing the iframe does not reliably fire `resize` inside it.** The host sets the
pop-out's width and height at open time; without the `ResizeObserver` the renderer keeps the
size it had at load and the first frame never lands correctly.

**The press that opens it must not also close it.** Registering the outside-press listener
synchronously means the same pointer sequence can close the pop-out immediately. Register it
in a `setTimeout(…, 0)` and remove it on close. The 400 ms guard on the trigger covers a
duplicate click event from the same gesture.

**The pop-out swallows clicks across its whole rectangle**, transparent regions included —
an iframe cannot be click-through only where its content is opaque. This matches the Android
widget's behaviour, but it means a visitor cannot click the card text underneath while it is
open. Keep the pop-out small enough that this doesn't hide anything important.

**Anchoring above the link is a preference, not a rule.** `roomAbove >= 260` means it drops
below the link on short viewports. Both sizes are caps: on a phone the width falls back to
`viewport − 24px` and the height to whatever room exists.

## Verification checklist

Serve the build and, in the pop-out:

- [ ] The apartment renders with no backdrop — the cards behind show through the empty areas.
- [ ] Dragging orbits the camera; scrolling zooms.
- [ ] Clicking a lamp toggles it, with the glow pooling on the floor.
- [ ] Pressing and dragging up or down on a lamp dims it, with a percentage readout, and
      does **not** orbit the camera.
- [ ] Escape, the × button, and a click outside all close it, and the iframe's `src` is gone
      afterwards.
- [ ] Re-opening works, and the scene renders on the first open after a fresh page load.
- [ ] At phone width it still sits above the link and fits the viewport.
- [ ] The browser console is clean — in particular no requests to `/api/lamps`.
