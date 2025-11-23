import * as THREE from 'three';
import { GUI } from 'dat.gui';

// --- Configuration ---
const CONFIG = {
  particleCount: 400000, // Number of rays simulated per frame (approx)
  sunElevation: 5, // degrees
  sunAzimuth: 0,
  camElevation: 15, // 90 = Looking at Zenith, 0 = Looking at Horizon
  crystalType: 'Plate', // Plate, Column, Random
  crystalTilt: 45, // degrees, variance from ideal orientation
  ior: 1.3,
  exposure: 0.0005,
  fadeFactor: 0.0 // 0 = Infinite accumulation, >0 = Fade out over time
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
    alpha: true, 
    preserveDrawingBuffer: true,
    powerPreference: "high-performance",
    precision: "highp"
});
renderer.setPixelRatio(window.devicePixelRatio); 
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.autoClear = false; // Enable accumulation
document.body.appendChild(renderer.domElement);

// Fade Plane (Full screen quad)
const fadeMaterial = new THREE.MeshBasicMaterial({
    color: 0x000000,
    transparent: true,
    opacity: 0.0,
    blending: THREE.NormalBlending // Standard blending to "darken" the buffer
});
const fadePlane = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), fadeMaterial);
// Use a separate scene/camera for the fade pass
const fadeScene = new THREE.Scene();
const fadeCamera = new THREE.Camera(); // Simple camera
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
uniform int uCrystalType; // 0: Random, 1: Plate, 2: Column
uniform float uTiltVariance; // Radians
uniform float uIOR;
uniform float uAspect; // Crystal aspect ratio (width/length)

varying vec3 vColor;

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

    if (uCrystalType == 0) { // Random (3D Uniform)
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

    } else if (uCrystalType == 1) { // Plate (C-axis vertical)
        // Main axis (C-axis) is Y (0,1,0) in local space.
        // In world space, we want it to be (0,1,0) (Up).
        // So we just rotate around Y for azimuth (random).
        // And apply a small "wobble" (tilt) to the C-axis.
        
        float azimuth = h.x * TWO_PI;
        // Tilt: Gaussian-ish distribution around 0
        // Box-Muller transform for normal distribution?
        // Or just uniform for simplicity first.
        float tiltScale = uTiltVariance; 
        float tilt = (h.y * 2.0 - 1.0) * tiltScale; // Simple linear wobble
        float tiltDir = h.z * TWO_PI;
        
        mat3 rotAzimuth = angleAxis(azimuth, vec3(0.0, 1.0, 0.0));
        mat3 rotTilt = angleAxis(tilt, vec3(cos(tiltDir), 0.0, sin(tiltDir)));
        
        rot = rotTilt * rotAzimuth;

    } else if (uCrystalType == 2) { // Column (C-axis horizontal)
        // C-axis is Y in local space. 
        // We want C-axis to be Horizontal in world space.
        // So rotate local Y to some random horizontal vector.
        
        // 1. Random horizontal direction for the C-axis
        float axisAzimuth = h.x * TWO_PI;
        vec3 worldC = vec3(cos(axisAzimuth), 0.0, sin(axisAzimuth));
        
        // 2. Rotate around this C-axis (spin)
        float spin = h.y * TWO_PI;
        
        // 3. Tilt (wobble the C-axis out of horizontal plane)
        float tilt = (h.z * 2.0 - 1.0) * uTiltVariance;
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
    float L = uAspect * 2.0; 
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
    
    float h_len = uAspect; // Half length
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
    screenPos *= 1.0; // Adjust FOV
    
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
    
    // DEBUG OVERRIDE: REMOVED
}
`;

const fragmentShader = `
precision highp float;
varying vec3 vColor;
uniform vec3 uColor; // Global exposure/tint

void main() {
    // Soft Circular Splat
    // Calculates gaussian falloff from center of point
    vec2 coord = gl_PointCoord - vec2(0.5);
    float distSq = dot(coord, coord);
    
    // Discard corners of the square to make it round
    if (distSq > 0.25) discard;
    
    // Gaussian falloff: exp(-dist^2 / sigma)
    // distSq ranges 0 to 0.25.
    // We want opacity to go from 1.0 to ~0.0.
    float alpha = exp(-distSq * 16.0); 

    // Additive blending handles the accumulation
    gl_FragColor = vec4(vColor * uColor * alpha, 1.0); 
}
`;

const material = new THREE.ShaderMaterial({
  uniforms: {
    uTime: { value: 0 },
    uResolution: { value: new THREE.Vector2() },
    uSunPos: { value: new THREE.Vector3() },
    uCamElevation: { value: 90.0 },
    uCrystalType: { value: CONFIG.crystalType === 'Random' ? 0 : 1 },
    uTiltVariance: { value: 0.0 },
    uIOR: { value: CONFIG.ior },
    uAspect: { value: 2.0 }, // Column length / width
    uColor: { value: new THREE.Color(0xffffff) }
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
    gui.add(CONFIG, 'particleCount', 10000, 10000000).step(10000).onChange(updateGeometry);
    gui.add(CONFIG, 'sunElevation', 0, 90).name('Sun Elevation').onChange(() => renderer.clear());
    gui.add(CONFIG, 'camElevation', -90, 90).name('Cam Pitch').onChange(() => renderer.clear());
    gui.add(CONFIG, 'crystalType', Object.keys(CRYSTAL_TYPES)).name('Crystal Type').onChange(() => renderer.clear());
    gui.add(CONFIG, 'crystalTilt', 0, 45).name('Tilt (Deg)').onChange(() => renderer.clear());
    gui.add(CONFIG, 'ior', 1.0, 1.5).name('IOR (Ice=1.31)').onChange(() => renderer.clear());
    
    // Use a proxy object for exponential exposure control
    const exposureControl = { slider: Math.log10(CONFIG.exposure) };
    
    gui.add(exposureControl, 'slider', -6, -1).name('Log Exposure').onChange(v => {
        const val = Math.pow(10, v);
        material.uniforms.uColor.value.setScalar(val);
        renderer.clear();
    });
    
    gui.add(CONFIG, 'fadeFactor', 0, 0.5).name('Fade Out (Speed)').onChange(v => {
        // v is roughly "opacity of black overlay per frame"
        fadeMaterial.opacity = v;
    });

function updateGeometry() {
    // Recreate geometry if count changes
    // For now, just ignore dynamic resize to keep it simple
    renderer.clear();
}

// --- Main Loop ---
function resize() {
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    material.uniforms.uResolution.value.set(window.innerWidth * window.devicePixelRatio, window.innerHeight * window.devicePixelRatio);
    renderer.clear();
}
window.addEventListener('resize', resize);
resize();

function updateSun() {
    // Invert slider logic so 0 is top of screen (Horizon North?) and 90 is center (Zenith)
    
    const rad = THREE.MathUtils.degToRad(CONFIG.sunElevation);
    // Let's try Positive Cosine again but verify projection logic.
    // Projection: vec2(worldDir.x, worldDir.z) / (1.0 + worldDir.y);
    // If Z is positive, Screen Y is positive (Top).
    // If Z is negative, Screen Y is negative (Bottom).
    
    // We want 0 deg = Bottom (Screen Y < 0). So we want Z < 0.
    // cos(0) = 1. So we want -cos(0) = -1.
    
    // Wait, I just set it to -cos and you said it was at the TOP.
    // That implies Z < 0 maps to TOP in this projection/coordinate system?
    // Let's check THREE.js coordinates.
    // Usually Y is Up. X is Right. Z is... Out of screen?
    // But in my shader: screenPos = vec2(x, z).
    // Standard GL: Y+ is Up.
    // So if Z is mapped to Screen Y...
    // If Z is negative, Screen Y is negative (Bottom).
    
    // Why did -cos result in Top?
    // Maybe the camera is inverted? Or my projection formula.
    
    // Let's just brute force it to conform to user observation.
    // User saw "Top" when I used -cos.
    // So I should use +cos to get "Bottom".
    
    const y = Math.sin(rad); 
    const z = Math.cos(rad); 
    
    material.uniforms.uSunPos.value.set(0, y, z).normalize();
}

function animate(time) {
    requestAnimationFrame(animate);
    
    material.uniforms.uTime.value = time * 0.001;
    
    // Update Uniforms from Config
    updateSun();
    material.uniforms.uCamElevation.value = CONFIG.camElevation;
    material.uniforms.uCrystalType.value = CRYSTAL_TYPES[CONFIG.crystalType];
    material.uniforms.uTiltVariance.value = THREE.MathUtils.degToRad(CONFIG.crystalTilt);
    material.uniforms.uIOR.value = CONFIG.ior;
    
    // Crystal Aspect Ratio:
    // Plates: Aspect < 1 (e.g. 0.2)
    // Columns: Aspect > 1 (e.g. 2.0)
    // We should probably automate this based on type, or expose it.
    // Let's switch aspect based on type for now.
    if (CONFIG.crystalType === 'Plate') material.uniforms.uAspect.value = 0.2;
    else material.uniforms.uAspect.value = 2.0;
    
    // Draw Fade Pass (if needed)
    if (CONFIG.fadeFactor > 0.0) {
        fadeMaterial.opacity = CONFIG.fadeFactor;
        // We need to draw the fade plane ON TOP of the existing buffer
        // But since autoClear is false, rendering normally works?
        // No, we want to render the fade plane, THEN add the new particles.
        // Or Add particles, THEN fade? 
        // Standard trails: Fade existing buffer slightly, then draw new stuff.
        
        // 1. Fade existing
        renderer.render(fadeScene, fadeCamera);
        
        // 2. Clear depth? No depth used.
    }
    
    renderer.render(scene, camera);
}

// Debug log to ensure it started
console.log("Parhelion simulation started. Particles:", CONFIG.particleCount);

animate(0);

