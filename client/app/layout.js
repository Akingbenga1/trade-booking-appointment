import './globals.css';

export const metadata = {
  title: 'Trade Booking — Cleaning Hub',
  description: 'Central cleaning booking appointment hub',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
