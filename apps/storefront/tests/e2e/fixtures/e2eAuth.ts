// Riesporta il token per usarlo in chiamate fetch dirette dentro gli spec
// (extraHTTPHeaders del config copre già la navigazione browser normale)
export const E2E_TOKEN = process.env.E2E_TEST_SECRET || '';
