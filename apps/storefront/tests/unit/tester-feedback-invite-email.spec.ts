import { expect, test } from '@playwright/test';
import {
  buildTesterFeedbackInviteEmail,
  LEPEFY_PLATFORM_SIGNATURE,
  LEPEFY_PLATFORM_TAGLINE,
} from '../../src/lib/notifications/testerFeedbackInviteEmail';

test('builds the shared tenant-branded tester invitation email contract', () => {
  const playUrl = 'https://play.google.com/store/apps/details?id=com.example.test';
  const feedbackUrl = 'https://example.invalid/lepefy-feedback-invite-test';
  const email = buildTesterFeedbackInviteEmail(
    'Tenant <test>',
    'https://cdn.example.com/logo.png?a=1&b=2',
    playUrl,
    feedbackUrl,
  );

  expect(email.subject).toBe('Invitation à tester l’application Tenant <test>');
  expect(email.text).toContain(playUrl);
  expect(email.text).toContain(feedbackUrl);
  expect(email.text).toContain(LEPEFY_PLATFORM_SIGNATURE);
  expect(email.text).toContain(LEPEFY_PLATFORM_TAGLINE);
  expect(email.html).toContain('Ouvrir le test sur Google Play');
  expect(email.html).toContain('Donner mon feedback');
  expect(email.html).toContain('Tenant &lt;test&gt;');
  expect(email.html).not.toContain('<h1 style="font-size:24px">Vous êtes invité(e) à tester l’application Tenant <test>');
});
