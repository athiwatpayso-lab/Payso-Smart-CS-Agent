import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Payso Smart CS Agent",
  description: "Thai-first AI customer support prototype for Payso.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="th">
      <body className="font-sans antialiased">{children}</body>
    </html>
  );
}
