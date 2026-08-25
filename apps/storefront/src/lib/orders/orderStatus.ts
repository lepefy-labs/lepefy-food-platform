export type CustomerOrderStage =
  | 'confirmed'
  | 'preparing'
  | 'ready_for_pickup'
  | 'shipped'
  | 'delivered'
  | 'cancelled';

export type FulfillmentKind = 'delivery' | 'pickup';

export interface CustomerOrderPresentation {
  stage: CustomerOrderStage;
  label: string;
  title: string;
  description: string;
}

export const DELIVERY_STEPS: CustomerOrderStage[] = ['confirmed', 'preparing', 'shipped', 'delivered'];
export const PICKUP_STEPS: CustomerOrderStage[] = ['confirmed', 'preparing', 'ready_for_pickup', 'delivered'];

export const CUSTOMER_STATUS_LABELS: Record<CustomerOrderStage, string> = {
  confirmed: 'Confirmée',
  preparing: 'En préparation',
  ready_for_pickup: 'Prête au retrait',
  shipped: 'Expédiée',
  delivered: 'Terminée',
  cancelled: 'Annulée',
};

export function getCustomerOrderPresentation(
  dbStatus: string,
  fulfillmentType: FulfillmentKind,
): CustomerOrderPresentation {
  if (dbStatus === 'cancelled' || dbStatus === 'stock_conflict') {
    return {
      stage: 'cancelled',
      label: dbStatus === 'stock_conflict' ? 'Action requise' : 'Annulée',
      title: dbStatus === 'stock_conflict' ? 'Un problème bloque votre commande' : 'Commande annulée',
      description: dbStatus === 'stock_conflict'
        ? 'Notre équipe doit vérifier votre commande. Elle vous contactera si une action est nécessaire.'
        : 'Cette commande ne sera pas préparée. Contactez-nous si vous avez une question.',
    };
  }

  if (dbStatus === 'delivered') {
    return {
      stage: 'delivered',
      label: fulfillmentType === 'pickup' ? 'Retirée' : 'Livrée',
      title: fulfillmentType === 'pickup' ? 'Commande retirée' : 'Commande livrée',
      description: 'Votre commande est terminée. Merci pour votre confiance.',
    };
  }

  if (fulfillmentType === 'pickup' && dbStatus === 'ready_for_pickup') {
    return {
      stage: 'ready_for_pickup',
      label: 'Prête au retrait',
      title: 'Votre commande est prête',
      description: 'Vous pouvez venir la retirer en boutique.',
    };
  }

  if (fulfillmentType === 'delivery' && dbStatus === 'shipped') {
    return {
      stage: 'shipped',
      label: 'Expédiée',
      title: 'Votre commande est en route',
      description: 'Le colis a été remis au transporteur. Utilisez le suivi ci-dessous pour connaître son avancement.',
    };
  }

  if (dbStatus === 'preparing') {
    return {
      stage: 'preparing',
      label: 'En préparation',
      title: 'Nous préparons votre commande',
      description: fulfillmentType === 'pickup'
        ? 'Nous vous indiquerons ici dès qu’elle sera prête à être retirée.'
        : 'Nous préparons soigneusement vos articles avant leur remise au transporteur.',
    };
  }

  return {
    stage: 'confirmed',
    label: 'Confirmée',
    title: 'Commande confirmée',
    description: 'Nous avons bien reçu votre commande. Sa préparation va commencer prochainement.',
  };
}

export function customerOrderSteps(fulfillmentType: FulfillmentKind): CustomerOrderStage[] {
  return fulfillmentType === 'pickup' ? PICKUP_STEPS : DELIVERY_STEPS;
}

export function customerOrderStepIndex(stage: CustomerOrderStage, fulfillmentType: FulfillmentKind): number {
  if (stage === 'cancelled') return -1;
  return customerOrderSteps(fulfillmentType).indexOf(stage);
}
