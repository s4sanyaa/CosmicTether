document.addEventListener('DOMContentLoaded', () => {
    // --- DOM Elements ---
    const instructions = document.getElementById('instructions');
    const startButton = document.getElementById('start-button');
    const gameContainer = document.getElementById('game-container');
    const repository = document.getElementById('repository');
    const energyBar = document.getElementById('energy-bar');
    const energyText = document.getElementById('energy-text');
    const particleContainer = document.getElementById('particle-container'); // For original game particles
    const blackHoleCanvasElement = document.getElementById('blackhole-canvas');
    let blackHoleCtx = null;

    // --- Game Settings ---
    const IDEAL_TYPES = [
        { id: 'education', icon: '🎓', label: 'Education', color: '#87cefa' }, { id: 'money', icon: '💰', label: 'Wealth', color: '#ffd700' }, { id: 'freedom', icon: '🕊️', label: 'Freedom', color: '#f0f8ff' }, { id: 'health', icon: '❤️', label: 'Health', color: '#ffb6c1' }, { id: 'art', icon: '🎨', label: 'Art', color: '#dda0dd' }, { id: 'justice', icon: '⚖️', label: 'Justice', color: '#e6e6fa' }, { id: 'love', icon: '💖', label: 'Love', color: '#ffefd5' }, { id: 'knowledge', icon: '💡', label: 'Knowledge', color: '#f5f5dc' }, { id: 'nature', icon: '🌳', label: 'Nature', color: '#98fb98' }, { id: 'community', icon: '🤝', label: 'Community', color: '#ffdab9' }
     ];
    const IDEAL_SPAWN_INTERVAL = 1400; // ms
    const BASE_SPEED = 0.3;
    const ACCELERATION_FACTOR = 90; // Pull strength
    const MAX_SPEED_CLAMP = 4.0;
    const MIN_DIST_FOR_ACCEL = 10; // Prevents division by zero/extreme speed
    const MAX_ENERGY = 100;
    const ENERGY_COST_TO_DRAG = 12;
    const ENERGY_REGEN_RATE = 0.16; // Energy per loop (~60 times/sec)
    const PARTICLE_COUNT_SAVE = 15;
    const COLLISION_THRESHOLD_MULTIPLIER = 0.5; // Ideal center vs radius overlap
    const SHRINK_REMOVE_THRESHOLD = 2; // Distance (px) from center to remove ideal

    // --- Game State ---
    let currentEnergy = MAX_ENERGY;
    let activeIdeals = []; // Holds { element, x, y, ..., isShrinking }
    let spawnIntervalId = null;
    let gameLoopId = null;
    let isGameRunning = false;
    let isDragging = false;
    let draggedIdealData = null;
    let dragOffsetX = 0;
    let dragOffsetY = 0;
    let containerRect = null;
    let repositoryRect = null;
    let blackHoleCenterX = 0; // Logical gameplay center X
    let blackHoleCenterY = 0; // Logical gameplay center Y
    let blackHoleRadius = 0; // Logical gameplay interaction radius

    // --- Canvas Black Hole State ---
    let bhRender = { width: 0, height: 0, dpi: 1 };
    let bhRect = { width: 0, height: 0 };
    let bhDiscs = []; let bhLines = []; let bhParticles = [];
    let bhStartDisc = {}; let bhEndDisc = {};
    let bhClip = { path: null, disc: {}, i: 0 };
    let bhParticleArea = {};
    let linesCanvas = null; let linesCtx = null;

    // --- Audio ---
    let audioCtx = null;
    function initAudio() {
        if (!audioCtx) { try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch(e) { console.warn("Web Audio API not supported."); audioCtx = null; } }
    }
    function playSound(type) {
        if (!audioCtx) return; if (audioCtx.state === 'suspended') { audioCtx.resume(); } if(audioCtx.state !== 'running') { return; }
        const oscillator = audioCtx.createOscillator(); const gainNode = audioCtx.createGain(); oscillator.connect(gainNode); gainNode.connect(audioCtx.destination);
        let freq=440, duration=0.3, waveType='sine', initialGain=0.15;
        switch(type) {
            case 'save': freq=987.77; duration=0.25; waveType='triangle'; initialGain=0.15; gainNode.gain.setValueAtTime(initialGain, audioCtx.currentTime); gainNode.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + duration); break;
            case 'shrinking': freq=220; duration=0.4; waveType='sawtooth'; initialGain=0.1; gainNode.gain.setValueAtTime(initialGain, audioCtx.currentTime); gainNode.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + duration); break;
            case 'grab': freq=783.99; duration=0.05; waveType='square'; initialGain=0.1; gainNode.gain.setValueAtTime(initialGain, audioCtx.currentTime); gainNode.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + duration); break;
            case 'no_energy': freq=150; duration=0.15; waveType='sawtooth'; initialGain=0.1; gainNode.gain.setValueAtTime(initialGain, audioCtx.currentTime); gainNode.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + duration); break;
            default: initialGain=0;
        }
        if(initialGain > 0) { oscillator.type = waveType; oscillator.frequency.setValueAtTime(freq, audioCtx.currentTime); oscillator.start(audioCtx.currentTime); oscillator.stop(audioCtx.currentTime + duration); }
    }

    // --- Utility Functions ---
    function updateEnergyBar() {
        const energyPercentage = (currentEnergy / MAX_ENERGY) * 100;
        energyBar.style.width = `${Math.max(0, energyPercentage)}%`;
    }
    function getRandomPositionOutside() {
        if (!containerRect) containerRect = gameContainer.getBoundingClientRect();
        const containerWidth = containerRect.width; const containerHeight = containerRect.height;
        const side = Math.floor(Math.random() * 4); let x, y; const margin = 80;
        switch(side) { case 0: x=Math.random()*containerWidth; y=-margin; break; case 1: x=containerWidth+margin; y=Math.random()*containerHeight; break; case 2: x=Math.random()*containerWidth; y=containerHeight+margin; break; case 3: x=-margin; y=Math.random()*containerHeight; break; } return { x, y };
    }
    function createParticles(x, y, count, color = '#ffffff', type = 'burst') { // For save effect
        if (!particleContainer) return;
        const baseColor = color === 'var(--stuck-color)' ? getComputedStyle(document.documentElement).getPropertyValue('--stuck-color').trim() || '#888888' : color;
        for (let i = 0; i < count; i++) {
            const particle = document.createElement('div'); particle.classList.add('particle');
            particle.style.setProperty('--particle-color', baseColor);
            particle.style.left = `${x}px`; particle.style.top = `${y}px`;
            particleContainer.appendChild(particle);
            const angle=Math.random()*Math.PI*2; const distance=Math.random()*(type==='burst'?60:30)+15;
            const translateX=Math.cos(angle)*distance; const translateY=Math.sin(angle)*distance;
            const finalScale=type==='burst'?0:0.3;
            requestAnimationFrame(()=>{ requestAnimationFrame(()=>{ particle.style.transform=`translate(${translateX}px, ${translateY}px) scale(${finalScale})`; particle.style.opacity='0'; }); });
            setTimeout(() => { if (particle.parentNode === particleContainer) try { particleContainer.removeChild(particle); } catch(e){} }, 600);
        }
    }

    // --- Ideal Creation ---
    function createIdeal() {
        if (!isGameRunning) return;
        const typeData = IDEAL_TYPES[Math.floor(Math.random() * IDEAL_TYPES.length)];
        const idealElement = document.createElement('div');
        idealElement.classList.add('ideal');
        idealElement.style.setProperty('--ideal-color', typeData.color);
        const fadedColor = typeData.color.length === 7 ? `${typeData.color}80` : typeData.color; // Add alpha if hex
        idealElement.style.setProperty('--ideal-glow-color-faded', fadedColor);
        idealElement.style.setProperty('--ideal-glow-color', typeData.color);

        const contentDiv=document.createElement('div'); contentDiv.classList.add('ideal-content');
        const iconSpan=document.createElement('span'); iconSpan.classList.add('ideal-icon'); iconSpan.textContent=typeData.icon;
        const labelSpan=document.createElement('span'); labelSpan.classList.add('ideal-label'); labelSpan.textContent=typeData.label;
        contentDiv.appendChild(iconSpan); contentDiv.appendChild(labelSpan); idealElement.appendChild(contentDiv);

        const startPos = getRandomPositionOutside();
        const dx = blackHoleCenterX - startPos.x; const dy = blackHoleCenterY - startPos.y;
        const distance = Math.max(1, Math.sqrt(dx * dx + dy * dy));

        const idealData = {
            element: idealElement, x: startPos.x, y: startPos.y,
            dirX: dx / distance, dirY: dy / distance, vx: 0, vy: 0,
            typeData: typeData, speedMultiplier: BASE_SPEED,
            isShrinking: false // Initialize flag
        };

        idealElement.style.left = `${idealData.x}px`; idealElement.style.top = `${idealData.y}px`;
        idealElement.addEventListener('mousedown', (e) => handleMouseDown(e, idealData));
        activeIdeals.push(idealData); gameContainer.appendChild(idealElement);
    }

    // --- Drag & Drop Handlers ---
    function handleMouseDown(event, idealData) {
        if (!isGameRunning || isDragging || idealData.isShrinking) return; // Check isShrinking flag

        if (currentEnergy >= ENERGY_COST_TO_DRAG) {
            currentEnergy -= ENERGY_COST_TO_DRAG; updateEnergyBar(); playSound('grab');
            isDragging = true; draggedIdealData = idealData; idealData.element.classList.add('dragging');
            containerRect = gameContainer.getBoundingClientRect(); const idealRect = idealData.element.getBoundingClientRect();
            dragOffsetX = event.clientX - idealRect.left; dragOffsetY = event.clientY - idealRect.top;
            window.addEventListener('mousemove', handleMouseMove); window.addEventListener('mouseup', handleMouseUp);
            event.preventDefault();
        } else {
            playSound('no_energy'); idealData.element.classList.add('no-energy-flash');
            setTimeout(() => { if (idealData.element) { idealData.element.classList.remove('no-energy-flash'); } }, 300);
        }
    }
    function handleMouseMove(event) {
        if (!isDragging || !draggedIdealData) return;
        const newX=event.clientX - containerRect.left - dragOffsetX; const newY=event.clientY - containerRect.top - dragOffsetY;
        draggedIdealData.x = newX; draggedIdealData.y = newY;
        draggedIdealData.element.style.left = `${newX}px`; draggedIdealData.element.style.top = `${newY}px`;
        draggedIdealData.vx = 0; draggedIdealData.vy = 0; // Stop physics while dragging
    }
    function handleMouseUp(event) {
        if (!isDragging || !draggedIdealData) return;
        draggedIdealData.element.classList.remove('dragging');
        // Check drop location
        repositoryRect = repository.getBoundingClientRect(); const idealRect = draggedIdealData.element.getBoundingClientRect();
        const idealCenterX = idealRect.left + idealRect.width/2; const idealCenterY = idealRect.top + idealRect.height/2;
        const isInRepoX = idealCenterX >= repositoryRect.left && idealCenterX <= repositoryRect.right;
        const isInRepoY = idealCenterY >= repositoryRect.top && idealCenterY <= repositoryRect.bottom;
        if (isInRepoX && isInRepoY) { repositorySave(draggedIdealData); } // Save if in repository
        // Otherwise, physics takes over in the next game loop iteration
        isDragging = false; draggedIdealData = null;
        window.removeEventListener('mousemove', handleMouseMove); window.removeEventListener('mouseup', handleMouseUp);
    }

    // --- Save Logic ---
    function repositorySave(idealData) {
        playSound('save');
        const idealRect = idealData.element.getBoundingClientRect(); // Get size before modifying
        const saveX = idealData.x + idealRect.width / 2; const saveY = idealData.y + idealRect.height / 2;
        createParticles(saveX, saveY, PARTICLE_COUNT_SAVE, idealData.typeData.color, 'burst'); // Use non-canvas particles
        idealData.element.classList.add('saved-in-repository'); // Trigger CSS fade out
        // Clone node to remove listeners safely before potential removal
        const clone = idealData.element.cloneNode(true);
        if (idealData.element.parentNode) { idealData.element.parentNode.replaceChild(clone, idealData.element); }
        idealData.element = clone; // Update reference
        const elementToRemove = idealData.element; // Store reference for timeout
        setTimeout(() => { if (elementToRemove && elementToRemove.parentNode === gameContainer) { try { gameContainer.removeChild(elementToRemove); } catch(e){} } }, 200); // Match CSS transition
        activeIdeals = activeIdeals.filter(i => i !== idealData); // Remove from active list
    }

    // --- Canvas Black Hole Functions ---
    function bhSetSize() {
        bhRect = blackHoleCanvasElement.getBoundingClientRect();
        bhRender = { width: bhRect.width, height: bhRect.height, dpi: window.devicePixelRatio || 1 };
        blackHoleCanvasElement.width = bhRender.width * bhRender.dpi; blackHoleCanvasElement.height = bhRender.height * bhRender.dpi;
        // Set logical gameplay center/radius based on canvas size
        blackHoleCenterX = bhRender.width / 2; blackHoleCenterY = bhRender.height / 2;
        blackHoleRadius = bhRender.width * 0.15; // Example: 15% of width
    }
    function bhTweenValue(start, end, p, ease = 'linear') { // Simple easing included
        const delta = end - start; let easedP = p; if (ease === 'inExpo') { easedP = p * p * p; } return start + delta * easedP;
    }
    function bhTweenDisc(disc) {
        disc.x = bhTweenValue(bhStartDisc.x, bhEndDisc.x, disc.p); disc.y = bhTweenValue(bhStartDisc.y, bhEndDisc.y, disc.p, "inExpo"); disc.w = bhTweenValue(bhStartDisc.w, bhEndDisc.w, disc.p); disc.h = bhTweenValue(bhStartDisc.h, bhEndDisc.h, disc.p); return disc;
    }
    function bhSetDiscs() {
        const { width, height } = bhRender; bhDiscs = [];
        bhStartDisc = { x: width * 0.5, y: height * 0.45, w: width * 0.75, h: height * 0.7 }; bhEndDisc = { x: width * 0.5, y: height * 0.95, w: 0, h: 0 };
        const totalDiscs = 100; let prevBottom = height; bhClip = {};
        for (let i = 0; i < totalDiscs; i++) { const p = i / totalDiscs; const disc = bhTweenDisc({ p }); const bottom = disc.y + disc.h; if (bottom <= prevBottom) { bhClip = { disc: { ...disc }, i }; } prevBottom = bottom; bhDiscs.push(disc); }
        bhClip.path = new Path2D(); bhClip.path.ellipse(bhClip.disc.x, bhClip.disc.y, bhClip.disc.w, bhClip.disc.h, 0, 0, Math.PI * 2); bhClip.path.rect(bhClip.disc.x - bhClip.disc.w, 0, bhClip.disc.w * 2, bhClip.disc.y);
    }
    function bhSetLines() {
        const { width, height } = bhRender; bhLines = []; const totalLines = 100; const linesAngle = (Math.PI * 2) / totalLines;
        for (let i = 0; i < totalLines; i++) bhLines.push([]);
        bhDiscs.forEach((disc) => { for (let i = 0; i < totalLines; i++) { const angle = i * linesAngle; const p = { x: disc.x + Math.cos(angle) * disc.w, y: disc.y + Math.sin(angle) * disc.h }; bhLines[i].push(p); } });
        try { linesCanvas = new OffscreenCanvas(width, height); linesCtx = linesCanvas.getContext("2d", { alpha: true }); linesCtx.scale(1, 1); } catch (e) { console.warn("OffscreenCanvas not supported."); linesCanvas = null; linesCtx = null; return; }
        bhLines.forEach((line) => { let lineIsInClip = false; for (let j = 1; j < line.length; j++) { const p0 = line[j - 1]; const p1 = line[j]; const p1_in_path = linesCtx.isPointInPath(bhClip.path, p1.x, p1.y); if (!lineIsInClip && p1_in_path) { lineIsInClip = true; } linesCtx.save(); if (lineIsInClip) { linesCtx.clip(bhClip.path); } linesCtx.beginPath(); linesCtx.moveTo(p0.x, p0.y); linesCtx.lineTo(p1.x, p1.y); linesCtx.strokeStyle = "#444"; linesCtx.lineWidth = 1; linesCtx.stroke(); linesCtx.restore(); } });
    }
    function bhInitParticle(start = false) {
        const sx = bhParticleArea.sx + bhParticleArea.sw * Math.random(); const ex = bhParticleArea.ex + bhParticleArea.ew * Math.random(); const dx = ex - sx; const y = start ? bhParticleArea.h * Math.random() : bhParticleArea.h; const r = 0.5 + Math.random() * 2; const vy = 0.3 + Math.random() * 0.7; return { x: sx, sx, dx, y, vy, p: 0, r, c: `rgba(255, 255, 255, ${0.2 + Math.random()*0.6})` };
    }
    function bhSetParticles() {
        const { width, height } = bhRender; bhParticles = [];
        bhParticleArea = { sw: bhClip.disc.w * 0.5, ew: bhClip.disc.w * 2, h: height * 0.85 }; bhParticleArea.sx = (width - bhParticleArea.sw) / 2; bhParticleArea.ex = (width - bhParticleArea.ew) / 2;
        const totalParticles = 150; for (let i = 0; i < totalParticles; i++) { bhParticles.push(bhInitParticle(true)); }
    }
    function bhMoveDiscs() {
        bhDiscs.forEach((disc) => { disc.p = (disc.p + 0.0005) % 1; bhTweenDisc(disc); });
        // Update clip path based on the current state of the clipping disc
        bhClip.path = new Path2D(); bhClip.path.ellipse(bhClip.disc.x, bhClip.disc.y, bhClip.disc.w, bhClip.disc.h, 0, 0, Math.PI * 2); bhClip.path.rect(bhClip.disc.x - bhClip.disc.w, 0, bhClip.disc.w * 2, bhClip.disc.y);
    }
    function bhMoveParticles() {
        bhParticles.forEach((particle, index) => { particle.y -= particle.vy; particle.p = 1 - (particle.y / bhParticleArea.h); particle.p = Math.max(0, Math.min(1, particle.p)); particle.x = particle.sx + particle.dx * particle.p; if (particle.y < 0) { bhParticles[index] = bhInitParticle(false); } });
    }
    function bhDrawDiscs() {
        if (!blackHoleCtx) return; const ctx = blackHoleCtx; ctx.strokeStyle = "#444"; ctx.lineWidth = 1;
        bhDiscs.forEach((disc, i) => { if (i % 6 !== 0) return; ctx.save(); if (disc.w < bhClip.disc.w + 5 && disc.y > bhClip.disc.y) { ctx.clip(bhClip.path); } ctx.beginPath(); ctx.ellipse(disc.x, disc.y, disc.w, disc.h, 0, 0, Math.PI * 2); ctx.stroke(); ctx.restore(); });
    }
    function bhDrawLines() {
        if (!blackHoleCtx || !linesCanvas) return; const ctx = blackHoleCtx; ctx.save(); ctx.globalAlpha = 0.5; ctx.drawImage(linesCanvas, 0, 0); ctx.globalAlpha = 1.0; ctx.restore();
    }
    function bhDrawParticles() {
        if (!blackHoleCtx) return; const ctx = blackHoleCtx; ctx.save(); ctx.clip(bhClip.path);
        bhParticles.forEach((particle) => { ctx.fillStyle = particle.c; ctx.beginPath(); ctx.arc(particle.x, particle.y, particle.r / 2, 0, Math.PI * 2); ctx.closePath(); ctx.fill(); });
        ctx.restore();
    }

    // --- Game Loop ---
    function gameLoop() {
        if (!isGameRunning) return;

        // Regenerate Energy
        if (currentEnergy < MAX_ENERGY) {
            currentEnergy += ENERGY_REGEN_RATE;
            currentEnergy = Math.min(currentEnergy, MAX_ENERGY);
            updateEnergyBar();
        }

        // Update Ideals
        for (let i = activeIdeals.length - 1; i >= 0; i--) {
            const ideal = activeIdeals[i];

            if (ideal === draggedIdealData) continue; // Skip if dragged

            const dx_logic = blackHoleCenterX - ideal.x;
            const dy_logic = blackHoleCenterY - ideal.y;
            const currentDistanceToCenter = Math.sqrt(dx_logic * dx_logic + dy_logic * dy_logic);

            if (ideal.isShrinking) {
                // --- Handle Shrinking Ideal ---
                if (currentDistanceToCenter < SHRINK_REMOVE_THRESHOLD) {
                    // Remove ideal - it reached the center
                    if (ideal.element && ideal.element.parentNode === gameContainer) try { gameContainer.removeChild(ideal.element); } catch (e) {}
                    activeIdeals.splice(i, 1); // Remove from array
                    continue;
                }

                // Calculate scale (1 at radius, 0 at center)
                const scale = Math.max(0, Math.min(1, currentDistanceToCenter / blackHoleRadius));
                ideal.element.style.transform = `scale(${scale})`;
                ideal.element.style.opacity = scale * 0.8 + 0.2; // Fade out as it shrinks

                // Continue moving towards center with potentially reduced speed/acceleration
                const move_distance = Math.max(1, currentDistanceToCenter);
                ideal.dirX = dx_logic / move_distance; ideal.dirY = dy_logic / move_distance;
                let shrinkSpeed = BASE_SPEED + (ACCELERATION_FACTOR / 2) / move_distance; // Example: reduced acceleration
                shrinkSpeed = Math.min(shrinkSpeed, MAX_SPEED_CLAMP * 0.8); // Reduced max speed clamp
                ideal.vx = ideal.dirX * shrinkSpeed; ideal.vy = ideal.dirY * shrinkSpeed;
                ideal.x += ideal.vx; ideal.y += ideal.vy;
                ideal.element.style.left = `${ideal.x}px`; ideal.element.style.top = `${ideal.y}px`;

            } else {
                // --- Handle Normal Ideal Movement & Collision Check ---
                const distance = Math.max(currentDistanceToCenter, MIN_DIST_FOR_ACCEL);
                let currentSpeed = BASE_SPEED + ACCELERATION_FACTOR / distance;
                currentSpeed = Math.min(currentSpeed, MAX_SPEED_CLAMP);
                ideal.dirX = dx_logic / distance; ideal.dirY = dy_logic / distance;
                ideal.vx = ideal.dirX * currentSpeed; ideal.vy = ideal.dirY * currentSpeed;
                ideal.x += ideal.vx; ideal.y += ideal.vy;
                ideal.element.style.left = `${ideal.x}px`; ideal.element.style.top = `${ideal.y}px`;

                // Check if ideal enters the shrinking zone
                const idealRect = ideal.element.getBoundingClientRect(); // Get size for radius check
                const idealRadiusApprox = Math.max(idealRect.width, idealRect.height) / 2;
                if (currentDistanceToCenter < blackHoleRadius + (idealRadiusApprox * COLLISION_THRESHOLD_MULTIPLIER)) {
                    console.log(`Shrinking: ${ideal.typeData.label}`);
                    ideal.isShrinking = true;
                    ideal.element.style.cursor = 'default';
                    playSound('shrinking'); // Play sound
                    // Clone node to remove mouse listeners, preventing drag start after shrinking begins
                    const clone = ideal.element.cloneNode(true);
                    if (ideal.element.parentNode) { ideal.element.parentNode.replaceChild(clone, ideal.element); }
                    ideal.element = clone;
                }
            }
        }

        // --- Update Canvas Black Hole ---
        if (blackHoleCtx) {
            bhMoveDiscs(); bhMoveParticles();
            blackHoleCtx.clearRect(0, 0, blackHoleCanvasElement.width, blackHoleCanvasElement.height);
            blackHoleCtx.save(); blackHoleCtx.scale(bhRender.dpi, bhRender.dpi);
            bhDrawDiscs(); bhDrawLines(); bhDrawParticles();
            blackHoleCtx.restore();
        }

        gameLoopId = requestAnimationFrame(gameLoop);
    }

    // --- Game Control ---
    function startGame() {
        if (isGameRunning) return; initAudio();
        instructions.classList.add('hidden'); gameContainer.classList.remove('hidden');
        isGameRunning = true; currentEnergy = MAX_ENERGY; isDragging = false; draggedIdealData = null;
        // Clear previous ideals from DOM and array
        activeIdeals.forEach(ideal => { if (ideal.element && ideal.element.parentNode === gameContainer) try { gameContainer.removeChild(ideal.element); } catch(e) {} });
        activeIdeals = [];
        if (particleContainer) particleContainer.innerHTML = ''; // Clear non-canvas particles
        updateEnergyBar();
        containerRect = gameContainer.getBoundingClientRect(); repositoryRect = repository.getBoundingClientRect();
        // Initialize Canvas BH
        if (blackHoleCanvasElement) { blackHoleCtx = blackHoleCanvasElement.getContext('2d'); bhSetSize(); bhSetDiscs(); bhSetLines(); bhSetParticles(); } else { console.error("Black hole canvas element not found!"); return; } // Stop if no canvas
        // Clear old loops/intervals
        if (spawnIntervalId) clearInterval(spawnIntervalId); if (gameLoopId) cancelAnimationFrame(gameLoopId);
        // Start new game loops
        spawnIntervalId = setInterval(createIdeal, IDEAL_SPAWN_INTERVAL); gameLoopId = requestAnimationFrame(gameLoop);
        console.log("Cosmic Tether Engaged - Game Started");
    }
    function stopGame() { // Optional stop function
        isGameRunning = false; if (spawnIntervalId) clearInterval(spawnIntervalId); if (gameLoopId) cancelAnimationFrame(gameLoopId);
        window.removeEventListener('mousemove', handleMouseMove); window.removeEventListener('mouseup', handleMouseUp); // Clean up drag listeners
        console.log("Game Stopped");
        // Could potentially show instructions again here
    }

    // --- Event Listeners ---
    startButton.addEventListener('click', startGame);
    window.addEventListener('resize', () => { // Handle resize
        if(isGameRunning) {
            containerRect = gameContainer.getBoundingClientRect(); repositoryRect = repository.getBoundingClientRect();
            // Resize Canvas BH and re-init elements
            if (blackHoleCanvasElement && blackHoleCtx) { bhSetSize(); bhSetDiscs(); bhSetLines(); bhSetParticles(); }
            console.log("Resized - Recalculated bounds and BH Canvas");
        }
    });

}); // End DOMContentLoaded