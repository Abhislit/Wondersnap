import { mirrorX } from './shapes.js';

export const LOBES = ['frontal', 'parietal', 'temporal', 'occipital'];

/**
 * Cerebrum as an ellipsoid. +Z is the front of the head, +Y up, +X the model's right.
 * The proportions are roughly those of an adult brain: longest front-to-back, then
 * left-right, then top-to-bottom.
 */
const RX = 1.15;
const RY = 0.92;
const RZ = 1.55;

/**
 * The lateral (Sylvian) fissure is a near-horizontal cleft on the lateral surface. It
 * exists only well off the midline, so it must not be applied to the medial surface --
 * doing so is what gives a model a temporal lobe that wraps over the top of the brain.
 *
 * Real anatomy rises posteriorly; a constant height is the simplification. The value is
 * set by where it puts the temporal/parietal split: at -0.22 the parietal lobe came out
 * larger than the temporal, which is backwards.
 */
const LATERAL_Y = -0.16;
const LATERAL_X = 0.3;

/**
 * Anterior boundary of the parietal lobe: the central sulcus. It starts about a
 * centimetre behind the midpoint between the poles on the superomedial border and runs
 * down to just above the lateral sulcus, so it is steeply vertical and leans forward as
 * it descends. A horizontal plane here would put the frontal/parietal divide in the
 * wrong place entirely.
 *
 * The top end sits ~1cm behind the pole midpoint for a 17cm brain. That is what puts the
 * frontal lobe's surface share at 35% against a published 33% of total brain volume --
 * close enough that moving the line further would fit the number and break the landmark.
 */
function centralZ(y) {
  return -0.2 + 0.687 * ((0.92 - y) / 0.92);
}

/**
 * Anterior boundary of the occipital lobe: the imaginary line from the parieto-occipital
 * sulcus on the superomedial border down to the preoccipital notch on the inferolateral
 * border, which sits a little under 5cm in front of the occipital pole.
 */
function occipitalZ(y) {
  return -0.87 + 0.19 * (0.92 - y);
}

/**
 * Which cortical lobe a point on the cerebrum belongs to. Boundaries are evaluated on
 * the surface point rather than the unit direction, because the ellipsoid is anisotropic
 * and a boundary that is a plane in one space is not a plane in the other.
 */
export function lobeAt(dx, dy, dz) {
  const y = RY * dy;
  const z = RZ * dz;
  if (dy < LATERAL_Y && Math.abs(dx) > LATERAL_X) return 'temporal';
  if (z < occipitalZ(y)) return 'occipital';
  if (z < centralZ(y)) return 'parietal';
  return 'frontal';
}

/** The tentorial notch the cerebellum occupies, so the occipital lobe does not fill it. */
export function cortexSkip(dx, dy, dz) {
  return dz < -0.3 && dy < -0.35;
}

function unitVec(rand) {
  const u = rand() * 2 - 1;
  const th = rand() * Math.PI * 2;
  const s = Math.sqrt(1 - u * u);
  return [s * Math.cos(th), u, s * Math.sin(th)];
}

/**
 * A point on the cortical surface: the longitudinal fissure splits the hemispheres at the
 * top, the underside is flattened where it sits on the skull, and layered sines stand in
 * for gyri and sulci. The inward jitter gives the cortex thickness so it reads as a
 * surface rather than a wireframe, and keeps the interior hollow so the structures inside
 * stay visible when the model is exploded.
 */
function cortexSurface(rand, dx, dy, dz) {
  let y = dy;
  if (y < -0.2) y = -0.2 + (y + 0.2) * 0.5;
  const fissure = dy > 0
    ? 1 - 0.22 * Math.exp(-(dx * dx) / 0.006) * Math.min(1, dy * 2.5)
    : 1;
  const gyri = 1
    + 0.045 * Math.sin(10 * dx + 3 * Math.sin(7 * dy)) * Math.sin(9 * dz + 2 * Math.sin(6 * dx))
    + 0.03 * Math.sin(15 * dy + 6 * dz);
  const k = gyri * fissure * (0.94 + rand() * 0.06);
  return [RX * dx * k, RY * y * k, RZ * dz * k];
}

/** Rejection sampling: the whole sphere is proposed, the lobe predicate decides. */
function cortexSampler(lobe, size = 1) {
  return (rand) => {
    for (let attempt = 0; attempt < 256; attempt++) {
      const [dx, dy, dz] = unitVec(rand);
      if (cortexSkip(dx, dy, dz)) continue;
      if (lobeAt(dx, dy, dz) !== lobe) continue;
      return {
        p: cortexSurface(rand, dx, dy, dz),
        size,
        tint: 0.9 + rand() * 0.25,
        shimmer: 0.14,
      };
    }
    return { p: [0, 0, 0], size, tint: 1, shimmer: 0.14 };
  };
}

/**
 * A hollow blob: a direction on the unit sphere, a radius in [inner, outer], then scaled
 * and moved into place. Hollow rather than filled so it does not occlude whatever sits
 * behind it.
 */
function blob(rand, at, rx, ry, rz, inner = 0.65, size = 1) {
  const [dx, dy, dz] = unitVec(rand);
  const k = inner + rand() * (1 - inner);
  return {
    p: [at[0] + rx * dx * k, at[1] + ry * dy * k, at[2] + rz * dz * k],
    size,
    tint: 0.92 + rand() * 0.22,
    shimmer: 0.12,
  };
}

/** Samples a polyline as a tube of varying radius. */
function tubeAlong(rand, path, radiusAt, size = 1) {
  const seg = rand() * (path.length - 1);
  const i = Math.min(path.length - 2, Math.floor(seg));
  const f = seg - i;
  const a = path[i];
  const b = path[i + 1];
  const c = [
    a[0] + (b[0] - a[0]) * f,
    a[1] + (b[1] - a[1]) * f,
    a[2] + (b[2] - a[2]) * f,
  ];
  const axis = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const len = Math.hypot(...axis) || 1;
  const d = [axis[0] / len, axis[1] / len, axis[2] / len];
  const ref = Math.abs(d[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0];
  const side = norm3([
    ref[1] * d[2] - ref[2] * d[1],
    ref[2] * d[0] - ref[0] * d[2],
    ref[0] * d[1] - ref[1] * d[0],
  ]);
  const up = norm3([
    side[1] * d[2] - side[2] * d[1],
    side[2] * d[0] - side[0] * d[2],
    side[0] * d[1] - side[1] * d[0],
  ]);
  const ang = rand() * Math.PI * 2;
  const r = radiusAt(seg / (path.length - 1)) * (0.85 + rand() * 0.3);
  const cs = Math.cos(ang) * r;
  const sn = Math.sin(ang) * r;
  return {
    p: [c[0] + side[0] * cs + up[0] * sn, c[1] + side[1] * cs + up[1] * sn, c[2] + side[2] * cs + up[2] * sn],
    size,
    tint: 0.92 + rand() * 0.22,
    shimmer: 0.12,
  };
}

function norm3(v) {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

/** The corpus callosum arcs over the thalami in the midline. */
const CALLOSUM = [
  [0, 0.1, 0.85], [0, 0.35, 0.55], [0, 0.5, 0], [0, 0.35, -0.6], [0, 0.05, -0.9],
];

/** The hippocampus curves back and down through the medial temporal lobe. */
const HIPPOCAMPUS = [
  [0.5, -0.45, 0.35], [0.62, -0.5, 0], [0.6, -0.42, -0.45], [0.45, -0.22, -0.82],
];

/** Hypothalamus and the pituitary hanging below it, on the midline. */
const HYPOTHALAMUS = [
  [0, -0.34, 0.3], [0, -0.5, 0.34], [0, -0.64, 0.36],
];

/** Brainstem: midbrain into pons into medulla, descending in front of the cerebellum. */
const STEM = [
  [0, -0.3, -0.12], [0, -0.62, -0.2], [0, -0.95, -0.24], [0, -1.22, -0.26],
];

const AMYGDALA_AT = [0.7, -0.34, 0.5];
/**
 * Adult thalamus is roughly 3cm long, 2cm tall and 1.5cm across, with its centre a little
 * under 1cm off the midline. Scaled against a brain about 17cm front-to-back and 14cm
 * across, that puts it here. Getting this wrong is what made the pair cross the midline.
 */
const THALAMUS_AT = [0.131, 0, -0.05];
const THALAMUS_R = [0.123, 0.167, 0.274];

export default {
  id: 'brain',
  name: 'Human Brain',
  category: 'Human Anatomy',
  scale: 1.15,
  summary:
    'About 1.4 kilograms of tissue in three parts: the folded cerebrum that thinks, the cerebellum that coordinates, and the brainstem that keeps you alive. Pull the layers apart to see what sits inside.',
  parts: [
    {
      id: 'frontal',
      name: 'Frontal Lobe',
      description:
        'The largest lobe, and everything in front of the central sulcus. It holds the primary motor cortex that drives voluntary movement, plus the areas that plan, decide, judge and control behaviour. Damage here changes personality more than it changes movement.',
      color: '#c9b6ff',
      weight: 3.0,
      explode: [0, 0.25, 1],
      explodeDistance: 1.5,
      sampler: cortexSampler('frontal'),
    },
    {
      id: 'parietal',
      name: 'Parietal Lobe',
      description:
        'Behind the central sulcus and above the lateral fissure. Its postcentral gyrus is the primary somatosensory cortex, and because the hand and face occupy so much of it, this is where you feel fingers and lips most sharply.',
      color: '#7dffa0',
      weight: 2.0,
      explode: [0, 1, -0.15],
      explodeDistance: 1.6,
      sampler: cortexSampler('parietal'),
    },
    {
      id: 'temporal',
      name: 'Temporal Lobe',
      description:
        'Below the lateral fissure, reaching forward almost as far as the frontal lobe. It handles hearing, language comprehension and memory, and it holds the hippocampus and amygdala on its medial surface. The temporal pole is its forward tip.',
      color: '#ffc247',
      weight: 2.2,
      explode: [1, -0.7, 0.1],
      explodeDistance: 1.5,
      sampler: cortexSampler('temporal'),
    },
    {
      id: 'occipital',
      name: 'Occipital Lobe',
      description:
        'The small wedge at the back of the brain, behind the imaginary line from the parieto-occipital sulcus to the preoccipital notch. Its visual cortex receives signals from both eyes, which is why each half sees the opposite half of the world.',
      color: '#ff6f6f',
      weight: 1.4,
      explode: [0, 0.2, -1],
      explodeDistance: 1.6,
      sampler: cortexSampler('occipital'),
    },
    {
      id: 'corpus callosum',
      name: 'Corpus Callosum',
      description:
        'A C-shaped band of about two hundred million nerve fibres arching over the thalami. It is the only direct connection between the two hemispheres, which is why they work as one brain rather than two.',
      color: '#ffe14d',
      weight: 0.7,
      explode: [0, 1, 0],
      explodeDistance: 1.7,
      sampler: (rand) => tubeAlong(rand, CALLOSUM, (t) => 0.06 + 0.05 * Math.sin(Math.PI * t), 1.05),
    },
    {
      id: 'thalamus',
      name: 'Thalamus',
      description:
        'Two egg-shaped masses on either side of the third ventricle, and the single busiest crossroads in the body. Almost every signal reaching the cortex passes through here, and the two halves are joined across the midline by the massa intermedia.',
      color: '#ffb02e',
      weight: 0.7,
      explode: [0.8, 0.1, 0],
      explodeDistance: 1.3,
      sampler: mirrorX((rand) => blob(rand, THALAMUS_AT, THALAMUS_R[0], THALAMUS_R[1], THALAMUS_R[2], 0.66)),
    },
    {
      id: 'hippocampus',
      name: 'Hippocampus',
      description:
        'A curved structure in the floor of the temporal horn, named for its resemblance to a seahorse. It is where new memories are formed and consolidated, which is why damage to both of them produces an inability to form new long-term memories at all.',
      color: '#4fe3e0',
      weight: 0.6,
      explode: [0.7, -1, -0.2],
      explodeDistance: 1.5,
      sampler: mirrorX((rand) => tubeAlong(rand, HIPPOCAMPUS, (t) => 0.06 + 0.03 * t, 1)),
    },
    {
      id: 'amygdala',
      name: 'Amygdala',
      description:
        'A small almond-shaped nucleus at the front of the medial temporal lobe, sitting just ahead of the hippocampus. It weighs about twelve grams and gives fear and threat most of their speed, well ahead of conscious thought.',
      color: '#ff4fa8',
      weight: 0.4,
      explode: [1.3, -0.7, 0.8],
      explodeDistance: 1.6,
      sampler: mirrorX((rand) => blob(rand, AMYGDALA_AT, 0.13, 0.12, 0.14, 0.55, 1.05)),
    },
    {
      id: 'hypothalamus',
      name: 'Hypothalamus & Pituitary',
      description:
        'A small region below the thalamus that keeps the body regulated: temperature, hunger, thirst, sleep and circadian rhythm. The pituitary dangles beneath it and releases the hormones the hypothalamus tells it to.',
      color: '#ff8ac8',
      weight: 0.3,
      explode: [0, -1.2, 0.9],
      explodeDistance: 1.6,
      sampler: (rand) => tubeAlong(rand, HYPOTHALAMUS, (t) => 0.09 - 0.05 * t + (t > 0.7 ? 0.03 : 0), 1),
    },
    {
      id: 'cerebellum',
      name: 'Cerebellum',
      description:
        'The "little brain" tucked under the occipital lobes and behind the brainstem. It is only about a tenth of total brain volume but holds most of the neurons, packed into folds that give it roughly four fifths of the cortex\'s surface area.',
      color: '#ff5bd2',
      weight: 1.8,
      explode: [0, -0.9, -1.4],
      explodeDistance: 1.6,
      sampler: (rand) => {
        // Reject rather than fall back: a single fallback point would pull a quarter of
        // the samples onto one spot and drag the centroid with it.
        for (let attempt = 0; attempt < 256; attempt++) {
          const [dx, dy, dz] = unitVec(rand);
          if (dy > 0.45) continue;
          const folia = 1 + 0.05 * Math.sin(26 * dy);
          const k = (0.94 + rand() * 0.06) * folia;
          return {
            p: [0.78 * dx * k, -0.66 + 0.42 * dy * k, -1.02 + 0.52 * dz * k],
            size: 1,
            tint: 0.9 + rand() * 0.25,
            shimmer: 0.14,
          };
        }
        return { p: [0.78, -0.66, -1.02], size: 1, tint: 1, shimmer: 0.14 };
      },
    },
    {
      id: 'brainstem',
      name: 'Brainstem',
      description:
        'The stalk joining the brain to the spinal cord, and the part you cannot afford to lose. The pons alone is over half of it, relaying information between cerebrum and cerebellum and housing the nuclei that set your breathing and heart rate.',
      color: '#52e0d0',
      weight: 0.8,
      explode: [0, -1.5, -0.4],
      explodeDistance: 1.8,
      sampler: (rand) => tubeAlong(rand, STEM, (t) => 0.2 - 0.06 * t + (t > 0.45 && t < 0.7 ? 0.05 : 0), 1),
    },
  ],
};
