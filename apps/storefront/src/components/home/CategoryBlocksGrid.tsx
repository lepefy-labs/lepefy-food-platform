/**
 * Version desktop (>= md, 768px) des blocs-catégorie — statique, sans scroll
 * ni autoscroll : sans drag-to-scroll à la souris, un scroll horizontal
 * serait inatteignable pour qui n'a ni trackpad ni écran tactile, donc tous
 * les blocs sont affichés en grille qui va à la ligne. Réutilise
 * `CategoryBlock` tel quel (les classes `flex-*` héritées du contexte mobile
 * sont des no-op sur un enfant de grid, aucune modification nécessaire) —
 * seul le conteneur change. Server Component : aucune interactivité ici,
 * contrairement à `CategoryBlocksRow` (mobile, autoscroll).
 */
export function CategoryBlocksGrid({ children }: { children: React.ReactNode }) {
  return (
    <div className="hidden md:grid md:grid-cols-2 lg:grid-cols-3 gap-4 px-4 pb-3 mt-5">
      {children}
    </div>
  );
}
