import type { Metadata } from "next";
import { Geist, Geist_Mono, Instrument_Serif } from "next/font/google";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });
const serif = Instrument_Serif({
  variable: "--font-serif",
  subsets: ["latin"],
  weight: "400",
  style: ["normal", "italic"],
});

export const metadata: Metadata = {
  title: "ZecCircle — Private circle funds, spent on Bitrefill",
  description:
    "Fund one shielded Zcash wallet and let your family and friends spend from it — with limits you set and privacy nobody can break. Spend on food, groceries and gift cards via Bitrefill. Live on Zcash mainnet.",
  openGraph: {
    title: "ZecCircle — Your circle. Your funds. Nobody else's business.",
    description:
      "One shielded wallet for your whole circle. Set limits, invite family and friends, and let them spend privately.",
  },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} ${serif.variable} antialiased`}>
      <body className="noise min-h-full font-sans">{children}</body>
    </html>
  );
}
