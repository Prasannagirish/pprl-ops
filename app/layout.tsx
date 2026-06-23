import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "PPRL Ops",
  description: "PPRL team travel operations — buffer calculation and Google Sheets sync."
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@500;600&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        {children}
        <footer className="site-footer">
          Made with <span className="footer-heart">❤️</span> by PPRL
        </footer>
      </body>
    </html>
  );
}
