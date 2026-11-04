"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Check } from "lucide-react";
import { useEffect, useState } from "react";
import { Reveal, SectionHeading, Serif } from "./ui";

const cases = [
  {
    key: "family",
    label: "Family",
    emoji: "🏡",
    title: "One budget for the whole household",
    body: "Parents fund the circle, everyone at home spends from it. Kids get pocket-money limits, grandparents get recharges without needing a card.",
    points: ["Monthly allowance for each kid", "Phone recharges for grandparents", "One place to see every spend"],
    members: ["👨", "👩", "🧒", "👧", "👵"],
    stat: { k: "5 members", v: "2.0 ZEC / month" },
  },
  {
    key: "college",
    label: "Kids away",
    emoji: "🎓",
    title: "Support them from anywhere",
    body: "Your child is in another city or another country. Top up the circle and they can get what they need — data, groceries, gift cards — within limits you trust.",
    points: ["Travel eSIM before the flight lands", "Per-purchase cap keeps things sane", "Adjust limits anytime, from anywhere"],
    members: ["👩", "🧑‍🎓"],
    stat: { k: "2 members", v: "0.8 ZEC / month" },
  },
  {
    key: "friends",
    label: "Friends & trips",
    emoji: "✈️",
    title: "A pooled fund for the squad",
    body: "Everyone chips in shielded ZEC for the trip, the party or the flat. Whoever needs to spend just asks — and nobody's wallet history goes public.",
    points: ["Pool funds privately for trips", "Fair per-person spend caps", "Pause the circle when the trip ends"],
    members: ["🧑", "👱‍♀️", "🧔", "👩‍🦱"],
    stat: { k: "4 members", v: "3.5 ZEC pooled" },
  },
  {
    key: "parents",
    label: "Elder care",
    emoji: "💛",
    title: "Look after the ones who looked after you",
    body: "Give parents a simple way to get recharges and gift cards — they just type what they need. You stay in the loop, quietly.",
    points: ["Nothing new to learn — just chat", "Notifications for every purchase", "No card details ever shared"],
    members: ["🧑", "👴", "👵"],
    stat: { k: "3 members", v: "1.2 ZEC / month" },
  },
];

export function UseCases() {
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    if (paused) return;
    const t = setInterval(() => setActive((a) => (a + 1) % cases.length), 5500);
    return () => clearInterval(t);
  }, [paused]);
  const c = cases[active];

  return (
    <section id="circles" className="relative py-32 sm:py-40">
      <div className="mx-auto max-w-6xl px-6">
        <SectionHeading
          eyebrow="Circles for every kind of trust"
          title={
            <>
              Made for the people <Serif>you&apos;d hand your wallet to.</Serif>
            </>
          }
        />

        <Reveal delay={0.1} className="mt-14 flex justify-center">
          <div className="glass inline-flex flex-wrap justify-center gap-1 rounded-full p-1.5">
            {cases.map((x, i) => (
              <button
                key={x.key}
                onClick={() => {
                  setActive(i);
                  setPaused(true);
                }}
                className={`relative rounded-full px-4 py-2.5 text-sm font-medium transition-colors sm:px-5 ${
                  i === active ? "text-ink" : "text-white/60 hover:text-white"
                }`}
              >
                {i === active && (
                  <motion.span
                    layoutId="tab-pill"
                    className="absolute inset-0 rounded-full bg-gold"
                    transition={{ type: "spring", stiffness: 380, damping: 30 }}
                  />
                )}
                <span className="relative">
                  {x.emoji} {x.label}
                </span>
              </button>
            ))}
          </div>
        </Reveal>

        <Reveal delay={0.15} className="mt-10">
          <div className="relative overflow-hidden rounded-[32px] border border-white/[0.08] bg-gradient-to-br from-white/[0.05] to-white/[0.01] p-8 sm:p-12">
            {!paused && (
              <motion.div
                key={active}
                initial={{ scaleX: 0 }}
                animate={{ scaleX: 1 }}
                transition={{ duration: 5.5, ease: "linear" }}
                className="absolute inset-x-0 top-0 h-[2px] origin-left bg-gold/70"
              />
            )}
            <AnimatePresence mode="wait">
              <motion.div
                key={c.key}
                initial={{ opacity: 0, y: 24, filter: "blur(10px)" }}
                animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                exit={{ opacity: 0, y: -24, filter: "blur(10px)" }}
                transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
                className="grid items-center gap-12 md:grid-cols-[1.2fr_1fr]"
              >
                <div>
                  <h3 className="text-3xl font-semibold tracking-tight text-white sm:text-4xl">{c.title}</h3>
                  <p className="mt-4 text-lg leading-relaxed text-white/55">{c.body}</p>
                  <ul className="mt-8 space-y-3">
                    {c.points.map((p, i) => (
                      <motion.li
                        key={p}
                        initial={{ opacity: 0, x: -14 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: 0.15 + i * 0.08 }}
                        className="flex items-center gap-3 text-white/80"
                      >
                        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-gold/15 text-gold">
                          <Check className="h-3.5 w-3.5" />
                        </span>
                        {p}
                      </motion.li>
                    ))}
                  </ul>
                </div>

                <div className="relative mx-auto flex aspect-square w-full max-w-[340px] items-center justify-center">
                  <motion.div
                    animate={{ rotate: 360 }}
                    transition={{ duration: 40, repeat: Infinity, ease: "linear" }}
                    className="absolute inset-0 rounded-full border border-dashed border-gold/25"
                  />
                  <div className="absolute inset-[18%] rounded-full bg-[radial-gradient(closest-side,rgba(244,183,40,0.25),transparent)]" />
                  {c.members.map((m, i) => {
                    const a = ((360 / c.members.length) * i - 90) * (Math.PI / 180);
                    return (
                      <motion.div
                        key={m + i}
                        initial={{ scale: 0, x: 0, y: 0 }}
                        animate={{ scale: 1, x: Math.round(Math.cos(a) * 140), y: Math.round(Math.sin(a) * 140) }}
                        transition={{ delay: 0.1 + i * 0.07, type: "spring", stiffness: 140, damping: 14 }}
                        className="absolute flex h-14 w-14 items-center justify-center rounded-full border border-white/10 bg-ink text-2xl shadow-xl"
                      >
                        {m}
                      </motion.div>
                    );
                  })}
                  <div className="relative text-center">
                    <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-white/40">{c.stat.k}</p>
                    <p className="mt-1 text-xl font-semibold text-gold">{c.stat.v}</p>
                  </div>
                </div>
              </motion.div>
            </AnimatePresence>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
