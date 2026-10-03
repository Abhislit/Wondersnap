export const SIM_VERT = `#version 300 es
precision highp float;
layout(location = 0) in vec2 aUv;
out vec2 vUv;
void main() {
  vUv = aUv;
  gl_Position = vec4(aUv * 2.0 - 1.0, 0.0, 1.0);
}`;

export const SIM_FRAG = `#version 300 es
precision highp float;
precision highp sampler2D;

in vec2 vUv;
layout(location = 0) out vec4 outPos;
layout(location = 1) out vec4 outVel;

uniform sampler2D uPos;
uniform sampler2D uVel;
uniform sampler2D uTargetA;
uniform sampler2D uTargetB;
uniform sampler2D uGroup;   // xyz explode dir, w group id
uniform float uDt;
uniform float uTime;
uniform float uAssemble;    // 0 = loose cloud, 1 = locked onto target
uniform float uMorph;       // 0 -> targetA, 1 -> targetB
uniform float uTurbulence;
uniform float uExplode;
uniform float uHighlightGroup;
uniform float uHighlight;
uniform float uGrabGroup;
uniform vec3  uGrabVector;
uniform float uGrab;

vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 permute(vec4 x) { return mod289(((x * 34.0) + 10.0) * x); }
vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }

float snoise(vec3 v) {
  const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;
  i = mod289(i);
  vec4 p = permute(permute(permute(
             i.z + vec4(0.0, i1.z, i2.z, 1.0))
           + i.y + vec4(0.0, i1.y, i2.y, 1.0))
           + i.x + vec4(0.0, i1.x, i2.x, 1.0));
  float n_ = 0.142857142857;
  vec3 ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);
  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0) * 2.0 + 1.0;
  vec4 s1 = floor(b1) * 2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);
  vec4 norm = taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
  vec4 m = max(0.6 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
  m = m * m;
  return 42.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
}

vec3 flow(vec3 p, float t) {
  float s = 0.65;
  return vec3(
    snoise(p * s + vec3(0.0, t * 0.11, 0.0)),
    snoise(p * s + vec3(31.416, t * 0.13, 7.77)),
    snoise(p * s + vec3(-12.31, 5.19, t * 0.09))
  );
}

void main() {
  vec4 posData = texture(uPos, vUv);
  vec4 velData = texture(uVel, vUv);
  vec4 group = texture(uGroup, vUv);

  vec3 pos = posData.xyz;
  float energy = posData.w;
  vec3 vel = velData.xyz;
  float seed = velData.w;

  vec3 target = mix(texture(uTargetA, vUv).xyz, texture(uTargetB, vUv).xyz, uMorph);

  float spread = 0.45 + 0.75 * seed;
  target += group.xyz * uExplode * spread;
  target += flow(target * 0.8 + seed * 4.0, uTime * 0.35) * uExplode * 0.12;

  float gid = group.w;
  float isHighlighted = step(abs(gid - uHighlightGroup), 0.5) * uHighlight;
  float isGrabbed = step(abs(gid - uGrabGroup), 0.5) * uGrab;

  vec3 accel = vec3(0.0);

  float spring = mix(0.0, 62.0, uAssemble);
  accel += (target - pos) * spring;
  accel += (target - pos) * isHighlighted * 34.0;

  if (uTurbulence > 0.001) {
    vec3 curl = flow(pos * 0.55 + seed * 9.0, uTime * 0.6);
    accel += curl * uTurbulence * (2.2 + 5.5 * (1.0 - uAssemble));
  }

  accel += (uGrabVector) * isGrabbed * 26.0;

  accel -= vel * mix(2.4, 7.4, uAssemble);

  float dt = min(uDt, 0.033);
  vel += accel * dt;
  pos += vel * dt;

  float targetEnergy = mix(1.0, 0.34, uAssemble);
  targetEnergy += isHighlighted * 0.75;
  targetEnergy += isGrabbed * 0.5;
  energy += (targetEnergy - energy) * min(1.0, dt * 3.4);

  outPos = vec4(pos, energy);
  outVel = vec4(vel, seed);
}`;

export const DRAW_VERT = `#version 300 es
precision highp float;

uniform sampler2D uPos;
uniform sampler2D uColor;   // rgb color, a size
uniform mat4 uViewProj;
uniform float uPointScale;
uniform float uCutaway;
uniform vec3 uCutPlaneN;
uniform float uCutPlaneD;
uniform float uEnergyFloor;
uniform float uSizeBoost;
uniform float uTexSize;
uniform float uExposure;
uniform float uMaxPointSize;
uniform float uCoreExp;
uniform float uHaloExp;
uniform float uHaloWeight;
uniform float uHotBoost;

out vec3 vColor;
out float vEnergy;
out float vDiscarded;
out float vFade;

void main() {
  vec2 uv = (vec2(float(gl_VertexID % int(uTexSize)), float(gl_VertexID / int(uTexSize))) + 0.5) / uTexSize;

  vec4 posData = texture(uPos, uv);
  vec4 colorData = texture(uColor, uv);

  vec3 world = posData.xyz;
  vec4 clip = uViewProj * vec4(world, 1.0);

  gl_Position = clip;

  float dist = max(clip.w, 0.001);
  gl_PointSize = clamp(uPointScale * colorData.a * (1.0 + uSizeBoost) / dist, 1.0, uMaxPointSize);

  vColor = colorData.rgb;
  vEnergy = posData.w;

  vDiscarded = 0.0;
  if (posData.w < uEnergyFloor) vDiscarded = 1.0;
  if (uCutaway > 0.5 && dot(world, uCutPlaneN) > uCutPlaneD) vDiscarded = 1.0;

  vFade = clamp(1.0 - (dist - 6.0) / 26.0, 0.08, 1.0);
}`;

export const DRAW_FRAG = `#version 300 es
precision highp float;

in vec3 vColor;
in float vEnergy;
in float vDiscarded;
in float vFade;
uniform float uExposure;
uniform float uCoreExp;
uniform float uHaloExp;
uniform float uHaloWeight;
uniform float uHotBoost;
layout(location = 0) out vec4 fragColor;

void main() {
  if (vDiscarded > 0.5) discard;

  vec2 c = gl_PointCoord * 2.0 - 1.0;
  float r2 = dot(c, c);
  if (r2 > 1.0) discard;

  float core = pow(1.0 - r2, uCoreExp);
  float halo = pow(1.0 - r2, uHaloExp) * uHaloWeight;

  vec3 rgb = vColor * (core * 2.4 + halo);
  rgb += vec3(core * core * uHotBoost);
  float alpha = (core + halo) * vFade * clamp(vEnergy, 0.0, 1.6) * uExposure;

  fragColor = vec4(rgb * alpha, alpha);
}`;

export const BACKGROUND_FRAG = `#version 300 es
precision highp float;
in vec2 vUv;
uniform vec3 uTop;
uniform vec3 uBottom;
out vec4 fragColor;
void main() {
  float t = smoothstep(0.0, 1.0, vUv.y);
  vec3 col = mix(uBottom, uTop, t);
  float vig = 1.0 - 0.35 * length(vUv - 0.5);
  fragColor = vec4(col * vig, 1.0);
}`;
