import AdminPageHeader from '../../../_components/ui/AdminPageHeader';
import AddOnsClient from './AddOnsClient';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

// Accès : préfixe /admin/catalogue (catalog.view) ; l'enregistrement exige catalog.manage côté API.
export default function AdminAddOnsPage() {
  return (
    <div className="mx-auto max-w-4xl">
      <AdminPageHeader
        breadcrumb={[{ label: 'Produits', href: '/admin/catalogue' }, { label: 'Petits plus' }]}
        title="Petits plus"
        description="Chips, chocolats, sel, cubes, épices… : les produits proposés à chaque client dans le panier et après un ajout, juste après les produits complémentaires de son panier. Seuls les produits actifs et en stock sont proposés, jamais ceux déjà dans le panier."
      />
      <AddOnsClient />
    </div>
  );
}
