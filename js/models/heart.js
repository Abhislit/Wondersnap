import { spherePoint } from './shapes.js';

function heartImplicit(x, y, z) {
  const a = x * x + 2.25 * y * y + z * z - 1;
  return a * a * a - x * x * z * z * z - 0.1125 * y * y * z * z * z;
}

function heartSample(rand, scale, size) {
  for (let attempt = 0; attempt < 96; attempt++) {
    const x = (rand() * 2 - 1) * 1.5;
    const y = (rand() * 2 - 1) * 1.5;
    const z = (rand() * 2 - 1) * 1.5;
    const f = heartImplicit(x, y, z);
    if (f > 0) continue;

    const magnitude = Math.abs(f);
    const nearSurface = magnitude < 0.16;
    if (!nearSurface && rand() > 0.14) continue;

    return {
      p: [x * scale, y * scale, z * scale],
      size,
      tint: 0.9 + rand() * 0.35,
      shimmer: 0.16,
    };
  }
  return spherePoint(rand, scale * 0.9, size);
}

function atriaPoint(rand) {
  const side = rand() < 0.5 ? -1 : 1;
  const a = rand() * Math.PI * 2;
  const rad = 0.34 + rand() * 0.16;
  return {
    p: [side * (0.52 + rad * Math.cos(a) * 0.7), 0.62 + rad * Math.sin(a) * 0.55, rad * 0.6],
    size: 0.95,
    tint: 0.85 + rand() * 0.3,
    shimmer: 0.14,
  };
}

function vesselPoint(rand, spec) {
  const t = rand();
  const pts = spec.path;
  const seg = t * (pts.length - 1);
  const i = Math.min(pts.length - 2, Math.floor(seg));
  const f = seg - i;
  const a = pts[i], b = pts[i + 1];
  const ang = rand() * Math.PI * 2;
  const cx = a[0] + (b[0] - a[0]) * f;
  const cy = a[1] + (b[1] - a[1]) * f;
  const cz = a[2] + (b[2] - a[2]) * f;
  const rad = spec.r0 + (spec.r1 - spec.r0) * t;
  return {
    p: [cx + rad * Math.cos(ang), cy + rad * Math.sin(ang) * 0.4, cz + rad * Math.sin(ang)],
    size: 1.05,
    tint: 0.92 + rand() * 0.3,
    shimmer: 0.12,
  };
}

function valvePoint(rand) {
  const a = rand() * Math.PI * 2;
  const rad = 0.18 + rand() * 0.2;
  const y = rand() < 0.5 ? 0.06 : -0.14;
  return {
    p: [rad * Math.cos(a), y, rad * Math.sin(a)],
    size: 1.1,
    tint: 0.95 + rand() * 0.25,
    shimmer: 0.1,
  };
}

function septumPoint(rand) {
  const t = rand();
  const y = -1.5 + t * 2.6;
  const a = rand() * Math.PI * 2;
  const rad = 0.1 + 0.28 * Math.sin(t * Math.PI);
  return {
    p: [rad * Math.cos(a), y, rad * Math.sin(a)],
    size: 0.95,
    tint: 0.8 + rand() * 0.3,
    shimmer: 0.14,
  };
}

function apexPath(z) {
  return [
    [0, -1.05, 0.1], [0, -0.45, 0.2], [0, 0.1, 0.28], [0, 0.62, 0.3], [0, 1.0, 0.22], [0, 1.32, 0.05],
  ].map((p) => [p[0], p[1], p[2] + z * 0]);
}

function apexVessel(rand) {
  const t = rand();
  const x = 0.16 * t;
  const y = 1.0 + t * 0.6;
  const z = -0.1 - 0.5 * t * t;
  const ang = rand() * Math.PI * 2;
  const rad = 0.2 * (1 - t * 0.45);
  return {
    p: [x + rad * Math.cos(ang) * 0.3, y, z + rad * Math.sin(ang)],
    size: 1,
    tint: 0.9 + rand() * 0.25,
    shimmer: 0.1,
  };
}

export default {
  id: 'heart',
  name: 'Human Heart',
  category: 'Human Anatomy',
  scale: 1.25,
  summary:
    'A muscular pump roughly the size of your fist. It beats about 100,000 times a day, moving around 7,500 litres of blood through the lungs and the rest of the body.',
  parts: [
    {
      id: 'ventricles',
      name: 'Ventricles',
      description:
        'Two thick-walled pumping chambers. The left ventricle pushes blood into the systemic circulation through the aorta, while the right ventricle sends deoxygenated blood to the lungs. Their muscular walls are the thickest part of the heart.',
      color: '#ff3b6b',
      weight: 3.4,
      explode: [0, -1, 0.2],
      explodeDistance: 1.3,
      sampler: (rand) => heartSample(rand, 1.15, 1),
    },
    {
      id: 'atria',
      name: 'Atria',
      description:
        'The two upper collecting chambers. They fill with blood returning from the body (right atrium) and from the lungs (left atrium), then squeeze to push it down into the ventricles.',
      color: '#7a5cff',
      weight: 1.1,
      explode: [0, 1, 0.3],
      explodeDistance: 1.2,
      sampler: atriaPoint,
    },
    {
      id: 'septum',
      name: 'Interventricular Septum',
      description:
        'The muscular wall dividing the left and right ventricles. It stops the two sides from mixing oxygen-rich and oxygen-poor blood.',
      color: '#ff7a9c',
      weight: 0.8,
      explode: [1, 0, 0],
      explodeDistance: 1.5,
      sampler: septumPoint,
    },
    {
      id: 'aorta',
      name: 'Aorta',
      description:
        'The largest artery in the body. Oxygenated blood leaves the left ventricle through the aortic valve and travels up and over the heart before descending to the body.',
      color: '#ff2d55',
      weight: 1.0,
      explode: [0.2, 0.8, 0.6],
      explodeDistance: 1.6,
      sampler: (rand) => vesselPoint(rand, { path: apexPath(0), r0: 0.24, r1: 0.16 }),
    },
    {
      id: 'pulmonary',
      name: 'Pulmonary Arteries',
      description:
        'Carry deoxygenated blood from the right ventricle to the lungs, where it picks up oxygen. These are the only arteries in the body that carry oxygen-poor blood.',
      color: '#4d7cff',
      weight: 0.8,
      explode: [-0.4, 0.7, 0.6],
      explodeDistance: 1.6,
      sampler: (rand) => vesselPoint(rand, {
        path: [[0, 0.2, 0.1], [0.25, 0.5, 0.35], [0.45, 0.75, 0.2], [0.6, 0.85, -0.1]],
        r0: 0.2, r1: 0.13,
      }),
    },
    {
      id: 'vena cava',
      name: 'Vena Cava',
      description:
        'Two large veins returning oxygen-poor blood from the upper and lower body into the right atrium.',
      color: '#3fa9ff',
      weight: 0.6,
      explode: [-0.8, 0.4, 0.2],
      explodeDistance: 1.5,
      sampler: (rand) => vesselPoint(rand, {
        path: [[-0.5, 1.1, 0], [-0.45, 0.85, 0.05], [-0.35, 0.6, 0.1], [-0.25, 0.45, 0.12]],
        r0: 0.16, r1: 0.2,
      }),
    },
    {
      id: 'pulmonary veins',
      name: 'Pulmonary Veins',
      description:
        'Return freshly oxygenated blood from the lungs into the left atrium. They are the only veins that carry oxygen-rich blood.',
      color: '#2ee6a8',
      weight: 0.5,
      explode: [0.7, 0.5, -0.4],
      explodeDistance: 1.5,
      sampler: (rand) => vesselPoint(rand, {
        path: [[0.6, 0.75, -0.15], [0.4, 0.6, -0.1], [0.2, 0.5, -0.05], [0.05, 0.45, 0]],
        r0: 0.11, r1: 0.14,
      }),
    },
    {
      id: 'valves',
      name: 'Valves',
      description:
        'One-way doors between chambers and vessels. They open with each heartbeat and slam shut to stop blood flowing backwards.',
      color: '#ffd166',
      weight: 0.4,
      explode: [0, 0, 1],
      explodeDistance: 1.7,
      sampler: valvePoint,
    },
    {
      id: 'apex',
      name: 'Apex',
      description:
        'The pointed bottom-left tip of the heart. It is the point where the heartbeat is felt against the chest wall.',
      color: '#ff5c8a',
      weight: 0.3,
      explode: [0, -0.6, -1],
      explodeDistance: 1.8,
      sampler: apexVessel,
    },
  ],
};
