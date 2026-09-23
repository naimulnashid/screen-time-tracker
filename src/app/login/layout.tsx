import type { Metadata } from 'next';

/**
 * Only here for the title: the login page is a client component, and those
 * cannot export metadata.
 *
 * Note the gate REWRITES rather than redirects, so this form usually renders
 * at a dashboard URL -- "Sign in" is what the tab should say there too, since
 * the page it names is not what is showing.
 */
export const metadata: Metadata = { title: 'Sign in' };

export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return children;
}
