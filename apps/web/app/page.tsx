import { redirect } from 'next/navigation';

// Root URL has no UI of its own — funnel users into the orders page,
// which is the primary work surface for the MVP. Auth middleware will
// already have redirected unauthenticated users to /login before this runs.
export default function HomePage(): never {
  redirect('/orders');
}
