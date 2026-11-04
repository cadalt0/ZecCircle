import { ZecMark } from "./ui";

const items = [
  "Shielded circle funds",
  "Live on Zcash mainnet",
  "Spend limits per member",
  "Anonymous spending",
  "Powered by Bitrefill",
  "Burgers · Groceries · Chocolate",
  "Gift cards · Top-ups · eSIMs",
  "Pause anyone, instantly",
  "No cards shared. No keys shared.",
  "Built for families & friends",
];

export function Marquee() {
  return (
    <section className="relative border-y border-white/[0.06] bg-white/[0.015] py-6">
      <div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-32 bg-gradient-to-r from-ink to-transparent" />
      <div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-32 bg-gradient-to-l from-ink to-transparent" />
      <div className="flex overflow-hidden">
        <div className="animate-marquee flex shrink-0 items-center gap-12 pr-12">
          {[...items, ...items].map((t, i) => (
            <span key={i} className="flex shrink-0 items-center gap-12 text-lg font-medium text-white/40">
              {t}
              <ZecMark className="h-4 w-4 opacity-70" />
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}
