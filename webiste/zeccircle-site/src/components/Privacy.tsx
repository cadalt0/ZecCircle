"use client";

import { motion } from "framer-motion";
import { Eye, EyeOff, ShieldCheck } from "lucide-react";
import { Reveal, SectionHeading, Serif } from "./ui";

const rows = [
  { label: "Who funded the circle", circle: "You", world: "Hidden" },
  { label: "Circle balance", circle: "12.40 ZEC", world: "Hidden" },
  { label: "Who spent", circle: "Aarav", world: "Anonymous" },
  { label: "What was bought", circle: "Burger King voucher", world: "Hidden" },
  { label: "Where it was bought", circle: "Bitrefill", world: "Hidden" },
  { label: "Members in the circle", circle: "5 people", world: "Hidden" },
];

export function Privacy() {
  return (
    <section id="privacy" className="relative py-32 sm:py-40">
      <div className="mx-auto max-w-6xl px-6">
        <SectionHeading
          eyebrow="Privacy, by default"
          title={
            <>
              Your circle sees everything. <br className="hidden sm:block" />
              <Serif>The world sees nothing.</Serif>
            </>
          }
          sub="Built on Zcash shielded transactions — the gold standard in on-chain privacy, backed by zero-knowledge proofs and battle-tested on mainnet."
        />

        <Reveal delay={0.2} className="mt-20">
          <div className="overflow-hidden rounded-[32px] border border-white/[0.08] bg-white/[0.02]">
            <div className="grid grid-cols-[1.3fr_1fr_1fr] border-b border-white/[0.08] text-xs font-medium uppercase tracking-[0.14em] sm:text-sm">
              <div className="p-5 text-white/40 sm:p-6">Information</div>
              <div className="flex items-center gap-2 bg-gold/[0.06] p-5 text-gold sm:p-6">
                <Eye className="h-4 w-4" /> <span className="hidden sm:inline">Your</span> circle
              </div>
              <div className="flex items-center gap-2 p-5 text-white/40 sm:p-6">
                <EyeOff className="h-4 w-4" /> <span className="hidden sm:inline">Everyone</span> else
              </div>
            </div>
            {rows.map((r, i) => (
              <motion.div
                key={r.label}
                initial={{ opacity: 0, y: 12 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: 0.3 + i * 0.08 }}
                className="grid grid-cols-[1.3fr_1fr_1fr] border-b border-white/[0.05] text-sm last:border-0 sm:text-base"
              >
                <div className="p-5 text-white/70 sm:p-6">{r.label}</div>
                <div className="bg-gold/[0.04] p-5 font-medium text-white sm:p-6">{r.circle}</div>
                <div className="flex items-center p-5 sm:p-6">
                  <span className="relative inline-flex items-center gap-1.5 overflow-hidden rounded-md bg-white/[0.05] px-2.5 py-1 font-mono text-xs text-white/35">
                    <ShieldCheck className="h-3.5 w-3.5 text-emerald-300/70" />
                    {r.world}
                    <motion.span
                      animate={{ x: ["-120%", "220%"] }}
                      transition={{ duration: 2.6, repeat: Infinity, delay: i * 0.35, ease: "easeInOut" }}
                      className="absolute inset-y-0 left-0 w-1/2 bg-gradient-to-r from-transparent via-white/10 to-transparent"
                    />
                  </span>
                </div>
              </motion.div>
            ))}
          </div>
        </Reveal>

        <div className="mt-16 grid gap-5 sm:grid-cols-3">
          {[
            { n: "zk-SNARKs", d: "Zero-knowledge proofs verify every payment without revealing it." },
            { n: "Shielded pool", d: "Circle funds live in Zcash's encrypted Orchard pool." },
            { n: "Selective view", d: "You choose who sees what — the circle, and only the circle." },
          ].map((x, i) => (
            <Reveal key={x.n} delay={i * 0.1}>
              <div className="rounded-3xl border border-white/[0.07] p-6 transition-colors hover:border-gold/25">
                <p className="font-serif text-3xl italic text-gold">{x.n}</p>
                <p className="mt-2 text-white/55">{x.d}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
