"use client";

import { AnimatePresence, motion, useInView } from "framer-motion";
import { BadgeCheck, Clock, Globe2, Search, Zap } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { BitrefillMark, MagneticButton, Reveal, Serif, TelegramIcon } from "./ui";

type Product = { name: string; emoji: string; tag: string; inr: string; zec: string; bg: string };

const queries: { q: string; results: Product[] }[] = [
  {
    q: "craving a burger",
    results: [
      { name: "Burger King", emoji: "🍔", tag: "Food", inr: "₹400", zec: "0.0955", bg: "from-orange-500/30 to-red-600/20" },
      { name: "Swiggy", emoji: "🛵", tag: "Delivery", inr: "₹500", zec: "0.1194", bg: "from-orange-400/30 to-amber-500/10" },
      { name: "Zomato", emoji: "🍟", tag: "Delivery", inr: "₹300", zec: "0.0716", bg: "from-rose-500/30 to-red-500/10" },
    ],
  },
  {
    q: "groceries and chocolate",
    results: [
      { name: "BigBasket", emoji: "🛒", tag: "Groceries", inr: "₹1,000", zec: "0.2388", bg: "from-lime-500/30 to-emerald-600/10" },
      { name: "Amazon Fresh", emoji: "🥦", tag: "Groceries", inr: "₹750", zec: "0.1791", bg: "from-emerald-500/30 to-teal-500/10" },
      { name: "Chocolate box", emoji: "🍫", tag: "Treats", inr: "₹250", zec: "0.0597", bg: "from-amber-700/40 to-yellow-900/10" },
    ],
  },
  {
    q: "recharge my phone",
    results: [
      { name: "Jio Prepaid", emoji: "📶", tag: "Top-up", inr: "₹299", zec: "0.0714", bg: "from-blue-500/30 to-indigo-500/10" },
      { name: "Airtel", emoji: "📱", tag: "Top-up", inr: "₹349", zec: "0.0833", bg: "from-red-500/30 to-rose-500/10" },
      { name: "Vi", emoji: "📲", tag: "Top-up", inr: "₹199", zec: "0.0475", bg: "from-yellow-400/30 to-fuchsia-500/10" },
    ],
  },
  {
    q: "eSIM for Japan trip",
    results: [
      { name: "Japan 10GB", emoji: "🗾", tag: "eSIM", inr: "₹1,150", zec: "0.2746", bg: "from-pink-500/30 to-red-400/10" },
      { name: "Asia 20GB", emoji: "🌏", tag: "eSIM", inr: "₹1,900", zec: "0.4537", bg: "from-sky-500/30 to-cyan-500/10" },
      { name: "Uber", emoji: "🚕", tag: "Rides", inr: "₹800", zec: "0.1910", bg: "from-zinc-400/30 to-zinc-700/10" },
    ],
  },
  {
    q: "movie night",
    results: [
      { name: "Netflix", emoji: "🎬", tag: "Streaming", inr: "₹649", zec: "0.1550", bg: "from-red-600/30 to-black/10" },
      { name: "BookMyShow", emoji: "🍿", tag: "Movies", inr: "₹500", zec: "0.1194", bg: "from-rose-500/30 to-pink-500/10" },
      { name: "Spotify", emoji: "🎧", tag: "Music", inr: "₹119", zec: "0.0284", bg: "from-green-500/30 to-emerald-700/10" },
    ],
  },
];

const brands = [
  "🍔 Burger King", "🛵 Swiggy", "🍟 Zomato", "🛒 BigBasket", "📦 Amazon", "🛍️ Flipkart", "📶 Jio", "📱 Airtel",
  "🎬 Netflix", "🎧 Spotify", "🎮 Steam", "🕹️ PlayStation", "🚕 Uber", "🏠 Airbnb", "☕ Starbucks", "🍕 Domino's",
  "👗 Myntra", "🍿 BookMyShow", "🌍 Travel eSIMs", "🎁 1000s more",
];

export function BitrefillStore() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { margin: "-120px" });
  const [idx, setIdx] = useState(0);
  const [typed, setTyped] = useState("");
  const [showResults, setShowResults] = useState(false);
  const [picked, setPicked] = useState(false);

  useEffect(() => {
    if (!inView) return;
    const target = queries[idx].q;
    const timers: ReturnType<typeof setTimeout>[] = [];
    timers.push(
      setTimeout(() => {
        setTyped("");
        setShowResults(false);
        setPicked(false);
      }, 0),
    );
    for (let i = 1; i <= target.length; i++) timers.push(setTimeout(() => setTyped(target.slice(0, i)), 300 + i * 55));
    const done = 300 + target.length * 55;
    timers.push(setTimeout(() => setShowResults(true), done + 250));
    timers.push(setTimeout(() => setPicked(true), done + 1600));
    timers.push(setTimeout(() => setIdx((n) => (n + 1) % queries.length), done + 3900));
    return () => timers.forEach(clearTimeout);
  }, [idx, inView]);

  const current = queries[idx];

  return (
    <section id="store" className="relative overflow-hidden py-32 sm:py-40">
      <div className="pointer-events-none absolute right-[-10%] top-20 h-[600px] w-[700px] rounded-full bg-[radial-gradient(closest-side,rgba(47,208,160,0.16),transparent)]" />
      <div className="pointer-events-none absolute left-[-10%] bottom-0 h-[500px] w-[600px] rounded-full bg-[radial-gradient(closest-side,rgba(244,183,40,0.10),transparent)]" />

      <div className="relative mx-auto grid max-w-6xl items-center gap-16 px-6 lg:grid-cols-[1fr_1.1fr]">
        <div>
          <Reveal>
            <span className="inline-flex items-center gap-2 rounded-full border border-[#2fd0a0]/30 bg-[#2fd0a0]/[0.08] px-3.5 py-1.5 font-mono text-[11px] uppercase tracking-[0.18em] text-[#8ff0d0]">
              <BitrefillMark className="h-3.5 w-3.5" /> The Bitrefill store, inside your circle
            </span>
          </Reveal>
          <Reveal delay={0.08}>
            <h2 className="mt-6 text-4xl font-semibold leading-[1.05] tracking-tight text-white sm:text-5xl md:text-6xl">
              If Bitrefill sells it, <Serif>your circle can get it.</Serif>
            </h2>
          </Reveal>
          <Reveal delay={0.16}>
            <p className="mt-6 max-w-lg text-lg leading-relaxed text-white/55">
              Bitrefill is the biggest store for living on crypto — thousands of gift cards, food vouchers, grocery
              cards, mobile top-ups and eSIMs, delivered instantly. ZecCircle&apos;s agent searches its live catalogue
              for you, picks the right product and pays with shielded ZEC.
            </p>
          </Reveal>

          <div className="mt-10 grid gap-4 sm:grid-cols-3">
            {[
              { icon: Zap, k: "Instant", v: "codes delivered in seconds" },
              { icon: Globe2, k: "Global", v: "brands in 180+ countries" },
              { icon: Clock, k: "24 / 7", v: "midnight burger? sure." },
            ].map((s, i) => (
              <Reveal key={s.k} delay={0.2 + i * 0.08}>
                <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-4 transition-colors hover:border-[#2fd0a0]/40">
                  <s.icon className="h-5 w-5 text-[#5ee0b8]" />
                  <p className="mt-3 font-semibold text-white">{s.k}</p>
                  <p className="mt-0.5 text-[13px] text-white/45">{s.v}</p>
                </div>
              </Reveal>
            ))}
          </div>

          <Reveal delay={0.4} className="mt-10">
            <MagneticButton>
              <span className="flex items-center gap-2">
                <TelegramIcon /> Shop with your circle
              </span>
            </MagneticButton>
          </Reveal>
        </div>

        {/* animated storefront */}
        <Reveal delay={0.1} y={50}>
          <div ref={ref} className="relative">
            <div className="absolute -inset-4 rounded-[40px] bg-gradient-to-br from-[#2fd0a0]/20 via-transparent to-gold/15 blur-2xl" />
            <div className="relative overflow-hidden rounded-[32px] border border-white/10 bg-[#0b0d14]/90 p-5 shadow-[0_40px_120px_-30px_rgba(0,0,0,0.9)] backdrop-blur sm:p-6">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <BitrefillMark className="h-7 w-7" />
                  <span className="font-semibold text-white">Bitrefill</span>
                  <span className="rounded-full bg-white/[0.06] px-2 py-0.5 text-[10px] text-white/50">via ZecCircle agent</span>
                </div>
                <div className="flex gap-1.5">
                  {[0, 1, 2].map((d) => (
                    <span key={d} className="h-2.5 w-2.5 rounded-full bg-white/10" />
                  ))}
                </div>
              </div>

              <div className="mt-5 flex items-center gap-3 rounded-2xl border border-[#2fd0a0]/30 bg-black/40 px-4 py-3.5">
                <Search className="h-4 w-4 text-[#5ee0b8]" />
                <span className="text-[15px] text-white">
                  {typed}
                  <motion.span
                    animate={{ opacity: [1, 0, 1] }}
                    transition={{ duration: 0.9, repeat: Infinity }}
                    className="ml-0.5 inline-block h-4 w-[2px] translate-y-0.5 bg-[#5ee0b8]"
                  />
                </span>
              </div>

              <div className="mt-5 grid min-h-[236px] grid-cols-3 gap-3">
                <AnimatePresence mode="popLayout">
                  {showResults &&
                    current.results.map((p, i) => {
                      const chosen = picked && i === 0;
                      return (
                        <motion.div
                          key={current.q + p.name}
                          initial={{ opacity: 0, y: 24, scale: 0.92 }}
                          animate={{ opacity: picked && !chosen ? 0.4 : 1, y: 0, scale: chosen ? 1.05 : 1 }}
                          exit={{ opacity: 0, y: -16, scale: 0.95 }}
                          transition={{ delay: picked ? 0 : i * 0.1, type: "spring", stiffness: 220, damping: 20 }}
                          className={`relative overflow-hidden rounded-2xl border bg-gradient-to-br ${p.bg} p-3 ${
                            chosen ? "border-gold/60 shadow-[0_0_40px_-8px_rgba(244,183,40,0.6)]" : "border-white/10"
                          }`}
                        >
                          <div className="flex aspect-[4/3] items-center justify-center rounded-xl bg-black/30 text-4xl">{p.emoji}</div>
                          <p className="mt-2.5 truncate text-[13px] font-semibold text-white">{p.name}</p>
                          <p className="text-[11px] text-white/45">{p.tag}</p>
                          <div className="mt-2 flex items-baseline justify-between">
                            <span className="text-[13px] font-medium text-white">{p.inr}</span>
                            <span className="font-mono text-[10px] text-gold-soft">{p.zec} ZEC</span>
                          </div>
                          {chosen && (
                            <motion.span
                              initial={{ scale: 0 }}
                              animate={{ scale: 1 }}
                              className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full bg-gold text-ink"
                            >
                              <BadgeCheck className="h-4 w-4" />
                            </motion.span>
                          )}
                        </motion.div>
                      );
                    })}
                </AnimatePresence>
              </div>

              <AnimatePresence>
                {picked && (
                  <motion.div
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    className="mt-4 flex items-center justify-between rounded-2xl border border-emerald-400/20 bg-emerald-400/[0.06] px-4 py-3"
                  >
                    <span className="flex items-center gap-2 text-sm font-medium text-emerald-300">
                      <BadgeCheck className="h-4 w-4" /> {current.results[0].name} · paid & delivered
                    </span>
                    <span className="font-mono text-[11px] text-white/50">shielded ZEC</span>
                  </motion.div>
                )}
              </AnimatePresence>
              {!picked && <div className="mt-4 h-[46px]" />}
            </div>
          </div>
        </Reveal>
      </div>

      {/* brand marquee */}
      <div className="relative mt-24 space-y-4">
        <div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-40 bg-gradient-to-r from-ink to-transparent" />
        <div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-40 bg-gradient-to-l from-ink to-transparent" />
        {[0, 1].map((row) => (
          <div key={row} className="flex overflow-hidden">
            <div
              className="animate-marquee flex shrink-0 gap-3 pr-3"
              style={{ animationDirection: row ? "reverse" : "normal", animationDuration: row ? "55s" : "45s" }}
            >
              {[...brands, ...brands].map((b, i) => (
                <span
                  key={i}
                  className="shrink-0 rounded-full border border-white/[0.08] bg-white/[0.03] px-5 py-2.5 text-sm text-white/65 transition-colors hover:border-[#2fd0a0]/40 hover:text-white"
                >
                  {row ? brands[(i + 7) % brands.length] : b}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
