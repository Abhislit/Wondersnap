import { boxBeamPoint, combine } from './shapes.js';

const H = 3.2;

function legHalfWidth(t) {
  return 1.05 * (1 - t) + 0.14 * t;
}

function towerProfile(t) {
  if (t < 0.10) return 1.05 + (0.62 - 1.05) * (t / 0.10);
  if (t < 0.42) return 0.62 + (0.32 - 0.62) * ((t - 0.10) / 0.32);
  if (t < 0.78) return 0.32 + (0.15 - 0.32) * ((t - 0.42) / 0.36);
  return 0.15 + (0.10 - 0.15) * ((t - 0.78) / 0.22);
}

function baseCorners(t) {
  const r = legHalfWidth(t);
  return [
    [-r, 0, -r],
    [r, 0, -r],
    [r, 0, r],
    [-r, 0, r],
  ];
}

function legPoint() {
  return (r) => {
    const t = Math.pow(r(), 0.72);
    const c = baseCorners(t);
    const edge = Math.floor(r() * 4);
    const a = c[edge];
    const b = c[(edge + 1) % 4];
    const f = r();
    const y = t * H;
    const lattice = 0.035 + 0.02 * (1 - t);
    const s = boxBeamPoint(r, [a[0], y, a[2]], [b[0], y, b[2]], lattice, 1.0);
    s.tint = 0.85 + r() * 0.35;
    s.shimmer = 0.2;
    return s;
  };
}

function archPoint() {
  return (r) => {
    const t = r();
    const y = 0.30 + t * 0.20;
    const r0 = 1.02 - t * 0.42;
    const a = r() * Math.PI * 2;
    const jitter = 0.03;
    return {
      p: [r0 * Math.cos(a) + (r() * 2 - 1) * jitter, y + (r() * 2 - 1) * jitter, r0 * Math.sin(a) + (r() * 2 - 1) * jitter],
      size: 0.9,
      tint: 0.8 + r() * 0.35,
      shimmer: 0.2,
    };
  };
}

function secondPlatformPoint() {
  return (r) => {
    const r0 = 0.44;
    const a = r() * Math.PI * 2;
    const rib = r() < 0.55;
    if (rib) {
      const t = r();
      const rr = r0 - t * 0.12;
      return {
        p: [rr * Math.cos(a), 1.36 + t * 0.06, rr * Math.sin(a)],
        size: 0.9,
        tint: 0.85 + r() * 0.3,
        shimmer: 0.2,
      };
    }
    return {
      p: [r0 * Math.cos(a), 1.36 + (r() * 2 - 1) * 0.02, r0 * Math.sin(a)],
      size: 0.85,
      tint: 0.8 + r() * 0.3,
      shimmer: 0.2,
    };
  };
}

function firstPlatformPoint() {
  return (r) => {
    const r0 = 0.66;
    const a = r() * Math.PI * 2;
    return {
      p: [r0 * Math.cos(a), 1.36 + (r() * 2 - 1) * 0.03, r0 * Math.sin(a)],
      size: 0.9,
      tint: 0.8 + r() * 0.35,
      shimmer: 0.2,
    };
  };
}

function upperColumn() {
  return (r) => {
    const t = 0.44 + r() * 0.34;
    const rr = towerProfile(t);
    const a = r() * Math.PI * 2;
    return {
      p: [rr * Math.cos(a), t * H + (r() * 2 - 1) * 0.04, rr * Math.sin(a)],
      size: 0.95,
      tint: 0.85 + r() * 0.3,
      shimmer: 0.2,
    };
  };
}

function domePoint() {
  return (r) => {
    const t = r();
    const y = 2.45 + t * 0.5;
    const rr = 0.10 * Math.cos((t * Math.PI) / 2) + 0.015;
    const a = r() * Math.PI * 2;
    return {
      p: [rr * Math.cos(a), y, rr * Math.sin(a)],
      size: 0.9,
      tint: 0.9 + r() * 0.3,
      shimmer: 0.25,
    };
  };
}

function spirePoint() {
  return (r) => {
    const t = r();
    return {
      p: [(r() * 2 - 1) * 0.02 * (1 - t), 2.95 + t * 0.32, (r() * 2 - 1) * 0.02 * (1 - t)],
      size: 1.15,
      tint: 0.9 + r() * 0.4,
      shimmer: 0.3,
    };
  };
}

function antennaPoint() {
  return (r) => {
    const t = r();
    return {
      p: [(r() * 2 - 1) * 0.05, 2.6 + t * 0.35, (r() * 2 - 1) * 0.05],
      size: 0.8,
      tint: 0.9 + r() * 0.3,
      shimmer: 0.3,
    };
  };
}

function platformSlab(y, outer, inner) {
  return (r) => {
    const a = r() * Math.PI * 2;
    const rr = inner + r() * (outer - inner);
    return {
      p: [rr * Math.cos(a), y + (r() * 2 - 1) * 0.02, rr * Math.sin(a)],
      size: 0.85,
      tint: 0.8 + r() * 0.3,
      shimmer: 0.18,
    };
  };
}

export default {
  id: 'eiffel',
  name: 'Eiffel Tower',
  category: 'Wonders of the World',
  scale: 1,
  summary:
    'Built in 1889 for the Paris World Fair, this 330-metre iron lattice tower took 26 months and 18,038 parts. It was meant to stand for only 20 years.',
  parts: [
    {
      id: 'legs',
      name: 'Four Legs',
      description:
        'The wide splayed base gives the tower its stability. Each leg is a curved lattice column, and the gaps between them are the arches visitors walk through.',
      color: '#c9873f',
      weight: 3.0,
      explode: [0.7, -0.6, 0.7],
      explodeDistance: 1.5,
      sampler: legPoint(),
    },
    {
      id: 'first-platform',
      name: 'First Platform',
      description:
        'The large square deck about 57 metres up, holding restaurants and the main entrance to the tower. It is where the four legs meet.',
      color: '#e0a35c',
      weight: 1.0,
      explode: [0, -1, 0],
      explodeDistance: 1.3,
      sampler: combine(platformSlab(1.36, 0.70, 0.0), firstPlatformPoint()),
    },
    {
      id: 'arches',
      name: 'Iron Arches',
      description:
        'Decorative arches between the legs. They are not structural: the tower is a rigid lattice, not an arch bridge, and takes wind loads in shear.',
      color: '#d99a4e',
      weight: 0.9,
      explode: [0, 0.2, 1],
      explodeDistance: 1.6,
      sampler: archPoint(),
    },
    {
      id: 'second-platform',
      name: 'Second Platform',
      description:
        'The smaller upper deck at 115 metres, plus the surrounding balustrade. It marks the point where the four separate legs become one column.',
      color: '#f0b96b',
      weight: 0.9,
      explode: [0, 0.4, -1],
      explodeDistance: 1.4,
      sampler: secondPlatformPoint(),
    },
    {
      id: 'upper-column',
      name: 'Upper Column',
      description:
        'The narrowing central shaft above the second platform. Because each level is smaller than the one below, the whole upper structure carries only a fraction of the total weight.',
      color: '#ffcf8f',
      weight: 1.6,
      explode: [0, 1, 0],
      explodeDistance: 1.5,
      sampler: upperColumn(),
    },
    {
      id: 'dome',
      name: 'Dome',
      description:
        'The observation cupola near the top, designed with a panoramic glass floor. Above 250 metres the platform is meant to sway up to 9 centimetres in high wind.',
      color: '#ffe6b8',
      weight: 0.7,
      explode: [0.6, 1, -0.4],
      explodeDistance: 1.7,
      sampler: domePoint(),
    },
    {
      id: 'spire',
      name: 'Antenna Spire',
      description:
        'The broadcast mast added after construction, carrying antennas and a beacon. Modern digital transmitters have replaced most of the original equipment.',
      color: '#ff9f6b',
      weight: 0.5,
      explode: [0, 1, 0.4],
      explodeDistance: 2.0,
      sampler: spirePoint(),
    },
    {
      id: 'antennae',
      name: 'Broadcast Antennae',
      description:
        'Antenna clusters mounted around the upper section, used for television and radio transmission across the Paris region.',
      color: '#ff7b9c',
      weight: 0.4,
      explode: [-0.6, 1, 0.6],
      explodeDistance: 2.0,
      sampler: antennaPoint(),
    },
  ],
};
