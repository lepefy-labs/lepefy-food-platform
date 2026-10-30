import type { DocReviewStatus } from '@/lib/engineering/domain';

export type DocTone = 'neutral' | 'info' | 'success' | 'warning' | 'urgent' | 'danger';

/** Tone of a document / module review state. The label is always written too (never colour alone). */
export function docStatusTone(status: DocReviewStatus | 'none'): DocTone {
  switch (status) {
    case 'verified': return 'success';
    case 'indexed': return 'info';
    case 'partial': return 'warning';
    case 'to_review': return 'urgent';
    default: return 'neutral';
  }
}
