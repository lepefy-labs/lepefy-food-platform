import { IconFileText } from '@tabler/icons-react';
import { PREPARATION_STEP_META, statusMeta } from '@/lib/admin/statusRegistry';
import type { PreparationStep } from '@/lib/orders/preparation/preparationPolicy';
import Badge from './Badge';

/** Preparation step badge — tone from lib/admin/statusRegistry.ts, label from the policy (« Prête au retrait » for pickups). */
export default function PreparationStepBadge({ step }: { step: PreparationStep }) {
  const meta = statusMeta(PREPARATION_STEP_META, step.key);
  return (
    <Badge tone={meta.tone} icon={step.key === 'printed' ? <IconFileText size={12} aria-hidden="true" /> : undefined} dot={step.key !== 'printed'}>
      {step.label}
    </Badge>
  );
}
