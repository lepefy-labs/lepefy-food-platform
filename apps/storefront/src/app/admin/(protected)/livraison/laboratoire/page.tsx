import { redirect } from 'next/navigation';

// Moved to the platform console (platform_owner only); tenant admins are sent
// back to /admin by the platform layout.
export default function Redirect() {
  redirect('/admin/platform/livraison/laboratoire');
}
