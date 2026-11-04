"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Plus } from "lucide-react";
import { useState } from "react";
import { BOT_URL } from "@/lib/site";
import { MagneticButton, Reveal, SectionHeading, Serif, TelegramIcon, ZecMark } from "./ui";

const faqs = [
  {
    q: "What is a circle?",
    a: "A circle is a shared, shielded Zcash wallet for a group you trust — your family, your friends, your flatmates. The owner funds it and sets limits; members spend from it by simply asking in chat.",
  },
  {
    q: "What is Bitrefill and why is it built in?",
    a: "Bitrefill is the world's go-to store for living on crypto — gift cards, mobile top-ups, eSIMs and vouchers from thousands of brands, delivered instantly. ZecCircle plugs your circle straight into it, so shielded ZEC turns into burgers, groceries and everyday essentials in seconds.",
  },
  {
    q: "How does ZEC turn into a Bitrefill purchase?",
    a: "When a member asks for something, the circle agent finds it in Bitrefill's live catalogue, checks the member's limit, and pays from the circle's shielded funds through an instant swap. Bitrefill delivers the voucher or top-up, and the bot drops it right into the chat.",
  },
  {
    q: "Who can see the circle's balance and spending?",
    a: "Only your circle. The owner sees every member's spend and limits. To everyone else on-chain, circle funds and transactions are fully shielded — no names, no amounts, no history.",
  },
  {
    q: "Do members need their own crypto wallet?",
    a: "No. Members just open the invite link in Telegram and they're in. They never handle keys, seed phrases or card numbers — they ask, and the circle pays.",
  },
  {
    q: "What can members buy?",
    a: "Almost anything on Bitrefill — food from Burger King and Swiggy, groceries, chocolate runs, gift cards from thousands of brands, mobile recharges and travel eSIMs. Just ask in chat and it's delivered in seconds.",
  },
  {
    q: "How do limits work?",
    a: "Every member gets a per-purchase cap and a monthly budget, and you can add a hard monthly cap for the whole circle. You can change limits, pause a member or pause the entire circle at any time.",
  },
  {
    q: "How do I add money to the circle?",
    a: "Use /fund in the bot to get a shielded deposit address and send ZEC from any Zcash wallet. Funds land in your circle privately and are ready to spend.",
  },
];

export function FAQ() {
  const [open, setOpen] = useState<number | null>(0);
  return (
    <section id="faq" className="relative py-32 sm:py-40">
      <div className="mx-auto max-w-3xl px-6">
        <SectionHeading
          eyebrow="FAQ"
          title={
            <>
              Questions, <Serif>answered.</Serif>
            </>
          }
        />
        <div className="mt-16 space-y-3">
          {faqs.map((f, i) => {
            const isOpen = open === i;
            return (
              <Reveal key={f.q} delay={i * 0.05}>
                <div
                  className={`overflow-hidden rounded-2xl border transition-colors duration-300 ${
                    isOpen ? "border-gold/30 bg-gold/[0.04]" : "border-white/[0.08] bg-white/[0.02] hover:border-white/15"
                  }`}
                >
                  <button
                    onClick={() => setOpen(isOpen ? null : i)}
                    className="flex w-full items-center justify-between gap-6 px-6 py-5 text-left"
                  >
                    <span className="text-lg font-medium text-white">{f.q}</span>
                    <motion.span
                      animate={{ rotate: isOpen ? 45 : 0 }}
                      transition={{ type: "spring", stiffness: 300, damping: 20 }}
                      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${
                        isOpen ? "bg-gold text-ink" : "bg-white/[0.06] text-white/70"
                      }`}
                    >
                      <Plus className="h-4 w-4" />
                    </motion.span>
                  </button>
                  <AnimatePresence initial={false}>
                    {isOpen && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
                      >
                        <p className="px-6 pb-6 leading-relaxed text-white/60">{f.a}</p>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </Reveal>
            );
          })}
        </div>
      </div>
    </section>
  );
}

export function FinalCTA() {
  return (
    <section className="relative px-6 pb-24 pt-10">
      <Reveal y={50}>
        <div className="relative mx-auto max-w-6xl overflow-hidden rounded-[40px] border border-gold/20 px-6 py-24 text-center sm:py-32">
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(244,183,40,0.25),transparent_60%)]" />
          <div className="grid-bg absolute inset-0 opacity-60" />
          {[0, 1, 2].map((i) => (
            <motion.div
              key={i}
              aria-hidden
              className="absolute left-1/2 top-1/2 h-[300px] w-[300px] -translate-x-1/2 -translate-y-1/2 rounded-full border border-gold/30"
              animate={{ scale: [0.6, 2.6], opacity: [0.6, 0] }}
              transition={{ duration: 6, repeat: Infinity, delay: i * 2, ease: "easeOut" }}
            />
          ))}
          <div className="relative">
            <motion.div
              initial={{ rotate: -180, scale: 0 }}
              whileInView={{ rotate: 0, scale: 1 }}
              viewport={{ once: true }}
              transition={{ type: "spring", stiffness: 100, damping: 12 }}
              className="mx-auto w-fit"
            >
              <ZecMark className="h-16 w-16 drop-shadow-[0_0_30px_rgba(244,183,40,0.6)]" />
            </motion.div>
            <h2 className="mx-auto mt-8 max-w-3xl text-5xl font-semibold leading-[1.02] tracking-tight text-white sm:text-7xl">
              Your Zcash. <Serif>Bitrefill&apos;s whole store.</Serif>
            </h2>
            <p className="mx-auto mt-6 max-w-xl text-lg text-white/60">
              Fund your circle privately, invite your people, and let them spend on thousands of Bitrefill brands — anonymously, safely, on your terms.
            </p>
            <div className="mt-10 flex flex-wrap justify-center gap-4">
              <MagneticButton>
                <span className="flex items-center gap-2">
                  <TelegramIcon /> Open App
                </span>
              </MagneticButton>
            </div>
            <p className="mt-6 font-mono text-xs text-white/35">@ZecCircle_bot · Zcash × Bitrefill · live on mainnet</p>
          </div>
        </div>
      </Reveal>
    </section>
  );
}

export function Footer() {
  return (
    <footer className="border-t border-white/[0.06] px-6 py-12">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-6 sm:flex-row">
        <div className="flex items-center gap-2.5">
          <ZecMark className="h-6 w-6" />
          <span className="font-semibold text-white">
            Zec<span className="text-gold">Circle</span>
          </span>
          <span className="ml-3 text-sm text-white/35">Private money for the people you trust.</span>
        </div>
        <div className="flex items-center gap-6 text-sm text-white/45">
          <a href="#how" className="hover:text-white">How it works</a>
          <a href="#privacy" className="hover:text-white">Privacy</a>
          <a href={BOT_URL} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 hover:text-gold">
            <TelegramIcon className="h-4 w-4" /> Telegram
          </a>
        </div>
      </div>
      <p className="mx-auto mt-8 max-w-6xl text-center text-xs text-white/25 sm:text-left">
        © 2026 ZecCircle. Powered by Zcash × Bitrefill.
      </p>
    </footer>
  );
}
