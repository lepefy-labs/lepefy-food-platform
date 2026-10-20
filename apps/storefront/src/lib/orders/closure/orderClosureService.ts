import type { Order } from '@lepefy/types';
import {
  loadWorkflowOrder, OrderWorkflowError, updateWorkflowOrder, type OrderService,
} from '@/lib/orders/orderTransitionService';
import { runOrderTransitionSideEffects } from '@/lib/orders/adminOrderWorkflow';
import { notifyN8n } from '@/lib/events/notifyN8n';
import { emailRequest } from '@/lib/notifications/sendEmail';
import { orderClosureMessageEmail } from '@/lib/notifications/customerEmails';
import { getTenantNotificationContext } from '@/lib/notifications/getTenantNotificationContext';
import { buildOrderTrackingLink } from '@/lib/orders/convertCheckoutSessionToOrder';
import {
  closureIdempotencyKey, closureIssues, closureTypeFor, type ClosureInput, type ClosureType,
} from './closureRules';

/**
 * Single server path that cancels or closes an order (migration 161). One
 * compare-and-set write carries the status and the whole closure decision
 * (reason, communication, message, author), so the transition and what the
 * customer is told can never diverge. Then the chosen communication only:
 * standard email through the historical side effect, custom message through
 * send-email with its own ledger key, or nothing. Payment, refunds, stock and
 * the carrier are never touched.
 */

export class OrderClosureError extends OrderWorkflowError {
  constructor(message: string, httpStatus = 409, readonly issues: string[] = []) { super(message, httpStatus); }
}

export interface ClosureResult {
  order: Order;
  /** The same closure had already been recorded (double click, retry): nothing was redone. */
  alreadyClosed: boolean;
  closureType: ClosureType;
  /** Customer communication handed to the transport (false: none chosen, no email, or delivery failed and queued for retry). */
  customerNotified: boolean;
}

export interface ClosureDependencies {
  update?: typeof updateWorkflowOrder;
  sideEffects?: typeof runOrderTransitionSideEffects;
  notify?: typeof notifyN8n;
  getContext?: typeof getTenantNotificationContext;
  now?: () => Date;
}

function sameClosure(order: Order, input: ClosureInput): boolean {
  return order.status === 'cancelled' && Boolean(order.closed_at)
    && order.closure_type === closureTypeFor(input.reason) && order.closure_reason === input.reason;
}

export async function closeOrder(input: ClosureInput & {
  service: OrderService;
  tenantId: string;
  orderId: string;
  actorId: string | null;
}, dependencies: ClosureDependencies = {}): Promise<ClosureResult> {
  const { service, tenantId, orderId, actorId } = input;
  const update = dependencies.update ?? updateWorkflowOrder;
  const sideEffects = dependencies.sideEffects ?? runOrderTransitionSideEffects;
  const order = await loadWorkflowOrder(service, tenantId, orderId);

  if (order.status === 'cancelled') {
    if (sameClosure(order, input)) return { order, alreadyClosed: true, closureType: closureTypeFor(input.reason), customerNotified: false };
    throw new OrderClosureError('Cette commande est déjà clôturée.');
  }
  const issues = closureIssues(order, input);
  if (issues.length) throw new OrderClosureError(issues[0]!, 400, issues);

  const closureType = closureTypeFor(input.reason);
  const message = input.notification === 'custom' ? input.message!.trim() : null;
  const patch = {
    closure_type: closureType,
    closure_reason: input.reason,
    closure_note: input.note?.trim() || null,
    closure_notification: input.notification,
    closure_message: message,
    closed_at: (dependencies.now?.() ?? new Date()).toISOString(),
    closed_by: actorId,
  };

  let saved: Order;
  try {
    saved = await update({
      service, order, nextStatus: 'cancelled', patch,
      // Only the standard choice sends the historical « Commande annulée » email (ledger key order-cancelled:<id>).
      sideEffects: (args) => sideEffects({ ...args, customerEmail: input.notification === 'standard' }),
    });
  } catch (error) {
    // Lost compare-and-set (double click, second tab): the winner's closure stands.
    if (error instanceof OrderWorkflowError && error.httpStatus === 409) {
      const fresh = await loadWorkflowOrder(service, tenantId, orderId);
      if (sameClosure(fresh, input)) return { order: fresh, alreadyClosed: true, closureType, customerNotified: false };
    }
    throw error;
  }

  let customerNotified = input.notification === 'standard' && Boolean(saved.email);
  if (input.notification === 'custom' && message && saved.email) {
    customerNotified = await sendClosureMessage(saved, message, dependencies);
  }
  return { order: saved, alreadyClosed: false, closureType, customerNotified };
}

/** Custom message through send-email (ledger « retry »: a failure is retried, a retry never sends twice). */
async function sendClosureMessage(order: Order, message: string, dependencies: ClosureDependencies): Promise<boolean> {
  try {
    const context = await (dependencies.getContext ?? getTenantNotificationContext)(order.tenant_id);
    if (!context || !order.email) return false;
    const orderNumber = `#${order.id.slice(0, 8).toUpperCase()}`;
    const rendered = orderClosureMessageEmail(context, {
      orderNumber, fullName: order.full_name, message,
      orderTrackingLink: buildOrderTrackingLink(order.id, order.email, context.storefrontUrl),
    });
    return await (dependencies.notify ?? notifyN8n)(...emailRequest(context, {
      ...rendered, notificationType: 'order_closure_message', idempotencyKey: closureIdempotencyKey('custom', order.id)!, recipients: [order.email],
    }));
  } catch (error) {
    console.error('[order closure] custom message not delivered — order_id:', order.id, error instanceof Error ? error.message : error);
    return false;
  }
}
