import { RopeTag } from './RopeTag';

interface ReferralRopeProps {
  nodes: { customerId: string; level: number; points: number }[];
}

/**
 * "La corde des cartellini" — la spec (mockup ASCII section D) esquisse un
 * arbre avec des branches reliant chaque filleul à son parrain direct. Ce
 * niveau de détail n'est pas reconstructible ici : GET /api/loyalty/referrals/tree
 * (et resolveReferralDownline) renvoient {customerId, level, points} — sans
 * parentId — donc impossible de tracer une ligne vers UN parent précis parmi
 * plusieurs au même niveau. Simplification assumée (documentée dans le
 * rapport) : un rang par niveau, qui s'éloigne du centre et s'assombrit —
 * l'encodage couleur/taille/profondeur reste fidèle, seule la topologie
 * exacte branche-à-branche est perdue.
 */
export function ReferralRope({ nodes }: ReferralRopeProps) {
  if (nodes.length === 0) {
    return (
      <p className="text-sm text-gray-400 text-center py-6">
        Invite un ami pour commencer ta corde de filleuls.
      </p>
    );
  }

  const points = nodes.map((n) => n.points);
  const minPoints = Math.min(...points);
  const maxPoints = Math.max(...points);

  function sizeFor(pts: number): number {
    if (maxPoints === minPoints) return 40;
    const ratio = (pts - minPoints) / (maxPoints - minPoints);
    return 32 + ratio * (56 - 32);
  }

  const levels = Array.from(new Set(nodes.map((n) => n.level))).sort((a, b) => a - b);

  return (
    <div className="flex flex-col items-center gap-5 py-2">
      {levels.map((level) => {
        const levelNodes = nodes.filter((n) => n.level === level);
        return (
          <div key={level} className="flex flex-col items-center gap-1.5 w-full">
            <span className="text-[10px] uppercase tracking-wide text-gray-400 font-medium">
              Niveau {level}
            </span>
            <div className="flex flex-row flex-wrap md:flex-row max-[420px]:flex-col items-center justify-center gap-3">
              {levelNodes.map((node, i) => (
                <RopeTag
                  key={node.customerId}
                  size={sizeFor(node.points)}
                  level={node.level}
                  label={`Filleul ${i + 1}, niveau ${node.level} · ${node.points} pt${node.points !== 1 ? 's' : ''} généré${node.points !== 1 ? 's' : ''}`}
                />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
