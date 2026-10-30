import Link from 'next/link';
import type { ReactNode } from 'react';
import type { HelpBlock } from '@/lib/helpCenter/domain';
import { parseInline } from '@/lib/helpCenter/rules';
import { isAllowedImageSrc, isAllowedVideoUrl } from '@/lib/helpCenter/blocks';
import InlineAlert from '../ui/InlineAlert';

/**
 * Renders the structured blocks of a guide (server and client compatible).
 * Every block maps to a React element; text is never interpreted as HTML and
 * the only inline markup is **bold**. Sources are re-checked at render time
 * (defence in depth: content comes from the database).
 */

function Inline({ text }: { text: string }) {
  return <>{parseInline(text).map((segment, index) => (segment.bold ? <strong key={index} className="font-semibold text-a-text">{segment.text}</strong> : <span key={index}>{segment.text}</span>))}</>;
}

export default function HelpArticleBody({ blocks }: { blocks: readonly HelpBlock[] }) {
  let step = 0;
  const out: ReactNode[] = [];
  blocks.forEach((block, index) => {
    switch (block.type) {
      case 'heading':
        out.push(<h3 key={index} className="pt-1 text-base font-semibold text-a-text">{block.text}</h3>);
        break;
      case 'paragraph':
        out.push(<p key={index} className="text-sm leading-6 text-a-text"><Inline text={block.text} /></p>);
        break;
      case 'steps':
        out.push(
          <ol key={index} className="space-y-3">
            {block.items.map((item, itemIndex) => {
              step += 1;
              return (
                <li key={itemIndex} className="flex gap-3">
                  <span aria-hidden="true" className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-a-brand text-sm font-semibold text-a-on-brand">{step}</span>
                  <p className="min-w-0 flex-1 text-sm leading-7 text-a-text"><span className="sr-only">Étape {step} : </span><Inline text={item} /></p>
                </li>
              );
            })}
          </ol>,
        );
        break;
      case 'callout':
        out.push(<InlineAlert key={index} tone={block.tone === 'warning' ? 'warning' : 'info'}><Inline text={block.text} /></InlineAlert>);
        break;
      case 'image':
        if (isAllowedImageSrc(block.src)) {
          out.push(
            <figure key={index} className="space-y-1.5">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={block.src} alt={block.alt} loading="lazy" decoding="async" referrerPolicy="no-referrer" className="w-full rounded-[10px] border border-a-border bg-white" />
              {block.caption && <figcaption className="text-xs text-a-text-3">{block.caption}</figcaption>}
            </figure>,
          );
        }
        break;
      case 'video':
        if (isAllowedVideoUrl(block.url)) {
          out.push(
            <div key={index} className="aspect-video overflow-hidden rounded-[10px] border border-a-border">
              <iframe src={block.url} title={block.title} loading="lazy" referrerPolicy="no-referrer" sandbox="allow-scripts allow-same-origin allow-presentation" allow="fullscreen" className="h-full w-full" />
            </div>,
          );
        }
        break;
      case 'related':
        // Rendered as a link list by the page (needs the target title); nothing inline.
        break;
      default:
        break;
    }
  });
  return <div className="space-y-4">{out}</div>;
}

export function RelatedLinks({ items, href }: { items: Array<{ slug: string; title: string }>; href: (slug: string) => string }) {
  if (items.length === 0) return null;
  return (
    <nav aria-label="Guides liées" className="space-y-1.5">
      <p className="text-xs font-semibold text-a-text-3">Guides liées</p>
      <ul className="space-y-1">
        {items.map((item) => (
          <li key={item.slug}><Link href={href(item.slug)} className="text-sm font-semibold text-a-brand-fg underline-offset-2 hover:underline">{item.title}</Link></li>
        ))}
      </ul>
    </nav>
  );
}
