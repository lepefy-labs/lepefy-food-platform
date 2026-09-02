/** Only the existing migration-100 RPC performs expiry and retention changes. */
export async function runAiCoreMaintenance(
  purge: () => PromiseLike<{ data: unknown; error: unknown }>,
): Promise<{ deletedConversations: number }> {
  try {
    const { data, error } = await purge();
    if (error) throw new Error('purge_failed');
    const count = typeof data === 'number' ? data
      : typeof data === 'string' && /^(0|[1-9][0-9]*)$/.test(data) ? Number(data) : NaN;
    if (!Number.isSafeInteger(count) || count < 0) throw new Error('invalid_purge_result');
    // RPC returns deleted conversation rows, not deleted turns or states.
    return { deletedConversations: count };
  } catch {
    throw new Error('ai_core_maintenance_failed');
  }
}
