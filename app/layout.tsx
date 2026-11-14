import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Clipflow — AI Video Editor",
  description: "Upload video mentah dan ubah menjadi klip menarik.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="id">
      <body>{children}</body>
    </html>
  );
}
