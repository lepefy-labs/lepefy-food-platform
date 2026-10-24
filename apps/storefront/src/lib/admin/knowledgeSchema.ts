/** Expected during the short interval between app deployment and migration 168. */
export function missingKnowledgeSchema(error: { code?: string | null } | null): boolean {
  return error?.code === '42P01' || error?.code === '42703' || error?.code === 'PGRST205' || error?.code === 'PGRST204';
}
