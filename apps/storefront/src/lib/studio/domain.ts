/**
 * Studio images (migration 183, docs/IMAGE_STUDIO.md). Client-safe constants
 * and types: no server import here.
 */

export const STUDIO_FLAG = 'image_studio';
export const STUDIO_PERMISSION = 'studio.use';
export const STUDIO_PRIVATE_BUCKET = 'studio-private';
export const STUDIO_PUBLIC_BUCKET = 'assets';

export const STUDIO_LIMITS = {
  /** Original photo accepted by the signed upload (bucket limit too). */
  uploadBytes: 15 * 1024 * 1024,
  /** Smallest useful photo edge. */
  minSourceEdge: 320,
  /** The stored original and every proposal are kept at most this size. */
  maxStoredEdge: 2048,
  maxInputPixels: 40_000_000,
  requestChars: 1000,
  titleChars: 120,
  /** Signed read URL of a private image (seconds). */
  signedReadSeconds: 300,
  /** Lock of a running job; past it another worker may take it over. */
  jobLockSeconds: 180,
  /** One provider call; a job with a correction stays below the route duration. */
  providerTimeoutMs: 90_000,
  /** Default monthly quotas when the tenant has no studio_tenant_settings row (mirror of SQL). */
  defaultMonthlyRevisions: 60,
  defaultMonthlyBudgetUsd: 20,
  /** Library pages. */
  pageSize: 24,
} as const;

export const STUDIO_ACCEPTED_MIME = ['image/jpeg', 'image/png', 'image/webp'] as const;
export type StudioImageMime = (typeof STUDIO_ACCEPTED_MIME)[number];

export type StudioOrigin = 'photo' | 'prompt';
export type StudioAssetStatus = 'processing' | 'review' | 'approved' | 'failed' | 'discarded' | 'archived';
export type StudioRevisionStatus = 'pending' | 'succeeded' | 'failed' | 'discarded';
export type StudioUsageStatus = 'publishing' | 'active' | 'removed' | 'failed';
export type StudioAssetAction = 'approve' | 'discard' | 'archive' | 'restore' | 'rename';

/** Library filter of the URL (`?statut=`). */
export const STUDIO_LIBRARY_VIEWS = ['a-valider', 'pretes', 'utilisees', 'en-cours', 'toutes', 'ecartees'] as const;
export type StudioLibraryView = (typeof STUDIO_LIBRARY_VIEWS)[number];

export interface StudioAssetSummary {
  id: string;
  title: string;
  origin: StudioOrigin;
  status: StudioAssetStatus;
  ambianceOnly: boolean;
  activeUsages: number;
  thumbnailUrl: string | null;
  updatedAt: string;
  createdAt: string;
}

export interface StudioRevisionView {
  id: string;
  revisionNo: number;
  status: StudioRevisionStatus;
  requestText: string | null;
  imageUrl: string | null;
  width: number | null;
  height: number | null;
  styleVersion: number;
  provider: string | null;
  model: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: string;
  completedAt: string | null;
}

export interface StudioUsageView {
  id: string;
  destinationKey: string;
  destinationLabel: string;
  targetId: string;
  targetLabel: string | null;
  status: StudioUsageStatus;
  publicUrl: string | null;
  manageHref: string | null;
  createdAt: string;
  removedAt: string | null;
  canRemove: boolean;
}

export interface StudioAssetDetail {
  id: string;
  title: string;
  origin: StudioOrigin;
  status: StudioAssetStatus;
  ambianceOnly: boolean;
  requestText: string | null;
  sourceUrl: string | null;
  sourceWidth: number | null;
  sourceHeight: number | null;
  approvedRevisionId: string | null;
  revisions: StudioRevisionView[];
  usages: StudioUsageView[];
  /** A job is queued or running (the page keeps polling). */
  busy: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface StudioQuotaView {
  used: number;
  limit: number;
  costUsd: number;
  budgetUsd: number;
  remaining: number;
}

export interface StudioStyleInstructions {
  version: 1;
  /** Short name shown to the shop (« Fond clair, lumière douce »). */
  summary: string;
  background: string;
  lighting: string;
  composition: string;
  mood: string;
  palette: string;
  photoGuidance: string;
  ideaGuidance: string;
  avoid: string[];
}

export interface StudioStyleView {
  id: string;
  version: number;
  instructions: StudioStyleInstructions;
  note: string | null;
  createdAt: string;
  isDefault: boolean;
}

/** Crop of the approved image inside its own pixels (0–1 fractions). */
export interface StudioCrop {
  x: number;
  y: number;
  width: number;
  height: number;
}
