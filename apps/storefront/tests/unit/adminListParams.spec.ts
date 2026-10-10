import { test, expect } from '@playwright/test';
import { defineListParams, pageNumbers, pageWindow } from '../../src/lib/admin/listParams';

const LIST = defineListParams({
  q: { type: 'search' },
  status: { type: 'enum', values: ['new', 'preparing'] },
  sort: { type: 'enum', values: ['priority', 'newest'], default: 'priority' },
  from: { type: 'date' },
  min: { type: 'int', min: 0, max: 1000 },
  consent: { type: 'bool' },
  tag: { type: 'uuid' },
}, { pageSizes: [25, 50, 100], defaultPageSize: 50 });

test('parses and validates every param type, ignoring junk', () => {
  const values = LIST.parse({
    q: '  Ntjam <script>  ', status: 'hacked', sort: 'newest', from: '2026-13-40', min: '12', consent: 'true',
    tag: '0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0', page: '3', size: '100',
  });
  expect(values).toEqual({
    q: 'Ntjam script', status: undefined, sort: 'newest', from: undefined, min: 12, consent: true,
    tag: '0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0', page: 3, pageSize: 100,
  });
});

test('defaults: enum default, first page, default page size; invalid size falls back', () => {
  const values = LIST.parse(new URLSearchParams('size=7&page=-2&min=5000'));
  expect(values.sort).toBe('priority');
  expect(values.page).toBe(1);
  expect(values.pageSize).toBe(50);
  expect(values.min).toBeUndefined();
});

test('search keeps accents, e-mails and references', () => {
  expect(LIST.parse({ q: 'Éléonore.d+test@mail.fr #CC43-14' }).q).toBe('Éléonore.d+test@mail.fr #CC43-14');
});

test('href resets to page 1 on any filter change and omits defaults', () => {
  const current = LIST.parse({ status: 'new', page: '4', size: '25' });
  expect(LIST.href('/admin', current, { status: 'preparing' })).toBe('/admin?status=preparing&size=25');
  expect(LIST.href('/admin', current, { page: 5 })).toBe('/admin?status=new&size=25&page=5');
  expect(LIST.href('/admin', current, { status: undefined, pageSize: 50 })).toBe('/admin');
  expect(LIST.href('/admin', current, { sort: 'priority' })).toBe('/admin?status=new&size=25');
});

test('active filter count excludes search and defaults', () => {
  expect(LIST.activeCount(LIST.parse({ q: 'abc', sort: 'priority', status: 'new', consent: 'false' }))).toBe(2);
});

test('page window clamps and gives Supabase range bounds', () => {
  expect(pageWindow(0, 3, 50)).toMatchObject({ page: 1, pages: 1, from: 0, to: 0 });
  expect(pageWindow(120, 3, 50)).toMatchObject({ page: 3, pages: 3, from: 101, to: 120, rangeFrom: 100, rangeTo: 149 });
  expect(pageWindow(120, 9, 50).page).toBe(3);
});

test('page numbers keep first, last and neighbours with gaps', () => {
  expect(pageNumbers(1, 5)).toEqual([1, 2, 3, 4, 5]);
  expect(pageNumbers(1, 20)).toEqual([1, 2, null, 20]);
  expect(pageNumbers(10, 20)).toEqual([1, null, 9, 10, 11, null, 20]);
  expect(pageNumbers(20, 20)).toEqual([1, null, 19, 20]);
});
