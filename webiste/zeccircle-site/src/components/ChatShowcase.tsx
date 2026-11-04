"use client";

import { AnimatePresence, motion, useInView } from "framer-motion";
import { BadgeCheck, Lock } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { MagneticButton, Reveal, Serif, TelegramIcon, Eyebrow } from "./ui";

type Msg = { from: "me" | "bot"; text: React.ReactNode; card?: boolean };

const script: Msg[] = [
  { from: "me", text: "hey I'm craving a burger 🍔 can you order it from Burger King?" },
  { from: "bot", text: "Say no more! Getting you a ₹400 Burger King voucher — within your ₹500 per-purchase limit." },
  {
    from: "bot",
    card: true,
    text: (
      <div>
        <p className="flex items-center gap-1.5 text-[13px] font-semibold text-emerald-300">
          <BadgeCheck className="h-4 w-4" /> Burger King · delivered
        </p>
        <div className="mt-2 space-y-1 font-mono text-[12px] text-white/60">
          <p>Via: Bitrefill</p>
          <p>Paid from: Family circle</p>
          <p>Amount: 0.0955 ZEC · shielded</p>
        </div>
      </div>
    ),
  },
  { from: "me", text: "also buy me groceries and some chocolate 🍫" },
  { from: "bot", text: "Done ✨ ₹1,000 grocery voucher sent — chocolate's on the circle tonight. Enjoy!" },
];

export function ChatShowcase() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { margin: "-150px" });
  const [count, setCount] = useState(0);
  const [typing, setTyping] = useState(false);

  useEffect(() => {
    if (!inView) return;
    if (count >= script.length) {
      const t = setTimeout(() => setCount(0), 5000);
      return () => clearTimeout(t);
    }
    const next = script[count];
    const t1 = setTimeout(() => setTyping(next.from === "bot"), count === 0 ? 400 : 700);
    const t2 = setTimeout(
      () => {
        setTyping(false);
        setCount((c) => c + 1);
      },
      next.from === "bot" ? 2000 : 1300,
    );
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [inView, count]);

  return (
    <section className="relative overflow-hidden py-32 sm:py-40">
      <div className="pointer-events-none absolute -left-40 top-1/3 h-[600px] w-[600px] rounded-full bg-[radial-gradient(closest-side,rgba(244,183,40,0.12),transparent)]" />
      <div className="relative mx-auto grid max-w-6xl items-center gap-16 px-6 lg:grid-cols-2">
        <div>
          <Reveal>
            <Eyebrow>Just ask</Eyebrow>
          </Reveal>
          <Reveal delay={0.08}>
            <h2 className="mt-6 text-4xl font-semibold leading-[1.05] tracking-tight text-white sm:text-5xl md:text-6xl">
              Spending is a <Serif>conversation.</Serif>
            </h2>
          </Reveal>
          <Reveal delay={0.16}>
            <p className="mt-6 max-w-lg text-lg leading-relaxed text-white/55">
              No forms. No checkout pages. No card details. Members simply tell the circle what they need, and it&apos;s
              handled in seconds — paid from shielded circle funds through Bitrefill, delivered right in chat. Burger at midnight? Groceries for the week? Just ask.
            </p>
          </Reveal>
          <Reveal delay={0.24} className="mt-10">
            <MagneticButton>
              <span className="flex items-center gap-2">
                <TelegramIcon /> Try it on Telegram
              </span>
            </MagneticButton>
          </Reveal>
        </div>

        <Reveal delay={0.1} y={60}>
          <div ref={ref} className="relative mx-auto w-full max-w-[400px]">
            <div className="absolute -inset-6 rounded-[48px] bg-gold/10 blur-3xl" />
            <div className="relative overflow-hidden rounded-[40px] border border-white/10 bg-[#0e0f13] p-2 shadow-[0_40px_120px_-30px_rgba(0,0,0,0.9)]">
              <div className="rounded-[32px] bg-gradient-to-b from-[#15171d] to-[#0c0d11]">
                <div className="flex items-center gap-3 border-b border-white/[0.06] px-5 py-4">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gold text-lg font-bold text-ink">Z</div>
                  <div className="flex-1">
                    <p className="text-sm font-semibold text-white">ZecCircle</p>
                    <p className="text-[11px] text-gold/80">{typing ? "typing…" : "online"}</p>
                  </div>
                  <Lock className="h-4 w-4 text-white/30" />
                </div>
                <div className="flex h-[440px] flex-col justify-end gap-2.5 overflow-hidden px-4 py-5">
                  <AnimatePresence initial={false}>
                    {script.slice(0, count).map((m, i) => (
                      <motion.div
                        key={i}
                        layout
                        initial={{ opacity: 0, y: 20, scale: 0.9 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ type: "spring", stiffness: 260, damping: 22 }}
                        className={`max-w-[82%] rounded-2xl px-3.5 py-2.5 text-[14px] leading-snug ${
                          m.from === "me"
                            ? "ml-auto rounded-br-md bg-gold text-ink"
                            : m.card
                              ? "rounded-bl-md border border-emerald-400/20 bg-emerald-400/[0.06] text-white"
                              : "rounded-bl-md bg-white/[0.07] text-white/85"
                        }`}
                      >
                        {m.text}
                      </motion.div>
                    ))}
                    {typing && (
                      <motion.div
                        key="typing"
                        layout
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0 }}
                        className="flex w-16 items-center justify-center gap-1 rounded-2xl rounded-bl-md bg-white/[0.07] py-3.5"
                      >
                        {[0, 1, 2].map((d) => (
                          <motion.span
                            key={d}
                            animate={{ y: [0, -4, 0], opacity: [0.4, 1, 0.4] }}
                            transition={{ duration: 0.9, repeat: Infinity, delay: d * 0.15 }}
                            className="h-1.5 w-1.5 rounded-full bg-white/70"
                          />
                        ))}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
                <div className="flex items-center gap-2 border-t border-white/[0.06] px-4 py-3">
                  <div className="flex-1 rounded-full bg-white/[0.05] px-4 py-2.5 text-[13px] text-white/30">Message</div>
                  <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gold text-ink">
                    <TelegramIcon className="h-4 w-4" />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
