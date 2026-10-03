'use strict';
// Three.js renderer: camera-relative rendering of a heliocentric double-precision world.
// Physics frame (Z = ecliptic north) maps to three.js as (x, z, -y).
//
// Draw order (opaque list, by renderOrder): sky background -10, stars -9, planets/terrain 0,
// clouds 0.5, atmosphere 1, launch site 4, vessels 5. Transparent effects come after.
// HDR scene -> EffectComposer (MSAA render target) -> bloom -> tone mapping (OutputPass).

const RV = {
  renderer: null, scene: null, camera: null, w: 1, h: 1,
  camAbs: [0, 0, 0],            // camera position, heliocentric physics frame (double)
  bodies: {},                   // id -> {b, mesh, mat, atm, atmMat, clouds, ring}
  qM: null,                     // physics -> three rotation
  quality: 'high',
};
const SUN_I = 1.6;              // surface irradiance factor shared by every lit shader

function toT(v, out) { (out || (out = new THREE.Vector3())).set(v[0], v[2], -v[1]); return out; }
function fromT(t) { return [t.x, -t.z, t.y]; }
function relT(abs, out) { return toT([abs[0] - RV.camAbs[0], abs[1] - RV.camAbs[1], abs[2] - RV.camAbs[2]], out); }
function quatT(q, out) { out = out || new THREE.Quaternion(); out.set(q[0], q[1], q[2], q[3]); return out.premultiply(RV.qM); }

const GLSL_NOISE = `
vec3 mod289(vec3 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 mod289(vec4 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 permute(vec4 x){return mod289(((x*34.0)+1.0)*x);}
vec4 taylorInvSqrt(vec4 r){return 1.79284291400159-0.85373472095314*r;}
float snoise(vec3 v){
  const vec2 C=vec2(1.0/6.0,1.0/3.0); const vec4 D=vec4(0.0,0.5,1.0,2.0);
  vec3 i=floor(v+dot(v,C.yyy)); vec3 x0=v-i+dot(i,C.xxx);
  vec3 g=step(x0.yzx,x0.xyz); vec3 l=1.0-g; vec3 i1=min(g.xyz,l.zxy); vec3 i2=max(g.xyz,l.zxy);
  vec3 x1=x0-i1+C.xxx; vec3 x2=x0-i2+C.yyy; vec3 x3=x0-D.yyy;
  i=mod289(i);
  vec4 p=permute(permute(permute(i.z+vec4(0.0,i1.z,i2.z,1.0))+i.y+vec4(0.0,i1.y,i2.y,1.0))+i.x+vec4(0.0,i1.x,i2.x,1.0));
  float n_=0.142857142857; vec3 ns=n_*D.wyz-D.xzx;
  vec4 j=p-49.0*floor(p*ns.z*ns.z); vec4 x_=floor(j*ns.z); vec4 y_=floor(j-7.0*x_);
  vec4 x=x_*ns.x+ns.yyyy; vec4 y=y_*ns.x+ns.yyyy; vec4 h=1.0-abs(x)-abs(y);
  vec4 b0=vec4(x.xy,y.xy); vec4 b1=vec4(x.zw,y.zw);
  vec4 s0=floor(b0)*2.0+1.0; vec4 s1=floor(b1)*2.0+1.0; vec4 sh=-step(h,vec4(0.0));
  vec4 a0=b0.xzyw+s0.xzyw*sh.xxyy; vec4 a1=b1.xzyw+s1.xzyw*sh.zzww;
  vec3 p0=vec3(a0.xy,h.x); vec3 p1=vec3(a0.zw,h.y); vec3 p2=vec3(a1.xy,h.z); vec3 p3=vec3(a1.zw,h.w);
  vec4 norm=taylorInvSqrt(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));
  p0*=norm.x; p1*=norm.y; p2*=norm.z; p3*=norm.w;
  vec4 m=max(0.6-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.0); m=m*m;
  return 42.0*dot(m*m,vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));
}
float fbm(vec3 p, int oct){ float a=0.5, s=0.0; for(int i=0;i<9;i++){ if(i>=oct) break; s+=a*snoise(p); p=p*2.03+vec3(1.7,9.2,3.1); a*=0.5; } return s; }
float ridged(vec3 p, int oct){ float a=0.5, s=0.0; for(int i=0;i<6;i++){ if(i>=oct) break; float n=1.0-abs(snoise(p)); s+=a*n*n; p=p*2.1+vec3(3.1,1.7,8.3); a*=0.5; } return s; }
// bump mapping without tangents (Mikkelsen 2010): perturb N by a height field given in metres
vec3 bumpN(vec3 pos, vec3 N, float hgt){
  vec3 dpx = dFdx(pos), dpy = dFdy(pos);
  vec3 r1 = cross(dpy, N), r2 = cross(N, dpx);
  float det = dot(dpx, r1);
  vec3 grad = sign(det) * (dFdx(hgt) * r1 + dFdy(hgt) * r2);
  return normalize(abs(det) * N - grad);
}
`;

// ================================================================ planet surface
const PLANET_VS = `
uniform vec3 uAnchor;
attribute float aH;
varying vec3 vDir;      // planet-fixed unit direction (physics axes)
varying vec3 vLocal;    // object-space position relative to anchor (m)
varying vec3 vNrm;      // terrain normal, object space
varying vec3 vWorld;    // camera-relative world position
varying float vH;       // terrain height (m), unclamped (below sea level for oceans)
#include <common>
#include <logdepthbuf_pars_vertex>
void main(){
  vec3 pf = position + uAnchor;
  vDir = normalize(pf);
  vLocal = position;
  vNrm = normal;
  vH = aH;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
  #include <logdepthbuf_vertex>
}`;

const PLANET_FS = `
uniform int uType;           // 0 earth 1 rocky 2 ice 3 gas 4 haze (from space) 5 star 6 haze-world ground
uniform vec3 uC0, uC1, uC2;
uniform vec3 uSun;
uniform mat3 uRotM;          // planet-fixed (physics axes) -> world (three axes)
uniform float uSeed, uCrat, uBands, uSpot, uCaps, uMaria, uTwo, uVolc, uHeart;
uniform vec3 uKsc;
uniform float uDetail;       // 0 coarse sphere, 1 near-ground patch
uniform vec3 uOff1, uOff2, uOff3;
uniform float uAmb, uSea, uR, uTime, uDepthBias, uSunI;
uniform vec3 uSunC;           // tint of the host star's light
uniform vec3 uSpotP[2], uSpotD[2]; uniform vec4 uSpotK[2];   // vessel searchlights: camera-relative position, beam, (intensity, range, cos outer, cos inner)
uniform vec4 uPatch;          // xyz: centre of the near-ground patch (planet-fixed), w: cos of the cap it covers (2 = none)
// Colour noise of the near-ground patch is baked into two textures in the patch's own polar layout (PATCH_FIELD_FS)
// whenever the patch is rebuilt; FLDA(i, expr) / FLDB(i, expr) read channel i there, or evaluate expr elsewhere.
#ifdef PATCH_FIELDS
uniform sampler2D uFldA, uFldB; uniform vec3 uPE1, uPE2, uPCf; uniform float uPA, uPTh;
vec4 fA, fB;
#define FLDA(i, e) fA[i]
#define FLDB(i, e) fB[i]
#else
#define FLDA(i, e) (e)
#define FLDB(i, e) (e)
#endif
varying vec3 vDir; varying vec3 vLocal; varying vec3 vNrm; varying vec3 vWorld; varying float vH;
#include <common>
#include <logdepthbuf_pars_fragment>
${GLSL_NOISE}
void main(){
  #include <logdepthbuf_fragment>
  #if defined(USE_LOGDEPTHBUF)
    gl_FragDepth += uDepthBias;
  #endif
  vec3 d = vDir;
  // the coarse sphere does not shade what the detailed ground patch covers (that pixel would be paid twice)
  if (uDetail < 0.5 && dot(d, uPatch.xyz) > uPatch.w) discard;
  #ifdef PATCH_FIELDS
  {
    float along = dot(vLocal, uPCf); vec3 perp = vLocal - uPCf * along;
    float th = atan(length(perp), uPA + along);
    vec2 fuv = vec2(atan(dot(perp, uPE2), dot(perp, uPE1)) / 6.2831853, pow(clamp(th / uPTh, 0.0, 1.0), 1.0 / 2.4));
    fA = texture2D(uFldA, fuv); fB = texture2D(uFldB, fuv);
  }
  #endif
  vec3 sp = d * 2.2 + vec3(uSeed);
  vec3 V = normalize(-vWorld);
  vec3 Ng = normalize(uRotM * d);
  vec3 Nt = normalize(uRotM * normalize(vNrm));
  float camDist = length(vWorld);
  // fine detail heights (m) near the camera, continuous across patch rebuilds via uOff*
  float det = 0.0;
  vec3 detN = vec3(0.0);   // fine-relief slope (object space), from finite differences (no 2x2-quad blockiness)
  if (uDetail > 0.5) {
    float w1 = 1.0 - smoothstep(9000.0, 30000.0, camDist);
    float w2 = 1.0 - smoothstep(1500.0, 6000.0, camDist);
    float w3 = 1.0 - smoothstep(150.0, 700.0, camDist);
    vec3 up = d;
    vec3 t1 = normalize(cross(up, abs(up.z) < 0.9 ? vec3(0.0, 0.0, 1.0) : vec3(1.0, 0.0, 0.0)));
    vec3 t2 = cross(up, t1);
    float e = mix(0.25, 6.0, smoothstep(50.0, 4000.0, camDist));
    // each octave only where it still has weight: far from the camera the finest ones cost nothing
    vec3 qx = vLocal + t1 * e, qy = vLocal + t2 * e;
    if (w1 > 0.0) { float a = snoise(vLocal*(1.0/260.0) + uOff1)*6.0*w1; det += a; detN += t1 * ((snoise(qx*(1.0/260.0) + uOff1)*6.0*w1 - a) / e) + t2 * ((snoise(qy*(1.0/260.0) + uOff1)*6.0*w1 - a) / e); }
    if (w2 > 0.0) { float a = snoise(vLocal*(1.0/34.0) + uOff2)*1.2*w2; det += a; detN += t1 * ((snoise(qx*(1.0/34.0) + uOff2)*1.2*w2 - a) / e) + t2 * ((snoise(qy*(1.0/34.0) + uOff2)*1.2*w2 - a) / e); }
    if (w3 > 0.0) { float a = snoise(vLocal*(1.0/4.5) + uOff3)*0.25*w3; det += a; detN += t1 * ((snoise(qx*(1.0/4.5) + uOff3)*0.25*w3 - a) / e) + t2 * ((snoise(qy*(1.0/4.5) + uOff3)*0.25*w3 - a) / e); }
  }
  vec3 col; float spec = 0.0, rough = 1.0; vec3 emis = vec3(0.0);
  // sub-vertex detail for coastlines / snow lines on the coarse sphere (patch vertices are dense enough)
  float hn = vH + FLDA(0, fbm(d * 70.0 + vec3(uSeed), 4)) * 380.0 * (1.0 - uDetail * 0.85) * (uType == 0 ? 1.0 : 0.3);
  float slope = 1.0 - clamp(dot(normalize(vNrm), d), 0.0, 1.0);
  int type = uType;
  if (type == 5) {
    float g = fbm(d*40.0 + vec3(uTime*0.01), 4) * 0.5 + 0.5;
    float mu = max(dot(Ng, V), 0.0);
    col = mix(uC1, uC0, g) * (0.35 + 0.65 * pow(mu, 0.45)) * 9.0;
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    return;
  }
  if (type == 0) {
    float lat = abs(d.z);
    float water = step(hn, uSea);
    float m = FLDA(1, fbm(d*3.1 + vec3(5.0), 5)) * 0.5 + 0.5;          // moisture
    float tmp = 1.0 - lat * 1.2 - max(hn, 0.0) / 4200.0 + (FLDA(2, fbm(d*5.0+2.0,3)))*0.12;  // temperature
    if (water > 0.5) {
      float depth = uSea - hn;
      col = mix(vec3(0.012, 0.075, 0.13), vec3(0.003, 0.018, 0.06), smoothstep(10.0, 1600.0, depth));
      col = mix(col, vec3(0.05, 0.18, 0.2), (1.0 - smoothstep(0.0, 60.0, depth)) * 0.6);
      spec = 1.0; rough = 0.0;
    } else {
      vec3 forest = vec3(0.035, 0.085, 0.025), grass = vec3(0.11, 0.16, 0.05), savanna = vec3(0.26, 0.24, 0.11);
      vec3 desert = vec3(0.50, 0.38, 0.22), tundra = vec3(0.22, 0.22, 0.17), rock = vec3(0.21, 0.19, 0.17);
      vec3 c = mix(grass, forest, smoothstep(0.5, 0.68, m));
      c = mix(c, savanna, smoothstep(0.45, 0.32, m) * smoothstep(0.55, 0.75, tmp));
      c = mix(c, desert, smoothstep(0.38, 0.22, m) * smoothstep(0.6, 0.8, tmp));
      c = mix(c, tundra, smoothstep(0.42, 0.25, tmp));
      c = mix(c, vec3(0.42, 0.37, 0.27), (1.0 - smoothstep(1.0, 24.0, hn)) * 0.55);   // beaches
      c = mix(c, rock, smoothstep(0.18, 0.4, slope + hn / 9000.0));
      float snow = smoothstep(0.12, 0.0, tmp) + smoothstep(2500.0, 3100.0, hn + FLDA(3, fbm(d*60.0,3))*500.0) * (1.0 - smoothstep(0.35, 0.6, slope));
      c = mix(c, vec3(0.78, 0.81, 0.86), clamp(snow, 0.0, 1.0));
      float ksc = smoothstep(0.9988, 0.99975, dot(d, uKsc));
      c = mix(c, vec3(0.09, 0.15, 0.045), ksc * 0.9);
      c *= 0.85 + 0.3 * (FLDB(0, fbm(d*180.0 + vec3(1.3), 3)) * 0.5 + 0.5);
      col = c * (1.0 + det * 0.03);
      // night lights
      float city = smoothstep(0.62, 0.86, FLDB(1, fbm(d*55.0 + vec3(9.1), 4)) * 0.5 + 0.5) * smoothstep(0.3, 0.55, m) * smoothstep(0.25, 0.5, tmp) * (1.0 - smoothstep(1500.0, 2500.0, hn));
      emis = vec3(1.0, 0.62, 0.3) * city * 0.6;
    }
    float ice = smoothstep(0.82, 0.88, lat + FLDB(2, fbm(d*8.0, 3)) * 0.06);
    col = mix(col, vec3(0.82, 0.86, 0.9), ice);
    spec *= 1.0 - ice; rough = mix(rough, 0.7, ice);
  } else if (type == 1 || type == 6) {
    float n = FLDA(1, fbm(sp, 6));
    float hr = hn / max(uR * 0.006, 300.0);                   // normalised relief
    col = mix(uC0, uC1, smoothstep(-0.5, 0.6, n));
    col = mix(col, mix(uC0, uC1, 0.55) * 0.82, uMaria * smoothstep(-0.2, -1.3, hr) * 0.85);   // darker low basins (maria)
    col = mix(col, uC2, smoothstep(0.4, 1.2, hr) * 0.35 + smoothstep(0.25, 0.6, slope) * 0.25);
    col *= 0.85 + 0.3 * (FLDA(2, fbm(d*160.0 + vec3(uSeed), 3)) * 0.5 + 0.5);
    col = mix(col, vec3(0.9, 0.88, 0.86), uCaps * smoothstep(0.86, 0.93, abs(d.z) + n*0.04));
    col = mix(col, uC1 * 0.45, uTwo * smoothstep(-0.25, 0.25, d.x + n * 0.3));
    if (uVolc > 0.5) { col = mix(col, vec3(0.3, 0.14, 0.04), smoothstep(0.55, 0.72, abs(FLDA(3, snoise(sp*5.0))))); col = mix(col, vec3(0.9, 0.8, 0.3), smoothstep(0.75, 0.9, FLDB(0, fbm(sp*3.0+7.0, 3))*0.5+0.5)*0.5); }
    if (uHeart > 0.5) col = mix(col, uC2, smoothstep(0.25, 0.1, length(d - normalize(vec3(0.8,0.1,0.15)))));
    if (hn < uSea) { col = vec3(0.03, 0.025, 0.02); spec = 0.6; rough = 0.1; }   // methane lakes
    col *= 1.0 + det * 0.04;
  } else if (type == 2) {
    float n = FLDA(1, fbm(sp, 6));
    col = mix(uC0, uC2, smoothstep(-0.3, 0.6, n));
    float crack = 1.0 - smoothstep(0.0, 0.035, abs(FLDA(2, snoise(sp*6.0))));
    float crack2 = 1.0 - smoothstep(0.0, 0.02, abs(FLDA(3, snoise(sp*15.0+7.0))));
    col = mix(col, uC1, max(crack*0.7, crack2*0.45));
    if (uHeart > 0.5) col = mix(col, vec3(0.95,0.92,0.86), smoothstep(0.35, 0.2, length(d - normalize(vec3(0.85,0.0,0.2)))));
    col *= 0.92 + 0.16 * (FLDB(0, fbm(d*140.0, 3)) * 0.5 + 0.5) + det * 0.03;
    spec = 0.15; rough = 0.5;
  } else if (type == 3) {
    float lat = d.z;
    vec3 q = d + 0.06 * vec3(fbm(d*6.0 + vec3(uTime*0.0004, 0.0, 0.0), 4), fbm(d*6.0+3.0, 4), 0.0);
    float turb = fbm(q*vec3(3.0,3.0,1.2)*2.0 + vec3(uSeed), 5);
    float b = sin(lat*uBands*3.14159 + turb*2.4);
    float b2 = sin(lat*uBands*7.3 + turb*5.0);
    col = mix(uC0, uC1, smoothstep(-0.7, 0.7, b));
    col = mix(col, uC2, smoothstep(0.4, 1.0, b2) * 0.45);
    col *= 0.9 + 0.2 * fbm(q*24.0, 3);
    if (uSpot > 0.5) {
      vec2 qq = vec2(atan(d.y, d.x) - 1.2, (lat + 0.37) * 3.0);
      float r = length(qq * vec2(1.0, 2.2));
      float swirl = fbm(vec3(qq*6.0, r*4.0), 3);
      col = mix(col, vec3(0.72, 0.33, 0.18), (1.0 - smoothstep(0.1, 0.2 + swirl*0.03, r)) * 0.85);
    }
  } else {
    float turb = fbm(d*2.0 + vec3(uSeed, uTime*0.0002, 0.0), 6);
    float b = sin(d.z*5.0 + turb*3.0);
    col = mix(uC0, uC1, smoothstep(-1.0, 1.0, b)*0.55);
    col = mix(col, uC2, smoothstep(0.2, 0.7, turb)*0.4);
  }
  // ---- lighting
  vec3 N = Nt;
  vec3 nObj = normalize(vNrm);
  if (type == 0 && hn < uSea) {
    // ocean: flat sea with small wave slopes near the camera
    N = normalize(uRotM * normalize(d - detN * 0.35));
  } else if (type <= 2 || type == 6) {
    N = normalize(uRotM * normalize(nObj - detN));
  } else N = Ng;
  float sunVis = smoothstep(-0.05, 0.08, dot(Ng, uSun));
  float ndl = dot(N, uSun);
  float diff;
  if (type == 3 || type == 4) diff = smoothstep(-0.15, 0.6, ndl) * 0.85 * (0.75 + 0.25 * pow(max(dot(Ng, V), 0.0), 0.3));
  else if (type == 1 || type == 2 || type == 6) {
    // regolith: Lommel-Seeliger-like flat response blended with Lambert
    float mu0 = max(ndl, 0.0), mu = max(dot(N, V), 0.05);
    diff = mix(mu0, 2.0 * mu0 / (mu0 + mu), 0.45) * sunVis;
  } else diff = max(ndl, 0.0) * sunVis;
  vec3 outc = col * (diff * uSunI * uSunC + uAmb) + emis * (1.0 - smoothstep(-0.12, 0.05, dot(Ng, uSun)));
  for (int i = 0; i < 2; i++) {
    if (uSpotK[i].x <= 0.0) continue;
    vec3 Ls = uSpotP[i] - vWorld; float ds = length(Ls); Ls /= ds;
    float cone = smoothstep(uSpotK[i].z, uSpotK[i].w, dot(-Ls, uSpotD[i]));
    float att = uSpotK[i].x / (1.0 + ds * ds * 0.02) * (1.0 - smoothstep(uSpotK[i].y * 0.6, uSpotK[i].y, ds));
    outc += col * vec3(1.0, 0.95, 0.85) * max(dot(N, Ls), 0.0) * cone * att;
  }
  if (spec > 0.0) {
    vec3 H = normalize(V + uSun);
    float fres = 0.02 + 0.98 * pow(1.0 - max(dot(N, V), 0.0), 5.0);
    float nh = max(dot(N, H), 0.0);
    float glint = mix(pow(nh, 30.0) * 0.08, pow(nh, 400.0) * 6.0 + pow(nh, 60.0) * 0.4, 1.0 - rough);
    outc += vec3(1.0, 0.96, 0.88) * glint * spec * sunVis * max(ndl, 0.0) * 4.0 * (0.3 + fres);
    outc += vec3(0.12, 0.2, 0.32) * fres * spec * sunVis * 0.6;
  }
  gl_FragColor = vec4(outc, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

// The patch's colour-noise fields over its cap: x = azimuth / 2pi, y = (angle from the centre / cap)^(1/2.4), the same
// spacing as the patch rings. Channel layout must match the FLDA/FLDB indices in PLANET_FS for each surface type.
const PATCH_FIELD_FS = `
uniform vec3 uPE1, uPE2, uPCf; uniform float uPTh, uSeed; uniform int uType, uHalf;
varying vec2 vUv;
${GLSL_NOISE}
void main(){
  float th = uPTh * pow(vUv.y, 2.4), ph = vUv.x * 6.2831853;
  vec3 d = normalize(uPCf * cos(th) + (uPE1 * cos(ph) + uPE2 * sin(ph)) * sin(th));
  vec3 sp = d * 2.2 + vec3(uSeed);
  vec4 o = vec4(0.0);
  if (uType == 0) o = uHalf == 0 ? vec4(fbm(d * 70.0 + vec3(uSeed), 4), fbm(d*3.1 + vec3(5.0), 5), fbm(d*5.0+2.0,3), fbm(d*60.0,3))
                                 : vec4(fbm(d*180.0 + vec3(1.3), 3), fbm(d*55.0 + vec3(9.1), 4), fbm(d*8.0, 3), 0.0);
  else if (uType == 2) o = uHalf == 0 ? vec4(fbm(d * 70.0 + vec3(uSeed), 4), fbm(sp, 6), snoise(sp*6.0), snoise(sp*15.0+7.0))
                                      : vec4(fbm(d*140.0, 3), 0.0, 0.0, 0.0);
  else o = uHalf == 0 ? vec4(fbm(d * 70.0 + vec3(uSeed), 4), fbm(sp, 6), fbm(d*160.0 + vec3(uSeed), 3), snoise(sp*5.0))
                      : vec4(fbm(sp*3.0+7.0, 3), 0.0, 0.0, 0.0);
  gl_FragColor = o;
}`;

// ================================================================ clouds
const CLOUD_VS = `
varying vec3 vDir; varying vec3 vWorld;
#include <common>
#include <logdepthbuf_pars_vertex>
void main(){ vDir = normalize(position); vec4 wp = modelMatrix * vec4(position, 1.0); vWorld = wp.xyz; gl_Position = projectionMatrix * viewMatrix * wp;
  #include <logdepthbuf_vertex>
}`;
// cloud cover field, baked once per planet into a cube map (13 noise octaves per pixel were ~10 ms a frame at 2x)
const CLOUD_NOISE = `
${GLSL_NOISE}
float clouds(vec3 d){
  vec3 w = vec3(fbm(d*3.0, 3), fbm(d*3.0 + vec3(5.2,1.3,2.8), 3), 0.0);
  float c = fbm(d*4.2 + w*0.35, 7);
  float bands = 0.12 * sin(d.z * 9.0 + w.x * 2.0);      // storm belts
  return c + bands;
}`;
const CLOUD_BAKE_VS = `varying vec3 vDir; void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const CLOUD_BAKE_FS = `varying vec3 vDir; ${CLOUD_NOISE}
void main(){ gl_FragColor = vec4(clouds(normalize(vDir)), 0.0, 0.0, 1.0); }`;
const CLOUD_FS = `
uniform vec3 uSun; uniform mat3 uRotM; uniform float uSpin, uCover, uSunI, uAmb; uniform vec3 uTint; uniform samplerCube uCloud;
varying vec3 vDir; varying vec3 vWorld;
#include <common>
#include <logdepthbuf_pars_fragment>
void main(){
  #include <logdepthbuf_fragment>
  vec3 d = vDir;
  // the weather drifts eastward relative to the ground: the baked field turns slowly about the pole
  float cs = cos(uSpin), sn = sin(uSpin);
  float c = textureCube(uCloud, vec3(cs * d.x + sn * d.y, -sn * d.x + cs * d.y, d.z)).r;
  float cov = smoothstep(uCover, uCover + 0.32, c);
  if (cov < 0.004) discard;
  vec3 Ng = normalize(uRotM * d);
  vec3 V = normalize(-vWorld);
  float ndl = dot(Ng, uSun);
  float lit = smoothstep(-0.12, 0.25, ndl);
  // self-shadowing: thicker cloud is darker underneath
  float thick = smoothstep(uCover, uCover + 0.6, c);
  float viewBelow = step(0.0, -dot(Ng, V));           // looking at the underside from below
  float shade = mix(1.0 - thick * 0.35, 0.55 - thick * 0.3, viewBelow);
  vec3 sunCol = mix(vec3(1.0, 0.45, 0.2), vec3(1.0), smoothstep(-0.05, 0.3, ndl));
  float fwd = pow(max(dot(-V, uSun), 0.0), 8.0) * (1.0 - thick) * 1.5;   // silver lining
  vec3 col = uTint * sunCol * lit * (shade + fwd) * uSunI * 0.95 + uTint * uAmb;
  float a = cov * 0.92;
  gl_FragColor = vec4(col * a, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

// ================================================================ atmosphere
const ATM_VS = `
varying vec3 vWorld;
#include <common>
#include <logdepthbuf_pars_vertex>
void main(){ vec4 wp = modelMatrix * vec4(position, 1.0); vWorld = wp.xyz; gl_Position = projectionMatrix * viewMatrix * wp;
  #include <logdepthbuf_vertex>
}`;
const ATM_FS = `
uniform vec3 uCenter; uniform float uR, uRa, uH; uniform vec3 uBeta; uniform vec3 uSun; uniform float uMie, uSunI, uGroundR;
uniform sampler2D uOdLut;     // optical depth towards the sun by (height, sun cosine), see atmOdLut
varying vec3 vWorld;
#include <common>
#include <logdepthbuf_pars_fragment>
// optical depth (density integral) from p toward the sun; large if the planet blocks the sun
float sunDepth(vec3 p){
  float b = dot(p, uSun), c = dot(p, p), r = sqrt(c), mu = b / r, inner = 0.0;
  if (r < uR) {   // below the reference sphere (a low-lying camera): the sun path first crosses rock of density 1
    inner = -b + sqrt(max(b*b - (c - uR*uR), 0.0));
    r = uR; mu = (b + inner) / uR;
  }
  vec2 uv = vec2(sqrt(clamp((r - uR) / (uRa - uR), 0.0, 1.0)), 0.5 + 0.5 * sign(mu) * sqrt(abs(mu)));
  float od = texture2D(uOdLut, (uv * (vec2(ATM_LUT) - 1.0) + 0.5) / vec2(ATM_LUT)).r * 1e4 + inner;
  // soft planet shadow
  float dmin2 = c - b*b;
  float block = (b < 0.0) ? 1.0 - smoothstep(uGroundR*uGroundR*0.985, uGroundR*uGroundR*1.0, dmin2) : 0.0;
  return od + block * 1e7;
}
void main(){
  #include <logdepthbuf_fragment>
  vec3 dir = normalize(vWorld);
  vec3 oc = -uCenter;
  float b = dot(oc, dir);
  float occ = dot(oc, oc);
  float dA = b*b - (occ - uRa*uRa);
  if (dA < 0.0) discard;
  float sA = sqrt(dA);
  float t0 = max(0.0, -b - sA), t1 = -b + sA;
  if (t1 <= 0.0) discard;
  float dP = b*b - (occ - uGroundR*uGroundR);
  if (dP > 0.0) { float tp = -b - sqrt(dP); if (tp > 0.0) t1 = min(t1, tp); }
  bool inside = occ < uRa*uRa;
  const int N = 16;
  vec3 sumR = vec3(0.0); float sumM = 0.0; float od = 0.0;
  float span = t1 - t0;
  float tPrev = t0;
  for (int i = 0; i < N; i++) {
    float u = (float(i) + 1.0) / float(N);
    float tN = t0 + span * (inside ? u*u : u);       // denser samples near the camera when inside
    float seg = tN - tPrev;
    float t = 0.5 * (tN + tPrev);
    tPrev = tN;
    vec3 p = oc + dir * t;
    float h = max(length(p) - uR, 0.0);
    float dens = exp(-h / uH) * (1.0 - smoothstep(uRa - uR - uH*1.5, uRa - uR, h));
    float dseg = dens * seg;
    od += dseg * 0.5;
    float odS = sunDepth(p);
    vec3 att = exp(-uBeta * (od + odS) - uBeta.b * uMie * 0.6 * (od + odS));
    sumR += att * dseg;
    sumM += dot(att, vec3(0.333)) * dseg;
    od += dseg * 0.5;
  }
  float c = dot(dir, uSun);
  float pR = 0.0597 * (1.0 + c*c);
  float g = 0.76;
  float pM = 0.1194 * ((1.0-g*g)*(1.0+c*c)) / ((2.0+g*g)*pow(1.0+g*g-2.0*g*c, 1.5));
  vec3 col = uSunI * (sumR * uBeta * (pR * 1.4 + 0.045) + sumM * uBeta.b * uMie * pM);
  vec3 T = exp(-(uBeta + uBeta.b * uMie * 0.6) * od);
  float a = clamp(1.0 - dot(T, vec3(0.3333)), 0.0, 1.0);
  gl_FragColor = vec4(col, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

// ================================================================ sky background (Milky Way) + stars
// Sky and stars are pure directions (w = 0): never clipped by the near/far planes, at any map zoom or distance.
const SKY_VS = `
varying vec3 vDir;
void main(){ vDir = position; gl_Position = projectionMatrix * vec4(mat3(viewMatrix) * position, 0.0); gl_Position.z = 0.0; }`;
const SKY_FS = `
uniform float uFade, uBand; uniform mat3 uGal;
varying vec3 vDir;
${GLSL_NOISE}
void main(){
  vec3 g = uGal * normalize(vDir);          // x: towards the galactic centre, y: galactic north pole
  float band = exp(-pow(g.y / 0.16, 2.0));
  float bulge = exp(-pow(length(vec2(g.x - 0.85, g.y) / vec2(0.35, 0.22)), 2.0));
  float n = fbm(g * 3.5, 5) * 0.5 + 0.5;
  float dust = smoothstep(0.45, 0.75, fbm(g * 6.0 + vec3(2.0), 4) * 0.5 + 0.5) * exp(-pow(g.y / 0.05, 2.0));
  float glow = (band * (0.5 + 0.7 * n) + bulge * 1.2) * (1.0 - dust * 0.85);
  vec3 col = mix(vec3(0.55, 0.62, 0.85), vec3(1.0, 0.85, 0.65), bulge) * glow * 0.035;
  col += vec3(0.25, 0.1, 0.3) * smoothstep(0.7, 0.95, fbm(g*2.0+vec3(7.0), 4)*0.5+0.5) * band * 0.02;
  gl_FragColor = vec4(col * uFade * uBand, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;
// Sun optical depth table for the atmosphere shader: the same 5-segment midpoint sum the shader used to run 16 times
// per pixel, tabulated over sqrt(height / top) and a sun cosine squeezed towards the horizon. Values / 1e4, half floats.
const ATM_LUT = [64, 256];
function atmOdLut(R, Ra, H) {
  const [nh, nm] = ATM_LUT, data = new Uint16Array(nh * nm);
  for (let j = 0; j < nm; j++) {
    const s = j / (nm - 1) * 2 - 1, mu = Math.sign(s) * s * s;
    for (let i = 0; i < nh; i++) {
      const r = R + (Ra - R) * (i / (nh - 1)) ** 2, b = r * mu, c = r * r;
      const tExit = -b + Math.sqrt(Math.max(b * b - (c - Ra * Ra), 0)), seg = tExit / 5;
      let od = 0;
      for (let k = 0; k < 5; k++) { const t = seg * (k + 0.5), qx = r * Math.sqrt(1 - mu * mu), qz = r * mu + t; od += Math.exp(-Math.max(Math.hypot(qx, qz) - R, 0) / H) * seg; }
      data[j * nh + i] = THREE.DataUtils.toHalfFloat(od / 1e4);
    }
  }
  const tx = new THREE.DataTexture(data, nh, nm, THREE.RedFormat, THREE.HalfFloatType);
  tx.minFilter = tx.magFilter = THREE.LinearFilter; tx.needsUpdate = true;
  return tx;
}
// Relativistic view of the sky (science-fiction mode) for an observer moving at uBeta (v / c, three axes): aberration
// crowds the sky forward, the Doppler factor D blue-shifts and brightens it ahead and reddens it behind.
const BB_GLSL = `
vec3 bbCol(float T){   // blackbody tint, Tanner Helland's fit
  float t = clamp(T, 1000.0, 40000.0) / 100.0; vec3 c;
  c.r = t <= 66.0 ? 1.0 : clamp(1.292936 * pow(t - 60.0, -0.1332047592), 0.0, 1.0);
  c.g = t <= 66.0 ? clamp(0.3900816 * log(t) - 0.6318414, 0.0, 1.0) : clamp(1.1298909 * pow(t - 60.0, -0.0755148492), 0.0, 1.0);
  c.b = t >= 66.0 ? 1.0 : (t <= 19.0 ? 0.0 : clamp(0.5432068 * log(t - 10.0) - 1.1962541, 0.0, 1.0));
  return c;
}`;
const SKY_CUBE_FS = `
uniform float uFade; uniform samplerCube uCube; uniform vec3 uBeta;
varying vec3 vDir;
${BB_GLSL}
void main(){
  vec3 n = normalize(vDir), tint = vec3(1.0);
  float bl = length(uBeta), k = 1.0;
  if (bl > 1e-5) {   // where the light seen along n came from, and its Doppler factor
    vec3 bh = uBeta / bl; float c1 = dot(n, bh), c0 = (c1 - bl) / (1.0 - bl * c1);
    vec3 pp = n - bh * c1; float pl = length(pp);
    n = bh * c0 + (pl > 1e-7 ? pp / pl : vec3(0.0)) * sqrt(max(1.0 - c0 * c0, 0.0));
    float D = sqrt(1.0 - bl * bl) / (1.0 - bl * c1);
    k = min(D * D * D, 40.0); tint = bbCol(5500.0 * D) / bbCol(5500.0);
  }
  gl_FragColor = vec4(textureCube(uCube, n).rgb * uFade * k * tint, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;
// ---- black hole (science-fiction mode): photons traced through the Schwarzschild field ----
// In the hole's frame a light ray obeys x'' = -1.5 Rs h^2 x / r^5 (h = |x x x'|, conserved): the exact light orbits of
// a Schwarzschild metric. Rays that fall below Rs are lost (the shadow), the others pick up the thin disk where they
// cross it (Shakura-Sunyaev temperature, Doppler beaming of the orbiting gas, gravitational redshift) and end on the
// sky in their bent direction (Einstein ring). Far from the hole the deflection fades and the real sky shows through.
const BH_VS = `
varying vec3 vWorld;
#include <common>
#include <logdepthbuf_pars_vertex>
void main(){ vec4 wp = modelMatrix * vec4(position, 1.0); vWorld = wp.xyz; gl_Position = projectionMatrix * viewMatrix * wp;
  #include <logdepthbuf_vertex>
}`;
const BH_FS = `
uniform vec3 uCenter, uDiskN; uniform float uRs, uRimp, uTime, uFade; uniform vec4 uDisk; uniform samplerCube uSky;
varying vec3 vWorld;
#include <common>
#include <logdepthbuf_pars_fragment>
${BB_GLSL}
float hash3(vec3 p){ p = fract(p * 0.3183099 + vec3(0.71, 0.113, 0.419)); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
vec3 farStars(vec3 d){ vec3 c = floor(d * 260.0); float h = hash3(c); return h > 0.9975 ? vec3(0.9, 0.95, 1.0) * (h - 0.9975) * 900.0 : vec3(0.0); }
void main(){
  #include <logdepthbuf_fragment>
  vec3 dir = normalize(vWorld), oc = -uCenter;
  float b = dot(oc, dir), c = dot(oc, oc) - uRimp * uRimp, disc = b * b - c;
  if (disc < 0.0) discard;
  float t0 = max(0.0, -b - sqrt(disc));
  vec3 x = (oc + dir * t0) / uRs, v = dir;          // in horizon radii
  float h2 = dot(cross(x, v), cross(x, v));
  vec3 e1 = normalize(cross(uDiskN, vec3(0.31, 0.71, 0.63))), e2 = cross(uDiskN, e1);
  vec3 col = vec3(0.0); float trans = 1.0; bool lost = false;
  float rimp = uRimp / uRs;
  for (int i = 0; i < 200; i++) {
    float r = length(x);
    if (r < 1.0) { lost = true; break; }
    if (r > rimp * 1.0005 && dot(x, v) > 0.0) break;
    float dt = clamp(0.06 * r, 0.02, 2.0);
    vec3 xn = x + v * dt;
    v += -1.5 * h2 * xn / pow(dot(xn, xn), 2.5) * dt;
    if (uDisk.y > 0.0) {
      float s0 = dot(x, uDiskN), s1 = dot(xn, uDiskN);
      if (s0 * s1 < 0.0) {
        vec3 p = mix(x, xn, s0 / (s0 - s1)); float rp = length(p);
        if (rp > uDisk.x && rp < uDisk.y) {
          float T = uDisk.z * pow(uDisk.x / rp, 0.75) * pow(max(1.0 - sqrt(uDisk.x / rp), 0.0), 0.25) * 1.9;
          vec3 vel = normalize(cross(uDiskN, p)) * sqrt(0.5 / rp);        // Keplerian, in units of c
          float D = sqrt(1.0 - dot(vel, vel)) / (1.0 + dot(vel, normalize(v)));
          float g = D * sqrt(max(1.0 - 1.0 / rp, 0.0));
          float ang = atan(dot(p, e2), dot(p, e1)) + uTime * 0.6 / pow(rp, 1.5);
          float swirl = 0.55 + 0.45 * sin(rp * 2.3 + 6.0 * sin(ang * 2.0 + rp * 0.7)) * sin(ang * 5.0 - rp * 1.3);
          float I = pow(g, 4.0) * pow(T / uDisk.z, 4.0) * uDisk.w * swirl;
          col += bbCol(T * g) * I * 2.5 * trans; trans *= 0.3;
        }
      }
    }
    x = xn;
  }
  float defl = 1.0 - dot(normalize(v), dir);
  float a = lost ? 1.0 : clamp(defl * 3e4, 0.0, 1.0);
  if (!lost) { vec3 d = normalize(v); col += trans * a * (textureCube(uSky, d).rgb * uFade + farStars(d) * uFade); }
  a = max(a, clamp(max(col.r, max(col.g, col.b)) * 4.0, 0.0, 1.0));
  gl_FragColor = vec4(col, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;
// ---- wormhole (science-fiction mode): light passing the mouth bends towards it ((pi/4)(R/b)^2, as for an Ellis
// throat, exaggerated a little); light through the throat comes from the other mouth's sky, turned and tinted.
const WH_FS = `
uniform vec3 uCenter, uTint; uniform float uR, uRimp, uTime, uFade; uniform samplerCube uSky;
varying vec3 vWorld;
#include <common>
#include <logdepthbuf_pars_fragment>
float hash3(vec3 p){ p = fract(p * 0.3183099 + vec3(0.71, 0.113, 0.419)); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
vec3 farStars(vec3 d){ vec3 c = floor(d * 260.0); float h = hash3(c); return h > 0.9975 ? vec3(0.9, 0.95, 1.0) * (h - 0.9975) * 900.0 : vec3(0.0); }
void main(){
  #include <logdepthbuf_fragment>
  vec3 dir = normalize(vWorld), oc = -uCenter;
  float tca = -dot(oc, dir);
  if (tca < 0.0) discard;
  vec3 pc = oc + dir * tca; float bimp = length(pc), q = bimp / uR;
  vec3 col; float a;
  if (q < 1.0) {
    // the other side: a different star field, swirled towards the rim, tinted, with a thin bright rim of piled-up light
    float sw = 2.5 * (1.0 - q) * (1.0 - q) + uTime * 0.05;
    vec3 d = vec3(dir.z, -dir.y, dir.x);
    d = vec3(d.x * cos(sw) - d.z * sin(sw), d.y, d.x * sin(sw) + d.z * cos(sw));
    vec3 bg = textureCube(uSky, d).rgb * 5.0 + farStars(d) * 1.5 + farStars(d.zxy * 1.37) * 1.5;
    col = bg * mix(vec3(1.0), uTint, 0.6) * (0.7 + 0.6 * (1.0 - q)) + uTint * pow(q, 40.0) * 2.5;
    a = 1.0;
  } else {
    float al = 0.7854 * 1.8 / (q * q);
    vec3 toC = normalize(-pc);
    vec3 d = normalize(dir * cos(al) + toC * sin(al));
    col = (textureCube(uSky, d).rgb + farStars(d)) * uFade + uTint * exp(-(q - 1.0) * 6.0) * 0.6;
    a = clamp(al * 400.0, 0.0, 1.0);
  }
  gl_FragColor = vec4(col, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;
// position: star place relative to the Sun in units of 1e15 m (game scale); uCam: camera, same units.
// Apparent magnitude follows the distance, so nearby stars shift and brighten on an interstellar trip.
const STAR_VS = `
attribute float aMag, aBV; attribute vec3 aCol;
uniform float uPx, uFade; uniform vec3 uCam, uBeta; uniform mat3 uStarRot;   // uStarRot: the field turned into another galaxy's local stars
varying vec3 vCol;
${BB_GLSL}
void main(){
  vec3 rel = position - uCam; float d = length(rel), bl = length(uBeta);
  vec3 n = uStarRot * (rel / d), col = aCol;
  float m = aMag + 1.50515 * log2(d / length(position));        // + 5 log10(d / d0)
  if (bl > 1e-5) {   // aberration and Doppler for a fast observer (science-fiction mode)
    vec3 bh = uBeta / bl; float c0 = dot(n, bh), c1 = (c0 + bl) / (1.0 + bl * c0);
    vec3 pp = n - bh * c0; float pl = length(pp);
    n = bh * c1 + (pl > 1e-7 ? pp / pl : vec3(0.0)) * sqrt(max(1.0 - c1 * c1, 0.0));
    float D = (1.0 + bl * c0) / sqrt(1.0 - bl * bl);
    m -= 3.257 * log(D);                                          // ~D^3 beaming: -7.5 log10 D
    float T = 4600.0 * (1.0 / (0.92 * aBV + 1.7) + 1.0 / (0.92 * aBV + 0.62));
    col *= bbCol(T * D) / max(bbCol(T), vec3(0.05));
  }
  float b = 1.4 * pow(10.0, -0.16 * (m - 1.0));                  // compressed magnitude scale: mag 7 still shows
  vCol = col * min(b, 3.0) * uFade;
  gl_PointSize = m > 8.0 ? 0.0 : (1.6 + 2.2 * sqrt(min(b, 4.0))) * uPx;
  gl_Position = projectionMatrix * vec4(mat3(viewMatrix) * n, 0.0); gl_Position.z = 0.0;
}`;
const STAR_FS = `
varying vec3 vCol;
void main(){
  vec2 q = gl_PointCoord - 0.5; float r = length(q) * 2.0;
  float a = exp(-r * r * 5.0) + exp(-r * 18.0) * 0.4;
  if (a < 0.01) discard;
  gl_FragColor = vec4(vCol * a, 1.0);
}`;
// B-V colour index -> star tint
const BV_STOPS = [[-0.4, [0.61, 0.70, 1.0]], [0.0, [0.78, 0.84, 1.0]], [0.4, [0.95, 0.95, 1.0]], [0.65, [1.0, 0.95, 0.86]],
  [1.0, [1.0, 0.84, 0.66]], [1.5, [1.0, 0.72, 0.48]], [2.0, [1.0, 0.58, 0.32]]];
// light tint of a star relative to the Sun (the Sun stays white)
function starTint(s) { if (!s._tint) { const c = bvColor(s.bv), w = bvColor(0.656); s._tint = c.map((x, k) => Math.min(1.2, x / w[k])); } return s._tint; }
function bvColor(bv) {
  if (bv <= BV_STOPS[0][0]) return BV_STOPS[0][1].slice();
  for (let i = 1; i < BV_STOPS.length; i++) if (bv <= BV_STOPS[i][0]) { const [x0, c0] = BV_STOPS[i - 1], [x1, c1] = BV_STOPS[i], f = (bv - x0) / (x1 - x0); return c0.map((c, k) => c + (c1[k] - c) * f); }
  return BV_STOPS[BV_STOPS.length - 1][1].slice();
}

function hexToVec(h) { const c = new THREE.Color(h); c.convertSRGBToLinear(); return new THREE.Vector3(c.r, c.g, c.b); }

// colours used on the ground of haze-covered worlds (Venus, Titan)
const GROUND_COLS = { venus: ['#7a5233', '#4a2e1c', '#a37552'], titan: ['#4a3420', '#2a1d12', '#6b5034'] };

const SPOT_U = { p: { value: [new THREE.Vector3(), new THREE.Vector3()] }, d: { value: [new THREE.Vector3(0, -1, 0), new THREE.Vector3(0, -1, 0)] },
  k: { value: [new THREE.Vector4(), new THREE.Vector4()] } };
function makePlanetMaterial(b, ground, patch) {
  const vis = b.vis;
  let typeId = { earth: 0, rocky: 1, ice: 2, gas: 3, cloud: 4, star: 5 }[vis.type];
  const gc = ground && GROUND_COLS[b.id];
  if (gc) typeId = 6;
  const cols = gc || vis.c;
  const kscDir = V.norm(surfacePoint(BODY.earth, KSC.lat, KSC.lon, 0));
  return new THREE.ShaderMaterial({
    uniforms: {
      uType: { value: typeId }, uC0: { value: hexToVec(cols[0]) }, uC1: { value: hexToVec(cols[1]) }, uC2: { value: hexToVec(cols[2]) },
      uSun: { value: new THREE.Vector3(1, 0, 0) }, uRotM: { value: new THREE.Matrix3() },
      uSeed: { value: (b.id.charCodeAt(0) * 13.7 + b.id.length * 3.1) % 50 },
      uCrat: { value: vis.crat || 0 }, uBands: { value: vis.bands || 8 }, uSpot: { value: vis.spot || 0 }, uCaps: { value: vis.caps || 0 },
      uMaria: { value: vis.maria || 0 }, uTwo: { value: vis.twotone || 0 }, uVolc: { value: vis.volc || 0 }, uHeart: { value: vis.heart || 0 },
      uKsc: { value: new THREE.Vector3(kscDir[0], kscDir[1], kscDir[2]) }, uAnchor: { value: new THREE.Vector3() }, uDetail: { value: 0 },
      uOff1: { value: new THREE.Vector3() }, uOff2: { value: new THREE.Vector3() }, uOff3: { value: new THREE.Vector3() },
      uAmb: { value: 0.03 }, uSea: { value: b.terrain && b.terrain.sea != null ? b.terrain.sea : -1e9 }, uR: { value: b.R },
      uTime: { value: 0 }, uDepthBias: { value: 0 }, uSunI: { value: SUN_I }, uSunC: { value: new THREE.Vector3(1, 1, 1) },
      // shared with every planet material: one update reaches the bodies and the ground patch
      uSpotP: SPOT_U.p, uSpotD: SPOT_U.d, uSpotK: SPOT_U.k, uPatch: { value: new THREE.Vector4(0, 0, 1, 2) },
    },
    defines: patch ? { PATCH_FIELDS: '' } : {},
    vertexShader: PLANET_VS, fragmentShader: PLANET_FS,
  });
}

// ================================================================ renderer setup
// MSAA only below a 1.5 render scale (the effective one, after dynamic resolution): on a Retina screen the pixels
// are fine enough already, and a 4x multisampled half-float buffer there cost ~11 ms a frame
function gfxSettings() {
  const q = RV.quality;
  const s = {
    high: { dpr: Math.min(window.devicePixelRatio || 1, 2), bloom: true, shadows: 2048, msaa: 4 },
    medium: { dpr: Math.min(window.devicePixelRatio || 1, 1.5), bloom: true, shadows: 1024, msaa: 4 },
    low: { dpr: 1, bloom: false, shadows: 0, msaa: 0 },
  }[q] || {};
  if (Math.min(RV.dpr || s.dpr || 1, s.dpr || 1) >= 1.5) s.msaa = 0;
  return s;
}
function setFov(f) { RV.fov = f; try { localStorage.setItem('orbita.fov', String(f)); } catch (e) { /* ignore */ } }
function setQuality(q) {
  RV.quality = q;
  try { localStorage.setItem('orbita.gfx', q); } catch (e) { /* ignore */ }
  RV.dpr = null;
  buildComposer();
  resizeRenderer();
}
// dynamic resolution: on HiDPI screens fill rate, not the CPU, sets the frame rate (Retina at "high" ran
// 14-40 fps vs 60 at 1x), so the render scale drifts between 1x and the quality cap. Down fast, up slowly.
const DYN = { ft: 1 / 60, low: 0, ok: 0 };
function adaptResolution(dt) {
  const max = gfxSettings().dpr || 1;
  if (max <= 1 || !(dt > 0)) return;
  DYN.ft += (dt - DYN.ft) * 0.05;
  DYN.low = DYN.ft > 1 / 45 ? DYN.low + dt : 0;
  DYN.ok = DYN.ft < 1 / 56 ? DYN.ok + dt : 0;
  const cur = RV.renderer.getPixelRatio();
  let next = cur;
  if (DYN.low > 1) next = Math.max(1, cur - 0.25);
  else if (DYN.ok > 5 && cur < max) next = Math.min(max, cur + 0.25);
  if (next === cur) return;
  DYN.low = DYN.ok = 0;
  const msaaWas = gfxSettings().msaa;
  RV.dpr = next;
  if (gfxSettings().msaa !== msaaWas) buildComposer();   // crossing the 1.5 scale switches multisampling
  resizeRenderer();
}

function initRenderer(canvas) {
  try { RV.quality = localStorage.getItem('orbita.gfx') || 'high'; RV.fov = +localStorage.getItem('orbita.fov') || 55; } catch (e) { RV.quality = 'high'; RV.fov = 55; }
  const r = new THREE.WebGLRenderer({ canvas, antialias: false, logarithmicDepthBuffer: true, powerPreference: 'high-performance' });
  r.toneMapping = THREE.ACESFilmicToneMapping;
  r.toneMappingExposure = 1.0;
  r.outputColorSpace = THREE.SRGBColorSpace;
  r.autoClear = false;
  r.shadowMap.enabled = true;
  r.shadowMap.type = THREE.PCFSoftShadowMap;
  RV.renderer = r;
  RV.scene = new THREE.Scene();
  RV.scene.background = new THREE.Color(0x000000);
  RV.camera = new THREE.PerspectiveCamera(60, 1, 0.1, 1e14);
  RV.qM = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
  // lights for vessels and props
  RV.sunLight = new THREE.DirectionalLight(0xfff4e6, 3.2);
  RV.sunLight.position.set(1, 0, 0);
  RV.sunLight.shadow.bias = -0.0004; RV.sunLight.shadow.normalBias = 0.03;
  RV.scene.add(RV.sunLight); RV.scene.add(RV.sunLight.target);
  RV.ambient = new THREE.HemisphereLight(0x8aa8ff, 0x3a3128, 0.25); RV.scene.add(RV.ambient);
  RV.engineLight = new THREE.PointLight(0xffa860, 0, 120, 1.4); RV.scene.add(RV.engineLight);
  // searchlights of the active vessel: a fixed pool (changing the light count would recompile every material)
  RV.spots = [0, 1].map(() => { const sp = new THREE.SpotLight(0xfff0d8, 0, 140, 0.5, 0.45, 1.4); RV.scene.add(sp); RV.scene.add(sp.target); return sp; });
  buildEnvMaps();
  buildSky();
  buildDeepSky();
  buildBodies();
  buildSun();
  buildGroundPatch();
  buildShadowCatcher();
  buildKSC();
  buildComposer();
  resizeRenderer();
  window.addEventListener('resize', resizeRenderer);
}

// FXAA (after Lottes' FXAA 3, the compact "console" form) on the tone-mapped image
const FXAA_FS = `
uniform sampler2D tDiffuse; uniform vec2 resolution; varying vec2 vUv;
void main(){
  vec2 px = 1.0 / resolution;
  vec3 nw = texture2D(tDiffuse, vUv + vec2(-1.0, -1.0) * px).rgb, ne = texture2D(tDiffuse, vUv + vec2(1.0, -1.0) * px).rgb;
  vec3 sw = texture2D(tDiffuse, vUv + vec2(-1.0, 1.0) * px).rgb, se = texture2D(tDiffuse, vUv + vec2(1.0, 1.0) * px).rgb;
  vec4 m = texture2D(tDiffuse, vUv);
  vec3 L = vec3(0.299, 0.587, 0.114);
  float lnw = dot(nw, L), lne = dot(ne, L), lsw = dot(sw, L), lse = dot(se, L), lm = dot(m.rgb, L);
  float lmin = min(lm, min(min(lnw, lne), min(lsw, lse))), lmax = max(lm, max(max(lnw, lne), max(lsw, lse)));
  vec2 dir = vec2(-((lnw + lne) - (lsw + lse)), (lnw + lsw) - (lne + lse));
  float red = max((lnw + lne + lsw + lse) * (0.25 / 8.0), 1.0 / 128.0);
  dir = clamp(dir / (min(abs(dir.x), abs(dir.y)) + red), vec2(-8.0), vec2(8.0)) * px;
  vec3 a = 0.5 * (texture2D(tDiffuse, vUv + dir * (1.0 / 3.0 - 0.5)).rgb + texture2D(tDiffuse, vUv + dir * (2.0 / 3.0 - 0.5)).rgb);
  vec3 b = a * 0.5 + 0.25 * (texture2D(tDiffuse, vUv - dir * 0.5).rgb + texture2D(tDiffuse, vUv + dir * 0.5).rgb);
  float lb = dot(b, L);
  gl_FragColor = vec4((lb < lmin || lb > lmax) ? a : b, m.a);
}`;
function buildComposer() {
  const s = gfxSettings();
  const r = RV.renderer;
  if (RV.composer) RV.composer.dispose && RV.composer.dispose();
  const rt = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, samples: s.msaa || 0 });
  RV.composer = new THREE.EffectComposer(r, rt);
  RV.renderPass = new THREE.RenderPass(RV.scene, RV.camera);
  RV.composer.addPass(RV.renderPass);
  RV.bloom = null;
  if (s.bloom) {
    RV.bloom = new THREE.UnrealBloomPass(new THREE.Vector2(256, 256), 0.5, 0.55, 2.2);
    RV.composer.addPass(RV.bloom);
  }
  RV.composer.addPass(new THREE.OutputPass());
  // without MSAA (Retina) a cheap edge smoothing on the final image keeps thin struts and pad edges from stair-stepping
  RV.fxaa = null;
  if (!s.msaa && s.bloom) {
    RV.fxaa = new THREE.ShaderPass({ uniforms: { tDiffuse: { value: null }, resolution: { value: new THREE.Vector2(1, 1) } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }', fragmentShader: FXAA_FS });
    RV.composer.addPass(RV.fxaa);
  }
  r.shadowMap.enabled = !!s.shadows;
  RV.sunLight.castShadow = !!s.shadows;
  if (s.shadows) { RV.sunLight.shadow.mapSize.set(s.shadows, s.shadows); if (RV.sunLight.shadow.map) { RV.sunLight.shadow.map.dispose(); RV.sunLight.shadow.map = null; } }
}

function resizeRenderer() {
  const w = window.innerWidth, h = window.innerHeight;
  const s = gfxSettings();
  const dpr = Math.min(RV.dpr || s.dpr || 1, s.dpr || 1);
  RV.w = w; RV.h = h;
  RV.renderer.setPixelRatio(dpr);
  RV.renderer.setSize(w, h, false);
  if (RV.composer) { RV.composer.setPixelRatio(dpr); RV.composer.setSize(w, h); }
  if (RV.fxaa) RV.fxaa.material.uniforms.resolution.value.set(Math.round(w * dpr), Math.round(h * dpr));
  RV.camera.aspect = w / h; RV.camera.updateProjectionMatrix();
}

// image-based lighting for vessels: a blue sky dome near the ground, black space above it
function buildEnvMaps() {
  const pm = new THREE.PMREMGenerator(RV.renderer);
  const mk = (top, hor, bot, sun) => {
    const s = new THREE.Scene();
    const m = new THREE.ShaderMaterial({
      side: THREE.BackSide, uniforms: { t: { value: new THREE.Color(top) }, h: { value: new THREE.Color(hor) }, g: { value: new THREE.Color(bot) }, s: { value: sun } },
      vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
      fragmentShader: 'uniform vec3 t,h,g; uniform float s; varying vec3 vP; void main(){ float y = vP.y; vec3 c = y > 0.0 ? mix(h, t, pow(y, 0.6)) : mix(h, g, pow(-y, 0.4)); c += vec3(1.0,0.95,0.85) * s * pow(max(dot(vP, normalize(vec3(0.5,0.6,0.3))), 0.0), 64.0); gl_FragColor = vec4(c, 1.0); }',
    });
    s.add(new THREE.Mesh(new THREE.SphereGeometry(10, 32, 16), m));
    return pm.fromScene(s, 0.02).texture;
  };
  RV.envSky = mk(0x3a6ec4, 0xb8cde6, 0x3b3a2e, 4.0);
  RV.envSpace = mk(0x000000, 0x070a10, 0x0d1626, 0.0);
  RV.scene.environment = RV.envSpace;
  pm.dispose();
}

function buildSky() {
  // the real galactic plane: centre (Sgr A*) and north pole, J2000
  const C = toT(eqToEcl(17.76033, -28.93617)).normalize(), N0 = toT(eqToEcl(12.85730, 27.12825));
  const N = N0.addScaledVector(C, -N0.dot(C)).normalize(), Wg = new THREE.Vector3().crossVectors(C, N);
  const gal = new THREE.Matrix3().set(C.x, C.y, C.z, N.x, N.y, N.z, Wg.x, Wg.y, Wg.z);
  // the procedural Milky Way is baked once into a cube map: noise for every pixel of a Retina screen cost ~10 ms a frame
  const skyGeo = new THREE.SphereGeometry(1, 48, 24);
  RV.skyProc = new THREE.Mesh(skyGeo, new THREE.ShaderMaterial({ uniforms: { uFade: { value: 1 }, uBand: { value: 1 }, uGal: { value: gal } }, vertexShader: SKY_VS, fragmentShader: SKY_FS,
    side: THREE.BackSide, depthWrite: false, depthTest: false }));
  RV.skyCube = new THREE.WebGLCubeRenderTarget(1024, { type: THREE.HalfFloatType });
  RV.beta = new THREE.Vector3();   // observer velocity / c for the relativistic sky (zero unless science fiction)
  RV.sky = new THREE.Mesh(skyGeo, new THREE.ShaderMaterial({ uniforms: { uFade: { value: 1 }, uCube: { value: RV.skyCube.texture }, uBeta: { value: RV.beta } }, vertexShader: SKY_VS, fragmentShader: SKY_CUBE_FS,
    side: THREE.BackSide, depthWrite: false, depthTest: false }));
  RV.sky.renderOrder = -10; RV.sky.frustumCulled = false;
  RV.scene.add(RV.sky);
  bakeSky();
  // the star catalogue (HYG, to magnitude 7): real places, colours and distances
  const n = STARCAT.n, bin = atob(STARCAT.data), u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  const u = new Uint16Array(u8.buffer), dq = (x, lo, hi) => lo + x / 65534 * (hi - lo);
  const pos = new Float32Array(n * 3), col = new Float32Array(n * 3), mag = new Float32Array(n), bvs = new Float32Array(n), tv = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    const k = i * 5, dl = u[k + 2];
    const dist = dl === 65535 ? 1e6 : Math.pow(10, dq(dl, -1, 5)) * PC * SCALE_L * 1e-15;   // unknown distance: effectively infinite
    toT(V.scale(eqToEcl(dq(u[k], 0, 24), dq(u[k + 1], -90, 90)), dist), tv);
    pos.set([tv.x, tv.y, tv.z], i * 3);
    mag[i] = dq(u[k + 3], -2, 8);
    bvs[i] = dq(u[k + 4], -0.5, 3.5);
    col.set(bvColor(bvs[i]), i * 3);
  }
  const mkStars = (g) => new THREE.Points(g, new THREE.ShaderMaterial({ uniforms: { uPx: { value: 1 }, uFade: { value: 1 }, uCam: { value: new THREE.Vector3() }, uBeta: { value: RV.beta }, uStarRot: { value: new THREE.Matrix3() } },
    vertexShader: STAR_VS, fragmentShader: STAR_FS, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false }));
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aCol', new THREE.BufferAttribute(col, 3));
  g.setAttribute('aMag', new THREE.BufferAttribute(mag, 1));
  g.setAttribute('aBV', new THREE.BufferAttribute(bvs, 1));
  RV.stars = mkStars(g);
  RV.stars.renderOrder = -9; RV.stars.frustumCulled = false;
  RV.scene.add(RV.stars);
  // stars that are game bodies (the Sun too, once far away): directions and magnitudes refreshed every frame
  const allStars = ALL_BODIES.filter(b => b.star), gg = new THREE.BufferGeometry(), ns = allStars.length;
  RV.gstarList = allStars;
  gg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(ns * 3), 3));
  gg.setAttribute('aCol', new THREE.BufferAttribute(new Float32Array(allStars.flatMap(s => bvColor(s.bv))), 3));
  gg.setAttribute('aMag', new THREE.BufferAttribute(new Float32Array(ns).fill(99), 1));
  gg.setAttribute('aBV', new THREE.BufferAttribute(new Float32Array(allStars.map(s => s.bv)), 1));
  RV.gstars = mkStars(gg);
  RV.gstars.renderOrder = -9; RV.gstars.frustumCulled = false;
  RV.scene.add(RV.gstars);
}

// render the procedural sky into RV.skyCube (again whenever the backdrop changes)
function bakeSky() {
  const sc = new THREE.Scene();
  sc.add(RV.skyProc);
  new THREE.CubeCamera(0.1, 10, RV.skyCube).update(RV.renderer, sc);
  sc.remove(RV.skyProc);
}

// sphere with per-vertex unit directions; heights are filled in lazily (displaceBody)
function physSphere(radius, ws, hs) {
  const g = new THREE.SphereGeometry(1, ws, hs);
  const p = g.attributes.position, nrm = g.attributes.normal;
  const dirs = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    dirs[i * 3] = x; dirs[i * 3 + 1] = -z; dirs[i * 3 + 2] = y;
    p.setXYZ(i, x * radius, -z * radius, y * radius);
    nrm.setXYZ(i, x, -z, y);
  }
  g.setAttribute('aH', new THREE.BufferAttribute(new Float32Array(p.count), 1));
  g.userData.dirs = dirs;
  g.computeBoundingSphere();
  return g;
}

function buildBodies() {
  for (const b of ALL_BODIES) {
    if (b.bh) { RV.bodies[b.id] = buildBlackHole(b); continue; }
    if (b.wh) { RV.bodies[b.id] = buildWormhole(b); continue; }
    if (b.mega && !b.star) { RV.bodies[b.id] = buildONeill(b); continue; }
    const mat = makePlanetMaterial(b);
    const seg = b.vis.type === 'star' ? 96 : b.terrain ? 256 : 192;
    const geo = physSphere(b.R, seg, seg / 2);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false; mesh.renderOrder = 0;
    RV.scene.add(mesh);
    const rec = { b, mesh, mat, displaced: 0 };
    if (GROUND_COLS[b.id]) rec.groundMat = makePlanetMaterial(b, true);
    if (b.atm) {
      const ra = b.R + b.atm.top;
      const ag = new THREE.SphereGeometry(ra, 128, 64);
      const f = clamp(Math.sqrt(b.atm.p0 / 101.325), 0.12, 3.5);
      const beta = b.atm.sky.map(x => x * 0.24 * f / b.atm.H);
      const am = new THREE.ShaderMaterial({
        uniforms: { uCenter: { value: new THREE.Vector3() }, uR: { value: b.R }, uGroundR: { value: b.R }, uRa: { value: ra }, uH: { value: b.atm.H },
          uBeta: { value: new THREE.Vector3(beta[0], beta[1], beta[2]) }, uSun: { value: new THREE.Vector3(1, 0, 0) },
          uMie: { value: b.id === 'mars' ? 1.6 : b.id === 'titan' || b.id === 'venus' ? 1.2 : b.gas ? 0.4 : 0.22 }, uSunI: { value: SUN_I * Math.PI },
          uOdLut: { value: atmOdLut(b.R, ra, b.atm.H) } },
        defines: { ATM_LUT: `vec2(${ATM_LUT[0]}.0, ${ATM_LUT[1]}.0)` },
        vertexShader: ATM_VS, fragmentShader: ATM_FS, side: THREE.BackSide, transparent: false, depthWrite: false, depthTest: false,
        blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
      });
      const atm = new THREE.Mesh(ag, am);
      atm.renderOrder = 1; atm.frustumCulled = false;
      RV.scene.add(atm);
      rec.atm = atm; rec.atmMat = am;
    }
    if (b.id === 'earth') {
      const cg = new THREE.SphereGeometry(1, 192, 96);
      const p = cg.attributes.position;
      const rr = b.R + 5000;
      for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i), z = p.getZ(i); p.setXYZ(i, x * rr, -z * rr, y * rr); }
      cg.computeBoundingSphere();
      rec.cloudCube = new THREE.WebGLCubeRenderTarget(1024, { type: THREE.HalfFloatType, format: THREE.RedFormat, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter });
      const bake = new THREE.Scene();
      bake.add(new THREE.Mesh(cg, new THREE.ShaderMaterial({ vertexShader: CLOUD_BAKE_VS, fragmentShader: CLOUD_BAKE_FS, side: THREE.DoubleSide })));
      new THREE.CubeCamera(rr * 0.5, rr * 2, rec.cloudCube).update(RV.renderer, bake);
      const cm = new THREE.ShaderMaterial({
        uniforms: { uSun: { value: new THREE.Vector3() }, uRotM: { value: new THREE.Matrix3() }, uSpin: { value: 0 }, uCover: { value: 0.06 },
          uSunI: { value: SUN_I }, uAmb: { value: 0.02 }, uTint: { value: new THREE.Vector3(1, 1, 1) }, uCloud: { value: rec.cloudCube.texture } },
        vertexShader: CLOUD_VS, fragmentShader: CLOUD_FS, side: THREE.DoubleSide, transparent: false, depthWrite: false,
        blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
      });
      rec.clouds = new THREE.Mesh(cg, cm);
      rec.clouds.renderOrder = 0.5; rec.clouds.frustumCulled = false;
      RV.scene.add(rec.clouds);
    }
    if (b.rings) {
      const rg = new THREE.RingGeometry(b.R * b.rings[0], b.R * b.rings[1], 256, 6);
      const tex = ringTexture();
      const p = rg.attributes.position, uv = rg.attributes.uv;
      for (let i = 0; i < p.count; i++) { const rr = Math.hypot(p.getX(i), p.getY(i)); uv.setXY(i, (rr / b.R - b.rings[0]) / (b.rings[1] - b.rings[0]), 0.5); }
      const rm = new THREE.ShaderMaterial({
        uniforms: { map: { value: tex }, uSun: { value: new THREE.Vector3() }, uCenter: { value: new THREE.Vector3() }, uR: { value: b.R } },
        vertexShader: `varying vec2 vUv; varying vec3 vW;
          #include <common>
          #include <logdepthbuf_pars_vertex>
          void main(){ vUv = uv; vec4 wp = modelMatrix*vec4(position,1.0); vW = wp.xyz; gl_Position = projectionMatrix*viewMatrix*wp;
          #include <logdepthbuf_vertex>
          }`,
        fragmentShader: `uniform sampler2D map; uniform vec3 uSun, uCenter; uniform float uR; varying vec2 vUv; varying vec3 vW;
          #include <common>
          #include <logdepthbuf_pars_fragment>
          void main(){
            #include <logdepthbuf_fragment>
            vec4 t = texture2D(map, vUv);
            // planet shadow on the rings
            vec3 p = vW - uCenter; float along = dot(p, uSun); float perp = length(p - uSun*along);
            float sh = (along < 0.0) ? smoothstep(uR*0.97, uR*1.03, perp) : 1.0;
            vec3 c = t.rgb * (0.08 + 1.5 * sh);
            gl_FragColor = vec4(c * t.a, t.a);
            #include <tonemapping_fragment>
            #include <colorspace_fragment>
          }`,
        transparent: true, side: THREE.DoubleSide, depthWrite: false,
        blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
      });
      const ring = new THREE.Mesh(rg, rm);
      ring.renderOrder = 2; ring.frustumCulled = false;
      RV.scene.add(ring);
      const W = b.children.length ? b.children[0].el.W : [0, 0, 1];
      ring.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), toT(W).normalize());
      rec.ring = ring; rec.ringMat = rm;
    }
    if (b.mega && b.star) rec.dyson = buildDyson(b);
    RV.bodies[b.id] = rec;
  }
}

// ---- megastructures (science-fiction mode) ----
// "Island Three": two counter-rotating cylinders (32 x 8 km, here 1:10), three land strips and three window strips each,
// with the long mirrors that bounce sunlight in through the windows
function buildONeill(b) {
  const L = b.mega.size * 100, R = L / 8, grp = new THREE.Group();
  const tex = canvasTexOrbit(1024, 256, (x, w, h) => {
    for (let i = 0; i < 6; i++) {
      const x0 = i * w / 6;
      if (i % 2 === 0) {   // land: fields, woods, lakes, a town
        x.fillStyle = '#4c6a34'; x.fillRect(x0, 0, w / 6, h);
        for (let k = 0; k < 140; k++) { x.fillStyle = ['#5d7c3c', '#3d5a2a', '#7a7a48', '#3b6e8c', '#9a8f78'][k % 5]; x.fillRect(x0 + Math.random() * w / 6, Math.random() * h, 6 + Math.random() * 30, 3 + Math.random() * 10); }
      } else {             // windows: glass ribs over the lit interior
        x.fillStyle = '#16263a'; x.fillRect(x0, 0, w / 6, h);
        x.fillStyle = 'rgba(160,200,255,0.25)'; for (let k = 0; k < h; k += 8) x.fillRect(x0, k, w / 6, 1);
      }
    }
  });
  // the window strips glow with the daylight the mirrors throw inside
  const glow = canvasTexOrbit(1024, 256, (x, w, h) => { x.fillStyle = '#000'; x.fillRect(0, 0, w, h); for (let i = 1; i < 6; i += 2) { const g = x.createLinearGradient(i * w / 6, 0, (i + 1) * w / 6, 0); g.addColorStop(0, '#38506a'); g.addColorStop(0.5, '#9ec4e8'); g.addColorStop(1, '#38506a'); x.fillStyle = g; x.fillRect(i * w / 6, 0, w / 6, h); } });
  const hull = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6, metalness: 0.2, emissive: 0xffffff, emissiveMap: glow, emissiveIntensity: 0.9 });
  const steel = new THREE.MeshStandardMaterial({ color: 0x9aa4ae, roughness: 0.45, metalness: 0.7 });
  const mirror = new THREE.MeshStandardMaterial({ color: 0xe8eef6, metalness: 1, roughness: 0.15, side: THREE.DoubleSide });
  for (const side of [-1, 1]) {
    const cyl = new THREE.Group(); cyl.position.x = side * R * 1.4;
    const tube = new THREE.Mesh(new THREE.CylinderGeometry(R, R, L, 64, 1, false), [hull, steel, steel]);
    cyl.add(tube);
    for (const end of [-1, 1]) { const cap = new THREE.Mesh(new THREE.SphereGeometry(R, 32, 16, 0, TAU, 0, Math.PI / 2), steel); cap.scale.y = 0.35 * end; cap.position.y = end * L / 2; cyl.add(cap); }
    for (let i = 0; i < 3; i++) {   // mirrors hinged at the sunward end
      const a = (i * 2 + 1) * Math.PI / 3, m = new THREE.Mesh(new THREE.PlaneGeometry(R * 1.05, L), mirror);
      const hinge = new THREE.Group(); hinge.rotation.y = a; hinge.position.y = L / 2;
      m.position.set(R * 1.02 + Math.sin(0.5) * L / 2, -Math.cos(0.5) * L / 2, 0); m.rotation.z = 0.5; m.rotation.y = Math.PI / 2;
      hinge.add(m); cyl.add(hinge);
    }
    cyl.userData.spin = side;
    grp.add(cyl);
  }
  const truss = new THREE.Mesh(new THREE.BoxGeometry(R * 2.8, R * 0.15, R * 0.15), steel); truss.position.y = -L * 0.52; grp.add(truss);
  grp.traverse(o => { if (o.isMesh) o.frustumCulled = false; });
  RV.scene.add(grp);
  return { b, mesh: grp, mega: true, size: L };
}
function canvasTexOrbit(w, h, draw) { const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = THREE.RepeatWrapping; return t; }

// a ringworld round a star, and a Dyson swarm of collectors whose orbits run in the vertex shader
function buildDyson(b) {
  const R = b.mega.ring * AU * SCALE_L, W = R * 0.011, grp = new THREE.Group();
  const land = canvasTexOrbit(2048, 128, (x, w, h) => {
    x.fillStyle = '#2a4f7a'; x.fillRect(0, 0, w, h);
    for (let k = 0; k < 900; k++) { x.fillStyle = ['#4f7a3a', '#6d6a3e', '#3e6a33', '#8a7e5a'][k % 4]; const cx = Math.random() * w, cy = h * (0.15 + Math.random() * 0.7); x.beginPath(); x.ellipse(cx, cy, 8 + Math.random() * 40, 3 + Math.random() * 14, 0, 0, TAU); x.fill(); }
    x.fillStyle = 'rgba(255,255,255,0.35)'; for (let k = 0; k < 500; k++) { x.beginPath(); x.ellipse(Math.random() * w, Math.random() * h, 6 + Math.random() * 30, 2 + Math.random() * 6, 0, 0, TAU); x.fill(); }
    x.fillStyle = '#3a3c40'; x.fillRect(0, 0, w, h * 0.06); x.fillRect(0, h * 0.94, w, h * 0.06);   // rim walls
  });
  land.repeat.set(48, 1);
  const inner = new THREE.Mesh(new THREE.CylinderGeometry(R, R, W, 720, 1, true), new THREE.MeshBasicMaterial({ map: land, side: THREE.BackSide, toneMapped: true }));
  const outer = new THREE.Mesh(new THREE.CylinderGeometry(R * 1.0005, R * 1.0005, W, 720, 1, true), new THREE.MeshStandardMaterial({ color: 0x2c3036, metalness: 0.8, roughness: 0.5 }));
  grp.add(inner, outer);
  // the swarm
  const n = 3000, geo = new THREE.InstancedBufferGeometry().copy(new THREE.PlaneGeometry(1, 1)), orb = new Float32Array(n * 4), rnd = rng(77);
  for (let i = 0; i < n; i++) orb.set([AU * SCALE_L * (b.mega.swarm[0] + rnd() * (b.mega.swarm[1] - b.mega.swarm[0])), (rnd() - 0.5) * 1.6, rnd() * TAU, rnd() * TAU], i * 4);
  geo.instanceCount = n;
  geo.setAttribute('aOrb', new THREE.InstancedBufferAttribute(orb, 4));
  const swarm = new THREE.Mesh(geo, new THREE.ShaderMaterial({ uniforms: { uTime: { value: 0 }, uMu: { value: b.mu }, uSize: { value: 6e7 } }, side: THREE.DoubleSide,
    vertexShader: `attribute vec4 aOrb; uniform float uTime, uMu, uSize; varying float vGlint;
      void main(){
        float r = aOrb.x, a = aOrb.w + uTime * sqrt(uMu / (r * r * r));
        vec3 e1 = vec3(cos(aOrb.z), 0.0, sin(aOrb.z)), e2 = normalize(cross(vec3(sin(aOrb.y) * sin(aOrb.z), cos(aOrb.y), -sin(aOrb.y) * cos(aOrb.z)), e1));
        vec3 c = r * (cos(a) * e1 + sin(a) * e2), nrm = -normalize(c), u = normalize(cross(nrm, vec3(0.0, 1.0, 0.0001))), v = cross(nrm, u);
        vec3 p = c + (u * position.x + v * position.y) * uSize;
        vec4 wp = modelMatrix * vec4(p, 1.0);
        vGlint = pow(max(dot(normalize(cameraPosition - wp.xyz), reflect(normalize(c), nrm)), 0.0), 8.0);
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: `varying float vGlint; void main(){ gl_FragColor = vec4(vec3(0.16, 0.18, 0.24) + vec3(1.0, 0.9, 0.7) * vGlint * 3.0, 1.0); }` }));
  grp.add(swarm);
  grp.traverse(o => { if (o.isMesh) o.frustumCulled = false; });
  RV.scene.add(grp);
  return { grp, swarm };
}

// impostor sphere around a black hole: big enough that the deflection at its edge is negligible
function buildBlackHole(b) {
  const disk = b.bh.disk, rimp = b.R * (disk ? disk.rOut * 1.6 : 14);
  const tilt = new THREE.Vector3(0.3, 1, -0.2).normalize();      // the disk's axis (three axes)
  const mat = new THREE.ShaderMaterial({ uniforms: { uCenter: { value: new THREE.Vector3() }, uDiskN: { value: tilt }, uRs: { value: b.R }, uRimp: { value: rimp },
    uTime: { value: 0 }, uFade: { value: 1 }, uDisk: { value: disk ? new THREE.Vector4(disk.rIn, disk.rOut, disk.T, disk.glow) : new THREE.Vector4() }, uSky: { value: RV.skyCube.texture } },
    vertexShader: BH_VS, fragmentShader: BH_FS, side: THREE.BackSide, transparent: true, depthWrite: false,
    blending: THREE.CustomBlending, blendSrc: THREE.SrcAlphaFactor, blendDst: THREE.OneMinusSrcAlphaFactor });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(rimp, 48, 24), mat);
  mesh.renderOrder = 2; mesh.frustumCulled = false;
  RV.scene.add(mesh);
  return { b, mesh, mat, bh: true, rimp, displaced: 2 };
}

function buildWormhole(b) {
  const rimp = b.R * 40;
  const mat = new THREE.ShaderMaterial({ uniforms: { uCenter: { value: new THREE.Vector3() }, uTint: { value: new THREE.Vector3(...b.wh.tint) }, uR: { value: b.R }, uRimp: { value: rimp },
    uTime: { value: 0 }, uFade: { value: 1 }, uSky: { value: RV.skyCube.texture } },
    vertexShader: BH_VS, fragmentShader: WH_FS, side: THREE.BackSide, transparent: true, depthWrite: false,
    blending: THREE.CustomBlending, blendSrc: THREE.SrcAlphaFactor, blendDst: THREE.OneMinusSrcAlphaFactor });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(rimp, 48, 24), mat);
  mesh.renderOrder = 2; mesh.frustumCulled = false;
  RV.scene.add(mesh);
  return { b, mesh, mat, bh: true, rimp, displaced: 2 };
}

// displace a body's sphere with its terrain (incrementally, a slice per frame)
function displaceBody(rec, budgetMs) {
  const b = rec.b;
  if (!b.terrain || rec.displaced >= 2) return;
  const g = rec.mesh.geometry, p = g.attributes.position, hA = g.attributes.aH, nrm = g.attributes.normal, dirs = g.userData.dirs;
  const n = p.count;
  const seg = Math.sqrt(n / 0.5);
  const spacing = TAU * b.R / seg;
  const sink = Math.min(400, b.hMax * 0.12 + 40);
  if (!rec.dispJob) rec.dispJob = { i: 0, H: new Float32Array(n) };
  const J = rec.dispJob;
  const t0 = performance.now();
  for (; J.i < n; J.i++) {
    if ((J.i & 255) === 0 && performance.now() - t0 > budgetMs) break;
    const d = [dirs[J.i * 3], dirs[J.i * 3 + 1], dirs[J.i * 3 + 2]];
    J.H[J.i] = terrainHeight(b, d, spacing * 0.7);
  }
  if (J.i < n) { rec.displaced = 1; return; }
  const sea = b.terrain.sea;
  for (let i = 0; i < n; i++) {
    const h = J.H[i], hv = (sea != null ? Math.max(h, sea) : h) - sink;
    hA.array[i] = h;
    p.setXYZ(i, dirs[i * 3] * (b.R + hv), dirs[i * 3 + 1] * (b.R + hv), dirs[i * 3 + 2] * (b.R + hv));
  }
  // normals from grid neighbours; the u-seam (ix = 0 / ws) wraps, poles use the radial direction
  const ws = g.parameters ? g.parameters.widthSegments : Math.round(seg), hs = (n / (ws + 1)) - 1;
  const P = (ix, iy) => { const i = iy * (ws + 1) + ix; return [p.getX(i), p.getY(i), p.getZ(i)]; };
  for (let iy = 0; iy <= hs; iy++) for (let ix = 0; ix <= ws; ix++) {
    const i = iy * (ws + 1) + ix;
    const d = [dirs[i * 3], dirs[i * 3 + 1], dirs[i * 3 + 2]];
    if (iy === 0 || iy === hs) { nrm.setXYZ(i, d[0], d[1], d[2]); continue; }
    const l = P(ix === 0 ? ws - 1 : ix - 1, iy), r = P(ix === ws ? 1 : ix + 1, iy), u = P(ix, iy - 1), dn = P(ix, iy + 1);
    let nn = V.norm(V.cross(V.sub(r, l), V.sub(u, dn)));
    if (V.dot(nn, d) < 0) nn = V.neg(nn);
    nrm.setXYZ(i, nn[0], nn[1], nn[2]);
  }
  p.needsUpdate = true; hA.needsUpdate = true; nrm.needsUpdate = true;
  g.computeBoundingSphere();
  rec.dispJob = null; rec.displaced = 2;
  rec.mat.uniforms.uDepthBias.value = 2e-4;
  if (rec.groundMat) rec.groundMat.uniforms.uDepthBias.value = 2e-4;
}

function ringTexture() {
  const c = document.createElement('canvas'); c.width = 2048; c.height = 4;
  const x = c.getContext('2d');
  const rnd = rng(77);
  let a = 0.5;
  for (let i = 0; i < 2048; i++) {
    const t = i / 2048;
    a = clamp(a + (rnd() - 0.5) * 0.25, 0.15, 0.95);
    let o = a * (0.55 + 0.45 * Math.sin(t * 90) * Math.sin(t * 13));
    if (t > 0.56 && t < 0.61) o *= 0.06;              // Cassini division
    if (t > 0.86 && t < 0.875) o *= 0.2;              // Encke gap
    if (t < 0.25) o *= 0.35 + t;                      // faint C ring
    const v = Math.floor(175 + rnd() * 60);
    x.fillStyle = `rgba(${v},${v - 12},${v - 35},${clamp(o, 0, 1)})`;
    x.fillRect(i, 0, 1, 4);
  }
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function glowTexture(stops) {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const x = c.getContext('2d');
  const gr = x.createRadialGradient(128, 128, 0, 128, 128, 128);
  for (const [o, col] of stops) gr.addColorStop(o, col);
  x.fillStyle = gr; x.fillRect(0, 0, 256, 256);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
function streakTexture() {
  const c = document.createElement('canvas'); c.width = 512; c.height = 64;
  const x = c.getContext('2d');
  const gr = x.createRadialGradient(256, 32, 0, 256, 32, 256);
  gr.addColorStop(0, 'rgba(255,240,220,0.9)'); gr.addColorStop(0.15, 'rgba(255,220,180,0.35)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
  x.fillStyle = gr; x.save(); x.scale(1, 0.12); x.fillRect(0, 0, 512, 64 / 0.12); x.restore();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

function buildSun() {
  const mk = (map, renderOrder) => {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: true, transparent: true, toneMapped: true }));
    s.renderOrder = renderOrder; RV.scene.add(s); return s;
  };
  RV.sunCore = mk(glowTexture([[0, 'rgba(255,255,255,1)'], [0.18, 'rgba(255,250,235,1)'], [0.3, 'rgba(255,220,170,0.35)'], [1, 'rgba(0,0,0,0)']]), 3);
  RV.sunHalo = mk(glowTexture([[0, 'rgba(255,230,200,0.5)'], [0.2, 'rgba(255,200,150,0.12)'], [1, 'rgba(0,0,0,0)']]), 3);
  RV.sunStreak = mk(streakTexture(), 3);
}

// ================================================================ near-ground terrain patch
const PATCH_RINGS = 96, PATCH_SEGS = 128;
function buildGroundPatch() {
  const n = (PATCH_RINGS + 1) * PATCH_SEGS;
  const idx = [];
  for (let k = 0; k < PATCH_RINGS; k++) for (let s = 0; s < PATCH_SEGS; s++) {
    const a = k * PATCH_SEGS + s, b = k * PATCH_SEGS + (s + 1) % PATCH_SEGS, c = (k + 1) * PATCH_SEGS + s, d = (k + 1) * PATCH_SEGS + (s + 1) % PATCH_SEGS;
    idx.push(a, c, b, b, c, d);
  }
  const mkGeo = () => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    g.setAttribute('aH', new THREE.BufferAttribute(new Float32Array(n), 1));
    g.setIndex(idx);
    return g;
  };
  // colour-noise field textures of the patch (two RGBA halves), double-buffered with the geometry
  const mkRT = () => new THREE.WebGLRenderTarget(1024, 512, { type: THREE.HalfFloatType, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
    wrapS: THREE.RepeatWrapping, wrapT: THREE.ClampToEdgeWrapping, generateMipmaps: false });
  RV.patch = { geos: [mkGeo(), mkGeo()], cur: 0, fields: [[mkRT(), mkRT()], [mkRT(), mkRT()]], mesh: null, body: null, job: null, anchor: null, ready: false };
}

// bake the colour-noise fields for a finished patch job into `pair` (see PATCH_FIELD_FS)
function bakePatchFields(J, pair) {
  let F = RV.patchField;
  if (!F) {
    const mat = new THREE.ShaderMaterial({ uniforms: { uPE1: { value: new THREE.Vector3() }, uPE2: { value: new THREE.Vector3() }, uPCf: { value: new THREE.Vector3() },
      uPTh: { value: 1 }, uSeed: { value: 0 }, uType: { value: 0 }, uHalf: { value: 0 } }, depthTest: false, depthWrite: false,
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }', fragmentShader: PATCH_FIELD_FS });
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat); quad.frustumCulled = false;
    F = RV.patchField = { mat, scene: new THREE.Scene(), cam: new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1) };
    F.scene.add(quad);
  }
  const u = F.mat.uniforms, pm = RV.patch.mat.uniforms;
  u.uPE1.value.fromArray(J.e1); u.uPE2.value.fromArray(J.e2); u.uPCf.value.fromArray(J.cf); u.uPTh.value = J.thMax;
  u.uSeed.value = pm.uSeed.value; u.uType.value = pm.uType.value === 6 ? 1 : pm.uType.value;
  const r = RV.renderer, prev = r.getRenderTarget();
  for (let h = 0; h < 2; h++) { u.uHalf.value = h; r.setRenderTarget(pair[h]); r.render(F.scene, F.cam); }
  r.setRenderTarget(prev);
}

// keep a terrain patch centred under the camera; rebuilt on a second buffer in time slices
function updateGroundPatch(b, camRelBody, t) {
  const P = RV.patch;
  const camR = V.len(camRelBody);
  const camAlt = camR - b.R;
  const showMax = Math.min(220000, b.R * 0.6);
  if (!b || b.gas || b.vis.type === 'star' || !b.terrain || camAlt > showMax) { if (P.mesh) P.mesh.visible = false; P.job = null; return; }
  if (P.body !== b) {
    if (P.mesh) RV.scene.remove(P.mesh);
    const mat = makePlanetMaterial(b, true, true);
    mat.uniforms.uDetail.value = 1;
    Object.assign(mat.uniforms, { uFldA: { value: null }, uFldB: { value: null }, uPE1: { value: new THREE.Vector3() }, uPE2: { value: new THREE.Vector3() },
      uPCf: { value: new THREE.Vector3() }, uPA: { value: 1 }, uPTh: { value: 1 } });
    P.mesh = new THREE.Mesh(P.geos[P.cur], mat);
    P.mesh.frustumCulled = false; P.mesh.renderOrder = 0;
    RV.scene.add(P.mesh);
    P.body = b; P.mat = mat; P.ready = false; P.job = null; P.anchor = null;
  }
  const cf = V.norm(inertialToBodyFixed(b, t, camRelBody));
  // need a rebuild if the camera moved relative to the patch density or altitude changed a lot
  const hNow = Math.max(camAlt - (P.centerH || 0), 1);
  if (!P.job) {
    let need = !P.ready;
    if (P.ready) {
      const moved = Math.acos(clamp(V.dot(cf, P.cf), -1, 1)) * b.R;
      if (moved > Math.max(3, hNow * 0.06)) need = true;
      if (Math.abs(Math.log(hNow / P.alt)) > 0.12) need = true;
    }
    if (need) startPatchJob(b, cf, hNow);
  }
  if (P.job) runPatchJob(b, 4.5);
  P.mesh.visible = P.ready;
}

function startPatchJob(b, cf, hAlt) {
  const P = RV.patch;
  const horizon = Math.acos(clamp(b.R / (b.R + hAlt), -1, 1));
  const thMax = clamp(horizon * 1.3 + 3000 / b.R, 5000 / b.R, 0.85);
  const e1 = V.perp(cf), e2 = V.cross(cf, e1);
  P.job = { cf, e1, e2, thMax, k: 0, alt: hAlt, geo: P.geos[1 - P.cur], anchorH: null };
}

function runPatchJob(b, budget) {
  const P = RV.patch, J = P.job;
  const t0 = performance.now();
  const g = J.geo, pos = g.attributes.position.array, hA = g.attributes.aH.array;
  const sea = b.terrain.sea;
  if (J.anchorH == null) { J.anchorH = groundHeight(b, J.cf, 2); J.anchor = V.scale(J.cf, b.R + J.anchorH); }
  const A = J.anchor;
  while (J.k <= PATCH_RINGS) {
    const k = J.k;
    const u = k / PATCH_RINGS;
    const th = J.thMax * Math.pow(u, 2.4);
    const thN = J.thMax * Math.pow(Math.min(1, (k + 1) / PATCH_RINGS), 2.4);
    const ct = Math.cos(th), st = Math.sin(th);
    const spacing = Math.max((thN - th) * b.R, th * b.R * TAU / PATCH_SEGS, 1);
    for (let s = 0; s < PATCH_SEGS; s++) {
      const ph = s / PATCH_SEGS * TAU, cp = Math.cos(ph), sp = Math.sin(ph);
      const d = [J.cf[0] * ct + (J.e1[0] * cp + J.e2[0] * sp) * st, J.cf[1] * ct + (J.e1[1] * cp + J.e2[1] * sp) * st, J.cf[2] * ct + (J.e1[2] * cp + J.e2[2] * sp) * st];
      const h = k === 0 ? J.anchorH : terrainHeight(b, d, spacing * 0.6);
      const hv = sea != null ? Math.max(h, sea) : h;
      const i = k * PATCH_SEGS + s;
      const rr = b.R + hv;
      pos[i * 3] = d[0] * rr - A[0]; pos[i * 3 + 1] = d[1] * rr - A[1]; pos[i * 3 + 2] = d[2] * rr - A[2];
      hA[i] = h;
    }
    J.k++;
    if (performance.now() - t0 > budget) return;
  }
  // normals from the grid
  const nrm = g.attributes.normal.array;
  const P3 = (k, s) => { const i = (k * PATCH_SEGS + ((s + PATCH_SEGS) % PATCH_SEGS)) * 3; return [pos[i], pos[i + 1], pos[i + 2]]; };
  for (let k = 0; k <= PATCH_RINGS; k++) for (let s = 0; s < PATCH_SEGS; s++) {
    let nn;
    if (k === 0) nn = J.cf;
    else {
      const a = P3(Math.min(k + 1, PATCH_RINGS), s), c = P3(k - 1, s), l = P3(k, s - 1), r = P3(k, s + 1);
      nn = V.norm(V.cross(V.sub(r, l), V.sub(a, c)));
      const i0 = (k * PATCH_SEGS + s) * 3;
      const up = V.norm([pos[i0] + A[0], pos[i0 + 1] + A[1], pos[i0 + 2] + A[2]]);
      if (V.dot(nn, up) < 0) nn = V.neg(nn);
    }
    const i = (k * PATCH_SEGS + s) * 3;
    nrm[i] = nn[0]; nrm[i + 1] = nn[1]; nrm[i + 2] = nn[2];
  }
  g.attributes.position.needsUpdate = true; g.attributes.normal.needsUpdate = true; g.attributes.aH.needsUpdate = true;
  g.computeBoundingSphere();
  // swap buffers (geometry and its baked colour fields together)
  const pair = P.fields[P.cur];
  bakePatchFields(J, pair);
  P.cur = 1 - P.cur;
  P.mesh.geometry = g;
  P.anchor = A; P.cf = J.cf; P.alt = J.alt; P.centerH = J.anchorH; P.thMax = J.thMax; P.ready = true;
  const u = P.mat.uniforms;
  u.uAnchor.value.set(A[0], A[1], A[2]);
  u.uFldA.value = pair[0].texture; u.uFldB.value = pair[1].texture;
  u.uPE1.value.fromArray(J.e1); u.uPE2.value.fromArray(J.e2); u.uPCf.value.fromArray(J.cf); u.uPA.value = V.len(A); u.uPTh.value = J.thMax;
  // simplex noise repeats every 3*289 along each axis, so reduce the offset in double precision
  const off = (f) => new THREE.Vector3(...A.map(a => { const x = (a * f) % 867; return x < 0 ? x + 867 : x; }));
  u.uOff1.value.copy(off(1 / 260)); u.uOff2.value.copy(off(1 / 34)); u.uOff3.value.copy(off(1 / 4.5));
  P.job = null;
}

// ShadowMaterial disc that catches the vessel's shadow on the ground
function buildShadowCatcher() {
  const m = new THREE.ShadowMaterial({ opacity: 0.55, depthWrite: false });
  m.polygonOffset = true;
  RV.shadowCatcher = new THREE.Mesh(new THREE.CircleGeometry(1, 48), m);
  RV.shadowCatcher.receiveShadow = true; RV.shadowCatcher.renderOrder = 3; RV.shadowCatcher.visible = false;
  RV.scene.add(RV.shadowCatcher);
}

// ================================================================ launch site
function siteTex(w, h, draw) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
function buildKSC() {
  const g = new THREE.Group();
  const std = (o) => new THREE.MeshStandardMaterial(Object.assign({ roughness: 0.85, metalness: 0.05 }, o));
  const noiseFill = (x, w, h, base, amp, n) => { x.fillStyle = base; x.fillRect(0, 0, w, h); for (let i = 0; i < n; i++) { const v = Math.random() * amp; x.fillStyle = `rgba(0,0,0,${v})`; x.fillRect(Math.random() * w, Math.random() * h, 2 + Math.random() * 6, 2 + Math.random() * 6); } };
  const concreteT = siteTex(512, 512, (x, w, h) => {
    noiseFill(x, w, h, '#9a9b98', 0.08, 3000);
    x.strokeStyle = 'rgba(40,40,40,0.35)'; x.lineWidth = 2;
    for (let i = 0; i <= 8; i++) { x.beginPath(); x.moveTo(i * w / 8, 0); x.lineTo(i * w / 8, h); x.stroke(); x.beginPath(); x.moveTo(0, i * h / 8); x.lineTo(w, i * h / 8); x.stroke(); }
    for (let i = 0; i < 25; i++) { x.fillStyle = 'rgba(30,30,30,0.12)'; x.beginPath(); x.arc(Math.random() * w, Math.random() * h, 10 + Math.random() * 40, 0, TAU); x.fill(); }
  });
  const concrete = std({ map: concreteT, color: 0xdddddd });
  const asphaltT = siteTex(256, 256, (x, w, h) => noiseFill(x, w, h, '#3a3c3e', 0.15, 2500));
  const asphalt = std({ map: asphaltT, roughness: 0.95 });
  const dark = std({ color: 0x33373d, roughness: 0.6, metalness: 0.4 });
  const red = std({ color: 0xa8402a, roughness: 0.55, metalness: 0.5 });
  const steel = std({ color: 0x6d7279, roughness: 0.5, metalness: 0.75 });
  const white = std({ color: 0xe4e6e8, roughness: 0.6 });
  const glass = std({ color: 0x1f3550, roughness: 0.1, metalness: 0.9 });
  const vabT = siteTex(512, 512, (x, w, h) => {
    x.fillStyle = '#d9dcdf'; x.fillRect(0, 0, w, h);
    for (let i = 0; i < 32; i++) { x.fillStyle = i % 2 ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.05)'; x.fillRect(i * w / 32, 0, w / 32, h); }
    x.fillStyle = '#5a6068'; x.fillRect(w * 0.36, h * 0.12, w * 0.28, h * 0.88);
    x.strokeStyle = 'rgba(0,0,0,0.3)'; for (let j = 0; j < 14; j++) { x.beginPath(); x.moveTo(w * 0.36, h * (0.12 + j * 0.063)); x.lineTo(w * 0.64, h * (0.12 + j * 0.063)); x.stroke(); }
    x.fillStyle = '#c8402a'; x.fillRect(w * 0.06, h * 0.06, w * 0.22, h * 0.07);
    x.fillStyle = '#ffffff'; x.font = 'bold 34px Arial'; x.fillText('ОРБИТА', w * 0.07, h * 0.115);
  });
  const vabMat = std({ map: vabT, roughness: 0.7 });
  const grassT = siteTex(256, 256, (x, w, h) => { noiseFill(x, w, h, '#4c6a2a', 0.12, 4000); for (let i = 0; i < 3000; i++) { x.fillStyle = `rgba(${90 + Math.random() * 60},${110 + Math.random() * 50},40,0.25)`; x.fillRect(Math.random() * w, Math.random() * h, 1, 3); } });
  void grassT;
  const add = (geo, mat, x, y, z, o) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); if (o) Object.assign(m, o); m.receiveShadow = true; g.add(m); return m; };
  // local frame: +Y up, +X east, +Z south (matches the vessel's pad frame)
  // launch pad: concrete deck with flame trench and lightning masts
  const deck = add(new THREE.CylinderGeometry(22, 26, 3, 64), concrete, 0, -1.5, 0); deck.material = concrete.clone(); deck.material.map = concreteT.clone(); deck.material.map.repeat.set(3, 3); deck.material.map.needsUpdate = true;
  add(new THREE.BoxGeometry(6, 0.2, 36), dark, 0, 0.02, 20);
  const plate = add(new THREE.CylinderGeometry(4.2, 4.2, 0.3, 40), steel, 0, 0.08, 0);
  void plate;
  add(new THREE.TorusGeometry(4.6, 0.3, 10, 48), dark, 0, 0.25, 0).rotation.x = Math.PI / 2;
  for (const [x, z] of [[-20, -20], [20, -20], [-20, 20], [20, 20]]) {
    add(new THREE.CylinderGeometry(0.25, 0.6, 52, 8), steel, x, 26, z);
    add(new THREE.ConeGeometry(0.15, 4, 6), steel, x, 54, z);
  }
  // service tower (north of pad)
  const tw = new THREE.Group();
  const leg = new THREE.BoxGeometry(0.45, 46, 0.45);
  for (const [x, z] of [[-1.8, -1.8], [1.8, -1.8], [-1.8, 1.8], [1.8, 1.8]]) { const m = new THREE.Mesh(leg, red); m.position.set(x, 23, z); m.castShadow = true; tw.add(m); }
  for (let y = 2; y < 46; y += 3.4) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(4, 0.22, 4), red); m.position.y = y; tw.add(m);
    const br = new THREE.Mesh(new THREE.BoxGeometry(0.12, 4.6, 0.12), red); br.position.set(1.9, y + 1.7, 0); br.rotation.z = 0.75; tw.add(br);
    const br2 = br.clone(); br2.position.x = -1.9; br2.rotation.z = -0.75; tw.add(br2);
  }
  for (const y of [14, 28, 40]) { const arm = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.8, 6), dark); arm.position.set(0, y, 4.5); tw.add(arm); }
  const top = new THREE.Mesh(new THREE.ConeGeometry(0.15, 6, 6), dark); top.position.y = 49; tw.add(top);
  tw.position.set(0, 0, -11); tw.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  g.add(tw);
  // water tower
  add(new THREE.CylinderGeometry(0.8, 0.8, 30, 10), steel, 45, 15, -35);
  add(new THREE.SphereGeometry(5, 20, 14), white, 45, 33, -35);
  // crawlerway to the assembly building and service roads
  add(new THREE.BoxGeometry(14, 0.3, 420), asphalt, -40, 0.06, -230);
  add(new THREE.BoxGeometry(420, 0.25, 10), asphalt, -40, 0.05, -440);
  // assembly building
  const vab = add(new THREE.BoxGeometry(110, 140, 90), vabMat, -40, 70, -520);
  vab.castShadow = true;
  add(new THREE.BoxGeometry(150, 40, 120), white, 40, 20, -520);
  add(new THREE.BoxGeometry(152, 4, 122), glass, 40, 34, -520);
  // mission control + R&D + tracking
  add(new THREE.BoxGeometry(80, 18, 50), white, 220, 9, -380);
  add(new THREE.BoxGeometry(82, 5, 52), glass, 220, 13, -380);
  const dome = add(new THREE.SphereGeometry(28, 32, 16, 0, TAU, 0, Math.PI / 2), white, 260, 0, -250);
  void dome;
  for (const [x, z, s] of [[330, -120, 18], [370, -170, 12], [300, -190, 9]]) {
    add(new THREE.CylinderGeometry(s * 0.12, s * 0.2, s * 1.3, 12), white, x, s * 0.65, z);
    const dish = add(new THREE.SphereGeometry(s, 32, 12, 0, TAU, 0, 0.95), white, x, s * 1.5, z);
    dish.rotation.x = -0.9; dish.material = white.clone(); dish.material.side = THREE.DoubleSide;
  }
  // runway south of the pad
  // 1600 x 45 m at 2.56 px/m: threshold bars, numbers, touchdown zone, centre line, edge lines
  const runT = siteTex(4096, 116, (x, w, h) => {
    noiseFill(x, w, h, '#2e3032', 0.1, 14000);
    const m = w / (RUNWAY.e1 - RUNWAY.e0);
    x.fillStyle = 'rgba(230,230,226,0.92)';
    x.fillRect(0, 2, w, 2); x.fillRect(0, h - 4, w, 2);
    for (let e = 160; e < 1440; e += 50) x.fillRect(e * m, h / 2 - 1, 30 * m, 2);
    for (const [e0, dir] of [[6, 1], [1594, -1]]) {
      for (let i = 0; i < 12; i++) { const y = 8 + i * (h - 16) / 12; x.fillRect((dir > 0 ? e0 : e0 - 30) * m, y, 30 * m, (h - 16) / 24); }
      for (const off of [150, 300, 450]) for (const yy of [0.22, 0.7]) x.fillRect((dir > 0 ? e0 + off : e0 - off - 22) * m, yy * h, 22 * m, 0.08 * h);
      x.save(); x.translate((e0 + dir * 60) * m, h / 2); x.rotate(dir > 0 ? -Math.PI / 2 : Math.PI / 2);
      x.font = `bold ${Math.round(h * 0.5)}px Arial`; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(dir > 0 ? '09' : '27', 0, 0); x.restore();
    }
  });
  runT.anisotropy = 16;
  // top at RUNWAY.h above the reference radius (the deck is the local origin), matching groundHeight
  add(new THREE.BoxGeometry(RUNWAY.e1 - RUNWAY.e0, 0.3, RUNWAY.half * 2), std({ map: runT, roughness: 0.9 }), (RUNWAY.e0 + RUNWAY.e1) / 2, RUNWAY.h - KSC_DECK - 0.15, RUNWAY.s);
  // trees
  const treeGeo = new THREE.ConeGeometry(4, 13, 7); treeGeo.translate(0, 9, 0);
  const trunkGeo = new THREE.CylinderGeometry(0.6, 0.8, 4, 6); trunkGeo.translate(0, 2, 0);
  const nT = 420;
  const trees = new THREE.InstancedMesh(treeGeo, std({ color: 0x24401c, roughness: 0.95 }), nT);
  const trunks = new THREE.InstancedMesh(trunkGeo, std({ color: 0x4a3622 }), nT);
  const rr = rng(4242), m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3();
  let placed = 0;
  for (let i = 0; i < 4000 && placed < nT; i++) {
    const x = (rr() - 0.5) * 2600, z = (rr() - 0.5) * 2600;
    if (Math.hypot(x, z) < 120) continue;
    if (Math.abs(x + 40) < 30 && z < 0 && z > -460) continue;
    if (Math.abs(z - 700) < 60 && x > -520 && x < 1120) continue;
    if (x > -120 && x < 300 && z > -600 && z < -200) continue;
    const s = 0.6 + rr() * 0.9;
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rr() * TAU);
    sc.set(s, s * (0.8 + rr() * 0.5), s);
    m4.compose(new THREE.Vector3(x, 0, z), q, sc);
    trees.setMatrixAt(placed, m4); trunks.setMatrixAt(placed, m4);
    placed++;
  }
  trees.count = trunks.count = placed;
  g.add(trees); g.add(trunks);
  g.traverse(o => { if (o.isMesh) o.renderOrder = 4; });
  RV.ksc = g;
  RV.scene.add(g);
}
function updateKSC(t) {
  const b = BODY.earth;
  const pf = surfacePoint(b, KSC.lat, KSC.lon, KSC_DECK);
  const abs = V.add(bodyAbsPos(b, t), bodyFixedToInertial(b, t, pf));
  const d = V.dist(abs, RV.camAbs);
  RV.ksc.visible = d < 90000;
  if (!RV.ksc.visible) return;
  relT(abs, RV.ksc.position);
  const upF = V.norm(pf), eastF = V.norm(V.cross([0, 0, 1], upF)), southF = V.neg(V.cross(upF, eastF));
  const qf = Q.fromBasis(eastF, upF, southF);
  quatT(Q.mul(bodyRotQuat(b, t), qf), RV.ksc.quaternion);
}

// ================================================================ per-frame update
// t: UT; camAbs: heliocentric camera position; camQuat: three quaternion
// opts: {focusBody, focusRel, near, map, skyLight, sunFactor, shadow: {pos (three), size}, engineLight: {pos, power}}
function renderWorld(t, camAbs, camQuat, opts) {
  opts = opts || {};
  RV.camAbs = camAbs;
  const cam = RV.camera;
  cam.position.set(0, 0, 0);
  cam.quaternion.copy(camQuat);
  cam.near = opts.near || 0.1;
  cam.far = opts.far || 1e14;
  for (const k of SPOT_U.k.value) k.x = 0;   // searchlights are switched on per frame by the flight scene
  if (opts.beta) toT(opts.beta, RV.beta); else RV.beta.set(0, 0, 0);
  updateDeepSky(t, camAbs, cam.far, clamp(opts.skyLight || 0, 0, 1));
  cam.fov = opts.fov || (opts.map ? 50 : RV.fov || 55);
  cam.updateProjectionMatrix();
  cam.updateMatrixWorld();
  // the brightest star at the camera lights the scene (the Sun at home)
  const SL = starLight(camAbs, t), prim = SL.star;
  const sunRel = relT(SL.pos);
  const tmp = new THREE.Vector3();
  const hostAbs = {};
  const rotM = new THREE.Matrix3();
  const sky = clamp(opts.skyLight || 0, 0, 1);
  for (const id in RV.bodies) {
    const rec = RV.bodies[id], b = rec.b;
    if (!b.active) { for (const o of [rec.mesh, rec.atm, rec.clouds, rec.ring, rec.dyson && rec.dyson.grp]) if (o) o.visible = false; continue; }
    const abs = bodyAbsPos(b, t);
    relT(abs, rec.mesh.position);
    if (rec.mega) {   // the cylinder pair points at its star, the cylinders turn (a 1 g spin)
      const dist = rec.mesh.position.length(), hd = V.norm(V.sub(bodyAbsPos(b.host, t), abs));
      rec.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), toT(hd).normalize());
      for (const c of rec.mesh.children) if (c.userData.spin) c.rotation.y = c.userData.spin * t * TAU / 40;
      rec.mesh.visible = rec.size / dist > 2e-4;
      continue;
    }
    if (rec.bh) {
      const u = rec.mat.uniforms, dist = rec.mesh.position.length();
      u.uCenter.value.copy(rec.mesh.position); u.uTime.value = t % 1e5; u.uFade.value = 1 - clamp(sky * 1.6, 0, 0.985);
      rec.mesh.visible = rec.rimp / dist > 3e-4;
      continue;
    }
    quatT(bodyRotQuat(b, t), rec.mesh.quaternion);
    rec.mesh.updateMatrixWorld();
    rotM.setFromMatrix4(rec.mesh.matrixWorld);
    const dist = rec.mesh.position.length();
    const hA = hostAbs[b.host.id] || (hostAbs[b.host.id] = b.host === b ? abs : bodyAbsPos(b.host, t));
    const lightDir = V.norm(V.sub(hA, abs));
    const sunDir = toT(lightDir, tmp);
    // haze worlds: show their ground colours when the camera is under the cloud deck
    let mat = rec.mat;
    if (rec.groundMat && opts.focusBody === b && opts.focusRel && V.len(opts.focusRel) - b.R < b.atm.top * 0.6) mat = rec.groundMat;
    if (rec.mesh.material !== mat) rec.mesh.material = mat;
    const u = mat.uniforms;
    u.uSun.value.copy(b.vis.type === 'star' ? sunDir.set(0, 1, 0) : sunDir);
    if (!b.star) u.uSunC.value.fromArray(starTint(b.host));
    u.uRotM.value.copy(rotM);
    u.uAmb.value = opts.map ? 0.1 : (b.atm ? 0.03 + sky * 0.05 : 0.05);
    u.uTime.value = t;
    if (b.terrain && rec.displaced < 2 && dist < b.R * 30) displaceBody(rec, 3);
    if (rec.atm) {
      rec.atm.position.copy(rec.mesh.position);
      rec.atmMat.uniforms.uCenter.value.copy(rec.mesh.position);
      rec.atmMat.uniforms.uSun.value.copy(toT(lightDir));
      rec.atm.visible = dist < b.R * 600;
    }
    if (rec.clouds) {
      rec.clouds.position.copy(rec.mesh.position);
      rec.clouds.quaternion.copy(rec.mesh.quaternion);
      const cu = rec.clouds.material.uniforms;
      cu.uSun.value.copy(toT(lightDir)); cu.uRotM.value.copy(rotM); cu.uSpin.value = (t * 1e-5) % TAU;
      cu.uAmb.value = 0.02 + sky * 0.08;
      rec.clouds.visible = dist < b.R * 300;
    }
    if (rec.ring) {
      rec.ring.position.copy(rec.mesh.position);
      rec.ringMat.uniforms.uSun.value.copy(toT(lightDir));
      rec.ringMat.uniforms.uCenter.value.copy(rec.mesh.position);
    }
    rec.mesh.visible = b.R / dist > (b.star ? 1e-4 : 4e-6);
    if (rec.dyson) {
      rec.dyson.grp.position.copy(rec.mesh.position);
      rec.dyson.swarm.material.uniforms.uTime.value = t % 1e9;
      rec.dyson.grp.visible = b.mega.ring * AU * SCALE_L / dist > 2e-3;
    }
  }
  // sun sprites, dimmed and reddened by the atmosphere the camera sits in
  const sd = sunRel.length();
  const sDir = sunRel.clone().normalize();
  const place = Math.min(1, 1e9 / sd);
  let tr = [1, 1, 1];
  if (opts.focusBody && opts.focusBody.atm && opts.focusRel) {
    const b = opts.focusBody, alt = V.len(opts.focusRel) - b.R;
    if (alt < b.atm.top) {
      const up = toT(V.norm(opts.focusRel)).normalize();
      const mu = up.dot(sDir);
      const a = Math.acos(clamp(mu, -1, 1)) / DEG;
      const airmass = 1 / (Math.max(mu, 0) + 0.15 * Math.pow(Math.max(93.885 - a, 0.35), -1.253));
      const od = Math.exp(-Math.max(alt, 0) / b.atm.H) * b.atm.H * airmass;
      const f = clamp(Math.sqrt(b.atm.p0 / 101.325), 0.12, 3.5);
      tr = b.atm.sky.map(x => Math.exp(-x * 0.24 * f / b.atm.H * od * 1.3));
      if (mu < -0.02) tr = tr.map(x => x * clamp(1 + (mu + 0.02) * 30, 0, 1));
    }
  }
  // a dim primary (outer space) fades from a glare into a point of the star field
  const glare = clamp((Math.log10(Math.max(SL.fMain, 1e-12)) + 6) / 2, 0, 1), tint = starTint(prim);
  tr = tr.map((x, k) => x * tint[k]);
  const sunAng = prim.R / sd;
  const coreS = Math.max(sunAng * 2 * 3.2, 0.006 * Math.max(glare, 0.15)) * Math.min(sd, 1e9);
  RV.sunCore.position.copy(sunRel).multiplyScalar(place);
  RV.sunCore.scale.set(coreS, coreS, 1);
  const coreI = (2.5 + 3.5 * tint[2] * tint[2]) * glare;   // a red dwarf's glare stays orange instead of burning out to white
  RV.sunCore.material.color.setRGB(coreI * tr[0], coreI * tr[1], coreI * tr[2]);
  RV.sunHalo.position.copy(RV.sunCore.position);
  const haloS = coreS * (opts.map ? 6 : 14);
  RV.sunHalo.scale.set(haloS, haloS, 1);
  RV.sunHalo.material.color.setRGB(tr[0] * (0.5 + sky) * glare, tr[1] * (0.5 + sky) * glare, tr[2] * (0.5 + sky) * glare);
  RV.sunStreak.position.copy(RV.sunCore.position);
  RV.sunStreak.scale.set(coreS * 22, coreS * 2.5, 1);
  RV.sunStreak.material.color.setRGB(0.6 * tr[0], 0.55 * tr[1], 0.5 * tr[2]);
  RV.sunStreak.visible = !opts.map && glare > 0.5;
  RV.sunCore.visible = RV.sunHalo.visible = glare > 0;
  // vessel lighting
  const sf = opts.sunFactor == null ? 1 : opts.sunFactor;
  RV.sunLight.position.copy(sDir);
  RV.sunLight.target.position.set(0, 0, 0);
  // full light out to the edge of a planetary system, fading to starlight in interstellar space
  const lightK = clamp((Math.log10(Math.max(SL.fMain, 1e-12)) + 7) / 3, 0.15, 1);   // a faint floor so a ship between stars stays visible
  RV.sunLight.intensity = sf * 3.2 * Math.max(tr[0], tr[1], tr[2]) * lightK;
  RV.sunLight.color.setRGB(tr[0], tr[1] * 0.98, tr[2] * 0.95);
  RV.ambient.intensity = 0.04 + sky * 0.55;
  RV.scene.environment = sky > 0.25 ? RV.envSky : RV.envSpace;
  RV.scene.environmentIntensity = sky > 0.25 ? 0.35 + sky * 0.5 : 0.6 * sf * lightK + 0.05;
  // shadows around the active vessel
  const sh = opts.shadow;
  if (sh && RV.sunLight.castShadow) {
    const s = sh.size;
    RV.sunLight.position.copy(sh.pos).addScaledVector(sDir, s * 4 + 40);
    RV.sunLight.target.position.copy(sh.pos);
    const sc = RV.sunLight.shadow.camera;
    sc.left = -s; sc.right = s; sc.top = s; sc.bottom = -s; sc.near = 1; sc.far = s * 10 + 120;
    sc.updateProjectionMatrix();
  }
  RV.sunLight.target.updateMatrixWorld();
  // shadow catcher on the ground under the vessel
  if (opts.catcher && RV.sunLight.castShadow) {
    const c = opts.catcher;
    RV.shadowCatcher.visible = true;
    RV.shadowCatcher.position.copy(c.pos);
    RV.shadowCatcher.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), c.normal);
    RV.shadowCatcher.scale.setScalar(c.size);
  } else RV.shadowCatcher.visible = false;
  // engine glow light
  const el = opts.engineLight;
  if (el && el.power > 0) { RV.engineLight.position.copy(el.pos); RV.engineLight.intensity = el.power; RV.engineLight.distance = el.range || 120; }
  else RV.engineLight.intensity = 0;
  // stars and Milky Way fade in a bright sky; star size in physical pixels
  const fade = 1 - clamp(sky * 1.6, 0, 0.985);
  for (const st of [RV.stars, RV.gstars]) { st.material.uniforms.uFade.value = fade; st.material.uniforms.uPx.value = RV.renderer.getPixelRatio(); }
  RV.sky.material.uniforms.uFade.value = fade;
  // catalogue parallax: the camera relative to the Sun, in 1e15 m (in another galaxy the field stands in for its stars)
  if (DEEP.home === 'mw') toT(V.scale(V.sub(camAbs, bodyAbsPos(BODY.sun, t)), 1e-15), RV.stars.material.uniforms.uCam.value);
  else RV.stars.material.uniforms.uCam.value.set(0, 0, 0);
  // game stars: a point wherever the disc is too small to see (the glare covers the primary)
  const gp = RV.gstars.geometry.attributes.position, gm = RV.gstars.geometry.attributes.aMag, dE = BODY.earth.el.a;
  RV.gstarList.forEach((st, i) => {
    if (!st.active) { gm.setX(i, 99); return; }
    const rel = V.sub(st === prim ? SL.pos : bodyAbsPos(st, t), camAbs), d = V.len(rel);
    toT(V.scale(rel, 1 / d), tmp); gp.setXYZ(i, tmp.x, tmp.y, tmp.z);
    gm.setX(i, st.R / d > 1e-4 || (st === prim && glare > 0.6) ? 99 : -26.74 - 2.5 * Math.log10(st.L) + 5 * Math.log10(d / dE));
  });
  gp.needsUpdate = true; gm.needsUpdate = true;
  // ground patch
  if (opts.focusBody && opts.focusRel) updateGroundPatch(opts.focusBody, opts.focusRel, t);
  else if (RV.patch.mesh) RV.patch.mesh.visible = false;
  for (const id in RV.bodies) { const m = RV.bodies[id].mesh.material; if (m && m.uniforms && m.uniforms.uPatch) m.uniforms.uPatch.value.w = 2; }
  if (RV.patch.mesh && RV.patch.mesh.visible) {
    const b = RV.patch.body;
    // the sphere leaves the inner 90% of the patch cap to the patch
    const pc = RV.patch.cf, cu = RV.bodies[b.id].mesh.material.uniforms.uPatch.value;
    cu.set(pc[0], pc[1], pc[2], Math.cos(RV.patch.thMax * 0.9));
    const abs = bodyAbsPos(b, t);
    relT(V.add(abs, bodyFixedToInertial(b, t, RV.patch.anchor)), RV.patch.mesh.position);
    quatT(bodyRotQuat(b, t), RV.patch.mesh.quaternion);
    const pu = RV.patch.mat.uniforms, bu = RV.bodies[b.id].mesh.material.uniforms;
    pu.uSun.value.copy(bu.uSun.value); pu.uRotM.value.copy(bu.uRotM.value); pu.uAmb.value = bu.uAmb.value; pu.uTime.value = t;
  }
  updateKSC(t);
  if (opts.map) RV.ksc.visible = false;
}

// render the main scene (or another scene/camera, e.g. the VAB) through the post chain
function renderScene(scene, camera) {
  const r = RV.renderer;
  r.setRenderTarget(null);
  r.setViewport(0, 0, RV.w, RV.h);
  r.setScissorTest(false);
  r.clear();
  RV.renderPass.scene = scene;
  RV.renderPass.camera = camera;
  RV.composer.render();
}
function drawFrame() { renderScene(RV.scene, RV.camera); }
