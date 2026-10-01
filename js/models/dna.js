const RISE = 2.0;
const TURNS = 3.4;
const RADIUS = 1.15;

function backboneAt(t, strand) {
  const phase = strand * Math.PI;
  const theta = t * TURNS * Math.PI * 2 + phase;
  return [RADIUS * Math.cos(theta), t * RISE - RISE / 2, RADIUS * Math.sin(theta)];
}

function backbone(strand) {
  return (r, i, n) => {
    const t = (i + r() * 0.6) / n;
    const base = backboneAt(t, strand);
    const jitter = 0.045;
    return {
      p: [
        base[0] + (r() * 2 - 1) * jitter,
        base[1] + (r() * 2 - 1) * jitter,
        base[2] + (r() * 2 - 1) * jitter,
      ],
      size: 1.05,
      tint: 0.9 + r() * 0.3,
      shimmer: 0.1,
    };
  };
}

function basePair() {
  return (r, i, n) => {
    const t = (i + r() * 0.8) / n;
    const a = backboneAt(t, 0);
    const b = backboneAt(t, 1);
    const f = r();
    const base = [
      a[0] + (b[0] - a[0]) * f,
      a[1] + (b[1] - a[1]) * f,
      a[2] + (b[2] - a[2]) * f,
    ];
    const ang = r() * Math.PI * 2;
    const rad = 0.075;
    return {
      p: [base[0] + rad * Math.cos(ang), base[1] + rad * Math.sin(ang), base[2] + rad * Math.cos(ang) * 0.6],
      size: 1.15,
      tint: 0.85 + r() * 0.4,
      shimmer: 0.2,
    };
  };
}

export default {
  id: 'dna',
  name: 'DNA Double Helix',
  category: 'Biology',
  scale: 1,
  summary:
    'Two strands of DNA wind around each other like a twisted ladder. Every cell in your body carries about two metres of it packed into a nucleus less than 6 micrometres across.',
  parts: [
    {
      id: 'strand-a',
      name: 'Sugar-Phosphate Backbone (Strand A)',
      description:
        'An alternating chain of deoxyribose sugar and phosphate groups. It gives DNA its structural strength and directionality, and runs in one orientation only.',
      color: '#4dd0ff',
      weight: 2.2,
      explode: [1, 0.2, 0.2],
      explodeDistance: 1.4,
      sampler: backbone(0),
    },
    {
      id: 'strand-b',
      name: 'Sugar-Phosphate Backbone (Strand B)',
      description:
        'The complementary strand, running in the opposite direction. The two backbones are held together by base pairs that pair up like ladder rungs.',
      color: '#7cf6c8',
      weight: 2.2,
      explode: [-1, 0.2, -0.2],
      explodeDistance: 1.4,
      sampler: backbone(1),
    },
    {
      id: 'base-pairs',
      name: 'Base Pairs (Rungs)',
      description:
        'Adenine always pairs with thymine, guanine with cytosine. The order of these four bases is the actual genetic code read by cells.',
      color: '#ffd166',
      weight: 2.6,
      explode: [0, 1, 0],
      explodeDistance: 1.1,
      sampler: basePair(),
    },
    {
      id: 'major-groove',
      name: 'Major Groove',
      description:
        'The wider spiral channel. Protein readers dock into it to recognise specific base sequences, which is how genes get switched on and off.',
      color: '#b07cff',
      weight: 0.8,
      explode: [0, 0, 1],
      explodeDistance: 1.5,
      sampler: (r) => {
        const t = r();
        const base = backboneAt(t, 0);
        const off = (r() * 2 - 1) * 0.16;
        return {
          p: [base[0] * 1.18 + off, base[1], base[2] * 1.18 - off],
          size: 0.95,
          tint: 0.85 + r() * 0.3,
          shimmer: 0.18,
        };
      },
    },
    {
      id: 'minor-groove',
      name: 'Minor Groove',
      description:
        'The narrower spiral channel on the opposite face of the helix. It is shallower and is used by some proteins to read the code.',
      color: '#5c7cff',
      weight: 0.7,
      explode: [0, 0, -1],
      explodeDistance: 1.5,
      sampler: (r) => {
        const t = r();
        const base = backboneAt(t, 1);
        const off = (r() * 2 - 1) * 0.14;
        return {
          p: [base[0] * 1.14 - off, base[1], base[2] * 1.14 + off],
          size: 0.95,
          tint: 0.85 + r() * 0.3,
          shimmer: 0.18,
        };
      },
    },
    {
      id: 'centrosome',
      name: 'Nucleosome Beads',
      description:
        'In living cells DNA is wrapped around protein cores called histones, forming beads on a string. That packaging is what lets two metres of DNA fit inside a nucleus.',
      color: '#ff8bd0',
      weight: 0.9,
      explode: [0, -1, 0],
      explodeDistance: 1.6,
      sampler: (r) => {
        const t = (Math.floor(r() * 26) + 0.5) / 26;
        const base = backboneAt(t, 0);
        const ang = r() * Math.PI * 2;
        const rad = 0.26 + r() * 0.06;
        return {
          p: [base[0] + rad * Math.cos(ang), base[1] + r() * 0.1 - 0.05, base[2] + rad * Math.sin(ang)],
          size: 1.1,
          tint: 0.85 + r() * 0.35,
          shimmer: 0.22,
        };
      },
    },
    {
      id: 'terminals',
      name: 'Helix Turns',
      description:
        'DNA rotates once every 10.5 base pairs. That regular twist is what makes the double helix a stable, self-compacting structure.',
      color: '#9fe870',
      weight: 0.5,
      explode: [0.6, 1, -0.6],
      explodeDistance: 1.7,
      sampler: (r) => {
        const t = r();
        const theta = t * TURNS * Math.PI * 2;
        const band = Math.floor(theta / (Math.PI * 2)) % 2;
        const ribbon = Math.sin(theta * 0.5) * 0.06;
        return {
          p: [
            (RADIUS + ribbon) * Math.cos(theta),
            t * RISE - RISE / 2,
            (RADIUS + ribbon) * Math.sin(theta),
          ],
          size: 0.8,
          tint: 0.8 + r() * 0.3,
          shimmer: 0.25,
        };
      },
    },
  ],
};
