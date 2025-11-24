import * as THREE from 'three';
import { GUI } from 'dat.gui';

// --- Configuration ---
const CONFIG = {
  particleCount: 400000, // Number of rays simulated per frame (approx)
  sunElevation: 12, // degrees
  sunAzimuth: 0,
  camElevation: 0, // 90 = Looking at Zenith, 0 = Looking at Horizon
  
  // Crystal Populations (Toggles)
  enableRandom: false,
  enablePlate: true,
  enableColumn: false,
  enableParry: false,
  
  crystalTilt: 20, // degrees, variance from ideal orientation
  ior: 1.31,
  exposure: 0.0158, // 10^-1.8
  fadeFactor: 0.05, // 1/10 of 0.5 range
  saturation: 1.2, // Default slight bump
  lockSunCenter: false, // New Toggle: Keep Sun Centered
  lockZoom: false, // New Toggle: Maintain Halo Size
  zoom: 1.0, // Field of View Zoom
  
  // Spring Physics for Sliders
  enableSprings: true, // Toggle smooth slider movement
  
  preset: 'Eye 1'
};

// --- Smooth Interpolation State ---
const targetState = { ...CONFIG }; // Stores the slider target values
const currentState = { ...CONFIG }; // Stores the actual simulation values
const springVelocity = {}; // Stores velocity for each property

// Initialize velocity to 0
Object.keys(CONFIG).forEach(k => springVelocity[k] = 0);

// Spring constants
const SPRING_STIFFNESS = 0.03;
const SPRING_DAMPING = 0.4;
const SPRING_SNAP_THRESHOLD = 0.0001;

// --- Presets ---
const PRESETS = {
    "Eye 1": {
        particleCount: 100000,
        sunElevation: 25,
        camElevation: 25,
        lockSunCenter: true,
        zoom: 3.6,
        enablePlate: true,
        enableColumn: true,
        enableParry: true,
        enableRandom: true,
        crystalTilt: 1,
        ior: 1.1,
        exposure: 0.0079, // 10^-2.1
        fadeFactor: 0.059,
        saturation: 2.8
    },
    "Eye Cycle 1": {
        particleCount: 100000,
        sunElevation: 90,
        camElevation: 90,
        lockSunCenter: true,
        enablePlate: true,
        enableColumn: true,
        enableParry: true,
        enableRandom: true,
        crystalTilt: 1,
        ior: 1.1,
        exposure: 0.0079, // 10^-2.1
        fadeFactor: 0.059,
        saturation: 2.8,
        zoom: 2.9
    },
    "Display 1": {
        particleCount: 100000,
        sunElevation: -14,
        camElevation: -14,
        lockSunCenter: true,
        enablePlate: true,
        enableColumn: true,
        enableParry: true,
        enableRandom: false,
        crystalTilt: 2.34,
        ior: 1.11,
        exposure: 0.00079, // 10^-3.1
        fadeFactor: 0.059,
        saturation: 3.0,
        zoom: 3.2
    },
    "Tunnel 1": {
        particleCount: 100000,
        sunElevation: -57,
        camElevation: -57,
        lockSunCenter: true,
        enablePlate: true,
        enableColumn: true,
        enableParry: true,
        enableRandom: false,
        crystalTilt: 2.83,
        ior: 1.3,
        exposure: 0.0158, // 10^-1.8
        fadeFactor: 0.037,
        saturation: 2.8
    },
    "Tunnel 2": {
        particleCount: 100000,
        sunElevation: -46,
        camElevation: -46,
        lockSunCenter: true,
        enablePlate: false,
        enableColumn: true,
        enableParry: true,
        enableRandom: false,
        crystalTilt: 2.83,
        ior: 1.22,
        exposure: 0.1, // 10^-1.0
        fadeFactor: 0.156,
        saturation: 2.2,
        zoom: 1.0
    },
    "Preset 1": {
        particleCount: 100000,
        sunElevation: 0,
        camElevation: 0,
        lockSunCenter: true,
        zoom: 5,
        enablePlate: true,
        enableColumn: true,
        enableParry: true,
        enableRandom: true,
        crystalTilt: 25.27,
        ior: 1.04,
        exposure: 0.00001995, // 10^-4.7
        fadeFactor: 0.037,
        saturation: 2.8
    },
    "Preset 2": {
        particleCount: 100000,
        sunElevation: 31,
        camElevation: 31,
        lockSunCenter: true,
        zoom: 1.7,
        enablePlate: true,
        enableColumn: true,
        enableParry: true,
        enableRandom: false,
        crystalTilt: 2.83,
        ior: 1.3,
        exposure: 0.0158, // 10^-1.8
        fadeFactor: 0.037,
        saturation: 2.8
    },
    "Preset 3": {
        particleCount: 100000,
        sunElevation: 31,
        camElevation: 31,
        lockSunCenter: true,
        zoom: 1.1,
        enablePlate: true,
        enableColumn: true,
        enableParry: true,
        enableRandom: false,
        crystalTilt: 4.29,
        ior: 1.5,
        exposure: 0.0158, // 10^-1.8
        fadeFactor: 0.016,
        saturation: 2.8
    },
    "Preset 4": {
        particleCount: 100000,
        sunElevation: -12,
        camElevation: -12,
        lockSunCenter: true,
        zoom: 1.8,
        enablePlate: true,
        enableColumn: true,
        enableParry: true,
        enableRandom: false,
        crystalTilt: 0.88,
        ior: 1.37,
        exposure: 0.0158, // 10^-1.8
        fadeFactor: 0.01,
        saturation: 3
    },
    "Preset 5": {
        particleCount: 100000,
        sunElevation: -16.87,
        camElevation: -16.87,
        lockSunCenter: true,
        zoom: 5,
        enablePlate: true,
        enableColumn: true,
        enableParry: true,
        enableRandom: false,
        crystalTilt: 0,
        ior: 1.03,
        exposure: 0.000794, // 10^-3.1
        fadeFactor: 0.059,
        saturation: 3
    },
    "Preset 6": {
        particleCount: 100000,
        sunElevation: -38,
        camElevation: -38,
        lockSunCenter: true,
        zoom: 1,
        enablePlate: true,
        enableColumn: false,
        enableParry: false,
        enableRandom: false,
        crystalTilt: 0.88,
        ior: 1.28,
        exposure: 0.0025, // 10^-2.6
        fadeFactor: 0.01,
        saturation: 2.8
    },
    "Preset 7": {
        particleCount: 100000,
        sunElevation: 25,
        camElevation: 25,
        lockSunCenter: true,
        zoom: 5,
        enablePlate: true,
        enableColumn: true,
        enableParry: true,
        enableRandom: true,
        crystalTilt: 2.22,
        ior: 1.04,
        exposure: 0.0079, // 10^-2.1
        fadeFactor: 0.275,
        saturation: 2.8
    }
};

const CRYSTAL_TYPES = {
  'Random': 0,
  'Plate': 1,
  'Column': 2,
  'Parry': 3
};

// --- Scene Setup ---
const scene = new THREE.Scene();
const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
// Use devicePixelRatio for Retina resolution
const renderer = new THREE.WebGLRenderer({ 
    antialias: false, 
    alpha: false, // No alpha needed for HDR
    preserveDrawingBuffer: false, // We use our own target
    powerPreference: "high-performance",
    precision: "highp"
});
renderer.setPixelRatio(window.devicePixelRatio); 
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.autoClear = false; // Handle manually
document.body.appendChild(renderer.domElement);

// --- HDR Accumulation Setup ---
// 1. Float32 Render Target (Accumulation Buffer)
const accumTarget = new THREE.WebGLRenderTarget(
    window.innerWidth * window.devicePixelRatio, 
    window.innerHeight * window.devicePixelRatio, 
    {
        type: THREE.FloatType, // 32-bit Float for HDR
        format: THREE.RGBAFormat,
        minFilter: THREE.NearestFilter,
        magFilter: THREE.NearestFilter,
        generateMipmaps: false
    }
);

// 2. Screen Output Quad (Tone Mapping)
const screenCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
const screenScene = new THREE.Scene();
const screenMaterial = new THREE.ShaderMaterial({
    uniforms: {
        tDiffuse: { value: accumTarget.texture },
        uExposure: { value: 1.0 },
        uSaturation: { value: 1.0 }
    },
    vertexShader: `
        varying vec2 vUv;
        void main() {
            vUv = uv;
            gl_Position = vec4(position, 1.0);
        }
    `,
    fragmentShader: `
        uniform sampler2D tDiffuse;
        uniform float uExposure;
        uniform float uSaturation;
        varying vec2 vUv;
        
        // Saturation helper
        vec3 adjustSaturation(vec3 color, float saturation) {
            float gray = dot(color, vec3(0.299, 0.587, 0.114));
            return mix(vec3(gray), color, saturation);
        }
        
        void main() {
            vec4 tex = texture2D(tDiffuse, vUv);
            vec3 color = tex.rgb;
            
            // Saturation (Linear Space)
            color = adjustSaturation(color, uSaturation);
            
            // Gamma Correction (2.2)
            color = pow(color, vec3(1.0 / 2.2));
            
            gl_FragColor = vec4(color, 1.0);
        }
    `
});
const screenQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), screenMaterial);
screenScene.add(screenQuad);

// Fade Plane (Now renders into accumTarget)
const fadeMaterial = new THREE.MeshBasicMaterial({
    color: 0x000000,
    transparent: true,
    opacity: 0.0,
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.ZeroFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor // Multiplicative fade (Float precision!)
});
const fadePlane = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), fadeMaterial);
const fadeScene = new THREE.Scene();
const fadeCamera = new THREE.Camera(); 
fadeScene.add(fadePlane);

// --- Geometry (Points) ---
const geometry = new THREE.BufferGeometry();
// Use simpler standard geometry for debug test if needed, but Buffer is better for particles
const indices = new Float32Array(CONFIG.particleCount);
for (let i = 0; i < CONFIG.particleCount; i++) {
  indices[i] = i;
}
geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(CONFIG.particleCount * 3), 3)); // Dummy pos
geometry.setAttribute('aIndex', new THREE.BufferAttribute(indices, 1));

// --- Shader ---
const vertexShader = `
precision highp float;

attribute float aIndex;

uniform float uTime;
uniform vec2 uResolution;
uniform vec3 uSunPos;
uniform float uCamElevation; // degrees
uniform float uZoom; // FOV zoom factor
uniform vec4 uTypeWeights; // Cumulative probabilities: x=Random, y=Plate, z=Column, w=Parry
uniform float uTiltVariance; // Radians
uniform float uIOR;
uniform float uAspect; // Crystal aspect ratio (width/length)

varying vec3 vColor;
varying float vSeed;

// Constants
const float PI = 3.14159265359;
const float TWO_PI = 6.28318530718;

// --- Random Utils ---
// Gold Noise or simple hash
float hash11(float p) {
    p = fract(p * .1031);
    p *= p + 33.33;
    p *= p + p;
    return fract(p);
}

vec2 hash21(float p) {
	vec3 p3 = fract(vec3(p) * vec3(.1031, .1030, .0973));
	p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.xx+p3.yz)*p3.zy);
}

vec3 hash31(float p) {
   vec3 p3 = fract(vec3(p) * vec3(.1031, .1030, .0973));
   p3 += dot(p3, p3.yzx+33.33);
   return fract((p3.xxy+p3.yzz)*p3.zyx);
}

// --- Geometry Math ---

// Generate a random rotation matrix
mat3 randomRotation(float seed) {
    vec3 r = hash31(seed);
    float theta = r.x * TWO_PI;
    float phi = acos(2.0 * r.y - 1.0);
    float roll = r.z * TWO_PI;
    
    // Euler angles or Axis-Angle?
    // Let's use a uniform sphere point for the axis, and random angle?
    // Actually, standard uniform rotation matrix generation:
    // Method by Arvo (1992)
    float z = r.x; 
    float R = sqrt(r.y); 
    float phi2 = TWO_PI * r.z;
    
    // This assumes we want completely random orientation.
    // We will modify this for specific crystal habits.
    return mat3(1.0); // Placeholder, overridden below
}

mat3 angleAxis(float angle, vec3 axis) {
    float s = sin(angle);
    float c = cos(angle);
    float oc = 1.0 - c;
    return mat3(
        oc * axis.x * axis.x + c,           oc * axis.x * axis.y - axis.z * s,  oc * axis.z * axis.x + axis.y * s,
        oc * axis.x * axis.y + axis.z * s,  oc * axis.y * axis.y + c,           oc * axis.y * axis.z - axis.x * s,
        oc * axis.z * axis.x - axis.y * s,  oc * axis.y * axis.z + axis.x * s,  oc * axis.z * axis.z + c
    );
}

mat3 getCrystalOrientation(float seed) {
    vec3 h = hash31(seed);
    mat3 rot = mat3(1.0);
    
    // Determine Crystal Type for this ray based on weights
    // uTypeWeights is cumulative: 
    // if rnd < x -> Type 0 (Random)
    // else if rnd < y -> Type 1 (Plate)
    // else if rnd < z -> Type 2 (Column)
    // else -> Type 3 (Parry)
    
    float rndType = hash11(seed + 999.9);
    int type = 3;
    if (rndType < uTypeWeights.x) type = 0;
    else if (rndType < uTypeWeights.y) type = 1;
    else if (rndType < uTypeWeights.z) type = 2;
    
    if (type == 0) { // Random (3D Uniform)
        // Standard uniform rotation
        float u1 = h.x;
        float u2 = h.y;
        float u3 = h.z;
        float qw = sqrt(1.0 - u1) * sin(TWO_PI * u2);
        float qx = sqrt(1.0 - u1) * cos(TWO_PI * u2);
        float qy = sqrt(u1) * sin(TWO_PI * u3);
        float qz = sqrt(u1) * cos(TWO_PI * u3);
        
        // Quat to Mat3
        float n = 1.0 / sqrt(qw*qw + qx*qx + qy*qy + qz*qz);
        qw *= n; qx *= n; qy *= n; qz *= n;
        
        rot = mat3(
            1.0 - 2.0*qy*qy - 2.0*qz*qz, 2.0*qx*qy - 2.0*qz*qw,       2.0*qx*qz + 2.0*qy*qw,
            2.0*qx*qy + 2.0*qz*qw,       1.0 - 2.0*qx*qx - 2.0*qz*qz, 2.0*qy*qz - 2.0*qx*qw,
            2.0*qx*qz - 2.0*qy*qw,       2.0*qy*qz + 2.0*qx*qw,       1.0 - 2.0*qx*qx - 2.0*qy*qy
        );

    } else if (type == 1) { // Plate (C-axis vertical)
        // Main axis (C-axis) is Y (0,1,0) in local space.
        // In world space, we want it to be (0,1,0) (Up).
        // So we just rotate around Y for azimuth (random).
        // And apply a small "wobble" (tilt) to the C-axis.
        
        float azimuth = h.x * TWO_PI;
        // Tilt: Gaussian-ish distribution around 0
        // Box-Muller transform for normal distribution?
        // Or just uniform for simplicity first.
        float tiltScale = uTiltVariance; 
        
        // Uniform distribution:
        // float tilt = (h.y * 2.0 - 1.0) * tiltScale; 
        
        // Gaussian Approximation (Box-Muller)
        // u1 = h.y, u2 = h.z (we need two random numbers)
        // We used h.z for tiltDir. Let's re-use h.y and h.z carefully.
        // Let's grab a new hash for Gaussian.
        vec2 hG = hash21(seed + 55.12);
        float r = sqrt(-2.0 * log(hG.x + 0.0001)); // Radius
        float theta = TWO_PI * hG.y; // Angle
        float gaussian = r * cos(theta); // Standard Normal Dist (mean=0, sigma=1)
        
        // Apply tilt scale (sigma)
        float tilt = gaussian * tiltScale;
        
        float tiltDir = h.z * TWO_PI;
        
        mat3 rotAzimuth = angleAxis(azimuth, vec3(0.0, 1.0, 0.0));
        mat3 rotTilt = angleAxis(tilt, vec3(cos(tiltDir), 0.0, sin(tiltDir)));
        
        rot = rotTilt * rotAzimuth;

    } else if (type == 2 || type == 3) { // Column or Parry (C-axis horizontal)
        // C-axis is Y in local space. 
        // We want C-axis to be Horizontal in world space.
        // So rotate local Y to some random horizontal vector.
        
        // 1. Random horizontal direction for the C-axis
        float axisAzimuth = h.x * TWO_PI;
        vec3 worldC = vec3(cos(axisAzimuth), 0.0, sin(axisAzimuth));
        
        // 2. Rotate around this C-axis (spin)
        float spin = h.y * TWO_PI; // Default random spin for Column
        
        // Parry adjustment: Constrained spin.
        // Parry crystals have a pair of prism faces horizontal.
        // Prism faces are at angles 0, 60, 120...
        // We want Face normal to be Up (0,1,0).
        // In local space, Face 1 normal is (0,1,0). But Face 1 is Basal (End cap).
        // Wait, our geometry: Face 1,2 are Basal (Top/Bottom). Face 3-8 are Prism.
        // Prism faces normals are in XZ plane.
        // We aligned C-axis (Y) to World Horizontal.
        // So Prism faces rotate around World Horizontal.
        // We want one Prism face to be UP.
        
        if (type == 3) { // Parry
             // Gaussian wobble around spin 0 (or whatever aligns a face up)
             vec2 hP = hash21(seed + 33.44);
             float rP = sqrt(-2.0 * log(hP.x + 0.0001));
             float gP = rP * cos(TWO_PI * hP.y);
             // Constrain spin to be near 0 (assuming that aligns a face)
             // Or we might need to offset by 30 deg depending on mesh definition.
             // Let's assume 0 aligns a face.
             spin = gP * uTiltVariance; 
        }
        
        // 3. Tilt (wobble the C-axis out of horizontal plane)
        // Use Gaussian distribution
        vec2 hG = hash21(seed + 99.76);
        float r = sqrt(-2.0 * log(hG.x + 0.0001));
        float gaussian = r * cos(TWO_PI * hG.y);
        
        float tilt = gaussian * uTiltVariance;
        
        // Tilt axis is perpendicular to worldC in horizontal plane
        vec3 tiltAxis = vec3(-worldC.z, 0.0, worldC.x);
        
        // Construct rotation:
        // We need a transform that maps Local Y (0,1,0) to World C (with tilt).
        
        // Let's build it from scratch.
        // Local Y -> aligned with World C.
        // Start with Identity. C-axis is Y.
        // Rotate Z by 90 deg to make Y horizontal? 
        mat3 preRot = angleAxis(PI * 0.5, vec3(0.0, 0.0, 1.0)); // Y becomes -X
        // Now local axis is X.
        
        // Let's keep it simple.
        // Local Frame: Y is C-axis.
        // Target World Frame: Y' is roughly horizontal.
        
        // Rotate around World Up (Y) by random azimuth -> C-axis is still Y (vertical). Wrong.
        // Rotate around X by 90 -> C-axis is Z (horizontal). 
        mat3 toHorizontal = angleAxis(PI * 0.5, vec3(1.0, 0.0, 0.0)); 
        
        // Spin around the C-axis (now Z)
        mat3 spinRot = angleAxis(spin, vec3(0.0, 0.0, 1.0));
        
        // Azimuth of the C-axis in world
        mat3 azRot = angleAxis(axisAzimuth, vec3(0.0, 1.0, 0.0));
        
        // Tilt the C-axis
        mat3 tiltRot = angleAxis(tilt, tiltAxis); // This is approximate
        
        rot = tiltRot * azRot * spinRot * toHorizontal;
    }
    
    // Crystal Aspect Ratio:
    // Plates: Aspect < 1 (e.g. 0.2)
    // Columns: Aspect > 1 (e.g. 2.0)
    // Random: usually compact (1.0)
    // We have a problem: uAspect is a single uniform, but we have mixed populations.
    // Ideally we calculate aspect in shader based on type.
    float aspect = 1.0;
    if (type == 1) aspect = 0.2; // Plate
    else if (type == 2 || type == 3) aspect = 2.0; // Column/Parry
    else aspect = 1.0; // Random
    
    // Length = uAspect * 2.0 ... wait, we need to use this local 'aspect' instead of uniform
    // But the intersection logic is later in main().
    // We need to output aspect? Or move intersection logic into a function?
    // Or just assume one global aspect for now?
    // User might want "Plates are flat" and "Columns are long" simultaneously.
    // Let's assume uAspect is override, or we use hardcoded defaults based on type?
    // Let's use the calculated 'aspect' and pass it out or use a varying?
    // Cannot pass varying from helper function.
    // Let's just stick to uniform for now to save complexity, or hacked "average".
    // Actually, we can derive aspect from type in main().
    
    return rot;
}


// --- Ray Tracing ---

// Hexagon Normals (in local space, C-axis = Y)
// Face 1, 2: Top/Bottom (0, 1, 0), (0, -1, 0)
// Face 3-8: Prism faces. Normal is (cos(t), 0, sin(t)) for t = 0, 60, 120...

vec3 getFaceNormal(int faceIdx) {
    if (faceIdx == 1) return vec3(0.0, 1.0, 0.0);
    if (faceIdx == 2) return vec3(0.0, -1.0, 0.0);
    
    float angle = float(faceIdx - 3) * (PI / 3.0);
    return vec3(sin(angle), 0.0, cos(angle)); // Indicies 3,4,5,6,7,8
}

// Intersect ray with infinite plane defined by normal and distance
// Hexagon prism is centered at 0.
// Distance to prism faces is w (width/2). Distance to basal faces is h (length/2).
// Let's assume unit width (dist = 1) and aspect ratio controls height.
float intersectPlane(vec3 ro, vec3 rd, vec3 n, float d) {
    float denom = dot(n, rd);
    if (abs(denom) < 1e-6) return -1.0;
    float t = (d - dot(n, ro)) / denom;
    return t;
}

// We need to pick a random entry point on the crystal.
// This is simplified. We pick a face based on projected area?
// Or just iterate faces, find max projected area, pick random point?
//
// GPU SIMPLIFICATION:
// We are just calculating deviation. The position of entry doesn't change the deviation 
// for a convex shape with parallel opposing faces (like a prism) IF the ray goes through.
// It only affects *whether* it goes through (geometric cross section).
//
// So, we can pick a random face 'i' with probability P_i ~ max(0, dot(N_i, -LightDir)).
// This ensures we sample the effective aperture correctly.

// Spectral Colors
// Improved spectral approximation (Broad overlap for intermediate colors)
vec3 spectralColor(float lambda) { // lambda in nm [400, 700]
    
    // Broaden the curves significantly for better overlap (Yellows, Cyans)
    // Sigma = 80.0 ensures strong mixing between channels
    float r = exp(-0.5 * pow((lambda - 600.0) / 80.0, 2.0)); // Broad Red
    float g = exp(-0.5 * pow((lambda - 535.0) / 80.0, 2.0)); // Broad Green
    float b = exp(-0.5 * pow((lambda - 460.0) / 80.0, 2.0)); // Broad Blue
    
    // Add secondary lobes for violet/red tails
    r += 0.2 * exp(-0.5 * pow((lambda - 700.0) / 50.0, 2.0));
    b += 0.2 * exp(-0.5 * pow((lambda - 400.0) / 50.0, 2.0));
    
    return vec3(r, g, b);
}

// Ice IOR (Cauchy)
// n = A + B / lambda^2
// Ice: n_avg = 1.31.
// Let's approx: n(400) = 1.318, n(700) = 1.306
float getIOR(float lambda) {
    // Linear approx is prob fine for this visual
    // Scale by uIOR relative to 1.31
    float base = mix(1.318, 1.306, (lambda - 400.0) / 300.0);
    return base * (uIOR / 1.31);
}

void main() {
    // Initialize random seed per vertex per frame
    float seed = aIndex + uTime * 71.2341;

    // Spectral Dispersion
    float rndLambda = hash11(seed + 123.45);
    float lambda = 400.0 + rndLambda * 300.0;
    vec3 rayColor = spectralColor(lambda);
    float ior = getIOR(lambda);
    
    // 1. Crystal Orientation
    mat3 rot = getCrystalOrientation(seed);
    mat3 invRot = transpose(rot); // For rotation matrices, inverse = transpose
    
    // Redetermine type for aspect ratio (duplicate logic, optimized out by compiler hopefully)
    float rndType = hash11(seed + 999.9);
    int type = 3;
    if (rndType < uTypeWeights.x) type = 0;
    else if (rndType < uTypeWeights.y) type = 1;
    else if (rndType < uTypeWeights.z) type = 2;
    
    float localAspect = uAspect;
    if (type == 1) localAspect = 0.2;
    else if (type == 2 || type == 3) localAspect = 2.0;
    else localAspect = 1.0;
    
    // 2. Ray Direction (Sun -> Crystal)
    // Sun is at infinity, so all rays are parallel to uSunPos
    // We work in Local Crystal Space.
    vec3 rayDirWorld = normalize(-uSunPos); // Incoming light direction
    
    vec3 rayDir = invRot * rayDirWorld; // In local space
    
    // 3. Select Entry Face
    // Calculate projected areas of all 8 faces
    // Area of Prism face: Width * Height. Let's say Width=1. Height=Aspect. Area=Aspect.
    // Area of Basal face: Hexagon area. Side=width/sqrt(3)? Let's set apothem=1.
    // Distance to prism face = 1. Side length s = 2*tan(30) = 1.15.
    // Basal Area = 3*sqrt(3)/2 * s^2 ?? 
    // Let's normalize dimensions: distance to prism face = 1.
    // Prism Face Area (Rect) = Side * Length. Side = 2*tan(30deg)*1 = 1.1547.
    // Length = uAspect * 2.0 (since uAspect is usually L/D).
    // Basal Face Area (Hex) = 2 * sqrt(3) * 1^2 = 3.464.
    
    float s = 1.1547;
    float L = localAspect * 2.0; 
    float areaPrism = s * L;
    float areaBasal = 3.464; 
    
    // Compute dot products for all 8 faces to see which are illuminated
    float weights[8];
    float totalWeight = 0.0;
    
    for (int i=1; i<=8; i++) {
        vec3 n = getFaceNormal(i);
        float proj = dot(n, -rayDir); // Must be facing the ray
        float w = max(0.0, proj);
        if (i <= 2) w *= areaBasal;
        else w *= areaPrism;
        
        weights[i-1] = w;
        totalWeight += w;
    }
    
    // Pick face based on weight
    float rnd = hash11(seed + 0.321) * totalWeight;
    int entryFace = 0;
    float accum = 0.0;
    vec3 n1 = vec3(0.0);
    
    for (int i=0; i<8; i++) {
        accum += weights[i];
        if (rnd <= accum) {
            entryFace = i + 1;
            n1 = getFaceNormal(entryFace);
            break;
        }
    }
    
    // If totalWeight is 0 (impossible unless sun inside?), discard
    if (totalWeight <= 0.0) {
        gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
        return;
    }
    
    // 4. Refract Entry
    // Snell's Law: n1 sin(t1) = n2 sin(t2)
    // Vector form: T = eta * I + (eta * cos1 - sqrt(1 - eta^2 * (1-cos1^2))) * N
    // I = rayDir, N = n1 (outward normal), eta = 1.0 / uIOR
    float eta = 1.0 / ior;
    vec3 rd = reflect(rayDir, -n1); // Default reflection? No, refraction.
    
    vec3 I = rayDir;
    vec3 N = n1;
    float cosI = -dot(N, I);
    float k = 1.0 - eta * eta * (1.0 - cosI * cosI);
    
    if (k < 0.0) {
        // Total internal reflection at entry? Impossible entering denser medium.
        // Should not happen for air->ice.
        gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
        return;
    }
    
    rd = eta * I + (eta * cosI - sqrt(k)) * N;
    
    // 5. Trace internal ray to find exit face
    // We need to find the closest intersection with any OTHER face.
    // Since it's a convex shape, we just check all faces (except entry).
    // Closest positive t wins.
    
    float minT = 1e10;
    int exitFace = -1;
    vec3 n2 = vec3(0.0);
    
    // Simplified "Point" for ray origin inside crystal
    // Effectively we are at the entry face.
    // But since we only care about direction, the exact position only matters 
    // for "which face do we hit next?".
    // For a regular prism, this depends on entry point.
    // WE NEED AN ENTRY POINT.
    //
    // Sampling entry point on the face:
    // This is getting expensive for a vertex shader.
    // 
    // Approximations:
    // - Standard Ray Tracing often uses specific paths (3-5, 1-3, etc).
    // - We want general simulation.
    // 
    // Let's try a brute force approach with a "virtual" crystal size.
    // Ray enters at random point on the projected face.
    // 
    // Define Entry Point P0 on Face[entryFace].
    // Face 1,2 (Basal): Random point in Hexagon.
    // Face 3-8 (Prism): Random point in Rectangle.
    // 
    // Implementation of random point on face:
    // Too much code.
    //
    // HACK:
    // Most halos (22, parhelia) come from specific paths:
    // Path 3-5 (Prism in, Prism out - skip 1) -> 22 halo, parhelia.
    // Path 1-2 (Base in, Base out) -> No deviation.
    // Path 1-3 (Base in, Prism out) -> 46 halo?
    // 
    // If we want a GENERAL simulation, we really need the geometry.
    // Let's attempt a simplified geometry check.
    // We only check intersection with the "Infinite Prism" and "Infinite Slab" (basal).
    // The intersection is the minimum positive distance.
    //
    // Ray Origin P0?
    // We can assume P0 is (0,0,0) and shift the PLANES? No.
    //
    // OK, Backtrack.
    // We pick an entry face.
    // We pick a random UV on that face (0..1, 0..1).
    // We construct P0 in local space.
    // Then we trace.
    
    vec2 uv = hash21(seed + 0.999);
    vec3 P0 = vec3(0.0);
    
    // Generate P0 on entry face
    if (entryFace == 1) { // Top Basal
        P0 = vec3((uv.x - 0.5)*2.0, 1.0, (uv.y - 0.5)*2.0); // Square approx for hex
        // Check hex bounds? Ignore for now, approximate as square.
    } else if (entryFace == 2) { // Bottom
        P0 = vec3((uv.x - 0.5)*2.0, -1.0, (uv.y - 0.5)*2.0);
    } else { // Prism
        // Face normal angle
        float angle = float(entryFace - 3) * (PI / 3.0);
        vec3 n = vec3(sin(angle), 0.0, cos(angle));
        vec3 tangent = vec3(-cos(angle), 0.0, sin(angle));
        vec3 bitangent = vec3(0.0, 1.0, 0.0);
        
        P0 = n * 1.0 + tangent * (uv.x - 0.5) * s + bitangent * (uv.y - 0.5) * L;
    }
    
    // Now trace from P0 along rd.
    // Find intersection with all other faces.
    // Face definition: dot(P, N) = D.
    // Prism faces: D = 1. Basal: D = uAspect (half-length?). Let's say L/2.
    
    float h_len = localAspect; // Half length
    float d_prism = 1.0; // Apothem
    
    for (int i=1; i<=8; i++) {
        if (i == entryFace) continue;
        
        vec3 n = getFaceNormal(i);
        float dist = (i <= 2) ? h_len : d_prism;
        
        // Intersection distance t
        // P0 + t*rd is on plane -> dot(P0 + t*rd, n) = dist
        // t = (dist - dot(P0, n)) / dot(rd, n)
        
        float denom = dot(rd, n);
        if (denom > 0.0) { // Must be exiting face (normal points out, ray points out)
             float t = (dist - dot(P0, n)) / denom;
             if (t > 0.001 && t < minT) {
                 minT = t;
                 exitFace = i;
                 n2 = n;
             }
        }
    }
    
    if (exitFace == -1) {
        // Should not happen in convex closed shape
        gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
        return;
    }
    
    // 6. Refract Exit
    // Snell's Law exiting: n1 = 1.31, n2 = 1.0. eta = 1.31.
    // I = rd, N = -n2 (we need normal pointing INTO the material for the formula? 
    // Standard formula uses normal pointing towards incident medium.)
    // Here incident is ice. Normal n2 points out to air.
    // So "Normal" for formula should be -n2.
    // Incident I = rd.
    
    // Wait, standard formula:
    // Refract(I, N, eta). I incident, N normal.
    // If entering: I and N opposed.
    // If exiting: I and N aligned.
    // GLSL refract function expects N and I.
    // If exiting, dot(N, I) > 0.
    // We need to handle Total Internal Reflection.
    
    eta = ior; // Ice to Air
    vec3 finalDir = refract(rd, -n2, eta);
    
    if (length(finalDir) == 0.0) {
        // TIR - Total Internal Reflection
        // Ray is trapped or reflects.
        // For simple halo sim, we can kill it or reflect it.
        // Let's reflect and try one more bounce?
        // For simplicity -> Kill (black dot / discard).
        // Many rare halos come from multiple bounces.
        // Let's discard for version 1.
        gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
        return;
    }
    
    // 7. Transform back to World Space
    vec3 worldDir = rot * finalDir;
    
    // Debug log to ensure it started
    // console.log("Parhelion simulation started. Particles:", CONFIG.particleCount);
    
    // 8. Project to Screen (Fisheye / Stereographic)
    
    // Subpixel jitter for anti-aliasing (temporal accumulation)
    // Jitter range: -0.5 to 0.5 pixels in screen space
    vec2 jitter = vec2(hash11(seed + 0.1), hash11(seed + 0.2)) - 0.5;
    vec2 jitterNDC = jitter / uResolution; // Convert to NDC offset
    
    // Zenith is Y (0,1,0).
    // Camera looks at Zenith? Or Camera looks at Horizon?
    // Standard halo sims look at the sun or zenith.
    // Let's map the entire sky hemisphere to the circle.
    // Direction D = (x, y, z).
    // Project onto XY plane.
    // Stereographic projection:
    // R = tan(theta / 2).
    // Or simple Azimuth/Altitude mapping.
    
    // Let's look UP (Y is up).
    // Camera is at origin looking at Z- (North) or something?
    // Let's align so Sun at (0,0,-1) maps to center?
    // No, let's use a fixed "Sky View" looking straight UP.
    // Center of screen = Zenith (0,1,0).
    // Horizon = Circle edge.
    
    // Normalize worldDir
    worldDir = normalize(worldDir);

    // --- Camera Rotation ---
    // Apply camera rotation to the View Vector (-worldDir)
    // Default: Looking at Zenith (0,1,0).
    // User wants to change view elevation.
    // Rotate around X axis.
    
    vec3 viewDir = -worldDir;
    
    // DEBUG: Disable rotation temporarily to see if rays return
    // vec3 camViewDir = viewDir;
    
    // Standard Pitch Rotation Matrix around X axis
    // We want to rotate the WORLD relative to the CAMERA.
    // If Camera pitches DOWN, World moves UP.
    // So we rotate World Vector around X.
    
    // uCamElevation: 90 = Zenith (Look Up). 0 = Horizon (Look Forward).
    // If we look Up (90), (0,1,0) is Center.
    // If we look Horizon (0), (0,0,1) (South) should be Center.
    // So we want to rotate (0,0,1) to (0,1,0). That's -90 deg rotation around X?
    
    // Let's use a simpler approach.
    // Target Vector T.
    // We want T aligned with Y axis.
    
    float angle = radians(uCamElevation - 90.0); 
    
    float cCam = cos(angle);
    float sCam = sin(angle);
    
    vec3 camViewDir;
    camViewDir.x = viewDir.x;
    camViewDir.y = viewDir.y * cCam - viewDir.z * sCam;
    camViewDir.z = viewDir.y * sCam + viewDir.z * cCam;
    
    // Use camViewDir for projection
    // Projection expects Center at (0,0).
    // Zenith Projection: (0,1,0) -> (0,0).
    
    vec2 screenPos = vec2(camViewDir.x, camViewDir.z) / (1.0 + camViewDir.y);
    
    // Scale to fit in view
    // Horizon (y=0) is at radius 1.
    screenPos *= 1.0 * uZoom; // Apply Zoom (Scale screen position)
    
    // Correct aspect ratio of render target
    float aspectInfo = uResolution.x / uResolution.y;
    if (aspectInfo > 1.0) screenPos.x /= aspectInfo;
    else screenPos.y *= aspectInfo; // Wait, simpler to just fit circle.
    
    // Apply Jitter
    screenPos += jitterNDC * 2.0; // NDC is 2.0 wide (-1 to 1)
    
    // We want circle to be round.
    // NDC is -1..1.
    // If we output directly to clip space:
    
    // DEBUG: If screenPos is valid, show it.
    // if (length(screenPos) > 1.0) screenPos *= 0.0; // Clamp for debug
    
    gl_Position = vec4(screenPos.x, screenPos.y, 0.0, 1.0);
    gl_PointSize = 2.5; // Soft splat size
    vColor = rayColor;
    vSeed = seed; // Pass seed to fragment
}
`;

const fragmentShader = `
precision highp float;
varying vec3 vColor;
varying float vSeed;
uniform vec3 uColor; // Global exposure/tint

// Hash for stochastic dithering
float hash11(float p) {
    p = fract(p * .1031);
    p *= p + 33.33;
    p *= p + p;
    return fract(p);
}

void main() {
    // Soft Circular Splat
    vec2 coord = gl_PointCoord - vec2(0.5);
    float distSq = dot(coord, coord);
    if (distSq > 0.25) discard;
    float alpha = exp(-distSq * 16.0); 

    // Calculate intended linear energy
    vec3 linearEnergy = vColor * uColor * alpha;
    
    // STOCHASTIC ACCUMULATION (Photon Mapping)
    // Float32 Buffer: We don't need stochastic dithering for low values!
    // Float32 can handle 1e-30.
    // So we can just output the linear energy directly.
    
    // float maxVal = max(max(linearEnergy.r, linearEnergy.g), linearEnergy.b);
    // const float QUANTUM = 0.01; 
    // if (maxVal < QUANTUM && maxVal > 0.0) { ... }

    // Additive blending handles the accumulation
    gl_FragColor = vec4(linearEnergy, 1.0); 
}
`;

const material = new THREE.ShaderMaterial({
  uniforms: {
    uTime: { value: 0 },
    uResolution: { value: new THREE.Vector2() },
    uSunPos: { value: new THREE.Vector3() },
    uCamElevation: { value: 90.0 },
    uZoom: { value: 1.0 },
    uTypeWeights: { value: new THREE.Vector4() },
    uCrystalType: { value: CONFIG.crystalType === 'Random' ? 0 : 1 },
    uTiltVariance: { value: 0.0 },
    uIOR: { value: CONFIG.ior },
    uAspect: { value: 2.0 }, // Column length / width
    uColor: { value: new THREE.Color(0xffffff) },
    uSaturation: { value: 1.0 } // New Saturation Uniform
  },
  vertexShader,
  fragmentShader,
  transparent: true,
  depthTest: false,
  depthWrite: false,
  blending: THREE.AdditiveBlending
});

const points = new THREE.Points(geometry, material);
points.frustumCulled = false; // Important: Since we move points in vertex shader
scene.add(points);

// --- Controls ---
const gui = new GUI();

// Helper functions for Zoom Lock (Physics based)
function getHaloAngle(n) {
    // Minimum deviation for 60 degree prism
    // theta = 2 * asin(n * sin(A/2)) - A
    // A = 60 deg = PI/3
    // sin(30) = 0.5
    // Result in radians
    // Clamp n to avoid NaN if n > 2 (not possible here but good practice)
    const val = Math.min(1.0, n * 0.5);
    return 2.0 * Math.asin(val) - (Math.PI / 3.0);
}

function getIORFromHaloAngle(angle) {
    // Reverse: n = 2 * sin((theta + A)/2)
    return 2.0 * Math.sin((angle + Math.PI / 3.0) * 0.5);
}

let lockZoomConstant = 0; // Stores tan(theta) * zoom

// Preset Loader Function
function loadPreset(name) {
    const p = PRESETS[name];
    if (!p) return;
    
    // Update Target State instead of CONFIG directly for smooth props
    // But booleans and non-smooth props update immediately
    
    // Props to smooth:
    const smoothProps = ['sunElevation', 'camElevation', 'crystalTilt', 'ior', 'exposure', 'fadeFactor', 'zoom', 'saturation'];
    
    Object.keys(p).forEach(k => {
        if (smoothProps.includes(k)) {
            targetState[k] = p[k];
            // Also update CONFIG so the sliders snap to the target value immediately
            // This fixes the visual issue where sliders stayed at old values
            CONFIG[k] = p[k]; 
        } else {
            CONFIG[k] = p[k]; // Immediate update for booleans
            targetState[k] = p[k]; // Keep sync
            currentState[k] = p[k];
        }
    });
    
    // Force spring physics to reset? No, smooth transition is desired.
    // But updating CONFIG allows the GUI to updateDisplay() correctly.
    
    // Special handling for Log Exposure Slider proxy target
    if (exposureControl) {
        exposureControl.slider = Math.log10(targetState.exposure);
    }
    
    // Update GUI Controllers to show target values
    const updateControllers = (folder) => {
        folder.__controllers.forEach(c => c.updateDisplay());
        if (folder.__folders) {
            Object.values(folder.__folders).forEach(f => updateControllers(f));
        }
    };
    updateControllers(gui);
    
    // Manual Exposure proxy update
    gui.__controllers.forEach(c => {
        if (c.property === 'slider' && c.object === exposureControl) c.updateDisplay();
    });
    
    updateGeometry();
}

// Preset Dropdown
gui.add(CONFIG, 'preset', Object.keys(PRESETS)).name('Preset').onChange(name => {
    loadPreset(name);
    // Update native picker if it exists
    const presetPicker = document.getElementById('preset-picker');
    if (presetPicker) {
        presetPicker.value = name;
    }
});

// Modified onChange handlers to update targetState
gui.add(CONFIG, 'sunElevation', -90, 90).name('Sun Elevation').onChange(v => {
    targetState.sunElevation = v;
    if (CONFIG.lockSunCenter) {
        targetState.camElevation = v;
        gui.__controllers.forEach(c => {
            if (c.property === 'camElevation') {
                c.object = targetState; // Hack to update display? No.
                // We need to update the bound variable in CONFIG for the slider to move, 
                // but we want the simulation to lag.
                // Actually, dat.gui binds to CONFIG.
                // If we change CONFIG, the slider moves.
                // We want the slider to stay where user put it (target), but simulation (current) to lag.
                // So we should separate the Binding Object from the Simulation Object.
                
                // For simplicity:
                // GUI binds to CONFIG (Target).
                // Simulation uses currentState (Spring).
                // We copy CONFIG to targetState every frame? No, on change.
                
                // If Lock Center is on, we update the other CONFIG value too.
                CONFIG.camElevation = v;
                c.updateDisplay();
            }
        });
    }
});

gui.add(CONFIG, 'camElevation', -90, 90).name('Cam Pitch').onChange(v => {
    targetState.camElevation = v;
    if (CONFIG.lockSunCenter) {
        targetState.sunElevation = v;
        CONFIG.sunElevation = v;
        gui.__controllers.forEach(c => {
            if (c.property === 'sunElevation') c.updateDisplay();
        });
    }
});

gui.add(CONFIG, 'lockSunCenter').name('Lock Center');

// Zoom Lock Logic
gui.add(CONFIG, 'lockZoom').name('Lock Zoom').onChange(enabled => {
    if (enabled) {
        // Capture current relationship: C = Zoom * tan(theta)
        const angle = getHaloAngle(CONFIG.ior);
        // Ensure angle is positive enough to avoid 0 or negative division issues
        // 22 deg is ~0.38 rad. tan(0.38) ~ 0.4.
        // At IOR=1.0, angle=0.
        const tanTheta = Math.tan(Math.max(0.001, angle));
        lockZoomConstant = CONFIG.zoom * tanTheta;
    }
});

gui.add(CONFIG, 'zoom', 0.5, 20.0).name('Zoom').onChange(v => {
    targetState.zoom = v;
    if (CONFIG.lockZoom) {
        // Update IOR to match Zoom
        // C = Zoom * tan(theta) -> tan(theta) = C / Zoom
        const targetTan = lockZoomConstant / v;
        const angle = Math.atan(targetTan);
        let newIOR = getIORFromHaloAngle(angle);
        
        // Clamp IOR
        newIOR = Math.max(1.0, Math.min(1.5, newIOR));
        
        CONFIG.ior = newIOR;
        targetState.ior = newIOR;
        
        gui.__controllers.forEach(c => {
            if (c.property === 'ior') c.updateDisplay();
        });
    }
});

const types = gui.addFolder('Crystal Types');
types.open();
types.add(CONFIG, 'enablePlate').name('Plates');
types.add(CONFIG, 'enableColumn').name('Columns');
types.add(CONFIG, 'enableParry').name('Parry');
types.add(CONFIG, 'enableRandom').name('Random');

gui.add(CONFIG, 'crystalTilt', 0, 45).step(0.01).name('Tilt (Deg)').onChange(v => targetState.crystalTilt = v);
gui.add(CONFIG, 'ior', 1.0, 1.5).step(0.01).name('IOR (Ice=1.31)').onChange(v => {
    targetState.ior = v;
    if (CONFIG.lockZoom) {
        // Update Zoom to match IOR
        // Zoom = C / tan(theta)
        const angle = getHaloAngle(v);
        const tanTheta = Math.tan(Math.max(0.001, angle));
        let newZoom = lockZoomConstant / tanTheta;
        
        // Clamp Zoom
        newZoom = Math.max(0.5, Math.min(5.0, newZoom));
        
        CONFIG.zoom = newZoom;
        targetState.zoom = newZoom;
        
        gui.__controllers.forEach(c => {
            if (c.property === 'zoom') c.updateDisplay();
        });
    }
});

// Use a proxy object for exponential exposure control
const exposureControl = { slider: Math.log10(CONFIG.exposure) };

// Initialize shader uniform immediately
material.uniforms.uColor.value.setScalar(CONFIG.exposure);
currentState.exposure = CONFIG.exposure; // Init current state

gui.add(exposureControl, 'slider', -6, -1).name('Log Exposure').onChange(v => {
    const val = Math.pow(10, v);
    CONFIG.exposure = val; // Update CONFIG so it persists in the animate loop
    targetState.exposure = val;
    // Update XY pad exposure slider position
    if (window.xyPadUpdateSliders) {
        window.xyPadUpdateSliders();
    }
});

gui.add(CONFIG, 'saturation', 0.0, 3.0).name('Saturation').onChange(v => targetState.saturation = v);

gui.add(CONFIG, 'fadeFactor', 0, 0.5).name('Fade Out (Speed)').step(0.001).onChange(v => {
    targetState.fadeFactor = v;
    // Update XY pad fade slider position
    if (window.xyPadUpdateSliders) {
        window.xyPadUpdateSliders();
    }
});

// Load initial preset
loadPreset(CONFIG.preset);

// GUI Toggle Button
const guiToggle = document.getElementById('gui-toggle');
const iconGear = document.getElementById('icon-gear');
const iconMinus = document.getElementById('icon-minus');

if (guiToggle && iconGear && iconMinus) {
    // Default to closed (hidden)
    gui.hide();
    iconGear.style.display = 'block';
    iconMinus.style.display = 'none';
    guiToggle.classList.remove('open');
    
    guiToggle.addEventListener('click', () => {
        // Check if GUI is currently visible
        const isVisible = gui.domElement.style.display !== 'none' && 
                         gui.domElement.offsetParent !== null;
        
        if (isVisible) {
            gui.hide();
            iconGear.style.display = 'block';
            iconMinus.style.display = 'none';
            guiToggle.classList.remove('open');
        } else {
            gui.show();
            iconGear.style.display = 'none';
            iconMinus.style.display = 'block';
            guiToggle.classList.add('open');
        }
    });
}

// Native Preset Picker
const presetToggle = document.getElementById('preset-toggle');
const presetPicker = document.getElementById('preset-picker');

if (presetToggle && presetPicker) {
    // Position the select element over the preset-toggle button
    const toggleRect = presetToggle.getBoundingClientRect();
    const padRect = presetToggle.closest('#xy-pad').getBoundingClientRect();
    const relativeTop = toggleRect.top - padRect.top;
    const relativeLeft = toggleRect.left - padRect.left;
    
    presetPicker.style.position = 'absolute';
    presetPicker.style.top = `${relativeTop}px`;
    presetPicker.style.left = `${relativeLeft}px`;
    presetPicker.style.width = '20px';
    presetPicker.style.height = '20px';
    presetPicker.style.opacity = '0';
    presetPicker.style.cursor = 'pointer';
    presetPicker.style.zIndex = '10';
    presetPicker.style.pointerEvents = 'auto';
    
    // Populate the select with preset names
    Object.keys(PRESETS).forEach(presetName => {
        const option = document.createElement('option');
        option.value = presetName;
        option.textContent = presetName;
        presetPicker.appendChild(option);
    });
    
    // Set current preset
    presetPicker.value = CONFIG.preset;
    
    // Handle preset selection
    presetPicker.addEventListener('change', (e) => {
        const selectedPreset = e.target.value;
        if (selectedPreset && PRESETS[selectedPreset]) {
            loadPreset(selectedPreset);
            CONFIG.preset = selectedPreset;
            // Update GUI preset controller
            gui.__controllers.forEach(c => {
                if (c.property === 'preset') c.updateDisplay();
            });
        }
    });
    
    // Make preset-toggle click trigger the select
    presetToggle.addEventListener('click', (e) => {
        e.stopPropagation();
        presetPicker.focus();
        presetPicker.click();
    });
    
    // Also allow direct clicks on the select
    presetPicker.addEventListener('mousedown', (e) => {
        e.stopPropagation();
    });
}

function updateGeometry() {
    // Recreate geometry if count changes
    renderer.clear();
}

// --- Main Loop ---
function resize() {
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    material.uniforms.uResolution.value.set(window.innerWidth * window.devicePixelRatio, window.innerHeight * window.devicePixelRatio);
    renderer.clear(); // Resize usually requires clear to avoid stretching
}
window.addEventListener('resize', resize);
resize();

function updateSun() {
    const rad = THREE.MathUtils.degToRad(CONFIG.sunElevation);
    
    const y = Math.sin(rad); 
    const z = Math.cos(rad); 
    
    material.uniforms.uSunPos.value.set(0, y, z).normalize();
}

// --- XY Pad Control ---
const xyPad = document.getElementById('xy-pad');
const xyPadKnob = document.getElementById('xy-pad-knob');
const xyPadBg = document.getElementById('xy-pad-background');
const xyPadXSlider = document.getElementById('xy-pad-x-slider');
const xyPadYSlider = document.getElementById('xy-pad-y-slider');
const xyPadZoomSlider = document.getElementById('xy-pad-zoom-slider');
const xyPadFadeSlider = document.getElementById('xy-pad-fade-slider');
const xyPadExposureSlider = document.getElementById('xy-pad-exposure-slider');
const xyPadTiltSlider = document.getElementById('xy-pad-tilt-slider');
const crystalToggles = document.querySelectorAll('.crystal-toggle');

if (xyPad && xyPadKnob && xyPadBg) {
    // Value ranges
    const IOR_MIN = 1.0;
    const IOR_MAX = 1.5;
    const SUN_ELEV_MIN = -90;
    const SUN_ELEV_MAX = 90;
    const TILT_MIN = 0;
    const TILT_MAX = 45;
    const ZOOM_MIN = 20.0;
    const ZOOM_MAX = 0.5;
    const FADE_MIN = 0.0;
    const FADE_MAX = 0.5;
    const EXPOSURE_LOG_MIN = -6;
    const EXPOSURE_LOG_MAX = -1;

    // Crystal Toggles Logic
    function updateToggleVisuals() {
        if (!crystalToggles) return;
        crystalToggles.forEach(toggle => {
            const type = toggle.dataset.type;
            if (CONFIG[type]) {
                toggle.classList.add('active');
            } else {
                toggle.classList.remove('active');
            }
        });
    }

    if (crystalToggles) {
        crystalToggles.forEach(toggle => {
            toggle.addEventListener('click', (e) => {
                e.stopPropagation(); // Prevent dragging background
                const type = toggle.dataset.type;
                if (CONFIG.hasOwnProperty(type)) {
                    // Toggle
                    const newVal = !CONFIG[type];
                    CONFIG[type] = newVal;
                    targetState[type] = newVal;
                    currentState[type] = newVal;
                    
                    // Force Parry if all off
                    if (!CONFIG.enableRandom && !CONFIG.enablePlate && !CONFIG.enableColumn && !CONFIG.enableParry) {
                        CONFIG.enableParry = true;
                        targetState.enableParry = true;
                        currentState.enableParry = true;
                    }
                    
                    // Update GUI for all types (to reflect forced changes)
                    const typeKeys = ['enableRandom', 'enablePlate', 'enableColumn', 'enableParry'];
                    typeKeys.forEach(t => {
                        gui.__controllers.forEach(c => {
                            if (c.property === t) c.updateDisplay();
                        });
                        if (typeof types !== 'undefined') {
                            types.__controllers.forEach(c => {
                                 if (c.property === t) c.updateDisplay();
                            });
                        }
                    });

                    updateToggleVisuals();
                }
            });
            // Prevent drag on mousedown/touchstart
            toggle.addEventListener('mousedown', (e) => e.stopPropagation());
            toggle.addEventListener('touchstart', (e) => e.stopPropagation());
        });
        
        updateToggleVisuals();
    }

    // Convert value to normalized position (0-1)
    function valueToX(ior) {
        return (ior - IOR_MIN) / (IOR_MAX - IOR_MIN);
    }

    function valueToY(sunElev) {
        // XY pad Y: top (90) = 1, bottom (-90) = 0
        return (sunElev - SUN_ELEV_MIN) / (SUN_ELEV_MAX - SUN_ELEV_MIN);
    }

    function valueToTilt(tilt) {
        // Power curve for Tilt: t = (Tilt/Max)^(1/Power)
        // Allows finer control at low angles
        const normalized = (tilt - TILT_MIN) / (TILT_MAX - TILT_MIN);
        return Math.pow(normalized, 1.0/2.5);
    }

    function valueToZoom(zoom) {
        // Invert Y: top (max) = 0, bottom (min) = 1
        return 1.0 - (zoom - ZOOM_MIN) / (ZOOM_MAX - ZOOM_MIN);
    }

    function valueToFade(fade) {
        // Invert Y: top (max) = 0, bottom (min) = 1
        return 1.0 - (fade - FADE_MIN) / (FADE_MAX - FADE_MIN);
    }

    function valueToExposure(exposure) {
        // Convert exposure to log scale, then normalize to 0-1
        // exposure is linear, but we want log scale: log10(exposure)
        // Invert Y: top (max) = 0, bottom (min) = 1
        const logExp = Math.log10(exposure);
        return 1.0 - (logExp - EXPOSURE_LOG_MIN) / (EXPOSURE_LOG_MAX - EXPOSURE_LOG_MIN);
    }

    // Convert normalized position (0-1) to value
    function xToValue(x) {
        return IOR_MIN + x * (IOR_MAX - IOR_MIN);
    }

    function yToValue(y) {
        // Y: top (1) = 90, bottom (0) = -90
        return SUN_ELEV_MIN + y * (SUN_ELEV_MAX - SUN_ELEV_MIN);
    }

    function tiltToValue(t) {
        // Power curve for Tilt: Tilt = Max * t^Power
        const normalized = Math.pow(t, 2.5);
        return TILT_MIN + normalized * (TILT_MAX - TILT_MIN);
    }

    function zoomToValue(z) {
        // Invert Y: top (0) = max, bottom (1) = min
        return ZOOM_MIN + (1.0 - z) * (ZOOM_MAX - ZOOM_MIN);
    }

    function fadeToValue(f) {
        // Invert Y: top (0) = max, bottom (1) = min
        return FADE_MIN + (1.0 - f) * (FADE_MAX - FADE_MIN);
    }

    function exposureToValue(e) {
        // Convert normalized 0-1 back to log scale, then to linear exposure
        // Invert Y: top (0) = max, bottom (1) = min
        const logExp = EXPOSURE_LOG_MIN + (1.0 - e) * (EXPOSURE_LOG_MAX - EXPOSURE_LOG_MIN);
        return Math.pow(10, logExp);
    }

    // Update knob position from CONFIG values
    function updateKnobPosition() {
        // Get normalized parameters (0-1)
        const paramX = valueToX(CONFIG.ior);
        const paramY = valueToY(CONFIG.sunElevation);
        
        // Map to Visual Position (0.1 - 0.9) to match slider thumb constraints
        const visualX = 0.1 + 0.8 * paramX;
        const visualY = 0.1 + 0.8 * paramY;
        
        xyPadKnob.style.left = `${visualX * 100}%`;
        xyPadKnob.style.top = `${visualY * 100}%`;
    }

    // Update CONFIG values from Visual Knob Position (0-1)
    function updateValuesFromKnob(visualX, visualY) {
        // Constrain visual position to interior (0.1 - 0.9)
        const constrainedX = Math.max(0.1, Math.min(0.9, visualX));
        const constrainedY = Math.max(0.1, Math.min(0.9, visualY));
        
        // Update knob visual position immediately
        xyPadKnob.style.left = `${constrainedX * 100}%`;
        xyPadKnob.style.top = `${constrainedY * 100}%`;
        
        // Convert Visual Position to Normalized Parameter (0-1)
        const paramX = (constrainedX - 0.1) / 0.8;
        const paramY = (constrainedY - 0.1) / 0.8;
        
        // Update Sliders
        // X Slider: 0-100 -> Param 0-1
        if (xyPadXSlider) xyPadXSlider.value = paramX * 100;
        
        // Y Slider: inverted (Top=90=paramY 1.0 -> Slider 0, Bottom=-90=paramY 0.0 -> Slider 100)
        if (xyPadYSlider) {
            xyPadYSlider.value = (1.0 - paramY) * 100;
        }

        const ior = xToValue(paramX);
        const sunElev = yToValue(paramY);
        
        // Clamp to valid ranges
        const clampedIor = Math.max(IOR_MIN, Math.min(IOR_MAX, ior));
        const clampedSunElev = Math.max(SUN_ELEV_MIN, Math.min(SUN_ELEV_MAX, sunElev));
        
        // Update CONFIG and targetState
        CONFIG.ior = clampedIor;
        CONFIG.sunElevation = clampedSunElev;
        targetState.ior = clampedIor;
        targetState.sunElevation = clampedSunElev;
        
        // Handle lock center
        if (CONFIG.lockSunCenter) {
            CONFIG.camElevation = clampedSunElev;
            targetState.camElevation = clampedSunElev;
            gui.__controllers.forEach(c => {
                if (c.property === 'camElevation') c.updateDisplay();
            });
        }
        
        gui.__controllers.forEach(c => {
            if (c.property === 'ior' || c.property === 'sunElevation') c.updateDisplay();
        });
    }

    // Get position from event (mouse or touch)
    function getEventPosition(e) {
        const rect = xyPad.getBoundingClientRect();
        let clientX, clientY;
        
        if (e.touches && e.touches.length > 0) {
            clientX = e.touches[0].clientX;
            clientY = e.touches[0].clientY;
        } else {
            clientX = e.clientX;
            clientY = e.clientY;
        }
        
        const x = (clientX - rect.left) / rect.width;
        const y = (clientY - rect.top) / rect.height;
        
        return { x: Math.max(0, Math.min(1, x)), y: Math.max(0, Math.min(1, y)) };
    }

    // Drag handlers
    let isDragging = false;

    function startDrag(e) {
        e.preventDefault();
        isDragging = true;
        const pos = getEventPosition(e);
        updateValuesFromKnob(pos.x, pos.y);
    }

    function drag(e) {
        if (!isDragging) return;
        e.preventDefault();
        const pos = getEventPosition(e);
        updateValuesFromKnob(pos.x, pos.y);
    }

    function endDrag(e) {
        isDragging = false;
    }

    // Mouse events
    xyPadKnob.addEventListener('mousedown', startDrag);
    document.addEventListener('mousemove', drag);
    document.addEventListener('mouseup', endDrag);

    // Touch events
    xyPadKnob.addEventListener('touchstart', startDrag, { passive: false });
    document.addEventListener('touchmove', drag, { passive: false });
    document.addEventListener('touchend', endDrag);

    // Also allow dragging from the background
    xyPadBg.addEventListener('mousedown', startDrag);
    xyPadBg.addEventListener('touchstart', startDrag, { passive: false });

    // Update slider positions from CONFIG values
    function updateSliderPositions() {
        // Get normalized params (0-1)
        const paramX = valueToX(CONFIG.ior);
        const paramY = valueToY(CONFIG.sunElevation);
        
        // Sliders match parameter 0-1 mapped to 0-100
        if (xyPadXSlider) xyPadXSlider.value = paramX * 100;
        // Y Slider inverted: Top (90, paramY 1.0) -> Slider 0, Bottom (-90, paramY 0.0) -> Slider 100
        if (xyPadYSlider) xyPadYSlider.value = (1.0 - paramY) * 100;
        if (xyPadZoomSlider) xyPadZoomSlider.value = valueToZoom(CONFIG.zoom) * 100;
        if (xyPadTiltSlider) xyPadTiltSlider.value = valueToTilt(CONFIG.crystalTilt) * 100;
        if (xyPadFadeSlider) xyPadFadeSlider.value = valueToFade(CONFIG.fadeFactor) * 100;
        if (xyPadExposureSlider) xyPadExposureSlider.value = valueToExposure(CONFIG.exposure) * 100;
    }

    // Slider event handlers
    if (xyPadXSlider) {
        xyPadXSlider.addEventListener('input', (e) => {
            const param = e.target.value / 100;
            // Convert Param to Visual Position
            const visualX = 0.1 + 0.8 * param;
            const visualY = 0.1 + 0.8 * valueToY(CONFIG.sunElevation);
            updateValuesFromKnob(visualX, visualY);
        });
    }

    if (xyPadYSlider) {
        xyPadYSlider.addEventListener('input', (e) => {
            const val = e.target.value / 100;
            // Y Slider is inverted: value 0 (top) = param 1.0 (90), value 100 (bottom) = param 0.0 (-90)
            const param = 1.0 - val; 
            const visualY = 0.1 + 0.8 * param;
            const visualX = 0.1 + 0.8 * valueToX(CONFIG.ior);
            updateValuesFromKnob(visualX, visualY);
        });
    }

    if (xyPadZoomSlider) {
        xyPadZoomSlider.addEventListener('input', (e) => {
            const z = e.target.value / 100;
            const zoom = zoomToValue(z);
            CONFIG.zoom = zoom;
            targetState.zoom = zoom;
            gui.__controllers.forEach(c => {
                if (c.property === 'zoom') c.updateDisplay();
            });
        });
    }

    if (xyPadTiltSlider) {
        xyPadTiltSlider.addEventListener('input', (e) => {
            const t = e.target.value / 100;
            const tilt = tiltToValue(t);
            CONFIG.crystalTilt = tilt;
            targetState.crystalTilt = tilt;
            gui.__controllers.forEach(c => {
                if (c.property === 'crystalTilt') c.updateDisplay();
            });
        });
    }

    if (xyPadFadeSlider) {
        xyPadFadeSlider.addEventListener('input', (e) => {
            const f = e.target.value / 100;
            const fade = fadeToValue(f);
            CONFIG.fadeFactor = fade;
            targetState.fadeFactor = fade;
            gui.__controllers.forEach(c => {
                if (c.property === 'fadeFactor') c.updateDisplay();
            });
        });
    }

    if (xyPadExposureSlider) {
        xyPadExposureSlider.addEventListener('input', (e) => {
            const e_val = e.target.value / 100;
            const exposure = exposureToValue(e_val);
            CONFIG.exposure = exposure;
            targetState.exposure = exposure;
            // Update the exposureControl proxy for GUI
            if (exposureControl) {
                exposureControl.slider = Math.log10(exposure);
            }
            gui.__controllers.forEach(c => {
                if (c.property === 'slider' && c.object === exposureControl) c.updateDisplay();
            });
        });
    }

    // Initialize knob and slider positions
    updateKnobPosition();
    updateSliderPositions();
    
    // Create preset markers
    function createPresetMarkers() {
        Object.keys(PRESETS).forEach(presetName => {
            const preset = PRESETS[presetName];
            if (preset.ior !== undefined && preset.sunElevation !== undefined) {
                // Convert to normalized parameters (0-1)
                const paramX = valueToX(preset.ior);
                const paramY = valueToY(preset.sunElevation);
                
                // Map to Visual Position (0.1 - 0.9) to account for knob radius
                const visualX = 0.1 + 0.8 * paramX;
                const visualY = 0.1 + 0.8 * paramY;
                
                // Create marker element
                const marker = document.createElement('div');
                marker.className = 'preset-marker';
                marker.style.left = `${visualX * 100}%`;
                marker.style.top = `${visualY * 100}%`;
                marker.title = presetName;
                
                // Add to XY pad (before knob so knob appears on top)
                xyPad.insertBefore(marker, xyPadKnob);
            }
        });
    }
    
    createPresetMarkers();

    // Sync knob position when CONFIG changes (polling in animate loop)
    let lastIor = CONFIG.ior;
    let lastSunElev = CONFIG.sunElevation;
    let lastZoom = CONFIG.zoom;
    let lastTilt = CONFIG.crystalTilt;
    let lastFade = CONFIG.fadeFactor;
    
    // Store references for animate loop
    window.xyPadUpdateKnob = updateKnobPosition;
    window.xyPadUpdateSliders = updateSliderPositions;
    window.xyPadIsDragging = () => isDragging;
    window.xyPadLastIor = () => lastIor;
    window.xyPadLastSunElev = () => lastSunElev;
    window.xyPadLastZoom = () => lastZoom;
    window.xyPadLastTilt = () => lastTilt;
    window.xyPadLastFade = () => lastFade;
    window.xyPadSetLastIor = (v) => { lastIor = v; };
    window.xyPadSetLastSunElev = (v) => { lastSunElev = v; };
    window.xyPadSetLastZoom = (v) => { lastZoom = v; };
    window.xyPadSetLastTilt = (v) => { lastTilt = v; };
    window.xyPadSetLastFade = (v) => { lastFade = v; };
    window.updateCrystalToggles = updateToggleVisuals;
} else {
    // Dummy functions if XY pad doesn't exist
    window.xyPadUpdateKnob = () => {};
    window.xyPadUpdateSliders = () => {};
    window.xyPadIsDragging = () => false;
    window.xyPadLastIor = () => CONFIG.ior;
    window.xyPadLastSunElev = () => CONFIG.sunElevation;
    window.xyPadLastZoom = () => CONFIG.zoom;
    window.xyPadLastTilt = () => CONFIG.crystalTilt;
    window.xyPadSetLastIor = () => {};
    window.xyPadSetLastSunElev = () => {};
    window.xyPadSetLastZoom = () => {};
    window.xyPadSetLastTilt = () => {};
    window.xyPadLastFade = () => CONFIG.fadeFactor;
    window.xyPadSetLastFade = () => {};
    window.updateCrystalToggles = () => {};
}

function animate(time) {
    requestAnimationFrame(animate);
    
    material.uniforms.uTime.value = time * 0.001;
    
    // --- Spring Interpolation ---
    if (CONFIG.enableSprings) {
        const props = ['sunElevation', 'camElevation', 'crystalTilt', 'ior', 'exposure', 'fadeFactor', 'zoom', 'saturation'];
        
        props.forEach(k => {
            // Ensure target is updated from CONFIG (in case user drags slider)
            // We treat CONFIG as the "Target" (where the slider is).
            // We treat currentState as the "Physics Value" (what the shader sees).
            targetState[k] = CONFIG[k]; 
            
            // Spring Physics: acceleration = force / mass
            // Force = (Target - Current) * Stiffness - Velocity * Damping
            const dist = targetState[k] - currentState[k];
            const force = dist * SPRING_STIFFNESS;
            springVelocity[k] += force;
            springVelocity[k] *= SPRING_DAMPING;
            currentState[k] += springVelocity[k];
            
            // Snap to target if close
            if (Math.abs(dist) < SPRING_SNAP_THRESHOLD && Math.abs(springVelocity[k]) < SPRING_SNAP_THRESHOLD) {
                currentState[k] = targetState[k];
                springVelocity[k] = 0;
            }
        });
    } else {
        // Direct mapping if springs disabled
        Object.assign(currentState, CONFIG);
    }
    
    // Sync XY Pad knob and slider positions when CONFIG changes (if not dragging)
    if (!window.xyPadIsDragging()) {
        window.updateCrystalToggles();
        const lastIor = window.xyPadLastIor();
        const lastSunElev = window.xyPadLastSunElev();
        const lastZoom = window.xyPadLastZoom();
        const lastTilt = window.xyPadLastTilt();
        const lastFade = window.xyPadLastFade ? window.xyPadLastFade() : CONFIG.fadeFactor;
        if (Math.abs(CONFIG.ior - lastIor) > 0.001 || 
            Math.abs(CONFIG.sunElevation - lastSunElev) > 0.001 ||
            Math.abs(CONFIG.zoom - lastZoom) > 0.001 ||
            Math.abs(CONFIG.crystalTilt - lastTilt) > 0.001 ||
            Math.abs(CONFIG.fadeFactor - lastFade) > 0.001) {
            window.xyPadUpdateKnob();
            window.xyPadUpdateSliders();
            window.xyPadSetLastIor(CONFIG.ior);
            window.xyPadSetLastSunElev(CONFIG.sunElevation);
            window.xyPadSetLastZoom(CONFIG.zoom);
            window.xyPadSetLastTilt(CONFIG.crystalTilt);
            if (window.xyPadSetLastFade) window.xyPadSetLastFade(CONFIG.fadeFactor);
        }
    }
    
    // Update Uniforms from currentState (Smoothed)
    const rad = THREE.MathUtils.degToRad(currentState.sunElevation);
    const y = Math.sin(rad); 
    const z = Math.cos(rad); 
    material.uniforms.uSunPos.value.set(0, y, z).normalize();
    
    material.uniforms.uCamElevation.value = currentState.camElevation;
    material.uniforms.uZoom.value = currentState.zoom;
    material.uniforms.uTiltVariance.value = THREE.MathUtils.degToRad(currentState.crystalTilt);
    material.uniforms.uIOR.value = currentState.ior;
    material.uniforms.uColor.value.setScalar(currentState.exposure);
    screenMaterial.uniforms.uSaturation.value = currentState.saturation;
    fadeMaterial.opacity = currentState.fadeFactor;
    
    // Calculate Type Weights
    let w0 = CONFIG.enableRandom ? 1.0 : 0.0;
    let w1 = CONFIG.enablePlate ? 1.0 : 0.0;
    let w2 = CONFIG.enableColumn ? 1.0 : 0.0;
    let w3 = CONFIG.enableParry ? 1.0 : 0.0;
    
    let totalW = w0 + w1 + w2 + w3;
    if (totalW <= 0.0) totalW = 1.0; // Prevent divide by zero
    
    w0 /= totalW;
    w1 /= totalW;
    w2 /= totalW;
    // w3 is remainder
    
    material.uniforms.uTypeWeights.value.set(
        w0,
        w0 + w1,
        w0 + w1 + w2,
        1.0 // End
    );
    
    // material.uniforms.uTiltVariance.value = THREE.MathUtils.degToRad(CONFIG.crystalTilt); // Moved to Spring Loop
    // material.uniforms.uIOR.value = CONFIG.ior; // Moved to Spring Loop
    
    // Crystal Aspect Ratio:
    // Plates: Aspect < 1 (e.g. 0.2)
    // Columns: Aspect > 1 (e.g. 2.0)
    // We should probably automate this based on type, or expose it.
    // Let's switch aspect based on type for now.
    if (CONFIG.crystalType === 'Plate') material.uniforms.uAspect.value = 0.2;
    else material.uniforms.uAspect.value = 2.0;
    
    // Draw Fade Pass (if needed)
    renderer.setRenderTarget(accumTarget); // Draw to Float32 buffer
    
    if (currentState.fadeFactor > 0.0) {
        // fadeMaterial.opacity = CONFIG.fadeFactor; // Handled in Spring Loop
        renderer.render(fadeScene, fadeCamera);
    }
    
    renderer.render(scene, camera);
    
    // Output to Screen (Tone Map)
    renderer.setRenderTarget(null);
    renderer.render(screenScene, screenCamera);
}

// Debug log to ensure it started
console.log("Parhelion simulation started. Particles:", CONFIG.particleCount);

animate(0);
