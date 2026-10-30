'use client';

import { useEffect, useState } from 'react';
import { IconLifebuoy, IconThumbDown, IconThumbUp } from '@tabler/icons-react';
import Button from '../ui/Button';
import { useSupport } from '../support/SupportProvider';
import { sendHelpEvent } from './helpClient';

/** « Cette guide vous a aidé ? » on the guide page; counts the view once per visit. */
export default function HelpArticleFeedback({ slug }: { slug: string }) {
  const support = useSupport();
  const [voted, setVoted] = useState<'helpful' | 'not_helpful' | null>(null);
  useEffect(() => { sendHelpEvent(slug, 'view'); }, [slug]);
  const vote = (event: 'helpful' | 'not_helpful') => { if (voted) return; setVoted(event); sendHelpEvent(slug, event); };
  return (
    <footer className="space-y-3 border-t border-a-border pt-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-a-text-2">Cette guide vous a aidé ?</span>
        <Button variant="outline" size="sm" disabled={voted !== null} onClick={() => vote('helpful')}><IconThumbUp size={16} aria-hidden="true" />Utile</Button>
        <Button variant="outline" size="sm" disabled={voted !== null} onClick={() => vote('not_helpful')}><IconThumbDown size={16} aria-hidden="true" />Pas utile</Button>
      </div>
      {voted && <p role="status" className="text-sm text-a-text-2">Merci pour votre retour.</p>}
      {support.enabled && !support.readOnly && (
        <button type="button" onClick={() => { sendHelpEvent(slug, 'support_opened'); support.open({ category: 'question', helpArticle: slug }); }}
          className="inline-flex min-h-10 items-center gap-1.5 text-sm font-semibold text-a-brand-fg underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-a-focus">
          <IconLifebuoy size={16} aria-hidden="true" />Besoin de plus d’aide ? Contacter Lepefy
        </button>
      )}
    </footer>
  );
}
