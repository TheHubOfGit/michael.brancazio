/* Matter.js pull chain, restored from the pre-refactor inline script. */
// Wrap in DOMContentLoaded to ensure elements exist before script runs
document.addEventListener('DOMContentLoaded', () => {

    const body = document.body;
    const chainContainer = document.getElementById('chain-container');

    if (!chainContainer || typeof Matter === 'undefined') {
        console.error("Chain container or Matter.js not found!");
        return; // Put the return back to stop execution on error
    }

    // --- Matter.js Setup ---
    const Engine = Matter.Engine;
    const Render = Matter.Render;
    const Runner = Matter.Runner;
    const Composites = Matter.Composites;
    const Constraint = Matter.Constraint;
    const MouseConstraint = Matter.MouseConstraint;
    const Mouse = Matter.Mouse;
    const Composite = Matter.Composite;
    const Bodies = Matter.Bodies;
    const Events = Matter.Events;

    const engine = Engine.create({
        enableSleeping: true,
        positionIterations: 20, // Increased iterations for smoother physics
        velocityIterations: 12   // More velocity iterations for smoother movement
    });
    const world = engine.world;
    engine.gravity.y = 15.0; // Very heavy gravity to limit movement

    // Get container dimensions
    let containerWidth = chainContainer.offsetWidth;
    let containerHeight = chainContainer.offsetHeight;

    const render = Render.create({
        element: chainContainer, // Render inside the container
        engine: engine,
        options: {
            width: containerWidth,
            height: containerHeight,
            wireframes: false,
            background: 'transparent', // Make background transparent
            pixelRatio: window.devicePixelRatio || 1 // Adjust for high DPI screens
        }
    });

    Render.run(render);
    const runner = Runner.create();
    Runner.run(runner, engine);

    // --- Chain Creation (Adapted) ---
    const group = Matter.Body.nextGroup(true);

    // Desktop vs Mobile chain parameters
    const isDesktop = window.innerWidth > 768;
    const segmentLength = isDesktop ? 5 : 5; // 6 * 0.8 = 4.8 → 5px
    const segmentRadius = isDesktop ? 7 : 7;  // 9 * 0.8 = 7.2 → 7px
    const numSegments = isDesktop ? 5 : 5;    // 6 * 0.8 = 4.8 → 5 segments  
    const segmentSpacing = isDesktop ? 5 : 5; // 6 * 0.8 = 4.8 → 5px
    const stiffness = 0.7;
    const damping = 0.2; // Increased damping
    let chainStartX = containerWidth / 2;
    const chainStartY = -10; // Start slightly above the container

    // Define colors based on theme
    let segmentFill = 'rgb(170, 170, 170)'; // Default light mode (Opaque)
    let segmentStroke = 'rgb(200, 200, 200)'; // Opaque
    let constraintStroke = 'rgba(102, 102, 102, 0.7)';
    let chain = null; // Declare chain variable

    function updateChainColors() {
        const isDarkMode = body.classList.contains('dark-mode');
        segmentFill = isDarkMode ? 'rgb(100, 100, 100)' : 'rgb(170, 170, 170)'; // Opaque
        segmentStroke = isDarkMode ? 'rgb(150, 150, 150)' : 'rgb(200, 200, 200)'; // Opaque
        constraintStroke = isDarkMode ? 'rgba(150, 150, 150, 0.7)' : 'rgba(102, 102, 102, 0.7)';

        if (chain && chain.bodies) {
            chain.bodies.forEach(body => {
                body.render.fillStyle = segmentFill;
                body.render.strokeStyle = segmentStroke;
            });
        }
        if (chain && chain.constraints) {
            chain.constraints.forEach(constraint => {
                if (constraint.render) constraint.render.strokeStyle = constraintStroke;
            });
        }
        // Also update the anchor constraint if it exists and has render properties
        const anchorConstraint = world.constraints.find(c => c.label === 'AnchorConstraint');
        if (anchorConstraint && anchorConstraint.render) {
            // Anchor constraint might not need color change, but included for completeness
        }
    }

    function createChain() {
        // Clear existing chain if any
        if (chain) {
            Composite.remove(world, chain);
            // Also remove the anchor constraint specifically if it exists
            const anchorConstraint = world.constraints.find(c => c.label === 'AnchorConstraint');
            if (anchorConstraint) Composite.remove(world, anchorConstraint);

            // Clean up any mobile constraint
            if (mobileConstraint) {
                Composite.remove(world, mobileConstraint);
                mobileConstraint = null;
            }

            // Reset mobile touch state
            isMobileTouch = false;
            draggedChainBody = null;
            hasMovedEnoughToDrag = false;
        }

        chainStartX = containerWidth / 2; // Recalculate start X

        // Recalculate desktop vs mobile parameters (in case of resize)
        const currentIsDesktop = window.innerWidth > 768;
        const currentSegmentLength = currentIsDesktop ? 5 : 5;
        const currentSegmentRadius = currentIsDesktop ? 7 : 7;
        const currentNumSegments = currentIsDesktop ? 5 : 5;
        const segmentSpacing = currentIsDesktop ? 5 : 5;

        chain = Composites.stack(chainStartX, chainStartY, currentNumSegments, 1, segmentSpacing, segmentSpacing, function (x, y) {
            return Bodies.circle(x, y, currentSegmentRadius, {
                collisionFilter: { group: group },
                frictionAir: 0.22, // Higher air friction for smoother, more controlled movement
                slop: 0.05, // Reduced slop for more precise physics
                render: {
                    fillStyle: segmentFill,
                    strokeStyle: segmentStroke,
                    lineWidth: 1
                }
            });
        });

        Composites.chain(chain, 0.5, 0, -0.5, 0, {
            stiffness: stiffness,
            length: currentSegmentLength * 0.8, // Slightly shorter constraint length
            damping: 0.35, // Increased damping for much smoother movement
            render: {
                type: 'line',
                strokeStyle: constraintStroke,
                lineWidth: 1
            }
        });

        const firstSegment = chain.bodies[0];
        const anchor = { x: chainStartX, y: 0 };
        const anchorConstraint = Constraint.create({
            label: 'AnchorConstraint', // Add label for easier finding
            pointA: anchor,
            bodyB: firstSegment,
            pointB: { x: 0, y: -currentSegmentRadius }, // Connect to top edge of first segment
            stiffness: 0.9, // Stiffer anchor
            length: currentIsDesktop ? 6 : 5, // Bigger slack for desktop chain
            render: { visible: false } // Hide anchor constraint line
        });

        Composite.add(world, [chain, anchorConstraint]);
        updateChainColors(); // Apply correct colors immediately
    }


    // --- Interaction & Dark Mode Toggle ---
    const mouse = Mouse.create(render.canvas);
    const mouseConstraint = MouseConstraint.create(engine, {
        mouse: mouse,
        constraint: {
            stiffness: 0.1, // Will be updated dynamically
            render: { visible: false }
        }
    });

    // Function to update mouse constraint stiffness based on screen size
    function updateMouseConstraint() {
        const currentIsDesktop = window.innerWidth > 768;
        mouseConstraint.constraint.stiffness = currentIsDesktop ? 0.2 : 0.1; // Higher stiffness for bigger desktop chain
    }

    // Set initial stiffness
    updateMouseConstraint();

    Composite.add(world, mouseConstraint);
    render.mouse = mouse;

    // Dynamic cursor management - only show grab cursor near chain
    let isNearChain = false;

    chainContainer.addEventListener('mousemove', (event) => {
        if (!chain || !chain.bodies || chain.bodies.length === 0) return;

        const rect = chainContainer.getBoundingClientRect();
        const mouseX = event.clientX - rect.left;
        const mouseY = event.clientY - rect.top;

        // Convert to world coordinates
        const worldX = mouseX * (containerWidth / chainContainer.offsetWidth);
        const worldY = mouseY * (containerHeight / chainContainer.offsetHeight);

        // Check if mouse is near any chain segment
        let nearChain = false;
        const hoverDistance = window.innerWidth > 768 ? 25 : 20; // Hover area around chain

        chain.bodies.forEach(body => {
            const distance = Math.sqrt(
                Math.pow(worldX - body.position.x, 2) +
                Math.pow(worldY - body.position.y, 2)
            );
            if (distance < hoverDistance) {
                nearChain = true;
            }
        });

        // Update cursor only when state changes
        if (nearChain !== isNearChain) {
            isNearChain = nearChain;
            chainContainer.style.cursor = nearChain ? 'grab' : 'default';
        }
    });

    chainContainer.addEventListener('mouseleave', () => {
        isNearChain = false;
        chainContainer.style.cursor = 'default';
    });

    // --- Mobile Touch Enhancement ---
    let mobileConstraint = null;
    let isMobileTouch = false;

    // Add touch listeners to the entire container for easier mobile interaction
    chainContainer.addEventListener('touchstart', (event) => {
        if (!chain || !chain.bodies || chain.bodies.length === 0) return;

        // Get touch position relative to the canvas
        const touch = event.touches[0];
        const canvasBounds = render.canvas.getBoundingClientRect();
        const touchX = touch.clientX - canvasBounds.left;
        const touchY = touch.clientY - canvasBounds.top;

        // Convert to world coordinates
        const worldX = touchX * (containerWidth / render.canvas.offsetWidth);
        const worldY = touchY * (containerHeight / render.canvas.offsetHeight);

        // More permissive touch area for mobile - especially with reduced container height
        const chainCenterX = containerWidth / 2;
        const touchDistanceFromCenter = Math.abs(worldX - chainCenterX);

        // Check if we're on mobile (reduced height container)
        const isMobileView = window.innerWidth <= 768;

        if (isMobileView) {
            // For mobile with 20vh container, make the entire container grabbable
            // since the chain should be visible throughout the reduced height
            const maxTouchDistance = containerWidth * 0.4; // Much wider touch area (40% of container width)
            const isInChainArea = touchDistanceFromCenter <= maxTouchDistance; // Allow touch anywhere in height

            if (!isInChainArea) {
                return; // Don't start chain interaction if touch is too far from chain area
            }
        } else {
            // Desktop behavior - keep original restrictive area
            const maxTouchDistance = 25; // Only within 25px of center
            const isInChainArea = touchDistanceFromCenter <= maxTouchDistance && worldY <= containerHeight * 0.15;

            if (!isInChainArea) {
                return; // Don't start chain interaction if touch is too far from chain area
            }
        }

        event.preventDefault(); // Prevent scrolling
        isMobileTouch = true;

        // Find the bottom-most (last) chain segment for easier grabbing
        const targetBody = chain.bodies[chain.bodies.length - 1];

        // Create a constraint from the touch point to the target body
        mobileConstraint = Constraint.create({
            pointA: { x: worldX, y: worldY },
            bodyB: targetBody,
            pointB: { x: 0, y: 0 }, // Center of the body
            stiffness: 0.1,
            length: 0,
            render: { visible: false }
        });

        Composite.add(world, mobileConstraint);

        // Set up drag tracking
        draggedChainBody = targetBody;
        startPullX = worldX;
        startPullY = worldY;
        themeToggledThisDrag = false;
        hasMovedEnoughToDrag = false; // Reset drag movement tracking
        chainContainer.style.cursor = 'grabbing';

        // Try to enable gyroscope on first interaction
        if (!gyroscopeSupported && !permissionRequested) {
            requestGyroscopePermission();
        }
    }, { passive: false });

    chainContainer.addEventListener('touchmove', (event) => {
        if (!isMobileTouch || !mobileConstraint) return;

        event.preventDefault(); // Prevent scrolling

        const touch = event.touches[0];
        const canvasBounds = render.canvas.getBoundingClientRect();
        const touchX = touch.clientX - canvasBounds.left;
        const touchY = touch.clientY - canvasBounds.top;

        // Convert to world coordinates
        const worldX = touchX * (containerWidth / render.canvas.offsetWidth);
        const worldY = touchY * (containerHeight / render.canvas.offsetHeight);

        // Update the constraint's point A to follow the touch
        mobileConstraint.pointA.x = worldX;
        mobileConstraint.pointA.y = worldY;

        // Update mouse position for other logic that depends on it
        mouse.position.x = worldX;
        mouse.position.y = worldY;
    }, { passive: false });

    chainContainer.addEventListener('touchend', (event) => {
        if (!isMobileTouch) return;

        event.preventDefault();
        isMobileTouch = false;

        // Remove the mobile constraint
        if (mobileConstraint) {
            Composite.remove(world, mobileConstraint);
            mobileConstraint = null;
        }

        // Reset drag state
        draggedChainBody = null;
        hasMovedEnoughToDrag = false; // Reset movement tracking
        chainContainer.style.cursor = 'grab';
    }, { passive: false });

    chainContainer.addEventListener('touchcancel', (event) => {
        // Handle touch cancel the same as touch end
        if (!isMobileTouch) return;

        isMobileTouch = false;

        if (mobileConstraint) {
            Composite.remove(world, mobileConstraint);
            mobileConstraint = null;
        }

        draggedChainBody = null;
        hasMovedEnoughToDrag = false; // Reset movement tracking
        chainContainer.style.cursor = 'grab';
    });

    let draggedChainBody = null;
    let startPullX = 0; // Store initial X for pull limit
    let startPullY = 0; // Store initial Y for pull limit

    // Dynamic pull distances based on screen size
    function getMaxPullDistance() {
        return window.innerWidth > 768 ? 200 : 150; // Bigger pull distance for desktop
    }

    function getPullThreshold() {
        return getMaxPullDistance() * 0.7; // Set threshold relative to max pull (e.g., 70%)
    }

    const minDragDistance = 30; // Minimum distance before considering it a real drag (not just a tap)
    let themeToggledThisDrag = false;
    let hasMovedEnoughToDrag = false; // Track if user has moved enough to be considered dragging
    let initialBodyClasses = body.className; // Store initial classes

    // Apply saved theme on load & set initial colors
    const currentTheme = localStorage.getItem('theme');
    if (currentTheme === 'light') {
        body.classList.remove('dark-mode'); // Explicitly light mode
    } else {
        body.classList.add('dark-mode'); // Default to dark if 'dark' or null/undefined
    }
    // Don't call updateChainColors here, wait for createChain

    Events.on(mouseConstraint, 'startdrag', (event) => {
        if (chain.bodies.includes(event.body)) {
            draggedChainBody = event.body;
            startPullX = mouse.position.x; // Record start X
            startPullY = mouse.position.y; // Record start Y
            themeToggledThisDrag = false; // Reset toggle flag
            hasMovedEnoughToDrag = false; // Reset drag movement tracking
            chainContainer.style.cursor = 'grabbing'; // Change cursor

            // Try to enable gyroscope on first interaction (if not already enabled)
            if (!gyroscopeSupported && !permissionRequested && window.innerWidth <= 768) {
                requestGyroscopePermission();
            }
        }
    });

    Events.on(mouseConstraint, 'enddrag', (event) => {
        if (draggedChainBody && event.body === draggedChainBody) {
            draggedChainBody = null;
            hasMovedEnoughToDrag = false; // Reset movement tracking
            chainContainer.style.cursor = 'grab'; // Restore cursor
        }
    });

    Events.on(engine, 'beforeUpdate', () => {
        if (draggedChainBody) {
            const deltaX = mouse.position.x - startPullX;
            const deltaY = mouse.position.y - startPullY;
            const totalMovement = Math.sqrt(deltaX * deltaX + deltaY * deltaY);

            // Check if user has moved enough to be considered dragging (not just tapping)
            if (!hasMovedEnoughToDrag && totalMovement > minDragDistance) {
                hasMovedEnoughToDrag = true;
            }

            const currentPullVerticalDistance = mouse.position.y - startPullY;

            // --- Theme Toggle Logic (Only if actually dragging, not just tapping) ---
            if (!themeToggledThisDrag && hasMovedEnoughToDrag && currentPullVerticalDistance > getPullThreshold()) {
                body.classList.toggle('dark-mode');
                updateChainColors(); // Update colors immediately after toggle

                // Determine which sound to play based on the new theme state
                const isDarkMode = body.classList.contains('dark-mode');
                const soundFile = isDarkMode ? 'lampclick_off.mp3' : 'lampclick_on.mp3';

                localStorage.setItem('theme', isDarkMode ? 'dark' : 'light');
                themeToggledThisDrag = true; // Prevent multiple toggles per drag

                // Play appropriate lamp click sound
                try {
                    const lampClickAudio = new Audio(soundFile);
                    lampClickAudio.volume = 0.6; // Set volume to 60% to avoid being too loud
                    lampClickAudio.play().catch(error => {
                        console.log('Audio playback failed:', error);
                    });
                } catch (error) {
                    console.log('Audio creation failed:', error);
                }

                // Optional: Vibrate on toggle
                if (navigator.vibrate) {
                    navigator.vibrate(50); // Short vibration
                }
            }

            // --- Max Pull Distance Logic (Check Second) ---
            // Check if still dragging (reuse the movement calculation from above)
            if (draggedChainBody) {
                const currentDistance = totalMovement;

                if (currentDistance > getMaxPullDistance()) {
                    // Release the drag
                    if (isMobileTouch && mobileConstraint) {
                        // Mobile touch - remove the constraint
                        Composite.remove(world, mobileConstraint);
                        mobileConstraint = null;
                        isMobileTouch = false;
                    } else {
                        // Desktop mouse - simulate mouse up
                        mouse.button = -1;
                    }

                    draggedChainBody = null; // Stop processing this drag
                    chainContainer.style.cursor = 'grab'; // Restore cursor

                    // Optional: Vibrate on release
                    if (navigator.vibrate) {
                        navigator.vibrate(20); // Short vibration for feedback
                    }
                }
            }
        }
    });

    // --- Fit to container & Handle Resize ---
    function fitRendererToContainer() {
        containerWidth = chainContainer.offsetWidth;
        containerHeight = chainContainer.offsetHeight;

        render.options.width = containerWidth;
        render.options.height = containerHeight;
        render.canvas.width = containerWidth * (window.devicePixelRatio || 1);
        render.canvas.height = containerHeight * (window.devicePixelRatio || 1);
        render.canvas.style.width = containerWidth + 'px';
        render.canvas.style.height = containerHeight + 'px';

        Render.lookAt(render, {
            min: { x: 0, y: 0 },
            max: { x: containerWidth, y: containerHeight }
        });

        // Recreate the chain to reposition it correctly
        createChain();

        // Update mouse constraint for new screen size
        updateMouseConstraint();
    }

    // Initial setup
    fitRendererToContainer(); // Call initially to set up size and create chain

    // Debounced resize handler
    let resizeTimeout;
    window.addEventListener('resize', () => {
        clearTimeout(resizeTimeout);
        resizeTimeout = setTimeout(fitRendererToContainer, 150); // Adjust debounce time as needed
    }, { passive: true });

    // --- Gyroscope Support for Mobile ---
    let gyroscopeSupported = false;
    let lastGamma = 0; // Store last gamma value for smoothing
    let smoothingBuffer = []; // Buffer for more advanced smoothing
    let permissionRequested = false;

    // Function to check if permission is already granted
    function checkExistingPermission() {
        // Try to add a listener and see if we get data
        let testReceived = false;
        function testHandler(event) {
            if (event.gamma !== null && event.gamma !== undefined) {
                testReceived = true;
                window.removeEventListener('deviceorientation', testHandler);
            }
        }

        window.addEventListener('deviceorientation', testHandler, { passive: true });

        // Remove test handler after 100ms
        setTimeout(() => {
            window.removeEventListener('deviceorientation', testHandler);
            if (testReceived) {
                enableGyroscope();
            }
        }, 100);
    }

    // Function to request device orientation permission (iOS 13+)
    async function requestGyroscopePermission() {
        if (permissionRequested) return false;
        permissionRequested = true;

        if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
            try {
                const permission = await DeviceOrientationEvent.requestPermission();
                if (permission === 'granted') {
                    enableGyroscope();
                    return true;
                }
                return false;
            } catch (error) {
                console.warn('Error requesting gyroscope permission:', error);
                return false;
            }
        }
        // For Android/older iOS, try to enable directly
        enableGyroscope();
        return true;
    }

    // Function to enable gyroscope
    function enableGyroscope() {
        if (gyroscopeSupported) return; // Already enabled

        window.addEventListener('deviceorientation', handleDeviceOrientation, { passive: true });
        gyroscopeSupported = true;
        console.log('Gyroscope support enabled for chain animation');
    }

    // Function to handle device orientation
    function handleDeviceOrientation(event) {
        if (!chain || !chain.bodies || chain.bodies.length === 0) return;

        // Get gamma (left/right tilt) - ignore beta (forward/backward)
        const gamma = event.gamma || 0; // Range: -90 to 90 degrees

        // Advanced smoothing using rolling average
        smoothingBuffer.push(gamma);
        if (smoothingBuffer.length > 8) { // Keep last 8 readings for very smooth movement
            smoothingBuffer.shift();
        }

        // Calculate weighted average with more weight on recent values
        let weightedSum = 0;
        let totalWeight = 0;
        for (let i = 0; i < smoothingBuffer.length; i++) {
            const weight = (i + 1) / smoothingBuffer.length; // More weight on recent values
            weightedSum += smoothingBuffer[i] * weight;
            totalWeight += weight;
        }
        const smoothedGamma = weightedSum / totalWeight;

        // Additional exponential smoothing on top
        lastGamma = lastGamma * 0.85 + smoothedGamma * 0.15;

        // Convert gamma to a force (-90 to 90 degrees -> -1 to 1 force)
        const normalizedForce = Math.max(-1, Math.min(1, lastGamma / 120)); // Use final smoothed value
        const forceStrength = normalizedForce * 0.004; // Even weaker force for very subtle movement

        // Apply horizontal force to all chain segments
        chain.bodies.forEach((body, index) => {
            // Apply much less force to segments closer to the anchor (exponential distribution)
            // First segment gets almost no force, last segment gets full force
            const segmentRatio = (index + 1) / chain.bodies.length; // 0.2, 0.4, 0.6, 0.8, 1.0 for 5 segments
            const segmentMultiplier = Math.pow(segmentRatio, 2.5); // Square the ratio for exponential effect: 0.01, 0.06, 0.22, 0.51, 1.0
            const segmentForce = forceStrength * segmentMultiplier;

            Matter.Body.applyForce(body, body.position, {
                x: segmentForce,
                y: 0
            });
        });
    }

    // Initialize gyroscope check on mobile
    function initializeGyroscope() {
        // Only enable on mobile devices
        if (window.innerWidth <= 768 && 'DeviceOrientationEvent' in window) {
            // First try to check if permission is already granted
            checkExistingPermission();
        }
    }



    // Initialize gyroscope check after a short delay
    setTimeout(initializeGyroscope, 1000);


    // --- Additional Touch Event Listener for Max Pull Distance (Canvas-specific) ---
    // This works alongside the container touch listeners for additional distance checking
    if (render.canvas) {
        render.canvas.addEventListener('touchmove', (event) => {
            if (draggedChainBody && !isMobileTouch) { // Only run if not using new mobile touch system
                // Get the first touch point
                const touch = event.touches[0];
                if (touch) {
                    // Calculate position relative to the canvas, similar to how mouse.position works
                    const canvasBounds = render.canvas.getBoundingClientRect();
                    const touchX = touch.clientX - canvasBounds.left;
                    const touchY = touch.clientY - canvasBounds.top;

                    const deltaX = touchX - startPullX;
                    const deltaY = touchY - startPullY;
                    const currentDistance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);

                    if (currentDistance > getMaxPullDistance()) {
                        // Release the drag (mirroring logic in beforeUpdate)
                        mouse.button = -1;
                        draggedChainBody = null;
                        chainContainer.style.cursor = 'grab';
                        if (navigator.vibrate) {
                            navigator.vibrate(20);
                        }
                        // Prevent default touch behavior like scrolling when limit is hit
                        event.preventDefault();
                    }
                }
            }
        }, { passive: false }); // Use passive: false to allow preventDefault
    } else {
        console.error("Render canvas not found for attaching touch listener.");
    }


}); // End of DOMContentLoaded wrapper
