export type ReadStatusFilter = 'all' | 'unread' | 'read';

export async function syncReadStatusChange(
  selectedStatus: ReadStatusFilter,
  updateLocal: () => void,
  reload: () => Promise<unknown>,
) {
  updateLocal();
  if (selectedStatus !== 'all') {
    await reload();
  }
}
