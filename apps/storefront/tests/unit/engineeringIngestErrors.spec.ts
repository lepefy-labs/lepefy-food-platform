import { test, expect } from '@playwright/test';
import { rowsInsertError } from '../../src/lib/engineering/ingest/protocol';

test('rows insert errors: known violations keep their code, others expose only the SQLSTATE', () => {
  expect(rowsInsertError('23503')).toMatchObject({ code: 'missing_blob_or_reference', status: 422 });
  expect(rowsInsertError('23505')).toMatchObject({ code: 'duplicate_row', status: 409 });
  expect(rowsInsertError('23514')).toMatchObject({ code: 'database_error_23514', status: 422 });
  expect(rowsInsertError(undefined)).toMatchObject({ code: 'database_error_unknown', status: 422 });
  expect(rowsInsertError('not a code: secret value')).toMatchObject({ code: 'database_error_unknown' });
});

test('rows insert errors: transient database states answer 503 so the sync client retries the batch', () => {
  for (const code of ['57014', '40001', '40P01', '53300', '08006', '57P01']) {
    expect(rowsInsertError(code)).toMatchObject({ code: `database_error_${code}`, status: 503 });
  }
});
