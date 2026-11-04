"use client";

import { motion, useScroll, useTransform } from "framer-motion";
import { Send, ShoppingBag, UsersRound, Wallet } from "lucide-react";
import { useRef } from "react";
import { Reveal, SectionHeading, Serif } from "./ui";

const steps = [
  {
    icon: UsersRound,
    title: "Start your circle",
    body: "Open ZecCircle in Telegram and create a circle in one message. Name it — Family, Trip Squad, Flatmates — it's yours.",
    tag: "/newcircle Family",
  },
  {
    icon: Wallet,
    title: "Fund it privately",
    body: "Add shielded ZEC to your circle wallet. Balances and transfers stay encrypted on-chain — visible only to your circle.",
    tag: "/fund 5",
  },
  {
    icon: Send,
    title: "Invite your people",
    body: "Send a one-tap invite link. Give each member their own per-purchase and monthly limit. Change it whenever you like.",
    tag: "/invite 3",
  },
  {
    icon: ShoppingBag,
    title: "They just ask & spend",
    body: "Members type what they need in plain words. The circle agent finds it on Bitrefill and buys it within their limit — food, groceries, gift cards, top-ups, eSIMs.",
    tag: "“craving a Burger King 🍔”",
  },
];

export function HowItWorks() {
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start 70%", "end 60%"] });
  const h = useTransform(scrollYProgress, [0, 1], ["0%", "100%"]);

  return (
    <section id="how" className="relative py-32 sm:py-40">
      <div className="mx-auto max-w-6xl px-6">
        <SectionHeading
          eyebrow="How it works"
          title={
            <>
              One wallet. <Serif>Many hands.</Serif>
            </>
          }
          sub="You fund the circle once. The people you trust spend from it — privately, within limits, without ever touching your keys."
        />

        <div ref={ref} className="relative mt-24">
          <div className="absolute left-6 top-0 h-full w-px bg-white/[0.08] md:left-1/2" />
          <motion.div
            style={{ height: h }}
            className="absolute left-6 top-0 w-px bg-gradient-to-b from-gold via-amber to-gold-soft shadow-[0_0_14px_#f4b728] md:left-1/2"
          />

          <div className="space-y-16 md:space-y-28">
            {steps.map((s, i) => {
              const left = i % 2 === 0;
              return (
                <div key={s.title} className="relative grid items-center md:grid-cols-2 md:gap-24">
                  <motion.div
                    initial={{ scale: 0 }}
                    whileInView={{ scale: 1 }}
                    viewport={{ once: true, margin: "-120px" }}
                    transition={{ type: "spring", stiffness: 200, damping: 14 }}
                    className="absolute left-6 top-6 z-10 flex h-11 w-11 -translate-x-1/2 items-center justify-center rounded-full border border-gold/40 bg-ink font-mono text-sm text-gold shadow-[0_0_30px_rgba(244,183,40,0.35)] md:left-1/2 md:top-1/2 md:-translate-y-1/2"
                  >
                    0{i + 1}
                  </motion.div>

                  <Reveal
                    y={40}
                    className={`pl-16 md:pl-0 ${left ? "md:col-start-1 md:text-right" : "md:col-start-2"}`}
                  >
                    <motion.div
                      whileHover={{ y: -6 }}
                      className={`glass group inline-block w-full max-w-md rounded-3xl p-7 text-left transition-colors hover:border-gold/30`}
                    >
                      <div className="flex items-center gap-4">
                        <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gold/10 text-gold transition-all duration-500 group-hover:rotate-[-8deg] group-hover:scale-110 group-hover:bg-gold group-hover:text-ink">
                          <s.icon className="h-6 w-6" />
                        </span>
                        <h3 className="text-2xl font-semibold tracking-tight text-white">{s.title}</h3>
                      </div>
                      <p className="mt-4 leading-relaxed text-white/55">{s.body}</p>
                      <code className="mt-5 inline-block rounded-lg border border-white/10 bg-black/40 px-3 py-1.5 font-mono text-[13px] text-gold-soft">
                        {s.tag}
                      </code>
                    </motion.div>
                  </Reveal>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}
