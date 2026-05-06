import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "SayNoMore",
  description: "FMCG Import & Distribution Operations",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark h-full antialiased">
      <body className="min-h-full">{children}</body>
    </html>
  );
}
