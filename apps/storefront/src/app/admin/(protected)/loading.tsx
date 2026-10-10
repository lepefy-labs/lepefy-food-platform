import { ListPageSkeleton } from '../_components/ui/States';

// Instant feedback while any protected admin page renders on the server.
export default function Loading() {
  return <ListPageSkeleton rows={8} />;
}
