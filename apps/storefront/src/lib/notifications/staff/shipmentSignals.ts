// Pure detection of shipment incidents worth a staff notification, from the
// provider snapshot only (Packlink tracking data): never inferred from time
// spent in the shop, never from a guessed delivery date.

export type ShipmentIssue = {
  kind: 'shipment_action_required' | 'shipment_delayed';
  issue: string;
  occurrenceId: string;
};

export const DELAY_GRACE_HOURS = 24;

const FINAL = new Set(['delivered', 'returned', 'cancelled']);

export function shipmentIssuesFor(
  previous: { normalizedStatus: string | null | undefined },
  snapshot: { normalizedStatus: string; providerStatus: string | null; estimatedDeliveryAt: string | null; providerReference: string },
  now: Date = new Date(),
): ShipmentIssue[] {
  const issues: ShipmentIssue[] = [];
  if ((snapshot.normalizedStatus === 'exception' || snapshot.normalizedStatus === 'returned')
    && previous.normalizedStatus !== snapshot.normalizedStatus) {
    const label = snapshot.normalizedStatus === 'returned' ? 'Colis retourné à l’expéditeur' : 'Incident signalé par le transporteur';
    issues.push({
      kind: 'shipment_action_required',
      issue: snapshot.providerStatus ? `${label} (${snapshot.providerStatus.slice(0, 60)})` : label,
      occurrenceId: `${snapshot.normalizedStatus}:${snapshot.providerReference}:${(snapshot.providerStatus ?? '').slice(0, 40)}`,
    });
  }
  if (snapshot.estimatedDeliveryAt && !FINAL.has(snapshot.normalizedStatus)) {
    const eta = Date.parse(snapshot.estimatedDeliveryAt);
    if (Number.isFinite(eta) && now.getTime() - eta > DELAY_GRACE_HOURS * 3_600_000) {
      issues.push({
        kind: 'shipment_delayed',
        issue: 'Date de livraison estimée par le transporteur dépassée',
        occurrenceId: `eta:${snapshot.providerReference}:${snapshot.estimatedDeliveryAt.slice(0, 10)}`,
      });
    }
  }
  return issues;
}
