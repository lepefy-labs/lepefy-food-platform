import { z } from 'zod';
import type { EventGalleryCategory } from '@lepefy/types';

export const GALLERY_CATEGORIES: { value: EventGalleryCategory; label: string; filterLabel: string }[] = [
  { value: 'event', label: 'Événement', filterLabel: 'Événements' },
  { value: 'traiteur', label: 'Traiteur', filterLabel: 'Traiteur' },
  { value: 'location_materiel', label: 'Location matériel', filterLabel: 'Location' },
  { value: 'ambiance', label: 'Ambiance', filterLabel: 'Ambiance' },
  { value: 'general', label: 'Général', filterLabel: 'Général' },
];

export const HERO_PRIORITIES = [
  { value: 25, label: 'Basse' },
  { value: 50, label: 'Normale' },
  { value: 75, label: 'Haute' },
];

export function heroPriorityOption(value: number) {
  return value < 30 ? 25 : value < 70 ? 50 : 75;
}

const editableFields = {
  category: z.enum(['event', 'traiteur', 'location_materiel', 'ambiance', 'general']),
  event_id: z.string().uuid().nullable(),
  hero_eligible: z.boolean(),
  hero_priority: z.number().int().min(0).max(100),
  caption: z.string().trim().max(2000).nullable(),
  is_social_share: z.boolean(),
};

export const createGallerySchema = z.object({
  ...editableFields,
  image_url: z.string().trim().url(),
}).partial().required({ image_url: true }).strict();

export const updateGallerySchema = z.object(editableFields).partial().strict()
  .refine((value) => Object.keys(value).length > 0, 'Aucun champ à modifier.');
