/**
 * Foveal Calibration Visualizer
 * Ported from Poe source.
 */

console.log("Foveal Calibration script initializing...");

// --- DOM Elements ---
const canvas = document.getElementById('calibration-canvas');
const ctx = canvas.getContext('2d');
const circleEl = document.getElementById('circle');
const radiusValEl = document.getElementById('radiusVal');
const doneBtn = document.getElementById('doneBtn');
const settingsBtn = document.getElementById('settingsBtn');
const settingsPanel = document.getElementById('settingsPanel');

// New button elements (no Alpine)
const btnStartAuto = document.getElementById('btnStartAuto');
const btnStartManual = document.getElementById('btnStartManual');
const btnRestartAuto = document.getElementById('btnRestartAuto');
const btnRestartManual = document.getElementById('btnRestartManual');
const finalRadiusValEl = document.getElementById('finalRadiusVal');
const shareDataCheckbox = document.getElementById('shareData');

// --- UI State Management (replaces Alpine) ---
let uiState = 'splash'; // 'splash' | 'running' | 'results'

function setUIState(newState, mode = 'auto') {
    uiState = newState;
    const body = document.body;

    // Remove all state classes
    body.classList.remove('running', 'results', 'mode-auto', 'mode-manual');

    if (newState === 'running') {
        body.classList.add('running');
        body.classList.add(mode === 'auto' ? 'mode-auto' : 'mode-manual');
    } else if (newState === 'results') {
        body.classList.add('results');
        body.classList.add(mode === 'auto' ? 'mode-auto' : 'mode-manual');
    }
    // 'splash' has no body class, shows default state

    console.log('[UI] State changed to:', newState, 'mode:', mode);
}

// Button event listeners
if (btnStartAuto) {
    btnStartAuto.addEventListener('click', () => {
        setUIState('running', 'auto');
        startCalibration('auto');
    });
}

if (btnStartManual) {
    btnStartManual.addEventListener('click', () => {
        setUIState('running', 'manual');
        startCalibration('manual');
    });
}

if (btnRestartAuto) {
    btnRestartAuto.addEventListener('click', () => {
        setUIState('running', 'auto');
        startCalibration('auto');
    });
}

if (btnRestartManual) {
    btnRestartManual.addEventListener('click', () => {
        setUIState('running', 'manual');
        startCalibration('manual');
    });
}

// --- State ---
let radius = 120; // Visual radius
let targetRadius = 120; // Logic target
let radiusVel = 0; // Spring velocity

// Spring constants
const springTension = 0.08;
const springFriction = 0.85;

let crossSize = 3; // Even smaller (refined)
let spacing = 19; // ~20% denser (was 24)
const minRadius = 30;
const maxRadius = 400;
const step = 5;
const numLayers = 15; // Match shader density
const goldenRatio = 0.61803398875;

// ...

// --- Random Utilities ---
function seededRandom(seed) {
    const x = Math.sin(seed * 9999.9) * 99999.9;
    return x - Math.floor(x);
}

// --- Color Utilities (Nimitz Shader Emulation) ---
function getNimitzColor(layerIndex) {
    // Original GLSL:
    // vec2 ds = hash12(i*2.5)*.20;
    // ... sin(ds.x*5100. + vec3(1.,2.,3.5))*.4+.6

    // We use our seededRandom to approximate hash12(i*2.5)*.20
    const randomVal = seededRandom(layerIndex * 2.5) * 0.2;

    // Phase shifts from shader: R=1.0, G=2.0, B=3.5
    // Freq factor: 5100.0
    const t = randomVal * 5100.0;

    const r = (Math.sin(t + 1.0) * 0.4 + 0.6) * 255;
    const g = (Math.sin(t + 2.0) * 0.4 + 0.6) * 255;
    const b = (Math.sin(t + 3.5) * 0.4 + 0.6) * 255;

    return `rgb(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)})`;
}

// --- Layer Generation ---
let layers = [];

function generateLayers() {
    layers = [];
    const cols = Math.ceil(window.innerWidth / spacing) + 4;
    const rows = Math.ceil(window.innerHeight / spacing) + 4;

    for (let layer = 0; layer < numLayers; layer++) {
        const layerData = [];

        // Use Golden Ratio for low-discrepancy (quasirandom) distribution
        // This ensures layers fill the gaps of previous layers, minimizing overlap/stacking.
        const offsetX = ((layer * goldenRatio) % 1) * spacing;
        const offsetY = ((layer * goldenRatio * 2) % 1) * spacing;

        // Use shader-derived color
        const colorStr = getNimitzColor(layer);

        for (let i = -2; i < cols; i++) {
            for (let j = -2; j < rows; j++) {
                const baseX = i * spacing + offsetX;
                const baseY = j * spacing + offsetY;
                const seed = i * 127.1 + j * 311.7 + layer * 1000;

                // Small local jitter is okay, but keep it constrained
                const cellOffsetX = (seededRandom(seed) - 0.5) * 0.3 * spacing;
                const cellOffsetY = (seededRandom(seed + 50) - 0.5) * 0.3 * spacing;
                const phase = seededRandom(seed + 100) * Math.PI * 2;

                layerData.push({
                    x: baseX + cellOffsetX,
                    y: baseY + cellOffsetY,
                    phase: phase,
                    color: colorStr // Pre-calculated
                });
            }
        }
        layers.push(layerData);
    }
    console.log(`Layers generated: ${layers.length}, first layer size: ${layers[0]?.length}`);
}

// --- View Updates ---
// --- View Updates ---
function updateCircle() {
    if (circleEl) {
        circleEl.style.width = radius * 2 + 'px';
        circleEl.style.height = radius * 2 + 'px';

        // Manual Mode UX: Thicker, distinct border
        if (calibrationMode === 'manual') {
            circleEl.style.borderWidth = '10px';
            circleEl.style.borderColor = 'rgba(34, 211, 238, 0.3)'; // Cyan-400 equivalent
        } else {
            circleEl.style.borderWidth = '2px';
            circleEl.style.borderColor = 'rgba(255, 255, 255, 0.5)';
        }
    }
    if (radiusValEl) {
        radiusValEl.textContent = Math.round(radius); // Display rounded visual radius
    }
}

let dpr = 1;

function resize() {
    dpr = window.devicePixelRatio || 1;
    // Cap DPR to 1.5 for performance on Retina screens
    if (dpr > 1.5) dpr = 1.5;

    // Performance Optimization: Cap internal resolution
    // User requested strict cap at 1280x800 for testing to avoid 30s load times
    const maxWidth = 1280;
    const maxHeight = 800;

    let w = window.innerWidth * dpr;
    let h = window.innerHeight * dpr;

    // If huge, scale down dpr effectively
    if (w > maxWidth) {
        const scale = maxWidth / w;
        w = maxWidth;
        h = h * scale;
    }

    canvas.width = w;
    canvas.height = h;

    // We do NOT scale context because we want to draw in pixel space of the capped canvas

    console.log(`Canvas resized (Strict Cap): ${canvas.width}x${canvas.height}, Effective DPR: ${dpr}`);
    generateLayers();
}

// --- Animation Logic ---
let outerTime = 0;
let lastFrameTime = performance.now();
let outerPaused = false;
let resumeTime = 0;
const rampDuration = 800;

function easeInQuad(t) { return t * t; }

// Trigger pause logic
function triggerPeripheralPause() {
    outerPaused = true;
    // Resume randomly between 0ms and 2000ms from now (faster events)
    // NOTE: resumeTime is the FUTURE timestamp when motion starts.
    resumeTime = performance.now() + Math.random() * 2000;
}

// --- State ---
let calibrationMode = 'auto'; // 'auto' | 'manual'
let manualPaused = false; // Separate pause state for manual mode

// ... (existing variable declarations)

// --- Start Logic ---
// Exposed to Alpine
window.startCalibration = function (mode = 'auto') {
    calibrationMode = mode;

    // Reset core state
    radius = 120;
    targetRadius = 120;
    sessionHistory = [];
    recentReversals = []; // Fix: Reset reversals to prevent immediate finish
    lastReactionResult = null;
    reactionWindowOpen = false;
    outerPaused = false;
    manualPaused = false;

    if (calibrationMode === 'auto') {
        calibrationState = 'idle';
        updateConfidence(); // Reset UI
    } else {
        calibrationState = 'manual_running';
        // In manual, we start animating immediately
    }

    // Trigger Alpine state change via event if needed, 
    // but the button click in HTML already sets 'state'.
    // We just ensure the logic execution matches.
}

// ... 

// --- Animation Logic ---

function render(now) {
    // Throttling for Splash / Results state to save CPU
    // We only need motion in 'running' state.
    if (uiState !== 'running') {
        // Just verify we drew at least once? 
        // Or just return? If we return, canvas might be blank if cleared.
        // We'll draw once per second or just Draw & Return if static.

        // Actually, let's just NOT loop if not running.
        // But we need to verify we drew the start screen pattern.
        // The pattern is "running" in the background behind the glass?
        // User wants "screen is always animated" in manual mode...
        // But on splash, we can probably just slow it down or not animate.
        // Let's cap FPS on splash.

        const elapsed = now - lastFrameTime;
        if (elapsed < 100) { // 10 FPS cap for splash
            requestAnimationFrame(render);
            return;
        }
    }

    const deltaTime = (now - lastFrameTime) / 1000;
    lastFrameTime = now;

    // Safety check for huge delta
    if (deltaTime > 0.5) {
        requestAnimationFrame(render);
        return;
    }

    if (calibrationMode === 'auto') {
        // Auto-Calibrate Staircase Update
        updateCalibration(now);
    } else {
        // MANUAL MODE LOGIC
        // Continuous animation unless manually paused
        outerPaused = manualPaused;

        // No "reaction window" logic here. Just visual feedback.
    }

    // Update radius with spring physics
    const displacement = targetRadius - radius;
    const springForce = displacement * springTension;
    radiusVel += springForce;
    radiusVel *= springFriction;
    radius += radiusVel;
    radius = Math.max(minRadius, Math.min(maxRadius, radius)); // Clamp visual radius

    updateCircle(); // Update visual circle based on new 'radius'

    // ... (resume logic for auto mode)

    // Auto-Resume Logic (Auto Mode Only)
    if (calibrationMode === 'auto' && outerPaused && resumeTime > 0 && now >= resumeTime) {
        outerPaused = false;
        // Logic for reaction window opens in updateCalibration via 'paused' state check
    }

    // Animation progress
    if (!outerPaused) {
        if (calibrationMode === 'auto') {
            // Existing ramp logic
            const timeSinceResume = now - resumeTime;
            const rampProgress = Math.max(0, Math.min(1, timeSinceResume / rampDuration));
            outerTime += deltaTime * easeInQuad(rampProgress);
        } else {
            // Manual: Constant linear speed (simulating full motion)
            outerTime += deltaTime;
        }
    } else {
        // Splash/Results: Background animation
        outerTime += deltaTime * 0.2; // Slow drift
    }

    // If paused, outerTime stays frozen => rotation stops

    // DRAWING
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, canvas.width, canvas.height); // Use full canvas size (dpr handled in size)

    const centerX = canvas.width / 2; // Use logical center of canvas
    const centerY = canvas.height / 2;

    // Use 'lighten' to match the shader's `max(col, ...)` blending.
    // This creates the correct "noise field" look where crosses merge rather than stack.
    ctx.globalCompositeOperation = 'lighten';
    ctx.lineWidth = 1.2; // Slightly thicker to mimic smoothstep glow
    ctx.lineCap = 'round'; // Softer ends

    const innerTime = now / 1000;

    // Draw Layers
    for (const layerData of layers) {
        for (const cross of layerData) {
            // Optimization: bounds check using canvas dims
            if (cross.x < -20 || cross.x > canvas.width + 20 || cross.y < -20 || cross.y > canvas.height + 20) continue;

            const dx = cross.x - centerX;
            const dy = cross.y - centerY;
            const dist = Math.sqrt(dx * dx + dy * dy);

            // Foveal circle check
            const time = dist < radius ? innerTime : outerTime;
            const angle = cross.phase + time * 3;

            const len = crossSize;
            const cos1 = Math.cos(angle) * len;
            const sin1 = Math.sin(angle) * len;
            const cos2 = Math.cos(angle + Math.PI / 2) * len;
            const sin2 = Math.sin(angle + Math.PI / 2) * len;

            ctx.strokeStyle = cross.color;

            ctx.beginPath();
            ctx.moveTo(cross.x - cos1, cross.y - sin1);
            ctx.lineTo(cross.x + cos1, cross.y + sin1);
            ctx.stroke();

            ctx.beginPath();
            ctx.moveTo(cross.x - cos2, cross.y - sin2);
            ctx.lineTo(cross.x + cos2, cross.y + sin2);
            ctx.stroke();
        }
    }

    requestAnimationFrame(render);
}

// --- Auto-Calibration Logic ---

let reactionWindowOpen = false;
let reactionWindowEnd = 0;
let lastReactionResult = null; // 'hit' or 'miss'
let calibrationState = 'idle'; // idle, waiting_for_pause, paused, reaction_window
let nextEventTime = 0;

// Staircase parameters (Gamified)
const HIT_increase = 30; // Bigger jumps for "fun"
const MISS_decrease = 10;
let recentReversals = [];
let sessionHistory = [];

function setCrosshairState(state) {
    const ch = document.getElementById('crosshair');
    if (!ch) return;

    if (state === 'active') {
        ch.classList.add('crosshair-active');
        ch.classList.remove('crosshair-idle');
    } else {
        ch.classList.add('crosshair-idle');
        ch.classList.remove('crosshair-active');
    }
}

function updateCalibration(now) {
    if (calibrationState === 'idle') {
        setCrosshairState('idle');
        // Start cycle
        // Speed up: 1000ms + random 3000ms (avg 2.5s wait) -> slower pace
        nextEventTime = now + 1000 + Math.random() * 3000;
        calibrationState = 'waiting_for_pause';
    }
    else if (calibrationState === 'waiting_for_pause') {
        if (now > nextEventTime) {
            setCrosshairState('active'); // Cue user to lock focus
            triggerPeripheralPause();
            calibrationState = 'paused';
        }
    }
    else if (calibrationState === 'paused') {
        if (!outerPaused) {
            // resumes -> motion event
            reactionWindowOpen = true;
            reactionWindowEnd = now + 1500; // 1.5s window (Tightened from 2.5s for False Positive pressure)
            calibrationState = 'reaction_window';
        }
    }
    else if (calibrationState === 'reaction_window') {
        if (now > reactionWindowEnd) {
            handleReaction(false);
        }
    }
}

function updateConfidence() {
    // Confidence Algorithm:
    // 1. Base progress: Number of exact reversals.
    // 2. Smart Convergence: If the RANGE of the last 5 reversals is small (<30px), we are stable.

    // Base Progress
    const maxReversals = 8;
    let progress = Math.min(1, recentReversals.length / maxReversals);

    // Smart Convergence (Range Check)
    if (recentReversals.length >= 5) {
        const last5 = recentReversals.slice(-5);
        const min = Math.min(...last5);
        const max = Math.max(...last5);
        const range = max - min;

        console.log(`Reversals Range: ${range}px`);

        if (range < 30) {
            // Very stable oscillation. We rely on this.
            progress = 1;
        } else if (range < 60) {
            progress = Math.min(1, progress + 0.4);
        }
    }

    // Update UI
    const bar = document.getElementById('confidenceBar');
    const val = document.getElementById('confidenceVal');

    if (bar) {
        bar.style.width = `${progress * 100}%`;

        if (progress >= 1) {
            bar.classList.add('bg-green-500');
        }
    }
    if (val) {
        val.textContent = `${Math.round(progress * 100)}%`;
        if (progress >= 1) val.classList.add('text-green-400');
    }

    // Auto-finish at 100%
    if (progress >= 1) {
        finishCalibration();
    }
}

function handleReaction(hit) {
    if (calibrationState === 'idle') return; // Debounce

    // Calculating RT: Time since motion STARTED (resumeTime)
    const now = performance.now();
    const rt = now - resumeTime;

    // Track history for chart
    sessionHistory.push({
        trial: sessionHistory.length + 1,
        radius: Math.round(targetRadius),
        result: hit ? 'hit' : 'miss',
        rt: hit ? Math.round(rt) : null
    });

    reactionWindowOpen = false;
    calibrationState = 'idle';
    setCrosshairState('idle');

    // Track reversal
    const result = hit ? 'hit' : 'miss';
    if (lastReactionResult && lastReactionResult !== result) {
        recentReversals.push(radius);
        updateConfidence();
    }
    lastReactionResult = result;

    if (hit) {
        // HIT: User saw motion.
        if (rt < 150) {
            // Physiologically improbable (<150ms) -> Likely false start / guessing
            showFeedback("Too Fast?", "text-orange-400");
            // Small penalty or no change? Let's just hold or slight drop.
            targetRadius = Math.max(minRadius, targetRadius - 5);
        }
        else if (rt < 1000) {
            // Fast/Normal Hit -> Reward by making it HARDER (Increases Radius)
            // Strong increase for clear hits
            targetRadius = Math.min(maxRadius, targetRadius + HIT_increase);
            showFeedback(`Clear Hit! (${Math.round(rt)}ms)`, "text-green-500");
        }
        else if (rt < 2000) {
            // Slower Hit -> Smaller increase
            targetRadius = Math.min(maxRadius, targetRadius + HIT_increase * 0.5);
            showFeedback(`Hit (${Math.round(rt)}ms)`, "text-green-400");
        }
        else {
            // Very slow -> Treat as weak signal, maybe don't increase much?
            // Actually, if they saw it, they saw it.
            // But if it took >2s (outside window?), handleReaction(false) would have triggered.
            // Wait, window is 1.5s?
            // If window is 1.5s (1500ms), then `rt < 2000` covers the tail.
            // Any hit is good!
            targetRadius = Math.min(maxRadius, targetRadius + 5);
            showFeedback(`Weak Hit (${Math.round(rt)}ms)`, "text-yellow-400");
        }
    } else {
        // MISS: Timeout (User never saw motion)
        const drop = MISS_decrease + (Math.random() * 10);
        targetRadius = Math.max(minRadius, targetRadius - drop);
        showFeedback("No Motion", "text-orange-400");
        lastMissTime = performance.now(); // Mark time for "Too Slow" check
    }
}

let lastMissTime = 0;

function handleFalseAlarm() {
    const now = performance.now();
    if (now - lastMissTime < 1500) {
        showFeedback("Too Slow!", "text-orange-400");
    } else {
        showFeedback("Wait for Motion!", "text-yellow-400");
    }
}

let feedbackTimeout = null;

function showFeedback(text, colorClass) {
    const fb = document.getElementById('feedback');
    if (fb) {
        if (feedbackTimeout) clearTimeout(feedbackTimeout);

        fb.textContent = text;
        fb.className = `absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-2xl font-bold transition-opacity duration-500 ${colorClass} opacity-100`;

        feedbackTimeout = setTimeout(() => {
            fb.classList.remove('opacity-100');
            fb.classList.add('opacity-0');
        }, 1000);
    }
}

// --- Chart Rendering ---
function renderResultsChart() {
    const rc = document.getElementById('results-canvas');
    if (!rc) return;

    // Resize calc
    const rect = rc.parentElement.getBoundingClientRect();
    rc.width = rect.width * window.devicePixelRatio;
    rc.height = rect.height * window.devicePixelRatio;

    const rCtx = rc.getContext('2d');
    rCtx.scale(window.devicePixelRatio, window.devicePixelRatio);

    const w = rect.width;
    const h = rect.height;
    const pad = 20;

    // Clear
    rCtx.fillStyle = '#0f172a';
    rCtx.fillRect(0, 0, w, h);

    if (sessionHistory.length === 0) return;

    // Scales
    const maxR = Math.max(...sessionHistory.map(d => d.radius)) + 20;
    const minR = Math.max(0, Math.min(...sessionHistory.map(d => d.radius)) - 20);
    const rangeR = maxR - minR || 1;

    const stepX = (w - pad * 2) / Math.max(1, sessionHistory.length - 1);

    // Draw Line
    rCtx.beginPath();
    rCtx.strokeStyle = '#64748b'; // slate-500
    rCtx.lineWidth = 2;

    sessionHistory.forEach((d, i) => {
        const x = pad + i * stepX;
        const y = h - pad - ((d.radius - minR) / rangeR) * (h - pad * 2);
        if (i === 0) rCtx.moveTo(x, y);
        else rCtx.lineTo(x, y);
    });
    rCtx.stroke();

    // Draw Points
    sessionHistory.forEach((d, i) => {
        const x = pad + i * stepX;
        const y = h - pad - ((d.radius - minR) / rangeR) * (h - pad * 2);

        rCtx.beginPath();
        rCtx.arc(x, y, 4, 0, Math.PI * 2);
        if (d.result === 'hit') {
            rCtx.fillStyle = '#4ade80'; // green-400
        } else {
            rCtx.fillStyle = '#fb923c'; // orange-400
        }
        rCtx.fill();

        // Label with Latency (Error Bar Style)
        if (d.rt !== null) {
            const barHeight = (d.rt / 1000) * 15;

            rCtx.strokeStyle = '#94a3b8'; // slate-400
            rCtx.lineWidth = 1;
            rCtx.beginPath();
            rCtx.moveTo(x, y - 6);
            rCtx.lineTo(x, y - 6 - barHeight);
            rCtx.stroke();

            // Top cap
            rCtx.beginPath();
            rCtx.moveTo(x - 2, y - 6 - barHeight);
            rCtx.lineTo(x + 2, y - 6 - barHeight);
            rCtx.stroke();
        }
    });

    // Axis Labels
    rCtx.fillStyle = '#64748b'; // slate-500
    rCtx.font = '10px sans-serif';
    rCtx.textAlign = 'right';
    rCtx.fillText(`${maxR}px`, w - 5, pad); // Max Y
    rCtx.fillText(`${minR}px`, w - 5, h - pad); // Min Y

    rCtx.textAlign = 'left';
    rCtx.fillText('Start', pad, h - 5);

    rCtx.textAlign = 'right';
    rCtx.fillText('End', w - pad, h - 5);
}

// --- Interactions ---

// Settings
if (settingsBtn && settingsPanel) {
    settingsBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        settingsPanel.classList.toggle('hidden');
    });

    document.addEventListener('click', (e) => {
        if (!settingsBtn.contains(e.target) && !settingsPanel.contains(e.target)) {
            settingsPanel.classList.add('hidden');
        }
    });

    document.getElementById('crossSize').addEventListener('input', (e) => {
        crossSize = parseFloat(e.target.value);
        document.getElementById('crossVal').textContent = crossSize;
    });

    document.getElementById('density').addEventListener('input', (e) => {
        spacing = parseFloat(e.target.value);
        document.getElementById('densityVal').textContent = spacing;
        generateLayers();
    });
}

// Done / Finish Logic
function finishCalibration() {
    // Prevent multiple triggers if already showing results
    if (uiState === 'results') return;

    // Sync final confidence DOM manually as it's static in the overlay
    const confVal = document.getElementById('confidenceVal');
    const endConfEl = document.getElementById('finalConfidence');
    if (confVal && endConfEl) {
        endConfEl.textContent = confVal.textContent;
    }

    // Update final radius display
    if (finalRadiusValEl) {
        finalRadiusValEl.textContent = Math.round(targetRadius);
    }

    // Switch to results state (vanilla JS, no Alpine)
    setUIState('results', calibrationMode);

    // Send to Scrutinizer Electron app if embedded
    // The parent window (Electron) listens for this message
    try {
        window.postMessage({
            type: 'scrutinizer-calibration-complete',
            radius: Math.round(targetRadius)
        }, '*');
        console.log('[Calibration] Sent postMessage with radius:', Math.round(targetRadius));
    } catch (e) {
        console.warn('[Calibration] postMessage failed:', e);
    }

    // Send PostHog event if user opted in (vanilla JS checkbox check)
    try {
        const shareData = shareDataCheckbox && shareDataCheckbox.checked;

        if (shareData && window.posthog) {
            window.posthog.capture('calibration_complete', {
                radius: Math.round(targetRadius),
                mode: calibrationMode,
                trials: sessionHistory.length,
                reversals: recentReversals.length,
                // Window dimensions
                window_width: window.innerWidth,
                window_height: window.innerHeight,
                // Screen dimensions
                screen_width: screen.width,
                screen_height: screen.height,
                device_pixel_ratio: window.devicePixelRatio || 1
            });
            console.log('[Calibration] PostHog event sent:', Math.round(targetRadius));
        } else {
            console.log('[Calibration] PostHog event skipped - user opted out or posthog unavailable');
        }
    } catch (e) {
        console.warn('[Calibration] PostHog event failed:', e);
    }

    // Stop calibration loop
    calibrationState = 'idle';
    reactionWindowOpen = false;
    outerPaused = false;

    // Defer chart render until visible (wait for Alpine transition)
    setTimeout(renderResultsChart, 300);
}

// Done Button
if (doneBtn) {
    doneBtn.addEventListener('click', finishCalibration);
}

// Spacebar Handler
document.addEventListener('keydown', (e) => {
    // Skip keyboard handling when overlay is visible (splash or results)
    if (uiState === 'splash' || uiState === 'results') {
        if (e.key === 'Enter') {
            // If we have a focused button, let it click. Otherwise maybe start?
        }
        return;
    }

    if (e.code === 'Space') {
        e.preventDefault();

        // Visual acknowledgement
        const ch = document.getElementById('crosshair');
        if (ch) {
            ch.style.transform = 'translate(-50%, -50%) scale(1.5)';
            setTimeout(() => ch.style.transform = 'translate(-50%, -50%) scale(1)', 100);
        }

        if (calibrationMode === 'auto') {
            if (reactionWindowOpen) {
                handleReaction(true);
            } else {
                handleFalseAlarm();
            }
        } else {
            // MANUAL MODE: Toggle Pause
            manualPaused = !manualPaused;
            console.log(`Manual Paused Toggle: ${manualPaused}`);
        }
    }

    // Arrow Keys
    if (e.key === 'ArrowUp' || e.key === 'ArrowRight') {
        const step = calibrationMode === 'manual' ? 5 : 5;
        targetRadius = Math.min(maxRadius, targetRadius + step);
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') {
        const step = calibrationMode === 'manual' ? 5 : 5;
        targetRadius = Math.max(minRadius, targetRadius - step);
    } else if (e.key === 'Enter') {
        // Commit result
        finishCalibration();
    }
});

// Remove mobile hold controls for now as spacebar is key
// Or map touch to spacebar logic (tap anywhere)
document.addEventListener('touchstart', (e) => {
    // Skip touch handling when overlay is visible
    if (uiState !== 'running') return;
    if (e.target.closest('button')) return; // ignore buttons

    if (reactionWindowOpen) {
        handleReaction(true);
        e.preventDefault();
    }
});

// Init
window.addEventListener('resize', resize);
resize();
setUIState('splash');
console.log('[Calibration] Version: 1.2.0 (Remote Test - Cap 1280x800 + UI Fix)');
updateCircle();
requestAnimationFrame(render);
