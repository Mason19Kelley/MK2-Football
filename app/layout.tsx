import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = {
  title: 'MKII Football — Your fantasy football edge',
  description:
    'Explore your ESPN fantasy football rosters, projections, and trade possibilities.',
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
