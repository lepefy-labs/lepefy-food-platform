import { test, expect } from '@playwright/test';
import { normalizeSocialUrl, socialDisplayName } from '../../src/lib/social/socialLinkUrl';
import { parseSocialCreate, parseSocialUpdate } from '../../src/lib/social/socialLinkWrite';
import { normalizeWhatsappNumber } from '../../src/lib/social/whatsappNumber';

test.describe('nettoyage des liens partagés depuis les apps', () => {
  test('Instagram : retire igsh', () => {
    expect(normalizeSocialUrl('instagram', 'https://www.instagram.com/chloefood_05?igsh=NnoxMHRrM2lmM3pt'))
      .toEqual({ ok: true, url: 'https://www.instagram.com/chloefood_05', cleaned: true });
  });
  test('Facebook : lien de partage avec mibextid', () => {
    expect(normalizeSocialUrl('facebook', 'https://www.facebook.com/share/1CnzLc9?mp/?mibextid=wwXIfr'))
      .toEqual({ ok: true, url: 'https://www.facebook.com/share/1CnzLc9', cleaned: true });
  });
  test('Facebook : garde profile.php?id=', () => {
    expect(normalizeSocialUrl('facebook', 'https://m.facebook.com/profile.php?id=1000&mibextid=x'))
      .toEqual({ ok: true, url: 'https://m.facebook.com/profile.php?id=1000', cleaned: true });
  });
  test('YouTube : retire si et utm_*', () => {
    expect(normalizeSocialUrl('youtube', 'https://youtube.com/@chloe?si=abc&utm_source=ig'))
      .toEqual({ ok: true, url: 'https://youtube.com/@chloe', cleaned: true });
  });
  test('lien déjà propre : inchangé', () => {
    expect(normalizeSocialUrl('tiktok', 'https://www.tiktok.com/@chloefoodets'))
      .toEqual({ ok: true, url: 'https://www.tiktok.com/@chloefoodets', cleaned: false });
  });
  test('http et sans protocole deviennent https', () => {
    expect(normalizeSocialUrl('x', 'twitter.com/chloe')).toMatchObject({ ok: true, url: 'https://twitter.com/chloe' });
    expect(normalizeSocialUrl('x', 'http://x.com/chloe')).toMatchObject({ ok: true, url: 'https://x.com/chloe' });
  });
});

test.describe('@nom', () => {
  test('devient le lien du profil', () => {
    expect(normalizeSocialUrl('instagram', '@chloefood_05')).toMatchObject({ ok: true, url: 'https://www.instagram.com/chloefood_05/' });
    expect(normalizeSocialUrl('tiktok', 'chloefoodets')).toMatchObject({ ok: true, url: 'https://www.tiktok.com/@chloefoodets' });
  });
  test('LinkedIn exige le lien complet', () => {
    expect(normalizeSocialUrl('linkedin', '@chloe').ok).toBe(false);
  });
});

test.describe('refus', () => {
  test('mauvaise plateforme', () => {
    const r = normalizeSocialUrl('instagram', 'https://www.tiktok.com/@chloe', 'Instagram');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('Instagram');
  });
  test('domaine qui imite', () => {
    expect(normalizeSocialUrl('instagram', 'https://instagram.com.evil.io/x').ok).toBe(false);
    expect(normalizeSocialUrl('facebook', 'https://notfacebook.com/x').ok).toBe(false);
  });
  test('accueil de la plateforme, vide, autre protocole', () => {
    expect(normalizeSocialUrl('instagram', 'https://www.instagram.com/').ok).toBe(false);
    expect(normalizeSocialUrl('instagram', '   ').ok).toBe(false);
    expect(normalizeSocialUrl('instagram', 'javascript://instagram.com/%0aalert(1)').ok).toBe(false);
  });
});

test.describe('nom affiché', () => {
  test('@nom quand le lien en a un', () => {
    expect(socialDisplayName('instagram', 'https://www.instagram.com/chloefood_05/')).toBe('@chloefood_05');
    expect(socialDisplayName('tiktok', 'https://www.tiktok.com/@chloefoodets')).toBe('@chloefoodets');
    expect(socialDisplayName('facebook', 'https://www.facebook.com/chloefood')).toBe('@chloefood');
  });
  test('sinon hôte et chemin', () => {
    expect(socialDisplayName('facebook', 'https://www.facebook.com/share/1CnzLc9')).toBe('facebook.com/share/1CnzLc9');
  });
});

test.describe('API réseaux sociaux', () => {
  test('création : lien nettoyé, réseau unique, réseau inconnu refusé', () => {
    expect(parseSocialCreate({ platform: 'instagram', url: 'https://www.instagram.com/x?igsh=1' }, []))
      .toMatchObject({ ok: true, values: { platform: 'instagram', url: 'https://www.instagram.com/x', active: true } });
    expect(parseSocialCreate({ platform: 'instagram', url: '@x' }, ['instagram'])).toMatchObject({ ok: false, status: 409 });
    expect(parseSocialCreate({ platform: 'myspace', url: 'https://myspace.com/x' }, [])).toMatchObject({ ok: false, status: 400 });
    expect(parseSocialCreate({ platform: 'instagram', url: 'https://tiktok.com/@x' }, [])).toMatchObject({ ok: false, status: 400 });
  });
  test('modification : réseau fixe, lien vérifié avec le réseau enregistré', () => {
    expect(parseSocialUpdate({ platform: 'tiktok' }, { platform: 'instagram' })).toMatchObject({ ok: false, status: 409 });
    expect(parseSocialUpdate({ url: 'https://tiktok.com/@x' }, { platform: 'instagram' })).toMatchObject({ ok: false, status: 400 });
    expect(parseSocialUpdate({ active: false }, { platform: 'instagram' })).toEqual({ ok: true, values: { active: false } });
  });
});

test.describe('numéro WhatsApp', () => {
  test('format international, chiffres seuls', () => {
    expect(normalizeWhatsappNumber('+39 333 123 4567')).toEqual({ ok: true, digits: '393331234567' });
    expect(normalizeWhatsappNumber('0039-333-123-4567')).toEqual({ ok: true, digits: '393331234567' });
    expect(normalizeWhatsappNumber('393331234567')).toEqual({ ok: true, digits: '393331234567' });
    expect(normalizeWhatsappNumber('(+33) 6.12.34.56.78')).toEqual({ ok: true, digits: '33612345678' });
  });
  test('vide = aucun numéro', () => {
    expect(normalizeWhatsappNumber('  ')).toEqual({ ok: true, digits: null });
    expect(normalizeWhatsappNumber(null)).toEqual({ ok: true, digits: null });
  });
  test('refuse lettres et longueurs impossibles', () => {
    expect(normalizeWhatsappNumber('wa.me/3933').ok).toBe(false);
    expect(normalizeWhatsappNumber('12345').ok).toBe(false);
    expect(normalizeWhatsappNumber('+1234567890123456').ok).toBe(false);
  });
});
