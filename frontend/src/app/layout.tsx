import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import { Providers } from '@/components/providers';
import { THEME_BOOT_SCRIPT } from '@/lib/theme';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: { default: 'TaskFlow Service Desk', template: '%s · TaskFlow Service Desk' },
  description: 'IT service management: incidents, service requests, problems, changes, assets and a self-service portal.',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" data-theme="glass" suppressHydrationWarning>
      <head>
        {/* Applies the saved theme before first paint; a constant string, no user input. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
      </head>
      <body className={inter.className}>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
