/* A tensioned pendulum: links never stretch; extra travel feeds from the switch. */
(() => {
    const container = document.getElementById('chain-container');
    if (!container || Portfolio.reduceMotion()) return;
    const ns = 'http://www.w3.org/2000/svg';
    const make = (tag, attributes, parent) => {
        const element = document.createElementNS(ns, tag);
        for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value);
        parent?.append(element);
        return element;
    };
    const svg = make('svg', { role: 'button', tabindex: '0', 'aria-label': 'Pull to switch theme', viewBox: '0 0 112 166', preserveAspectRatio: 'none' }, container);
    const title = make('title', {}, svg);
    title.textContent = 'Pull down to switch the light. Enter or Space also works.';
    const defs = make('defs', {}, svg);
    const gradient = make('radialGradient', { id: 'chain-metal', cx: '30%', cy: '25%', r: '75%' }, defs);
    [['0%', '#fff'], ['30%', '#d9dce0'], ['65%', '#90969d'], ['100%', '#50565e']].forEach(([offset, color]) => make('stop', { offset, 'stop-color': color }, gradient));
    const links = make('path', { stroke: '#91979d', 'stroke-width': '1.4', fill: 'none' }, svg);
    const beads = Array.from({ length: 23 }, () => make('circle', { r: '2.3', fill: 'url(#chain-metal)' }, svg));
    const grip = make('rect', { x: '-4', y: '-2', width: '8', height: '15', rx: '4', fill: 'url(#chain-metal)', stroke: '#737980', 'stroke-width': '.6' }, svg);
    const hit = make('path', { class: 'chain-hit', stroke: 'transparent', 'stroke-width': '32', fill: 'none' }, svg);
    const restLength = 94, maxTravel = 24, detent = 16, anchorX = 84;
    let angle = 0, angularVelocity = 0, travel = 0, velocity = 0;
    let drag = null, frame = 0, previousTime = 0, accumulator = 0;
    const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

    function paint() {
        const length = restLength + travel;
        const x = anchorX + Math.sin(angle) * length, y = Math.cos(angle) * length;
        const path = `M ${anchorX} 0 L ${x} ${y}`;
        links.setAttribute('d', path);
        hit.setAttribute('d', `M ${anchorX} 0 L ${x + Math.sin(angle) * 13} ${y + Math.cos(angle) * 13}`);
        beads.forEach((bead, i) => {
            const distance = length - 5 - i * 6;
            bead.setAttribute('cx', anchorX + Math.sin(angle) * distance);
            bead.setAttribute('cy', Math.cos(angle) * distance);
        });
        grip.setAttribute('transform', `translate(${x} ${y}) rotate(${-angle * 180 / Math.PI})`);
    }
    function toggle() {
        const dark = document.body.classList.toggle('dark-mode');
        Portfolio.storage.set('theme', dark ? 'dark' : 'light');
        document.dispatchEvent(new Event('themechange'));
        const sound = new Audio(dark ? 'lampclick_off.mp3' : 'lampclick_on.mp3');
        sound.volume = .6;
        sound.play().catch(() => {});
        navigator.vibrate?.(12);
    }
    function step(dt) {
        // Fixed time steps keep spring and pendulum behavior consistent at any refresh rate.
        const targetTravel = drag ? drag.travel : 0;
        velocity += ((targetTravel - travel) * 420 - velocity * 30) * dt;
        travel = clamp(travel + velocity * dt, 0, maxTravel);
        if ((travel === 0 && velocity < 0) || (travel === maxTravel && velocity > 0)) velocity = 0;
        const torque = drag ? (drag.angle - angle) * 170 - angularVelocity * 24 : -32 * Math.sin(angle) - angularVelocity * 5;
        angularVelocity += torque * dt;
        angle = clamp(angle + angularVelocity * dt, -.65, .22);
        if (drag && !drag.toggled && travel >= detent && drag.downward >= detent) {
            drag.toggled = true;
            toggle();
        }
    }
    function animate(time) {
        accumulator += Math.min((time - previousTime) / 1000, .04);
        previousTime = time;
        while (accumulator >= 1 / 120) { step(1 / 120); accumulator -= 1 / 120; }
        paint();
        if (drag || Math.abs(angle) + Math.abs(angularVelocity) + travel + Math.abs(velocity) > .001) {
            frame = requestAnimationFrame(animate);
        } else { angle = travel = velocity = angularVelocity = 0; frame = 0; paint(); }
    }
    function wake() {
        if (!frame && !document.hidden) { previousTime = performance.now(); accumulator = 0; frame = requestAnimationFrame(animate); }
    }
    function point(event) {
        const rect = svg.getBoundingClientRect();
        return { x: (event.clientX - rect.left) * 112 / rect.width, y: (event.clientY - rect.top) * 166 / rect.height };
    }
    hit.addEventListener('pointerdown', event => {
        if (drag || !event.isPrimary || event.button !== 0) return;
        const start = point(event);
        drag = { id: event.pointerId, start, angle, travel, downward: 0, toggled: false,
            tipX: Math.sin(angle) * (restLength + travel), tipY: Math.cos(angle) * (restLength + travel) };
        hit.setPointerCapture(event.pointerId);
        container.setAttribute('data-dragging', '');
        event.preventDefault();
        wake();
    });
    hit.addEventListener('pointermove', event => {
        if (!drag || drag.id !== event.pointerId) return;
        const p = point(event);
        const x = drag.tipX + p.x - drag.start.x;
        const y = Math.max(30, drag.tipY + p.y - drag.start.y);
        drag.downward = p.y - drag.start.y;
        drag.angle = clamp(Math.atan2(x, y), -.65, .22);
        // Increasing resistance caps the switch stroke instead of stretching the beads.
        drag.travel = maxTravel * (1 - Math.exp(-Math.max(0, Math.hypot(x, y) - restLength) / 28));
    });
    function release(event) {
        if (!drag || (event?.pointerId !== undefined && event.pointerId !== drag.id)) return;
        const id = drag.id;
        drag = null;
        container.removeAttribute('data-dragging');
        if (hit.hasPointerCapture(id)) hit.releasePointerCapture(id);
        wake();
    }
    ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(type => hit.addEventListener(type, release));
    window.addEventListener('blur', () => release());
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) { release(); cancelAnimationFrame(frame); frame = 0; }
        else wake();
    });
    svg.addEventListener('keydown', event => {
        if ((event.key === 'Enter' || event.key === ' ') && !event.repeat) {
            event.preventDefault(); toggle(); travel = detent; wake();
        }
    });
    paint();
})();
