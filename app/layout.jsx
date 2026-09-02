import './globals.css';

export const metadata = {
  title: { default: 'Inkwell eSign', template: '%s · Inkwell eSign' },
  description: 'Prepare, send and legally execute documents with a tamper-evident audit trail.',
  robots: { index: false },
};

export const viewport = { width: 'device-width', initialScale: 1, maximumScale: 5 };

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
