import { redirect } from 'next/navigation';

// Le simulateur ad-hoc a été absorbé dans le Laboratoire (mode "Test rapide")
// avec les campagnes de simulation — cf. proposition Shipping Intelligence.
export default function AdminShippingSimulatorRedirect() {
  redirect('/admin/livraison/laboratoire');
}
