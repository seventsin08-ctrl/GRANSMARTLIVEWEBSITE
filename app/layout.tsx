import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Grain Smart | Order fresh, feel good",
  description: "Milk tea, café bites, rice bowls and sweet little treats.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
