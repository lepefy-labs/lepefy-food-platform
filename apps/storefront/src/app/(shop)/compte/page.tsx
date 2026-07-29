import { redirect } from 'next/navigation';

// /compte nu n'a pas encore de tableau de bord (points/référral à venir) —
// on redirige vers la seule vue compte existante au lieu d'un 404.
export default function ComptePage() {
  redirect('/compte/connexion');
}
