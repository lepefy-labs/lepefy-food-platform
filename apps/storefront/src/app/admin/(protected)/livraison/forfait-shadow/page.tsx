import { redirect } from 'next/navigation';

// Old URL of the Forfait tab: the commercial page is now /admin/livraison/forfait
// (technical tools moved to /admin/platform/livraison/forfait-laboratoire).
export default function Redirect() {
  redirect('/admin/livraison/forfait');
}
