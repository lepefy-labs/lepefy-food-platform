import { expect, test } from '@playwright/test';
import { needsSharedPdfPrint, pdfDownloadHref, pdfFilenameFromDisposition } from '../../src/lib/orders/documents/pdfPrintPlatform';

const IPHONE_SAFARI = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1';
const IPHONE_CHROME = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/131.0.6778.73 Mobile/15E148 Safari/604.1';
const MAC_SAFARI = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15';
const ANDROID_CHROME = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36';
const WINDOWS_CHROME = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

test.describe('needsSharedPdfPrint', () => {
  test('iPhone (Safari and Chrome) and iPadOS print through the share sheet', () => {
    expect(needsSharedPdfPrint({ userAgent: IPHONE_SAFARI, platform: 'iPhone', maxTouchPoints: 5 })).toBe(true);
    expect(needsSharedPdfPrint({ userAgent: IPHONE_CHROME, platform: 'iPhone', maxTouchPoints: 5 })).toBe(true);
    // iPadOS reports a Mac user agent: touch tells it apart.
    expect(needsSharedPdfPrint({ userAgent: MAC_SAFARI, platform: 'MacIntel', maxTouchPoints: 5 })).toBe(true);
  });

  test('desktop and Android keep the plain PDF link', () => {
    expect(needsSharedPdfPrint({ userAgent: MAC_SAFARI, platform: 'MacIntel', maxTouchPoints: 0 })).toBe(false);
    expect(needsSharedPdfPrint({ userAgent: ANDROID_CHROME, platform: 'Linux armv8l', maxTouchPoints: 5 })).toBe(false);
    expect(needsSharedPdfPrint({ userAgent: WINDOWS_CHROME, platform: 'Win32', maxTouchPoints: 10 })).toBe(false);
  });
});

test('pdfFilenameFromDisposition reads the server filename', () => {
  expect(pdfFilenameFromDisposition('inline; filename="commande-37E96B44-preparation-a5.pdf"', 'document')).toBe('commande-37E96B44-preparation-a5.pdf');
  expect(pdfFilenameFromDisposition("attachment; filename*=UTF-8''bons%20de%20colis.pdf", 'document')).toBe('bons de colis.pdf');
  expect(pdfFilenameFromDisposition(null, 'document')).toBe('document.pdf');
  expect(pdfFilenameFromDisposition('inline; filename="../x/y"', 'document')).toBe('..-x-y.pdf');
});

test('pdfDownloadHref adds download=1 and keeps the query', () => {
  expect(pdfDownloadHref('/api/admin/orders/abc/documents/picking-list?format=a5')).toBe('/api/admin/orders/abc/documents/picking-list?format=a5&download=1');
  expect(pdfDownloadHref('/api/admin/orders/abc/documents/packing-slip')).toBe('/api/admin/orders/abc/documents/packing-slip?download=1');
  expect(pdfDownloadHref('/x?download=0&ids=a,b')).toBe('/x?download=1&ids=a%2Cb');
});
