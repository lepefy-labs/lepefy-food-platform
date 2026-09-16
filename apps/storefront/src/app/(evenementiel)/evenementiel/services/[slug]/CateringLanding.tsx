'use client';

import { useEffect, useRef, useState } from 'react';
import { IconArrowRight, IconBrandWhatsapp, IconCheck, IconChefHat, IconUsers } from '@tabler/icons-react';
import { EventImageFader } from '@/components/evenementiel/EventImageFader';
import type { CateringFormat } from '@/lib/events/cateringInquiry';
import DevisForm from './DevisForm';

type CateringPhoto = { id: string; image_url: string; caption: string | null };
const formats: { title: CateringFormat; description: string }[] = [
  { title: 'Buffet convivial', description: 'Un buffet généreux pour réunir vos invités autour des saveurs africaines et camerounaises.' },
  { title: 'Réception privée', description: 'Une formule personnalisée pour vos fêtes, repas de famille et moments à partager.' },
  { title: 'Événement professionnel', description: 'Une proposition adaptée à votre réception d’entreprise et au nombre de participants.' },
];
const faqs = [
  { question: 'Comment obtenir un tarif ?', answer: 'Partagez votre projet et, si vous les connaissez, votre date et le nombre d’invités. Notre équipe échangera avec vous pour préparer une proposition adaptée.' },
  { question: 'Dois-je déjà connaître tous les détails ?', answer: 'Non. Seuls votre nom et votre email sont nécessaires pour envoyer une demande. La date, le nombre d’invités, le téléphone et les précisions sont facultatifs.' },
  { question: 'Proposez-vous des formules personnalisées ?', answer: 'Oui. Présentez votre format de réception et vos besoins dans les précisions du formulaire pour en discuter avec notre équipe.' },
  { question: 'Puis-je signaler des préférences alimentaires ?', answer: 'Indiquez vos préférences ou besoins particuliers dans le champ « Votre projet ». Notre équipe échangera avec vous sur les possibilités adaptées à votre réception.' },
];

export default function CateringLanding({ serviceSlug, description, heroImages, photos, whatsappHref }: {
  serviceSlug: string;
  description: string | null;
  heroImages: string[];
  photos: CateringPhoto[];
  whatsappHref: string | null;
}) {
  const formRef = useRef<HTMLDivElement>(null);
  const [selectedFormat, setSelectedFormat] = useState<CateringFormat>();
  const [selectionVersion, setSelectionVersion] = useState(0);
  const [formVisible, setFormVisible] = useState(true);
  const [sent, setSent] = useState(false);

  useEffect(() => {
    const element = formRef.current;
    if (!element || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver((entries) => setFormVisible(entries[0]?.isIntersecting ?? false), { rootMargin: '-80px 0px 0px 0px' });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  function goToForm(format?: CateringFormat) {
    if (format) {
      setSelectedFormat(format);
      setSelectionVersion((version) => version + 1);
    }
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    formRef.current?.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
    formRef.current?.querySelector<HTMLInputElement>('input')?.focus({ preventScroll: true });
  }

  return (
    <div className="bg-[#f7f3eb] pb-24 text-[#20231f] lg:pb-0">
      <section className="relative isolate overflow-hidden bg-[var(--color-primary-dark)]">
        <div className="relative mx-auto grid max-w-[1180px] lg:grid-cols-[minmax(0,1fr)_420px] lg:items-start lg:gap-10 lg:px-6 lg:py-12">
          <div className="relative flex min-h-[470px] flex-col justify-center px-4 py-10 text-white sm:px-6 lg:static lg:px-0 lg:py-8">
            <EventImageFader images={heroImages} fallbackColor="var(--color-primary-dark)" className="absolute inset-0 h-full w-full" />
            <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(90deg,rgba(8,27,16,.92),rgba(8,27,16,.65),rgba(8,27,16,.25))]" />
            <div className="relative z-10">
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--color-secondary)]">Chloe Food · Service traiteur</p>
            <h1 className="mt-4 max-w-[680px] font-display text-4xl font-semibold leading-[1.05] sm:text-5xl lg:text-[3.4rem]">Traiteur africain &amp; camerounais pour vos réceptions</h1>
            <p className="mt-5 max-w-xl text-base leading-relaxed text-white/90">Buffets, réceptions privées et événements professionnels : une formule personnalisée pour réunir vos invités autour de notre cuisine.</p>
            <ul className="mt-5 flex flex-wrap gap-x-5 gap-y-2 text-sm text-white/90">
              {['Formules personnalisées', 'Privé & professionnel'].map((value) => <li key={value} className="inline-flex items-center gap-1.5"><IconCheck size={16} className="text-[var(--color-secondary)]" />{value}</li>)}
            </ul>
            <button type="button" onClick={() => goToForm()} className="mt-7 inline-flex min-h-11 w-fit items-center justify-center gap-2 rounded-xl bg-[var(--color-secondary)] px-5 py-3 text-sm font-bold text-[var(--color-primary-dark)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white">Recevoir un devis personnalisé <IconArrowRight size={17} /></button>
            {whatsappHref && <a href={whatsappHref} className="mt-3 inline-flex min-h-11 w-fit items-center gap-2 text-sm font-semibold text-white underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"><IconBrandWhatsapp size={18} />Une question ? WhatsApp</a>}
            </div>
          </div>
          <div ref={formRef} id="devis" className="relative z-10 scroll-mt-24 bg-[#f7f3eb] px-4 py-7 sm:px-6 lg:rounded-3xl lg:bg-transparent lg:p-0">
            <DevisForm serviceSlug={serviceSlug} selectedFormat={selectedFormat} selectionVersion={selectionVersion} onSent={() => setSent(true)} />
          </div>
        </div>
      </section>

      <main className="mx-auto max-w-[1180px] px-4 py-12 sm:px-6 sm:py-16">
        <section aria-labelledby="catering-formats-title">
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-[var(--color-primary)]">Votre réception, votre formule</p>
          <h2 id="catering-formats-title" className="mt-2 font-display text-3xl font-semibold sm:text-4xl">Quel moment souhaitez-vous organiser ?</h2>
          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-gray-600">Choisissez le format qui vous ressemble pour commencer votre demande.</p>
          <div className="mt-7 grid gap-5 md:grid-cols-3">
            {formats.map((format, index) => (
              <article key={format.title} className="overflow-hidden rounded-3xl border border-black/[0.06] bg-white shadow-sm">
                {photos[index] ? <img src={photos[index]?.image_url} alt="" loading="lazy" className="aspect-[16/10] w-full object-cover" /> : <div className="flex aspect-[16/10] items-center justify-center bg-[#efe5d1]"><IconChefHat size={40} className="text-[var(--color-primary)]" /></div>}
                <div className="p-5">
                  <h3 className="font-display text-2xl font-semibold">{format.title}</h3>
                  <p className="mt-3 text-sm leading-relaxed text-gray-600">{format.description}</p>
                  <button type="button" disabled={sent} onClick={() => goToForm(format.title)} className="mt-5 inline-flex min-h-11 w-full items-center justify-between gap-2 rounded-xl border border-[var(--color-primary)] px-4 py-2 text-left text-sm font-bold text-[var(--color-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] disabled:opacity-50">Choisir cette formule<IconArrowRight size={17} /></button>
                </div>
              </article>
            ))}
          </div>
        </section>

        {photos.length > 0 && <section className="pt-14" aria-labelledby="catering-gallery-title">
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-[var(--color-primary)]">La cuisine et l’art de recevoir</p>
          <h2 id="catering-gallery-title" className="mt-2 font-display text-3xl font-semibold sm:text-4xl">Notre univers traiteur</h2>
          <div className="mt-7 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {photos.slice(0, 6).map((photo) => <figure key={photo.id} className="overflow-hidden rounded-3xl bg-white"><img src={photo.image_url} alt={photo.caption ?? 'Notre univers traiteur'} loading="lazy" className="aspect-[4/3] w-full object-cover" />{photo.caption && <figcaption className="px-4 py-3 text-sm text-gray-700">{photo.caption}</figcaption>}</figure>)}
          </div>
          {description && <p className="mt-5 max-w-3xl whitespace-pre-line text-sm leading-relaxed text-gray-600">{description}</p>}
        </section>}

        <section className="pt-14" aria-labelledby="catering-steps-title">
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-[var(--color-primary)]">Simple & clair</p>
          <h2 id="catering-steps-title" className="mt-2 font-display text-3xl font-semibold sm:text-4xl">De votre idée à votre réception</h2>
          <div className="mt-7 grid gap-5 md:grid-cols-3">
            {[
              ['01', 'Parlez-nous de votre projet', 'Envoyez votre demande avec les informations que vous connaissez déjà.'],
              ['02', 'Construisons votre formule', 'Nous échangeons sur vos besoins et préparons une proposition personnalisée.'],
              ['03', 'Préparons votre réception', 'Une fois la proposition validée avec vous, nous organisons la prestation.'],
            ].map(([number, title, text]) => <div key={number} className="rounded-3xl bg-[#efe5d1] p-5"><span className="text-xs font-extrabold tracking-[0.18em] text-[var(--color-primary)]">{number}</span><h3 className="mt-3 font-display text-xl font-semibold">{title}</h3><p className="mt-3 text-sm leading-relaxed text-gray-700">{text}</p></div>)}
          </div>
        </section>

        <section className="pt-14" aria-labelledby="catering-faq-title">
          <h2 id="catering-faq-title" className="font-display text-3xl font-semibold sm:text-4xl">Vos questions, avant de commencer</h2>
          <div className="mt-7 divide-y divide-black/10 rounded-3xl border border-black/[0.06] bg-white px-5">
            {faqs.map((faq) => <details key={faq.question} className="group py-2"><summary className="min-h-11 cursor-pointer py-3 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]">{faq.question}</summary><p className="pb-4 text-sm leading-relaxed text-gray-600">{faq.answer}</p></details>)}
          </div>
        </section>

        <section className="mt-14 rounded-3xl bg-[var(--color-primary-dark)] p-6 text-white sm:p-8">
          <IconUsers size={28} className="text-[var(--color-secondary)]" />
          <h2 className="mt-3 font-display text-3xl font-semibold">Parlons de votre réception</h2>
          <p className="mt-3 max-w-xl text-sm leading-relaxed text-white/85">Partagez votre idée, même si tous les détails ne sont pas encore définis.</p>
          <div className="mt-5 flex flex-wrap gap-3">
            <button type="button" onClick={() => goToForm()} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-[var(--color-secondary)] px-5 py-3 text-sm font-bold text-[var(--color-primary-dark)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white">Recevoir un devis personnalisé<IconArrowRight size={17} /></button>
            {whatsappHref && <a href={whatsappHref} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-white/40 px-5 py-3 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"><IconBrandWhatsapp size={18} />Échanger sur WhatsApp</a>}
          </div>
        </section>
      </main>

      {!formVisible && !sent && <div className="fixed inset-x-0 bottom-0 z-40 border-t border-black/10 bg-white/95 px-4 pt-3 backdrop-blur lg:hidden" style={{ paddingBottom: 'max(12px, env(safe-area-inset-bottom))' }}>
        <button type="button" onClick={() => goToForm()} className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-[var(--color-primary)] px-4 py-3 text-sm font-bold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]">Recevoir un devis personnalisé<IconArrowRight size={17} /></button>
      </div>}
    </div>
  );
}
