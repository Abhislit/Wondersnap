import { combine } from './shapes.js';

const CORE_START = -1.5;
const CORE_END = 1.5;

function fanProfile(t) {
  return [
    [0.10, 0.10],
    [0.30, 0.34],
    [0.55, 0.62],
    [0.78, 0.86],
    [0.92, 1.00],
    [0.98, 1.06],
  ];
}

function compressorProfile(t) {
  return [
    [0.95, 0.0],
    [0.88, 0.18],
    [0.74, 0.42],
    [0.62, 0.66],
    [0.55, 0.85],
    [0.52, 1.0],
  ];
}

function combustorProfile(t) {
  return [
    [0.50, 0.0],
    [0.58, 0.15],
    [0.62, 0.4],
    [0.60, 0.65],
    [0.50, 0.85],
    [0.36, 1.0],
  ];
}

function turbineProfile(t) {
  return [
    [0.36, 0.0],
    [0.48, 0.25],
    [0.60, 0.55],
    [0.70, 0.8],
    [0.74, 1.0],
  ];
}

function nozzleProfile(t) {
  return [
    [0.74, 0.0],
    [0.72, 0.4],
    [0.70, 0.7],
    [0.80, 0.88],
    [0.96, 1.0],
  ];
}

function stageBlades(count, y, radius, chord) {
  return (r) => {
    const a = r() * Math.PI * 2;
    const b = (r() * 2 - 1) * chord;
    const twist = r() * Math.PI * 2;
    const cx = radius * Math.cos(a);
    const cz = radius * Math.sin(a);
    const nx = -Math.sin(a) * b;
    const nz = Math.cos(a) * b;
    const dy = Math.cos(twist) * b * 0.5;
    return {
      p: [cx + nx * 0.4, y + dy + (r() * 2 - 1) * 0.012, cz + nz * 0.4],
      size: 1.0,
      tint: 0.85 + r() * 0.35,
      shimmer: 0.22,
    };
  };
}

function rotorShafts() {
  return (r) => {
    const y = CORE_START + r() * (CORE_END - CORE_START);
    const a = r() * Math.PI * 2;
    return {
      p: [0.10 * Math.cos(a), y, 0.10 * Math.sin(a)],
      size: 1.0,
      tint: 0.9 + r() * 0.3,
      shimmer: 0.1,
    };
  };
}

function pylonPoint() {
  return (r) => {
    const t = r();
    const y = CORE_START + 0.05 + t * 1.1;
    const a = r() * Math.PI * 2;
    const r0 = 1.02;
    return {
      p: [r0 * Math.cos(a), y, r0 * Math.sin(a)],
      size: 1.1,
      tint: 0.9 + r() * 0.3,
      shimmer: 0.18,
    };
  };
}

function exhaustPlume() {
  return (r) => {
    const t = Math.pow(r(), 0.6);
    const y = 1.5 + t * 1.4;
    const r0 = 0.95 + t * 0.5;
    const a = r() * Math.PI * 2;
    const rad = r0 * Math.sqrt(r());
    return {
      p: [rad * Math.cos(a), y, rad * Math.sin(a)],
      size: 0.85,
      tint: 1.0 - t * 0.4,
      shimmer: 0.4,
    };
  };
}

function coolingRing(y) {
  return (r) => {
    const a = r() * Math.PI * 2;
    return {
      p: [0.86 * Math.cos(a), y + (r() * 2 - 1) * 0.02, 0.86 * Math.sin(a)],
      size: 1.0,
      tint: 0.9 + r() * 0.3,
      shimmer: 0.2,
    };
  };
}

export default {
  id: 'jet-engine',
  name: 'Turbofan Jet Engine',
  category: 'Engines & Vehicles',
  scale: 1.05,
  summary:
    'A turbojet with a large bypass fan. Cold air is pulled in by the fan, most of it straight around the core, while the rest feeds a compressor, a combustion chamber, and a turbine that drives the whole thing.',
  parts: [
    {
      id: 'fan',
      name: 'Fan Blades',
      description:
        'Twenty wide-chord blades that push most of the air around the engine core rather than through it. On a modern high-bypass turbofan this bypass flow is around 10:1, and it is the main reason the engine is quiet and efficient.',
      color: '#9fe8ff',
      weight: 2.2,
      explode: [0, 0, 1],
      explodeDistance: 1.5,
      sampler: combine(
        stageBlades(22, -1.46, 0.92, 0.20),
        stageBlades(22, -1.44, 0.55, 0.18),
      ),
    },
    {
      id: 'compressor',
      name: 'Compressor Stages',
      description:
        'Nine stages of spinning blades and fixed stator vanes, each stage squeezing the air a little more. Together they raise the pressure of the incoming air by around 40:1, preparing it for combustion.',
      color: '#5cd2ff',
      weight: 2.4,
      explode: [0, 0.4, -1],
      explodeDistance: 1.3,
      sampler: (r) => {
        const stage = Math.floor(r() * 9);
        const t = stage / 9;
        const y = -1.24 + t * 0.95;
        const radius = compressorProfile(t)[0][0];
        const a = r() * Math.PI * 2;
        const b = (r() * 2 - 1) * 0.12;
        return {
          p: [
            radius * Math.cos(a) - Math.sin(a) * b,
            y + (r() * 2 - 1) * 0.03,
            radius * Math.sin(a) + Math.cos(a) * b,
          ],
          size: 0.95,
          tint: 0.8 + r() * 0.35,
          shimmer: 0.24,
        };
      },
    },
    {
      id: 'combustor',
      name: 'Combustion Chamber',
      description:
        'Fuel is sprayed into a continuous flame here. The liner is perforated so air from the compressor can bleed through, diluting the flame and keeping the metal below its melting point despite temperatures over 1,900 K.',
      color: '#ff9f43',
      weight: 1.5,
      explode: [1, 0, 0],
      explodeDistance: 1.6,
      sampler: (r) => {
        const t = r();
        const prof = combustorProfile(t);
        const y = -0.22 + t * 0.72;
        const a = r() * Math.PI * 2;
        return {
          p: [prof[0][0] * Math.cos(a), y, prof[0][0] * Math.sin(a)],
          size: 1.05,
          tint: 0.8 + r() * 0.5,
          shimmer: 0.35,
        };
      },
    },
    {
      id: 'turbine',
      name: 'Turbine Stages',
      description:
        'Four stages of hot-gas driven blades. They extract only enough energy to drive the compressor and fan, typically giving a pressure ratio of about 2.5:1. They are the hottest visible metal in the engine.',
      color: '#ff5c5c',
      weight: 1.8,
      explode: [-1, 0, 0],
      explodeDistance: 1.6,
      sampler: (r) => {
        const stage = Math.floor(r() * 4);
        const t = stage / 4;
        const y = 0.56 + t * 0.7;
        const radius = turbineProfile(t)[0][0];
        const a = r() * Math.PI * 2;
        const b = (r() * 2 - 1) * 0.10;
        return {
          p: [
            radius * Math.cos(a) - Math.sin(a) * b,
            y + (r() * 2 - 1) * 0.03,
            radius * Math.sin(a) + Math.cos(a) * b,
          ],
          size: 0.95,
          tint: 0.85 + r() * 0.4,
          shimmer: 0.3,
        };
      },
    },
    {
      id: 'nacelle',
      name: 'Nacelle & Cowling',
      description:
        'The aerodynamic casing around the fan and core. Its intake lip is shaped to swallow air smoothly at low speed, and the bypass duct is what carries the cool, quiet bypass flow aft.',
      color: '#cfd8e3',
      weight: 1.6,
      explode: [0, 1, 0],
      explodeDistance: 1.7,
      sampler: (r) => {
        const t = r();
        const y = -1.75 + t * 3.5;
        const prof = fanProfile(t);
        const a = r() * Math.PI * 2;
        return {
          p: [prof[0][0] * Math.cos(a), y, prof[0][0] * Math.sin(a)],
          size: 0.9,
          tint: 0.85 + r() * 0.25,
          shimmer: 0.1,
        };
      },
    },
    {
      id: 'shaft',
      name: 'Rotor Shafts',
      description:
        'Two concentric shafts running the length of the core. The inner shaft drives the compressor, the outer low-pressure shaft drives the fan, and a bearing at the front keeps the two concentric shafts from touching.',
      color: '#8ea6c0',
      weight: 0.7,
      explode: [0, -1, 0],
      explodeDistance: 1.2,
      sampler: rotorShafts(),
    },
    {
      id: 'pylon',
      name: 'Pylon',
      description:
        'The arm that hangs the engine under the wing. It also carries fuel and bleed air lines, and its shape is tuned to minimise drag and noise.',
      color: '#6b7f96',
      weight: 0.6,
      explode: [0, 1, -1],
      explodeDistance: 1.9,
      sampler: pylonPoint(),
    },
    {
      id: 'nozzle',
      name: 'Exhaust Nozzle',
      description:
        'The convergent nozzle at the rear of the core. It accelerates the hot core exhaust to just above the speed of sound, and the visible shimmer is the shock diamonds that form as that jet mixes with the bypass stream.',
      color: '#ffb0e0',
      weight: 1.1,
      explode: [0, 0, -1],
      explodeDistance: 1.4,
      sampler: (r) => {
        const t = r();
        const y = 1.3 + t * 0.42;
        const prof = nozzleProfile(t);
        const a = r() * Math.PI * 2;
        return {
          p: [prof[0][0] * Math.cos(a), y, prof[0][0] * Math.sin(a)],
          size: 1.0,
          tint: 0.85 + r() * 0.35,
          shimmer: 0.3,
        };
      },
    },
    {
      id: 'exhaust',
      name: 'Jet Exhaust Plume',
      description:
        'Hot, fast exhaust leaving the nozzle. It expands enormously on mixing with the surrounding air, which is what makes the visible plume fade so quickly.',
      color: '#ff7b5c',
      weight: 1.0,
      explode: [0, 0, -1],
      explodeDistance: 2.0,
      sampler: exhaustPlume(),
    },
    {
      id: 'cooling',
      name: 'Cooling Rings',
      description:
        'Bleed air routed through the compressor and turbine casings for active cooling, then exhausted through the nozzle. A modern high-bypass engine moves hundreds of kilograms of air per second through these paths.',
      color: '#5cffe0',
      weight: 0.5,
      explode: [0, 0.6, 0.6],
      explodeDistance: 1.8,
      sampler: combine(coolingRing(-0.3), coolingRing(0.9), coolingRing(1.35)),
    },
  ],
};
