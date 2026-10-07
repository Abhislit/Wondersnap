import heart from './heart.js';
import brain from './brain.js';
import dna from './dna.js';
import eiffel from './eiffel.js';
import jetEngine from './jetEngine.js';

export const MODELS = [heart, brain, dna, eiffel, jetEngine];

export const CATEGORIES = [
  { id: 'all', label: 'All', models: MODELS },
  { id: 'Human Anatomy', label: 'Human Anatomy', models: MODELS.filter((m) => m.category === 'Human Anatomy') },
  { id: 'Biology', label: 'Biology', models: MODELS.filter((m) => m.category === 'Biology') },
  { id: 'Wonders of the World', label: 'Wonders of the World', models: MODELS.filter((m) => m.category === 'Wonders of the World') },
  { id: 'Engines & Vehicles', label: 'Engines & Vehicles', models: MODELS.filter((m) => m.category === 'Engines & Vehicles') },
];

export function modelById(id) {
  return MODELS.find((m) => m.id === id) || null;
}
