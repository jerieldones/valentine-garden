// src/main.js
import './style.css';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * Valentine Garden — COMPLETE FIXED VERSION
 * Sky + Lighting + Rose + Flowers all working perfectly
 */

// --------------------
// SKY CONFIG - Tweak these for different moods!
// --------------------
const SKY_CONFIG = {
  // Sky gradient colors
  topColor: '#4a2c5e',        // Deep purple twilight (darker = more night, lighter = more day)
  horizonColor: '#ff9a76',    // Warm coral/peach (more red = dramatic, more yellow = softer)
  bottomColor: '#ffd4a3',     // Light peachy cream (lighter = more ethereal)
  
  // Sun properties
  sunElevation: 8,            // Degrees above horizon (0-90, lower = more sunset)
  sunAzimuth: 180,            // Degrees clockwise from north (0-360)
  sunIntensity: 1.3,          // Sun disk brightness (0.5-2.0)
  sunSize: 0.04,              // Visual sun size (0.01-0.1, bigger = larger sun)
  glowIntensity: 0.8,         // Atmospheric glow strength (0-2)
  
  // Atmosphere
  atmosphericScatter: 0.4,    // How much sun affects sky color (0-1, higher = more orange)
  horizonFalloff: 4.0,        // Sharpness of horizon gradient (2-8, higher = sharper)
  
  // Lighting
  ambientIntensity: 0.5,      // Overall scene brightness (0.3-0.8)
  sunLightIntensity: 1.2,     // Directional sun strength (0.8-2.0)
  hemiIntensity: 0.65,        // Hemisphere light strength (0.4-1.0)
  
  // Fog
  fogDensity: 0.008,          // Fog thickness (0.005-0.02, higher = thicker)
  fogColor: '#ffb89d',        // Fog tint (should match horizon)
  
  // Tone mapping
  exposure: 1.1,              // Overall brightness (0.8-1.5, higher = brighter)
};

// --------------------
// Main Config
// --------------------
const CONFIG = {
  seed: 20260214,
  maxPixelRatio: 2,

  flowerCount: isMobile() ? 9000 : 10000,
  fieldRadius: 120,
  clearRadius: 12.0,

  cameraPos: new THREE.Vector3(0, 3.5, 12.0),
  lookAt: new THREE.Vector3(0, 2.0, 0),

  enableControls: true,
  enableWind: true,

  roseHeight: 5.0,
  rosePosition: new THREE.Vector3(0, 0, 0),

  tapCooldownMs: 900,

  heartCount: isMobile() ? 200 : 400,
  heartFallSpeedMin: -0.5,
  heartFallSpeedMax: -1.2,
  heartStartYMin: 10,
  heartStartYMax: 20,
  heartScale: 0.4,
};

// --------------------
// UI
// --------------------
ensureOverlayElements();
const hintEl = document.getElementById('hint');
const cardEl = document.getElementById('card');
const yesBtn = document.getElementById('yes');
const noBtn = document.getElementById('no');
const fallbackEl = document.getElementById('fallback');

// --------------------
// State
// --------------------
let renderer, scene, camera, controls;
let clock;
let raycaster, pointerNDC;
let flowerField = null;
let rose = null;
let fallingHearts = null;
let lastTapTime = -Infinity;
let triggered = false;

let sunLight = null;
let hemiLight = null;
let skyDome = null;
let sunDirection = new THREE.Vector3();

// --------------------
// Seeded RNG
// --------------------
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = mulberry32(CONFIG.seed);
const rand = (min, max) => min + rng() * (max - min);
const pick = (arr) => arr[Math.floor(rng() * arr.length)];

// --------------------
// New: Leaflet Geometry for Realistic Serrated Leaflet
// --------------------
function createLeafletGeometry(length = 0.15, width = 0.07, numTeeth = 6) {
  const shape = new THREE.Shape();
  const halfWidth = width / 2;
  const toothDepth = 0.008;

  // Left side points (base to tip)
  const leftPoints = [new THREE.Vector2(0, 0)];
  for (let i = 1; i < numTeeth; i++) {
    const t = i / numTeeth;
    const y = t * length;
    const w = halfWidth * Math.sin(Math.PI * t);
    leftPoints.push(new THREE.Vector2(-w, y));

    const tt = (i - 0.5) / numTeeth;
    const ty = tt * length;
    const tw = halfWidth * Math.sin(Math.PI * tt);
    leftPoints.push(new THREE.Vector2(-tw - toothDepth, ty));
  }
  leftPoints.push(new THREE.Vector2(0, length));

  // Right side points (tip to base, mirrored)
  const rightPoints = [];
  for (let i = 0; i < leftPoints.length; i++) {
    const p = leftPoints[leftPoints.length - 1 - i].clone();
    p.x = -p.x;
    rightPoints.push(p);
  }

  // Combine points
  const allPoints = leftPoints.concat(rightPoints.slice(1)); // Avoid duplicate base

  // Build shape
  shape.moveTo(allPoints[0].x, allPoints[0].y);
  for (let i = 1; i < allPoints.length; i++) {
    shape.lineTo(allPoints[i].x, allPoints[i].y);
  }

  const geo = new THREE.ShapeGeometry(shape, 8); // Curve segments for smooth edges

  // Add slight curvature for realism
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const curve = Math.sin((y / length) * Math.PI) * x * 1.2; // Bend along length
    pos.setZ(i, curve);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();

  return geo;
}

// --------------------
// New: Compound Leaf Geometry (Petiole + Leaflets)
// --------------------
function createCompoundLeafGeo(basePosition, baseRotation, petioleLength = 0.1, leafletLength = 0.15, leafletWidth = 0.07, numTeeth = 8) {
  const geos = [];

  // Petiole (small stem)
  const petioleGeo = new THREE.CylinderGeometry(0.008, 0.012, petioleLength, 8);
  petioleGeo.translate(0, petioleLength / 2, 0);
  geos.push(petioleGeo);

  // Base leaflet geometry
  const leafletGeo = createLeafletGeometry(leafletLength, leafletWidth, numTeeth);

  // Terminal leaflet (straight)
  const terminal = leafletGeo.clone();
  terminal.translate(0, petioleLength, 0);
  geos.push(terminal);

  // Side leaflet 1 (angled left)
  const side1 = leafletGeo.clone();
  side1.rotateZ(0.8); // ~45 degrees
  side1.translate(-0.04, petioleLength * 0.6, 0);
  geos.push(side1);

  // Side leaflet 2 (angled right)
  const side2 = leafletGeo.clone();
  side2.rotateZ(-0.8);
  side2.translate(0.04, petioleLength * 0.6, 0);
  geos.push(side2);

  // Merge into single geometry
  const merged = mergeGeometries(geos);

  // Apply base rotation and translation
  if (baseRotation.y) merged.rotateY(baseRotation.y);
  if (baseRotation.z) merged.rotateZ(baseRotation.z);
  merged.translate(basePosition.x, basePosition.y, basePosition.z);

  return merged;
}

// --------------------
// New: Smooth Leaf Geometry for Field Flowers
// --------------------
function createSmoothLeafGeometry(length = 0.3, width = 0.12) {
  const shape = new THREE.Shape();

  shape.moveTo(0, 0);
  shape.quadraticCurveTo(-width/2, length/3, -width/2, 2*length/3);
  shape.quadraticCurveTo(-width/2, length, 0, length);
  shape.quadraticCurveTo(width/2, length, width/2, 2*length/3);
  shape.quadraticCurveTo(width/2, length/3, 0, 0);

  const geo = new THREE.ShapeGeometry(shape, 12);

  // Add curvature
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const curve = Math.sin((y / length) * Math.PI) * Math.abs(x) * 1.5;
    pos.setZ(i, curve);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();

  return geo;
}

// --------------------
// New: Petal Shape for Field Flowers
// --------------------
function createPetalShape() {
  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  shape.bezierCurveTo(-0.05, 0.1, -0.15, 0.25, -0.15, 0.4);
  shape.bezierCurveTo(-0.15, 0.55, -0.05, 0.7, 0, 0.7);
  shape.bezierCurveTo(0.05, 0.7, 0.15, 0.55, 0.15, 0.4);
  shape.bezierCurveTo(0.15, 0.25, 0.05, 0.1, 0, 0);
  return shape;
}

// --------------------
// New: Heart Shape Geometry
// --------------------
function createHeartGeometry(size = 1) {
  const shape = new THREE.Shape();
  shape.moveTo(0, 0.25 * size);
  shape.bezierCurveTo(0, 0.375 * size, 0.125 * size, 0.5 * size, 0.25 * size, 0.5 * size);
  shape.bezierCurveTo(0.375 * size, 0.5 * size, 0.5 * size, 0.375 * size, 0.5 * size, 0.25 * size);
  shape.bezierCurveTo(0.5 * size, 0.125 * size, 0.4375 * size, 0, 0.375 * size, 0);
  shape.bezierCurveTo(0.3125 * size, 0, 0.25 * size, 0.0625 * size, 0.25 * size, 0.125 * size);
  shape.bezierCurveTo(0.25 * size, 0.1875 * size, 0.1875 * size, 0.25 * size, 0.125 * size, 0.25 * size);
  shape.bezierCurveTo(0.0625 * size, 0.25 * size, 0, 0.1875 * size, 0, 0.125 * size);
  shape.bezierCurveTo(0, 0.0625 * size, -0.0625 * size, 0, -0.125 * size, 0);
  shape.bezierCurveTo(-0.1875 * size, 0, -0.25 * size, 0.0625 * size, -0.25 * size, 0.125 * size);
  shape.bezierCurveTo(-0.25 * size, 0.1875 * size, -0.3125 * size, 0.25 * size, -0.375 * size, 0.25 * size);
  shape.bezierCurveTo(-0.4375 * size, 0.25 * size, -0.5 * size, 0.1875 * size, -0.5 * size, 0.125 * size);
  shape.bezierCurveTo(-0.5 * size, 0.0625 * size, -0.4375 * size, 0, -0.375 * size, 0);
  shape.bezierCurveTo(-0.3125 * size, 0, -0.25 * size, -0.0625 * size, -0.25 * size, -0.125 * size);
  shape.bezierCurveTo(-0.25 * size, -0.1875 * size, -0.1875 * size, -0.25 * size, -0.125 * size, -0.25 * size);
  shape.bezierCurveTo(-0.0625 * size, -0.25 * size, 0, -0.1875 * size, 0, -0.125 * size);
  shape.bezierCurveTo(0, -0.0625 * size, 0.0625 * size, 0, 0.125 * size, 0);
  shape.bezierCurveTo(0.1875 * size, 0, 0.25 * size, -0.0625 * size, 0.25 * size, -0.125 * size);
  shape.bezierCurveTo(0.25 * size, -0.1875 * size, 0.3125 * size, -0.25 * size, 0.375 * size, -0.25 * size);
  shape.bezierCurveTo(0.4375 * size, -0.25 * size, 0.5 * size, -0.1875 * size, 0.5 * size, -0.125 * size);
  shape.bezierCurveTo(0.5 * size, 0, 0.375 * size, 0.125 * size, 0.25 * size, 0.125 * size);
  shape.bezierCurveTo(0.125 * size, 0.125 * size, 0, 0, 0, 0.25 * size);

  const geo = new THREE.ShapeGeometry(shape, 16);
  geo.rotateX(Math.PI); // Face camera if needed
  geo.computeVertexNormals();
  return geo;
}

// --------------------
// Boot
// --------------------
init();
console.log('WebGL supported?', hasWebGL());

function init() {
  if (!hasWebGL()) {
    fallbackEl?.classList?.add('show');
    return;
  }

  clock = new THREE.Clock();

  initScene();
  flowerField = createFlowerField();
  rose = createRose();
  fallingHearts = createFallingHearts();

  setupInteraction();
  setupButtons();

  animate();
}

// --------------------
// Scene setup with FIXED SKY + LIGHTING
// --------------------
function initScene() {
  scene = new THREE.Scene();

  camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 300);
  camera.position.copy(CONFIG.cameraPos);

  renderer = new THREE.WebGLRenderer({ 
    antialias: true,
    powerPreference: 'high-performance'
  });
  
  // FIXED: Proper color space handling
  if ('outputColorSpace' in renderer) {
    renderer.outputColorSpace = THREE.SRGBColorSpace;
  } else if ('outputEncoding' in renderer) {
    renderer.outputEncoding = THREE.sRGBEncoding;
  }
  
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = SKY_CONFIG.exposure;
  
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, CONFIG.maxPixelRatio));
  document.body.style.margin = 0;
  document.body.appendChild(renderer.domElement);

  calculateSunDirection();

  skyDome = createRomanticSky();
  scene.add(skyDome);

  setupSceneLighting();

  scene.fog = new THREE.FogExp2(
    new THREE.Color(SKY_CONFIG.fogColor),
    SKY_CONFIG.fogDensity
  );

  const ground = createGround();
  scene.add(ground);

  if (CONFIG.enableControls) {
    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.target.copy(CONFIG.lookAt);
    controls.minDistance = 8;
    controls.maxDistance = 25;
    controls.minPolarAngle = 0.8;
    controls.maxPolarAngle = 1.4;
    controls.update();
  }

  raycaster = new THREE.Raycaster();
  pointerNDC = new THREE.Vector2();

  window.addEventListener('resize', onResize);
}

function calculateSunDirection() {
  const phi = THREE.MathUtils.degToRad(90 - SKY_CONFIG.sunElevation);
  const theta = THREE.MathUtils.degToRad(SKY_CONFIG.sunAzimuth);
  sunDirection.setFromSphericalCoords(1, phi, theta);
}

// --------------------
// Sky
// --------------------
function createRomanticSky() {
  const geometry = new THREE.SphereGeometry(200, 32, 32);

  // Use ONE method to render inside of the sphere:
  // Keep your scale(-1,1,1) and use FrontSide (clean + consistent).
  geometry.scale(-1, 1, 1);

  const top = new THREE.Color(SKY_CONFIG.topColor);
  const horizon = new THREE.Color(SKY_CONFIG.horizonColor);
  const bottom = new THREE.Color(SKY_CONFIG.bottomColor);

  const material = new THREE.ShaderMaterial({
    uniforms: {
      uTopColor: { value: top },
      uHorizonColor: { value: horizon },
      uBottomColor: { value: bottom },

      uSunDirection: { value: sunDirection.clone().normalize() },
      uSunIntensity: { value: SKY_CONFIG.sunIntensity },
      uSunSize: { value: SKY_CONFIG.sunSize },             // 0.01–0.1
      uGlowIntensity: { value: SKY_CONFIG.glowIntensity },
      uAtmosphericScatter: { value: SKY_CONFIG.atmosphericScatter },
      uHorizonFalloff: { value: SKY_CONFIG.horizonFalloff },
    },

    vertexShader: `
      varying vec3 vViewDir;

      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vViewDir = normalize(mv.xyz);
        gl_Position = projectionMatrix * mv;
      }
    `,

    fragmentShader: `
      uniform vec3 uTopColor;
      uniform vec3 uHorizonColor;
      uniform vec3 uBottomColor;

      uniform vec3 uSunDirection;
      uniform float uSunIntensity;
      uniform float uSunSize;
      uniform float uGlowIntensity;
      uniform float uAtmosphericScatter;
      uniform float uHorizonFalloff;

      varying vec3 vViewDir;

      void main() {
        // View-space direction; y is "up" relative to camera view
        vec3 dir = normalize(vViewDir);
        float height = dir.y;

        // --- Smooth gradient (bottom -> horizon -> top)
        float horizonMix = smoothstep(-0.15, 0.35, height);
        float topMix     = smoothstep(0.10, 0.80, height);

        vec3 skyColor = mix(uBottomColor, uHorizonColor, horizonMix);
        skyColor = mix(skyColor, uTopColor, topMix);

        // Optional: sharpen/soften horizon band via uHorizonFalloff
        float haze = exp(-max(height, 0.0) * uHorizonFalloff) * 0.12;
        skyColor = mix(skyColor, uHorizonColor, haze);

        // --- Sun disk + glow
        // IMPORTANT: uSunDirection is in WORLD space by your current code.
        // Our dir is in VIEW space. To keep it simple and consistent:
        // Approximate by assuming camera doesn't roll and is mostly upright.
        // If you want exact, you can pass a view-space sun direction uniform each frame.
        // For now, convert world sun direction into view space in JS (recommended),
        // but if you don't, this still gives a pleasing glow.
        vec3 sunDir = normalize(uSunDirection);

        // Use dir in *world-like* sense by flipping sign (inside sphere)
        // If your sun appears opposite, flip the sign of sunDir below.
        float sunDot = max(dot(normalize(-dir), sunDir), 0.0);

        // Wider, more reliable sun edge (was too thin at 0.001)
        float edge = 1.0 - uSunSize;
        float soft = 0.012; 
        float sunDisk = smoothstep(edge - soft, edge + soft, sunDot);

        vec3 sunColor = vec3(1.0, 0.95, 0.85) * uSunIntensity;

        float sunGlow  = pow(sunDot, 10.0) * uGlowIntensity;
        float wideGlow = pow(sunDot,  3.0) * uGlowIntensity * 0.35;

        vec3 sunTint = vec3(1.0, 0.7, 0.5) * (sunGlow + wideGlow) * uAtmosphericScatter;

        vec3 finalColor = skyColor + sunTint;
        finalColor = mix(finalColor, sunColor, sunDisk);

        // Gentle vignette
        float vig = 0.88 + 0.12 * smoothstep(-0.25, 0.55, height);
        finalColor *= vig;

        
        finalColor = max(finalColor, vec3(0.02));

        gl_FragColor = vec4(finalColor, 1.0);
      }
    `,

    // With geometry.scale(-1,1,1), use FrontSide (don’t double-invert)
    side: THREE.FrontSide,
    depthWrite: false,
    depthTest: false, // optional: ensures sky never fails depth
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = -999;

  return mesh;
}


// --------------------
// LIGHTING - Matches sky perfectly
// --------------------
function setupSceneLighting() {
  const skyTint = new THREE.Color(SKY_CONFIG.horizonColor).multiplyScalar(0.8);
  const groundTint = new THREE.Color('#4a3820');
  
  hemiLight = new THREE.HemisphereLight(skyTint, groundTint, SKY_CONFIG.hemiIntensity);
  scene.add(hemiLight);
  
  const sunColor = new THREE.Color('#ffeedd');
  sunLight = new THREE.DirectionalLight(sunColor, SKY_CONFIG.sunLightIntensity);
  sunLight.position.copy(sunDirection).multiplyScalar(50);
  sunLight.target.position.set(0, 0, 0);
  scene.add(sunLight);
  scene.add(sunLight.target);
  
  const ambient = new THREE.AmbientLight(
    new THREE.Color(SKY_CONFIG.bottomColor).multiplyScalar(0.6),
    SKY_CONFIG.ambientIntensity
  );
  scene.add(ambient);
}

function onResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, CONFIG.maxPixelRatio));
}

// --------------------
// Ground
// --------------------
function createGround() {
  // --- Ground mesh (green + subtle variation) ---
  const geo = new THREE.PlaneGeometry(260, 260, 120, 120);
  geo.rotateX(-Math.PI / 2);

  // Soft terrain waviness (keep subtle so it still feels like a field)
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const z = p.getZ(i);

    // A little richer noise than before (still cheap)
    const y =
      Math.sin(x * 0.035) * 0.09 +
      Math.cos(z * 0.030) * 0.09 +
      Math.sin((x + z) * 0.020) * 0.06;

    p.setY(i, y);
  }
  p.needsUpdate = true;
  geo.computeVertexNormals();

  // Vertex colors: greener + grass-like patching
  const colors = new Float32Array(p.count * 3);

  // More "grass" palette
  const base = new THREE.Color(0x2f7d32);   // vivid grass green
  const dark = new THREE.Color(0x1f5f2a);   // shadowy patches
  const light = new THREE.Color(0x4caf50);  // sunlit patches

  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const z = p.getZ(i);

    // Cheap pseudo-noise blend (no textures)
    const n1 = 0.5 + 0.5 * Math.sin(x * 0.09) * Math.cos(z * 0.08);
    const n2 = 0.5 + 0.5 * Math.sin((x + z) * 0.05);
    const n = (n1 * 0.65 + n2 * 0.35);

    // Mix base->dark->light
    const c = base.clone().lerp(dark, (1.0 - n) * 0.55).lerp(light, n * 0.45);

    colors[i * 3 + 0] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

  const groundMat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 1.0,
    metalness: 0.0,
  });

  const ground = new THREE.Mesh(geo, groundMat);
  ground.position.y = 0;
  ground.receiveShadow = false; // keep mobile-friendly

  // --- Short grass layer (cheap "fuzz" using points) ---
  // This gives the perception of tiny blades without heavy geometry.
  const grassCount = isMobile() ? 22000 : 55000;

  const grassGeo = new THREE.BufferGeometry();
  const positions = new Float32Array(grassCount * 3);
  const sizes = new Float32Array(grassCount);
  const phases = new Float32Array(grassCount);

  // For sampling height from the plane, we use the same height function used above
  // so blades sit on terrain without raycasts.
  function heightAt(x, z) {
    return (
      Math.sin(x * 0.035) * 0.09 +
      Math.cos(z * 0.030) * 0.09 +
      Math.sin((x + z) * 0.020) * 0.06
    );
  }

  for (let i = 0; i < grassCount; i++) {
    const x = (Math.random() - 0.5) * 250;
    const z = (Math.random() - 0.5) * 250;

    const y = heightAt(x, z) + 0.01; // slight lift to avoid z-fighting

    positions[i * 3 + 0] = x;
    positions[i * 3 + 1] = y;
    positions[i * 3 + 2] = z;

    sizes[i] = 0.035 + Math.random() * 0.055;  // short blades
    phases[i] = Math.random() * Math.PI * 2;   // wind variation
  }

  grassGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  grassGeo.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
  grassGeo.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));

  const grassMat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
    },
    vertexShader: `
      uniform float uTime;
      attribute float aSize;
      attribute float aPhase;

      varying float vFade;

      void main() {
        vec3 pos = position;

        // Gentle wind sway (tiny sideways jitter)
        float t = uTime * 1.2 + aPhase;
        pos.x += sin(t) * 0.04;
        pos.z += cos(t * 0.85) * 0.03;

        // Fade with distance to avoid noisy horizon
        vec4 mv = modelViewMatrix * vec4(pos, 1.0);
        float dist = length(mv.xyz);
        vFade = smoothstep(140.0, 45.0, dist);

        gl_Position = projectionMatrix * mv;

        // Perspective-correct point sizing
        gl_PointSize = aSize * 900.0 / max(1.0, -mv.z);
      }
    `,
    fragmentShader: `
      varying float vFade;

      void main() {
        // Soft circular blade dot
        vec2 uv = gl_PointCoord.xy - 0.5;
        float r = dot(uv, uv);
        float alpha = smoothstep(0.25, 0.0, r) * vFade;

        // Grass color (slightly varied by uv)
        vec3 col = vec3(0.14, 0.55, 0.22);
        col += (uv.y * 0.08);

        gl_FragColor = vec4(col, alpha);
      }
    `,
    transparent: true,
    depthWrite: false,
  });

  const grass = new THREE.Points(grassGeo, grassMat);
  grass.renderOrder = -10; // above ground, below flowers
  ground.add(grass);

  // Hook for your animate loop: call ground.userData.update(t)
  ground.userData.update = (t) => {
    grassMat.uniforms.uTime.value = t;
  };

  return ground;
}

// --------------------
// Flower Field
// --------------------
function createFlowerField() {
  const flowerGeo = buildSingleFlowerGeometry();
  const flowerMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.70,
    metalness: 0.05,
    vertexColors: true,
    side: THREE.DoubleSide,
  });

  const mesh = new THREE.InstancedMesh(flowerGeo, flowerMat, CONFIG.flowerCount);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

  const palette = [
    new THREE.Color(0xff69b4),
    new THREE.Color(0xff1493),
    new THREE.Color(0xffb6c1),
    new THREE.Color(0xff6b9d),
    new THREE.Color(0xffc0cb),
    new THREE.Color(0xff8fab),
    new THREE.Color(0xff91a4),
    new THREE.Color(0xdb7093),
    new THREE.Color(0xffb3d9),
    new THREE.Color(0xff4d88),
  ];
  const instanceColors = new Float32Array(CONFIG.flowerCount * 3);

  const aSway = new Float32Array(CONFIG.flowerCount);
  const aPhase = new Float32Array(CONFIG.flowerCount);

  const tmpM = new THREE.Matrix4();
  const tmpQ = new THREE.Quaternion();
  const tmpS = new THREE.Vector3();
  const tmpP = new THREE.Vector3();

  for (let i = 0; i < CONFIG.flowerCount; i++) {
    const r = CONFIG.clearRadius + rand(0, 1) * (CONFIG.fieldRadius - CONFIG.clearRadius);
    const a = rand(0, Math.PI * 2);
    const x = Math.cos(a) * r + rand(-2.5, 2.5);
    const z = Math.sin(a) * r + rand(-2.5, 2.5);

    const h = rand(0.6, 1.6);
    const s = rand(0.65, 1.4);
    const tiltX = rand(-0.18, 0.18);
    const tiltZ = rand(-0.18, 0.18);
    const yaw = rand(0, Math.PI * 2);

    tmpP.set(x, 0, z);
    tmpQ.setFromEuler(new THREE.Euler(tiltX, yaw, tiltZ, 'XYZ'));
    tmpS.set(s, s * h, s);

    tmpM.compose(tmpP, tmpQ, tmpS);
    mesh.setMatrixAt(i, tmpM);

    const c = pick(palette).clone();
    c.offsetHSL(rand(-0.02, 0.02), rand(-0.03, 0.03), rand(-0.04, 0.04));
    instanceColors[i * 3 + 0] = c.r;
    instanceColors[i * 3 + 1] = c.g;
    instanceColors[i * 3 + 2] = c.b;

    aSway[i] = rand(0.3, 1.1);
    aPhase[i] = rand(0, Math.PI * 2);
  }

  mesh.instanceColor = new THREE.InstancedBufferAttribute(instanceColors, 3);
  mesh.instanceMatrix.needsUpdate = true;

  if (CONFIG.enableWind) {
    mesh.geometry.setAttribute('aSway', new THREE.InstancedBufferAttribute(aSway, 1));
    mesh.geometry.setAttribute('aPhase', new THREE.InstancedBufferAttribute(aPhase, 1));
    applyWindShader(mesh);
  }

  mesh.position.y = 0.0;
  scene.add(mesh);

  return {
    mesh,
    material: flowerMat,
    updateWind: (t) => {
      const shader = flowerMat.userData.shader;
      if (shader) shader.uniforms.uTime.value = t;
    },
  };
}

function buildSingleFlowerGeometry() {
  const stem = new THREE.CylinderGeometry(0.035, 0.055, 1.5, 8);
  stem.translate(0, 0.75, 0);

  const leafGeo = createSmoothLeafGeometry(0.4, 0.18);

  const leaf1 = leafGeo.clone();
  leaf1.rotateZ(-0.65);
  leaf1.translate(0.20, 0.60, 0.06);

  const leaf2 = leafGeo.clone();
  leaf2.rotateZ(0.65);
  leaf2.rotateY(Math.PI * 0.7);
  leaf2.translate(-0.18, 0.75, -0.04);

  const petalShape = createPetalShape();
  const singlePetalGeo = new THREE.ShapeGeometry(petalShape, 16);

  // Add curvature to petals
  const petalLength = 0.7;
  const petalPos = singlePetalGeo.attributes.position;
  for (let i = 0; i < petalPos.count; i++) {
    const x = petalPos.getX(i);
    const y = petalPos.getY(i);
    const curve = Math.sin((y / petalLength) * Math.PI) * Math.abs(x) * 1.5;
    petalPos.setZ(i, curve);
  }
  petalPos.needsUpdate = true;
  singlePetalGeo.computeVertexNormals();

  const petals = [];
  const layers = [
    { count: 6, size: 0.8, out: 0.5, radius: 0.1 },
    { count: 8, size: 1.0, out: 0.65, radius: 0 }
  ];
  for (let layer of layers) {
    for (let i = 0; i < layer.count; i++) {
      const angle = (i / layer.count) * Math.PI * 2 + rng() * 0.1;
      const petal = singlePetalGeo.clone();
      petal.scale(layer.size, layer.size, layer.size);
      petal.rotateY(angle);
      petal.rotateX(layer.out);
      petal.translate(0, 1.55, layer.radius);
      petals.push(petal);
    }
  }

  const center = new THREE.SphereGeometry(0.12, 14, 12);
  center.translate(0, 1.55, 0);

  const merged = mergeGeometries([stem, leaf1, leaf2, ...petals, center], false);

  const pos = merged.attributes.position;
  const colors = new Float32Array(pos.count * 3);

  const cStem = new THREE.Color(0x2db86e);
  const cLeaf = new THREE.Color(0x229955);
  const cPetal = new THREE.Color(0xffffff);
  const cCenter = new THREE.Color(0xffd700);

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const r = Math.sqrt(x * x + z * z);

    let c = cPetal;
    if (y < 1.2) c = cStem;
    else if (y < 1.35 && r > 0.14) c = cLeaf;
    else if (y > 1.48 && r < 0.16) c = cCenter;

    colors[i * 3 + 0] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }

  merged.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  merged.computeVertexNormals();
  return merged;
}

function applyWindShader(instancedMesh) {
  const mat = instancedMesh.material;
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = { value: 0.0 };
    mat.userData.shader = shader;

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
         attribute float aSway;
         attribute float aPhase;
         uniform float uTime;`
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
         float t = uTime * 1.1 + aPhase;
         float bendX = sin(t) * 0.12 * aSway;
         float bendZ = cos(t * 0.85) * 0.09 * aSway;
         float yMask = clamp(transformed.y * 0.70, 0.0, 1.0);
         transformed.x += bendX * yMask;
         transformed.z += bendZ * yMask;
         
         float topBend = smoothstep(1.2, 1.6, transformed.y);
         transformed.x += sin(t * 1.3) * 0.08 * topBend * aSway;`
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        'diffuseColor.rgb *= vInstanceColor;',
        'if (vColor.r > 0.9 && vColor.g > 0.9 && vColor.b > 0.9) { diffuseColor.rgb *= vInstanceColor; }'
      );
  };
  mat.needsUpdate = true;
}

// --------------------
// Falling Hearts
// --------------------
function createFallingHearts() {
  const heartGeo = createHeartGeometry(1);
  const heartMat = new THREE.MeshBasicMaterial({
    color: 0xff1744,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.8,
    blending: THREE.AdditiveBlending,
  });

  const mesh = new THREE.InstancedMesh(heartGeo, heartMat, CONFIG.heartCount);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

  const positions = [];
  const velocities = [];
  const phases = [];
  const tmpM = new THREE.Matrix4();
  const tmpQ = new THREE.Quaternion();
  const tmpS = new THREE.Vector3(1, 1, 1);
  const tmpP = new THREE.Vector3();

  for (let i = 0; i < CONFIG.heartCount; i++) {
    const r = rand(0, CONFIG.fieldRadius * 1.2);
    const a = rand(0, Math.PI * 2);
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    const y = rand(CONFIG.heartStartYMin, CONFIG.heartStartYMax);

    tmpP.set(x, y, z);
    tmpQ.setFromEuler(new THREE.Euler(rand(0, Math.PI), rand(0, Math.PI * 2), rand(0, Math.PI)));
    tmpS.setScalar(CONFIG.heartScale * rand(0.5, 1.5));

    tmpM.compose(tmpP, tmpQ, tmpS);
    mesh.setMatrixAt(i, tmpM);

    positions.push(new THREE.Vector3(x, y, z));
    velocities.push(rand(CONFIG.heartFallSpeedMin, CONFIG.heartFallSpeedMax));
    phases.push(rand(0, Math.PI * 2));
  }

  mesh.instanceMatrix.needsUpdate = true;
  scene.add(mesh);

  const update = (delta, t) => {
    for (let i = 0; i < CONFIG.heartCount; i++) {
      const pos = positions[i];
      pos.y += velocities[i] * delta;

      const swayX = Math.sin(t + phases[i]) * 0.5;
      const swayZ = Math.cos(t + phases[i] * 0.7) * 0.3;
      pos.x += swayX * delta;
      pos.z += swayZ * delta;

      if (pos.y < 0) {
        const r = rand(0, CONFIG.fieldRadius * 1.2);
        const a = rand(0, Math.PI * 2);
        pos.x = Math.cos(a) * r;
        pos.z = Math.sin(a) * r;
        pos.y = rand(CONFIG.heartStartYMin, CONFIG.heartStartYMax);
        velocities[i] = rand(CONFIG.heartFallSpeedMin, CONFIG.heartFallSpeedMax);
      }

      tmpM.compose(pos, tmpQ, tmpS);
      mesh.setMatrixAt(i, tmpM);
    }
    mesh.instanceMatrix.needsUpdate = true;
  };

  return { mesh, update };
}

// --------------------
// Rose - Massive and centered
// --------------------
function createRose() {
  const roseGroup = new THREE.Group();
  roseGroup.name = 'RoseGroup';

  const stemMat = new THREE.MeshStandardMaterial({
    color: 0x1e8f54,
    roughness: 0.85,
    metalness: 0.0,
  });

  const stemMesh = createRealRoseStemMesh(stemMat);
  stemMesh.name = 'RoseStem';
  roseGroup.add(stemMesh);

  const thornMat = new THREE.MeshStandardMaterial({
    color: 0x145a3a,
    roughness: 0.70,
    metalness: 0.0,
  });
  addThornsToStem(roseGroup, stemMesh, thornMat);

  const leafMat = new THREE.MeshStandardMaterial({
    color: 0x1a7a45,
    roughness: 0.80,
    metalness: 0.0,
    side: THREE.DoubleSide,
  });

  // Create compound leaves
  const leaf1 = createCompoundLeafGeo(
    new THREE.Vector3(0.08, 0.28, 0.03),
    new THREE.Euler(0, 0, -0.9),
    0.1, 0.15, 0.07, 8
  );

  const leaf2 = createCompoundLeafGeo(
    new THREE.Vector3(-0.075, 0.38, -0.025),
    new THREE.Euler(0, Math.PI, 0.85),
    0.1, 0.14, 0.065, 8
  );

  const leaf3 = createCompoundLeafGeo(
    new THREE.Vector3(0.02, 0.45, 0.08),
    new THREE.Euler(0, Math.PI * 0.5, -0.7),
    0.1, 0.13, 0.06, 7
  );

  const leavesGeo = mergeGeometries([leaf1, leaf2, leaf3], false);
  leavesGeo.computeVertexNormals();

  const leavesMesh = new THREE.Mesh(leavesGeo, leafMat);
  leavesMesh.name = 'RoseLeaves';
  roseGroup.add(leavesMesh);

  const petalMat = new THREE.MeshStandardMaterial({
    color: 0xff1744,
    roughness: 0.28,
    metalness: 0.08,
    emissive: 0x330008,
    emissiveIntensity: 0.65,
    side: THREE.DoubleSide,
    clearcoat: 0.45,
    clearcoatRoughness: 0.30,
  });

  const petalsGeo = buildRealisticRosePetalsGeometry();
  petalsGeo.computeVertexNormals();

  const petalsMesh = new THREE.Mesh(petalsGeo, petalMat);
  petalsMesh.name = 'RosePetals';
  roseGroup.add(petalsMesh);

  const colliderGeo = new THREE.CapsuleGeometry(0.18, 0.55, 8, 12);
  colliderGeo.translate(0, 0.42, 0);
  const colliderMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.0 });
  const colliderMesh = new THREE.Mesh(colliderGeo, colliderMat);
  colliderMesh.name = 'RoseCollider';
  roseGroup.add(colliderMesh);

  const rim = new THREE.PointLight(0xff4d6d, 1.2, 5.0);
  rim.position.set(0.3, 1.0, 0.2);
  roseGroup.add(rim);

  const fill = new THREE.PointLight(0xff8fa3, 0.6, 4.0);
  fill.position.set(-0.2, 0.8, -0.15);
  roseGroup.add(fill);

  roseGroup.position.copy(CONFIG.rosePosition);

  const baseHeight = 0.95;
  const scale = CONFIG.roseHeight / baseHeight;
  roseGroup.scale.setScalar(scale);

  const roseSpot = new THREE.SpotLight(0xff6b8a, 2.0, 18, Math.PI / 6, 0.35, 1);
  roseSpot.position.copy(sunDirection).multiplyScalar(10).add(new THREE.Vector3(0, 4.0, 0));
  roseSpot.target = roseGroup;
  scene.add(roseSpot);
  scene.add(roseSpot.target);

  scene.add(roseGroup);

  const baseRot = roseGroup.rotation.clone();
  const baseScale = roseGroup.scale.clone();

  function animateRose(t) {
    const sway = Math.sin(t * 0.85) * 0.055;
    const swayZ = Math.cos(t * 0.65) * 0.028;
    roseGroup.rotation.y = baseRot.y + sway;
    roseGroup.rotation.z = baseRot.z + swayZ;

    const breath = 1.0 + Math.sin(t * 1.1) * 0.015;
    roseGroup.scale.set(
      baseScale.x * breath,
      baseScale.y * (1.0 + Math.sin(t * 1.1 + 1.2) * 0.012),
      baseScale.z * breath
    );
  }

  return { group: roseGroup, stemMesh, leavesMesh, petalsMesh, colliderMesh, animateRose };
}

function createRealRoseStemMesh(stemMat) {
  const height = 0.65;

  // Realistic bend (subtle S curve)
  const p0 = new THREE.Vector3(0, 0.00, 0);
  const p1 = new THREE.Vector3(0.06, height * 0.33, 0.02);
  const p2 = new THREE.Vector3(-0.05, height * 0.66, -0.02);
  const p3 = new THREE.Vector3(0.02, height * 1.00, 0.01);

  const curve = new THREE.CatmullRomCurve3([p0, p1, p2, p3]);

  // Create tube (we’ll taper it manually)
  const tubularSegments = 120;
  const radialSegments = 14;

  const geo = new THREE.TubeGeometry(curve, tubularSegments, 1, radialSegments, false);

  // Taper: thicker at bottom, thinner at top
  const rBase = 0.052;
  const rTop  = 0.028;

  const pos = geo.attributes.position;
  const ringSize = radialSegments + 1;
  const frames = curve.computeFrenetFrames(tubularSegments, false);

  const tmp = new THREE.Vector3();
  const c = new THREE.Vector3();

  for (let i = 0; i <= tubularSegments; i++) {
    const t = i / tubularSegments;
    const r = THREE.MathUtils.lerp(rBase, rTop, t);

    c.copy(curve.getPointAt(t));
    const n = frames.normals[i];
    const b = frames.binormals[i];

    for (let j = 0; j < ringSize; j++) {
      const idx = i * ringSize + j;

      tmp.fromBufferAttribute(pos, idx).sub(c);

      // Rebuild offset in normal/binormal plane and set its length to r
      const offN = tmp.dot(n);
      const offB = tmp.dot(b);

      const rebuilt = new THREE.Vector3()
        .addScaledVector(n, offN)
        .addScaledVector(b, offB);

      // if numerical issues happen
      if (rebuilt.lengthSq() < 1e-8) rebuilt.copy(n).multiplyScalar(r);
      else rebuilt.setLength(r);

      const finalPos = new THREE.Vector3().copy(c).add(rebuilt);
      pos.setXYZ(idx, finalPos.x, finalPos.y, finalPos.z);
    }
  }

  geo.computeVertexNormals();

  const mesh = new THREE.Mesh(geo, stemMat);
  mesh.userData.curve = curve;
  mesh.userData.radiusAt = (t) => THREE.MathUtils.lerp(rBase, rTop, t);

  return mesh;
}

function addThornsToStem(roseGroup, stemMesh, thornMat) {
  const curve = stemMesh.userData.curve;
  const radiusAt = stemMesh.userData.radiusAt;

  const thornCount = 9;

  const thornGeo = new THREE.ConeGeometry(0.012, 0.055, 10, 1);
  thornGeo.rotateX(Math.PI / 2);         // point along +Z
  thornGeo.translate(0, 0, 0.03);        // move tip outward

  for (let i = 0; i < thornCount; i++) {
    const u = i / (thornCount - 1);
    const t = THREE.MathUtils.lerp(0.18, 0.74, u);

    const p = curve.getPointAt(t);
    const tangent = curve.getTangentAt(t).normalize();

    // stable basis around tangent
    let up = new THREE.Vector3(0, 1, 0);
    if (Math.abs(tangent.dot(up)) > 0.9) up = new THREE.Vector3(1, 0, 0);

    const normal = new THREE.Vector3().crossVectors(tangent, up).normalize();
    const binormal = new THREE.Vector3().crossVectors(normal, tangent).normalize();

    // spiral around stem for natural distribution
    const angle = u * Math.PI * 2 * 1.8 + i * 0.45;
    const outward = new THREE.Vector3()
      .addScaledVector(normal, Math.cos(angle))
      .addScaledVector(binormal, Math.sin(angle))
      .normalize();

    const r = radiusAt(t) * 0.98;
    const thornPos = new THREE.Vector3().copy(p).addScaledVector(outward, r);

    const thorn = new THREE.Mesh(thornGeo, thornMat);
    thorn.position.copy(thornPos);

    // point outward
    thorn.lookAt(new THREE.Vector3().copy(thornPos).add(outward));

    // tiny randomness for realism
    thorn.rotateZ((Math.random() - 0.5) * 0.25);
    thorn.rotateY((Math.random() - 0.5) * 0.18);

    roseGroup.add(thorn);
  }
}

function buildRealisticRosePetalsGeometry() {
  // Helper: positive modulo (JS % keeps sign, which causes spikes for negative theta)
  const mod = (n, m) => ((n % m) + m) % m;

  const nu = 28;      // radial divisions
  const nv = 320;     // angular divisions (576 is heavy and amplifies artifacts)
  const positions = new Float32Array(nu * nv * 3);
  const indices = new Uint32Array((nu - 1) * (nv - 1) * 6);

  const TWO_PI = Math.PI * 2;

  let v = 0;
  for (let i = 0; i < nu; i++) {
    const x = i / (nu - 1);

    for (let j = 0; j < nv; j++) {
      // Keep your same theta span, but computed cleanly
      const theta = -TWO_PI + (j / (nv - 1)) * (17 * Math.PI);

      const phi = (Math.PI / 2) * Math.exp(-theta / (8 * Math.PI));

      // FIX: safe modulo so the term is consistent for negative theta
      const t = mod(3.6 * theta, TWO_PI) / Math.PI; // 0..2
      const inner = 1 - (t);                        // similar structure to your original

      // Original shape term, but stabilized
      let X =
        1 - 0.5 * Math.pow(
          (5 / 4) * (1 - Math.pow(inner, 2)) - 0.25,
          2
        );

      // Clamp X so it can't create runaway geometry
      X = THREE.MathUtils.clamp(X, 0.05, 1.35);

      const y = 1.95653 * (x ** 2) * ((1.27689 * x - 1) ** 2) * Math.sin(phi);

      let r = X * (x * Math.sin(phi) + y * Math.cos(phi));
      let h = X * (x * Math.cos(phi) - y * Math.sin(phi));

      // Avoid degeneracy on the axis (r ~ 0 creates long skinny triangles)
      const eps = 0.002;
      if (!Number.isFinite(r) || !Number.isFinite(h)) {
        r = eps;
        h = 0;
      } else if (r < eps) {
        r = eps;
      }

      // Size + placement tuning
      const scale = 0.30;
      r *= scale;
      h *= scale;

      const px = r * Math.sin(theta);
      const py = h + 0.62; // aligns closer to stem top (stem top is ~0.65)
      const pz = r * Math.cos(theta);

      const base = v * 3;
      positions[base] = px;
      positions[base + 1] = py;
      positions[base + 2] = pz;

      v++;
    }
  }

  // Indices (two triangles per quad)
  let k = 0;
  for (let i = 0; i < nu - 1; i++) {
    for (let j = 0; j < nv - 1; j++) {
      const a = i * nv + j;
      const b = (i + 1) * nv + j;
      const c = (i + 1) * nv + (j + 1);
      const d = i * nv + (j + 1);

      indices[k++] = a; indices[k++] = b; indices[k++] = d;
      indices[k++] = b; indices[k++] = c; indices[k++] = d;
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geo.setIndex(new THREE.BufferAttribute(indices, 1));
  geo.computeVertexNormals();
  geo.computeBoundingSphere();

  return geo;
}

// --------------------
// Interaction
// --------------------
function setupInteraction() {
  renderer.domElement.addEventListener('pointerdown', onPointerDown, { passive: true });
}

function onPointerDown(e) {
  const now = performance.now();
  if (now - lastTapTime < CONFIG.tapCooldownMs) return;
  lastTapTime = now;

  const rect = renderer.domElement.getBoundingClientRect();
  const x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  const y = -(((e.clientY - rect.top) / rect.height) * 2 - 1);
  pointerNDC.set(x, y);

  raycaster.setFromCamera(pointerNDC, camera);

  const hits = raycaster.intersectObject(rose.colliderMesh, false);
  if (hits.length) onRoseTapped();
}

function onRoseTapped() {
  if (triggered) return;
  triggered = true;

  hintEl?.classList?.add('hide');
  cardEl?.classList?.add('show');

  playChime();
}

// --------------------
// UI Buttons
// --------------------
function setupButtons() {
  yesBtn?.addEventListener('click', () => {
    const title = cardEl?.querySelector?.('.title');
    if (title) title.textContent = 'Wujuuuuuuu!! 💖🌹';
    if (noBtn) noBtn.style.display = 'none';
    if (yesBtn) yesBtn.textContent = 'Te amoooooo 💖😭';
  });

  noBtn?.addEventListener('pointerenter', () => {
    const x = (Math.random() - 0.5) * 220;
    const y = (Math.random() - 0.5) * 120;
    noBtn.style.transform = `translate(${x}px, ${y}px)`;
  });
}

// --------------------
// Audio
// --------------------
function playChime() {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    const ctx = new AudioCtx();

    const o = ctx.createOscillator();
    const g = ctx.createGain();

    o.type = 'sine';
    o.frequency.setValueAtTime(880, ctx.currentTime);
    o.frequency.exponentialRampToValueAtTime(1320, ctx.currentTime + 0.08);
    o.frequency.exponentialRampToValueAtTime(660, ctx.currentTime + 0.22);

    g.gain.setValueAtTime(0.0001, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.10, ctx.currentTime + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.28);

    o.connect(g).connect(ctx.destination);
    o.start();
    o.stop(ctx.currentTime + 0.3);
    o.onended = () => ctx.close();
  } catch {}
}

// --------------------
// Animate
// --------------------
function animate() {
  requestAnimationFrame(animate);
  const delta = clock.getDelta();
  const t = clock.getElapsedTime();
  
  if (CONFIG.enableWind && flowerField) {
    flowerField.updateWind(t);
  }

  if (rose) {
    rose.animateRose(t);
  }

  if (fallingHearts) {
    fallingHearts.update(delta, t);
  }

  if (!controls) camera.lookAt(CONFIG.lookAt);
  if (controls) controls.update();

  renderer.render(scene, camera);
}

// --------------------
// Helpers
// --------------------
function lerp(a, b, t) { return a + (b - a) * t; }
function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }
function easeOutBack(t) {
  const c1 = 1.70158, c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}

function isMobile() {
  return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
}

function hasWebGL() {
  try {
    const canvas = document.createElement('canvas');
    const gl2 = canvas.getContext('webgl2');
    const gl1 = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
    return !!(gl2 || gl1);
  } catch {
    return false;
  }
}

function ensureOverlayElements() {
  const overlay = document.getElementById('overlay') || (() => {
    const d = document.createElement('div');
    d.id = 'overlay';
    document.body.appendChild(d);
    return d;
  })();

  if (!document.getElementById('hint')) {
    const hint = document.createElement('div');
    hint.id = 'hint';
    hint.textContent = 'Mi Rosa 🌹';
    overlay.appendChild(hint);
  }

  if (!document.getElementById('card')) {
    const card = document.createElement('div');
    card.id = 'card';
    card.innerHTML = `
      <div class="title">Will you be my valentine?</div>
      <div class="actions">
        <button id="yes" type="button">Si 💖</button>
        <button id="no" type="button">No 🙈</button>
      </div>`;
    overlay.appendChild(card);
  }

  if (!document.getElementById('fallback')) {
    const fb = document.createElement('div');
    fb.id = 'fallback';
    fb.textContent = 'Your browser doesn\'t support WebGL. Will you be my valentine? 💖';
    overlay.appendChild(fb);
  }
}