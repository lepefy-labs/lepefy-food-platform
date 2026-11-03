import { expect, test } from '@playwright/test';
import { readKeyboard } from '../../src/hooks/useVirtualKeyboard';

const phone = { width: 390, height: 844 };

test('keyboard closed: the full height is visible, nothing hides the checkout bar', () => {
  expect(readKeyboard(phone, { innerWidth: 390, innerHeight: 844, visibleHeight: 844 }).open).toBe(false);
});

test('keyboard open (visual viewport shrinks, layout viewport does not): open, baseline kept', () => {
  const reading = readKeyboard(phone, { innerWidth: 390, innerHeight: 844, visibleHeight: 520 });
  expect(reading.open).toBe(true);
  expect(reading.baseline.height).toBe(844);
});

test('keyboard closes while the field keeps focus: the next reading is closed again (no blur needed)', () => {
  const opened = readKeyboard(phone, { innerWidth: 390, innerHeight: 844, visibleHeight: 520 });
  expect(readKeyboard(opened.baseline, { innerWidth: 390, innerHeight: 844, visibleHeight: 844 }).open).toBe(false);
});

test('Android PWA that resizes the layout viewport: still detected against the remembered baseline', () => {
  const opened = readKeyboard(phone, { innerWidth: 390, innerHeight: 540, visibleHeight: 540 });
  expect(opened.open).toBe(true);
  expect(readKeyboard(opened.baseline, { innerWidth: 390, innerHeight: 844, visibleHeight: 844 }).open).toBe(false);
});

test('small viewport changes (browser toolbar) are not a keyboard', () => {
  expect(readKeyboard(phone, { innerWidth: 390, innerHeight: 844, visibleHeight: 760 }).open).toBe(false);
});

test('rotation resets the baseline for the new width', () => {
  const landscape = readKeyboard(phone, { innerWidth: 844, innerHeight: 390, visibleHeight: 390 });
  expect(landscape.open).toBe(false);
  expect(landscape.baseline).toEqual({ width: 844, height: 390 });
  expect(readKeyboard(landscape.baseline, { innerWidth: 844, innerHeight: 390, visibleHeight: 190 }).open).toBe(true);
});
