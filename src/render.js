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
    #define DET(q) (snoise((q)*(1.0/260.0) + uOff1)*6.0*w1 + snoise((q)*(1.0/34.0) + uOff2)*1.2*w2 + snoise((q)*(1.0/4.5) + uOff3)*0.25*w3)
    det = DET(vLocal);
    float dx = (DET(vLocal + t1 * e) - det) / e, dy = (DET(vLocal + t2 * e) - det) / e;
    detN = t1 * dx + t2 * dy;
  }
  vec3 col; float spec = 0.0, rough = 1.0; vec3 emis = vec3(0.0);
  // sub-vertex detail for coastlines / snow lines on the coarse sphere (patch vertices are dense enough)
  float hn = vH + fbm(d * 70.0 + vec3(uSeed), 4) * 380.0 * (1.0 - uDetail * 0.85) * (uType == 0 ? 1.0 : 0.3);
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
    float m = fbm(d*3.1 + vec3(5.0), 5) * 0.5 + 0.5;          // moisture
    float tmp = 1.0 - lat * 1.2 - max(hn, 0.0) / 4200.0 + (fbm(d*5.0+2.0,3))*0.12;  // temperature
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
      float snow = smoothstep(0.12, 0.0, tmp) + smoothstep(2500.0, 3100.0, hn + fbm(d*60.0,3)*500.0) * (1.0 - smoothstep(0.35, 0.6, slope));
      c = mix(c, vec3(0.78, 0.81, 0.86), clamp(snow, 0.0, 1.0));
      float ksc = smoothstep(0.9988, 0.99975, dot(d, uKsc));
      c = mix(c, vec3(0.09, 0.15, 0.045), ksc * 0.9);
      c *= 0.85 + 0.3 * (fbm(d*180.0 + vec3(1.3), 3) * 0.5 + 0.5);
      col = c * (1.0 + det * 0.03);
      // night lights
      float city = smoothstep(0.62, 0.86, fbm(d*55.0 + vec3(9.1), 4) * 0.5 + 0.5) * smoothstep(0.3, 0.55, m) * smoothstep(0.25, 0.5, tmp) * (1.0 - smoothstep(1500.0, 2500.0, hn));
      emis = vec3(1.0, 0.62, 0.3) * city * 0.6;
    }
    float ice = smoothstep(0.82, 0.88, lat + fbm(d*8.0, 3) * 0.06);
    col = mix(col, vec3(0.82, 0.86, 0.9), ice);
    spec *= 1.0 - ice; rough = mix(rough, 0.7, ice);
  } else if (type == 1 || type == 6) {
    float n = fbm(sp, 6);
    float hr = hn / max(uR * 0.006, 300.0);                   // normalised relief
    col = mix(uC0, uC1, smoothstep(-0.5, 0.6, n));
    col = mix(col, mix(uC0, uC1, 0.55) * 0.82, uMaria * smoothstep(-0.2, -1.3, hr) * 0.85);   // darker low basins (maria)
    col = mix(col, uC2, smoothstep(0.4, 1.2, hr) * 0.35 + smoothstep(0.25, 0.6, slope) * 0.25);
    col *= 0.85 + 0.3 * (fbm(d*160.0 + vec3(uSeed), 3) * 0.5 + 0.5);
    col = mix(col, vec3(0.9, 0.88, 0.86), uCaps * smoothstep(0.86, 0.93, abs(d.z) + n*0.04));
    col = mix(col, uC1 * 0.45, uTwo * smoothstep(-0.25, 0.25, d.x + n * 0.3));
    if (uVolc > 0.5) { col = mix(col, vec3(0.3, 0.14, 0.04), smoothstep(0.55, 0.72, abs(snoise(sp*5.0)))); col = mix(col, vec3(0.9, 0.8, 0.3), smoothstep(0.75, 0.9, fbm(sp*3.0+7.0, 3)*0.5+0.5)*0.5); }
    if (uHeart > 0.5) col = mix(col, uC2, smoothstep(0.25, 0.1, length(d - normalize(vec3(0.8,0.1,0.15)))));
    if (hn < uSea) { col = vec3(0.03, 0.025, 0.02); spec = 0.6; rough = 0.1; }   // methane lakes
    col *= 1.0 + det * 0.04;
  } else if (type == 2) {
    float n = fbm(sp, 6);
    col = mix(uC0, uC2, smoothstep(-0.3, 0.6, n));
    float crack = 1.0 - smoothstep(0.0, 0.035, abs(snoise(sp*6.0)));
    float crack2 = 1.0 - smoothstep(0.0, 0.02, abs(snoise(sp*15.0+7.0)));
    col = mix(col, uC1, max(crack*0.7, crack2*0.45));
    if (uHeart > 0.5) col = mix(col, vec3(0.95,0.92,0.86), smoothstep(0.35, 0.2, length(d - normalize(vec3(0.85,0.0,0.2)))));
    col *= 0.92 + 0.16 * (fbm(d*140.0, 3) * 0.5 + 0.5) + det * 0.03;
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
  vec3 outc = col * (diff * uSunI + uAmb) + emis * (1.0 - smoothstep(-0.12, 0.05, dot(Ng, uSun)));
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

// ================================================================ clouds
const CLOUD_VS = `
varying vec3 vDir; varying vec3 vWorld;
#include <common>
#include <logdepthbuf_pars_vertex>
void main(){ vDir = normalize(position); vec4 wp = modelMatrix * vec4(position, 1.0); vWorld = wp.xyz; gl_Position = projectionMatrix * viewMatrix * wp;
  #include <logdepthbuf_vertex>
}`;
const CLOUD_FS = `
uniform vec3 uSun; uniform mat3 uRotM; uniform float uTime, uCover, uSunI, uAmb; uniform vec3 uTint;
varying vec3 vDir; varying vec3 vWorld;
#include <common>
#include <logdepthbuf_pars_fragment>
${GLSL_NOISE}
float clouds(vec3 d){
  vec3 drift = vec3(uTime * 0.00002, 0.0, 0.0);
  vec3 w = vec3(fbm(d*3.0 + drift, 3), fbm(d*3.0 + vec3(5.2,1.3,2.8) + drift, 3), 0.0);
  float c = fbm(d*4.2 + w*0.35 + drift*2.0, 7);
  float bands = 0.12 * sin(d.z * 9.0 + w.x * 2.0);      // storm belts
  return c + bands;
}
void main(){
  #include <logdepthbuf_fragment>
  vec3 d = vDir;
  float c = clouds(d);
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
varying vec3 vWorld;
#include <common>
#include <logdepthbuf_pars_fragment>
// optical depth (density integral) from p toward the sun; large if the planet blocks the sun
float sunDepth(vec3 p){
  float b = dot(p, uSun), c = dot(p, p);
  float tExit = -b + sqrt(max(b*b - (c - uRa*uRa), 0.0));
  float seg = tExit / 5.0, od = 0.0;
  for (int j = 0; j < 5; j++) { vec3 q = p + uSun * seg * (float(j) + 0.5); od += exp(-max(length(q) - uR, 0.0) / uH) * seg; }
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
const SKY_VS = `
varying vec3 vDir;
#include <common>
#include <logdepthbuf_pars_vertex>
void main(){ vDir = normalize(position); vec4 wp = modelMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * viewMatrix * wp;
  #include <logdepthbuf_vertex>
}`;
const SKY_FS = `
uniform float uFade; uniform mat3 uGal;
varying vec3 vDir;
#include <common>
#include <logdepthbuf_pars_fragment>
${GLSL_NOISE}
void main(){
  #include <logdepthbuf_fragment>
  vec3 g = uGal * normalize(vDir);
  float band = exp(-pow(g.y / 0.16, 2.0));
  float bulge = exp(-pow(length(vec2(g.x - 0.85, g.y) / vec2(0.35, 0.22)), 2.0));
  float n = fbm(g * 3.5, 5) * 0.5 + 0.5;
  float dust = smoothstep(0.45, 0.75, fbm(g * 6.0 + vec3(2.0), 4) * 0.5 + 0.5) * exp(-pow(g.y / 0.05, 2.0));
  float glow = (band * (0.5 + 0.7 * n) + bulge * 1.2) * (1.0 - dust * 0.85);
  vec3 col = mix(vec3(0.55, 0.62, 0.85), vec3(1.0, 0.85, 0.65), bulge) * glow * 0.035;
  col += vec3(0.25, 0.1, 0.3) * smoothstep(0.7, 0.95, fbm(g*2.0+vec3(7.0), 4)*0.5+0.5) * band * 0.02;
  gl_FragColor = vec4(col * uFade, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;
const STAR_VS = `
attribute float aSize; attribute vec3 aCol;
uniform float uPx, uFade;
varying vec3 vCol;
#include <common>
#include <logdepthbuf_pars_vertex>
void main(){ vCol = aCol * uFade; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv; gl_PointSize = aSize * uPx;
  #include <logdepthbuf_vertex>
}`;
const STAR_FS = `
varying vec3 vCol;
#include <common>
#include <logdepthbuf_pars_fragment>
void main(){
  #include <logdepthbuf_fragment>
  vec2 q = gl_PointCoord - 0.5; float r = length(q) * 2.0;
  float a = exp(-r * r * 5.0) + exp(-r * 18.0) * 0.4;
  if (a < 0.01) discard;
  gl_FragColor = vec4(vCol * a, 1.0);
}`;

function hexToVec(h) { const c = new THREE.Color(h); c.convertSRGBToLinear(); return new THREE.Vector3(c.r, c.g, c.b); }

// colours used on the ground of haze-covered worlds (Venus, Titan)
const GROUND_COLS = { venus: ['#7a5233', '#4a2e1c', '#a37552'], titan: ['#4a3420', '#2a1d12', '#6b5034'] };

function makePlanetMaterial(b, ground) {
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
      uTime: { value: 0 }, uDepthBias: { value: 0 }, uSunI: { value: SUN_I },
    },
    vertexShader: PLANET_VS, fragmentShader: PLANET_FS,
  });
}

// ================================================================ renderer setup
function gfxSettings() {
  const q = RV.quality;
  return {
    high: { dpr: Math.min(window.devicePixelRatio || 1, 2), bloom: true, shadows: 2048, msaa: 4 },
    medium: { dpr: Math.min(window.devicePixelRatio || 1, 1.5), bloom: true, shadows: 1024, msaa: 4 },
    low: { dpr: 1, bloom: false, shadows: 0, msaa: 0 },
  }[q] || {};
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
  RV.dpr = next;
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
  buildEnvMaps();
  buildSky();
  buildBodies();
  buildSun();
  buildGroundPatch();
  buildShadowCatcher();
  buildKSC();
  buildComposer();
  resizeRenderer();
  window.addEventListener('resize', resizeRenderer);
}

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
  // galactic plane tilted ~60 degrees to the ecliptic like the real sky
  const gal = new THREE.Matrix3().setFromMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(1.05, 0.4, 0.2)));
  const skyMat = new THREE.ShaderMaterial({ uniforms: { uFade: { value: 1 }, uGal: { value: gal } }, vertexShader: SKY_VS, fragmentShader: SKY_FS,
    side: THREE.BackSide, depthWrite: false, depthTest: false });
  RV.sky = new THREE.Mesh(new THREE.SphereGeometry(1e5, 48, 24), skyMat);
  RV.sky.renderOrder = -10; RV.sky.frustumCulled = false;
  RV.scene.add(RV.sky);
  // stars: concentrated toward the galactic plane, a few bright ones
  const n = 9000, pos = new Float32Array(n * 3), col = new Float32Array(n * 3), size = new Float32Array(n);
  const rnd = rng(12345);
  const gInv = gal.clone().invert();
  for (let i = 0; i < n; i++) {
    let x, y, z;
    if (i < n * 0.5) {
      const a = rnd() * TAU, lat = (rnd() + rnd() + rnd() - 1.5) * 0.22;
      const v = new THREE.Vector3(Math.cos(a) * Math.cos(lat), Math.sin(lat), Math.sin(a) * Math.cos(lat)).applyMatrix3(gInv);
      x = v.x; y = v.y; z = v.z;
    } else { const u = rnd() * 2 - 1, th = rnd() * TAU, s = Math.sqrt(1 - u * u); x = s * Math.cos(th); y = u; z = s * Math.sin(th); }
    pos.set([x * 9e4, y * 9e4, z * 9e4], i * 3);
    const t = rnd(), br = 0.12 + Math.pow(rnd(), 9) * 3.5;
    const c = t < 0.12 ? [1, 0.72, 0.52] : t < 0.3 ? [0.72, 0.82, 1] : t < 0.4 ? [1, 0.93, 0.8] : [1, 1, 1];
    col.set([c[0] * br, c[1] * br, c[2] * br], i * 3);
    size[i] = 1.6 + Math.min(br, 2.5) * 1.2;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aCol', new THREE.BufferAttribute(col, 3));
  g.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
  const m = new THREE.ShaderMaterial({ uniforms: { uPx: { value: 1 }, uFade: { value: 1 } }, vertexShader: STAR_VS, fragmentShader: STAR_FS,
    blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false });
  RV.stars = new THREE.Points(g, m);
  RV.stars.renderOrder = -9; RV.stars.frustumCulled = false;
  RV.scene.add(RV.stars);
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
  for (const b of BODIES) {
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
          uMie: { value: b.id === 'mars' ? 1.6 : b.id === 'titan' || b.id === 'venus' ? 1.2 : b.gas ? 0.4 : 0.22 }, uSunI: { value: SUN_I * Math.PI } },
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
      const cm = new THREE.ShaderMaterial({
        uniforms: { uSun: { value: new THREE.Vector3() }, uRotM: { value: new THREE.Matrix3() }, uTime: { value: 0 }, uCover: { value: 0.06 },
          uSunI: { value: SUN_I }, uAmb: { value: 0.02 }, uTint: { value: new THREE.Vector3(1, 1, 1) } },
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
    RV.bodies[b.id] = rec;
  }
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
  RV.patch = { geos: [mkGeo(), mkGeo()], cur: 0, mesh: null, body: null, job: null, anchor: null, ready: false };
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
    const mat = makePlanetMaterial(b, true);
    mat.uniforms.uDetail.value = 1;
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
  // swap buffers
  P.cur = 1 - P.cur;
  P.mesh.geometry = g;
  P.anchor = A; P.cf = J.cf; P.alt = J.alt; P.centerH = J.anchorH; P.ready = true;
  const u = P.mat.uniforms;
  u.uAnchor.value.set(A[0], A[1], A[2]);
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
  const runT = siteTex(1024, 64, (x, w, h) => {
    noiseFill(x, w, h, '#2f3133', 0.12, 3000);
    x.fillStyle = '#e8e8e8'; for (let i = 0; i < 40; i++) x.fillRect(i * w / 40 + 6, h / 2 - 1, w / 80, 2);
    x.fillRect(0, 3, w, 2); x.fillRect(0, h - 5, w, 2);
    for (let i = 0; i < 8; i++) { x.fillRect(10, 8 + i * 6, 40, 3); x.fillRect(w - 50, 8 + i * 6, 40, 3); }
  });
  add(new THREE.BoxGeometry(1600, 0.3, 45), std({ map: runT, roughness: 0.9 }), 300, 0.05, 700);
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
  cam.fov = opts.fov || (opts.map ? 50 : RV.fov || 55);
  cam.updateProjectionMatrix();
  cam.updateMatrixWorld();
  const sunRel = relT([0, 0, 0]);
  const tmp = new THREE.Vector3();
  const rotM = new THREE.Matrix3();
  const sky = clamp(opts.skyLight || 0, 0, 1);
  for (const id in RV.bodies) {
    const rec = RV.bodies[id], b = rec.b;
    const abs = bodyAbsPos(b, t);
    relT(abs, rec.mesh.position);
    quatT(bodyRotQuat(b, t), rec.mesh.quaternion);
    rec.mesh.updateMatrixWorld();
    rotM.setFromMatrix4(rec.mesh.matrixWorld);
    const dist = rec.mesh.position.length();
    const sunDir = toT(V.norm(V.neg(abs)), tmp);
    // haze worlds: show their ground colours when the camera is under the cloud deck
    let mat = rec.mat;
    if (rec.groundMat && opts.focusBody === b && opts.focusRel && V.len(opts.focusRel) - b.R < b.atm.top * 0.6) mat = rec.groundMat;
    if (rec.mesh.material !== mat) rec.mesh.material = mat;
    const u = mat.uniforms;
    u.uSun.value.copy(b.vis.type === 'star' ? sunDir.set(0, 1, 0) : sunDir);
    u.uRotM.value.copy(rotM);
    u.uAmb.value = opts.map ? 0.1 : (b.atm ? 0.03 + sky * 0.05 : 0.05);
    u.uTime.value = t;
    if (b.terrain && rec.displaced < 2 && dist < b.R * 30) displaceBody(rec, 3);
    if (rec.atm) {
      rec.atm.position.copy(rec.mesh.position);
      rec.atmMat.uniforms.uCenter.value.copy(rec.mesh.position);
      rec.atmMat.uniforms.uSun.value.copy(toT(V.norm(V.neg(abs))));
      rec.atm.visible = dist < b.R * 600;
    }
    if (rec.clouds) {
      rec.clouds.position.copy(rec.mesh.position);
      rec.clouds.quaternion.copy(rec.mesh.quaternion);
      const cu = rec.clouds.material.uniforms;
      cu.uSun.value.copy(toT(V.norm(V.neg(abs)))); cu.uRotM.value.copy(rotM); cu.uTime.value = t;
      cu.uAmb.value = 0.02 + sky * 0.08;
      rec.clouds.visible = dist < b.R * 300;
    }
    if (rec.ring) {
      rec.ring.position.copy(rec.mesh.position);
      rec.ringMat.uniforms.uSun.value.copy(toT(V.norm(V.neg(abs))));
      rec.ringMat.uniforms.uCenter.value.copy(rec.mesh.position);
    }
    rec.mesh.visible = b.R / dist > 4e-6 || b.vis.type === 'star';
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
  const sunAng = BODY.sun.R / sd;
  const coreS = Math.max(sunAng * 2 * 3.2, 0.006) * Math.min(sd, 1e9);
  RV.sunCore.position.copy(sunRel).multiplyScalar(place);
  RV.sunCore.scale.set(coreS, coreS, 1);
  RV.sunCore.material.color.setRGB(6 * tr[0], 6 * tr[1], 6 * tr[2]);
  RV.sunHalo.position.copy(RV.sunCore.position);
  const haloS = coreS * (opts.map ? 6 : 14);
  RV.sunHalo.scale.set(haloS, haloS, 1);
  RV.sunHalo.material.color.setRGB(tr[0] * (0.5 + sky), tr[1] * (0.5 + sky), tr[2] * (0.5 + sky));
  RV.sunStreak.position.copy(RV.sunCore.position);
  RV.sunStreak.scale.set(coreS * 22, coreS * 2.5, 1);
  RV.sunStreak.material.color.setRGB(0.6 * tr[0], 0.55 * tr[1], 0.5 * tr[2]);
  RV.sunStreak.visible = !opts.map;
  // vessel lighting
  const sf = opts.sunFactor == null ? 1 : opts.sunFactor;
  RV.sunLight.position.copy(sDir);
  RV.sunLight.target.position.set(0, 0, 0);
  RV.sunLight.intensity = sf * 3.2 * Math.max(tr[0], tr[1], tr[2]);
  RV.sunLight.color.setRGB(tr[0], tr[1] * 0.98, tr[2] * 0.95);
  RV.ambient.intensity = 0.04 + sky * 0.55;
  RV.scene.environment = sky > 0.25 ? RV.envSky : RV.envSpace;
  RV.scene.environmentIntensity = sky > 0.25 ? 0.35 + sky * 0.5 : 0.6 * sf + 0.05;
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
  RV.stars.material.uniforms.uFade.value = fade;
  RV.stars.material.uniforms.uPx.value = RV.renderer.getPixelRatio();
  RV.sky.material.uniforms.uFade.value = fade;
  // ground patch
  if (opts.focusBody && opts.focusRel) updateGroundPatch(opts.focusBody, opts.focusRel, t);
  else if (RV.patch.mesh) RV.patch.mesh.visible = false;
  if (RV.patch.mesh && RV.patch.mesh.visible) {
    const b = RV.patch.body;
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
