"use client";

import { motion } from "framer-motion";
import { ArrowRight, Repeat2, ShieldCheck } from "lucide-react";
import { BitrefillMark, Reveal, SectionHeading, Serif, ZecMark } from "./ui";

const flow = [
  { icon: <ZecMark className="h-7 w-7" />, title: "Shielded ZEC", sub: "from your circle" },
  { icon: <Repeat2 className="h-6 w-6 text-gold" />, title: "Instant swap", sub: "settled in minutes" },
  { icon: <BitrefillMark className="h-8 w-8" />, title: "Bitrefill", sub: "thousands of brands" },
  { icon: <span className="text-2xl">🍔</span>, title: "Delivered", sub: "right in your chat" },
];

const categories = [
  { emoji: "🍔", title: "Food cravings", brands: "Burger King · Swiggy · Zomato · Uber Eats", tint: "from-orange-500/20" },
  { emoji: "🛒", title: "Weekly groceries", brands: "BigBasket · Amazon Fresh · Walmart", tint: "from-emerald-500/20" },
  { emoji: "🍫", title: "Little treats", brands: "Chocolate runs · desserts · coffee", tint: "from-amber-700/30" },
  { emoji: "📱", title: "Mobile recharge", brands: "Jio · Airtel · Vi · 500+ carriers", tint: "from-sky-500/20" },
  { emoji: "🌍", title: "Travel eSIMs", brands: "Data in 150+ countries", tint: "from-indigo-500/20" },
  { emoji: "🛍️", title: "Shopping", brands: "Amazon · Flipkart · Myntra", tint: "from-pink-500/20" },
  { emoji: "🎮", title: "Gaming", brands: "Steam · PlayStation · Xbox", tint: "from-violet-500/20" },
  { emoji: "🚕", title: "Rides & travel", brands: "Uber · Airbnb · flights", tint: "from-yellow-500/20" },
];

export function Bitrefill() {
  return (
    <section id="bitrefill" className="relative overflow-hidden py-32 sm:py-40">
      <div className="pointer-events-none absolute left-1/2 top-1/3 h-[700px] w-[1100px] -translate-x-1/2 rounded-full bg-[radial-gradient(closest-side,rgba(244,183,40,0.10),transparent)]" />
      <div className="relative mx-auto max-w-6xl px-6">
        <Reveal className="mb-8 flex justify-center">
          <div className="glass flex items-center gap-3 rounded-full px-5 py-2.5">
            <ZecMark className="h-5 w-5" />
            <span className="text-sm font-semibold text-white">Zcash</span>
            <span className="text-white/30">×</span>
            <BitrefillMark className="h-5 w-5" />
            <span className="text-sm font-semibold text-white">Bitrefill</span>
          </div>
        </Reveal>

        <SectionHeading
          eyebrow="Spend on anything"
          title={
            <>
              Private money in. <Serif>Real life out.</Serif>
            </>
          }
          sub="ZecCircle is wired straight into Bitrefill. Circle funds become burgers, groceries, chocolate, recharges and gift cards from thousands of brands — without a card, a bank or a trace."
        />

        {/* flow */}
        <Reveal delay={0.15} className="mt-20">
          <div className="relative grid gap-4 md:grid-cols-4">
            <div className="absolute left-[12%] right-[12%] top-1/2 hidden h-px -translate-y-1/2 bg-gradient-to-r from-gold/0 via-gold/40 to-gold/0 md:block" />
            {[0, 1, 2].map((i) => (
              <motion.span
                key={i}
                aria-hidden
                className="absolute top-1/2 hidden h-2 w-2 -translate-y-1/2 rounded-full bg-gold shadow-[0_0_16px_4px_rgba(244,183,40,0.6)] md:block"
                initial={{ left: "12%", opacity: 0 }}
                animate={{ left: ["12%", "88%"], opacity: [0, 1, 1, 0] }}
                transition={{ duration: 3.6, repeat: Infinity, delay: i * 1.2, ease: "easeInOut" }}
              />
            ))}
            {flow.map((f, i) => (
              <motion.div
                key={f.title}
                initial={{ opacity: 0, y: 30 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: 0.2 + i * 0.15, duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
                whileHover={{ y: -6, scale: 1.03 }}
                className={`relative z-10 flex flex-col items-center rounded-3xl border bg-ink/80 p-6 text-center backdrop-blur ${
                  i === 3 ? "border-gold/40 shadow-[0_0_50px_-10px_rgba(244,183,40,0.5)]" : "border-white/[0.08]"
                }`}
              >
                <span className="flex h-14 w-14 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04]">
                  {f.icon}
                </span>
                <p className="mt-4 font-semibold text-white">{f.title}</p>
                <p className="mt-1 text-sm text-white/45">{f.sub}</p>
                {i < 3 && <ArrowRight className="mt-3 h-4 w-4 text-gold/60 md:hidden" />}
              </motion.div>
            ))}
          </div>
        </Reveal>

        {/* categories */}
        <div className="mt-20 grid grid-cols-2 gap-4 md:grid-cols-4">
          {categories.map((c, i) => (
            <Reveal key={c.title} delay={(i % 4) * 0.08}>
              <motion.div
                whileHover={{ y: -8, rotate: i % 2 ? 1.5 : -1.5 }}
                transition={{ type: "spring", stiffness: 300, damping: 18 }}
                className={`group relative h-full overflow-hidden rounded-3xl border border-white/[0.08] bg-gradient-to-br ${c.tint} to-transparent p-6 transition-colors hover:border-gold/30`}
              >
                <motion.span
                  className="inline-block text-4xl"
                  animate={{ y: [0, -6, 0] }}
                  transition={{ duration: 3 + (i % 3) * 0.5, repeat: Infinity, ease: "easeInOut", delay: i * 0.2 }}
                >
                  {c.emoji}
                </motion.span>
                <p className="mt-4 text-lg font-semibold text-white">{c.title}</p>
                <p className="mt-1 text-[13px] leading-snug text-white/50">{c.brands}</p>
              </motion.div>
            </Reveal>
          ))}
        </div>

        {/* stats */}
        <Reveal delay={0.1} className="mt-16">
          <div className="grid gap-px overflow-hidden rounded-3xl border border-white/[0.08] bg-white/[0.06] sm:grid-cols-3">
            {[
              { k: "1000s", v: "of brands to spend on" },
              { k: "180+", v: "countries covered" },
              { k: "0", v: "cards, banks or KYC for members" },
            ].map((s) => (
              <div key={s.v} className="bg-ink p-8 text-center">
                <p className="text-4xl font-semibold tracking-tight text-gradient-gold">{s.k}</p>
                <p className="mt-2 text-sm text-white/50">{s.v}</p>
              </div>
            ))}
          </div>
        </Reveal>

        <Reveal delay={0.15} className="mt-8 flex justify-center">
          <p className="flex items-center gap-2 text-sm text-white/45">
            <ShieldCheck className="h-4 w-4 text-emerald-300/80" />
            Every order is paid from shielded circle funds — Bitrefill delivers, your circle stays private.
          </p>
        </Reveal>
      </div>
    </section>
  );
}
