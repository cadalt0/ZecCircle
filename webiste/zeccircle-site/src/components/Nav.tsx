"use client";

import { AnimatePresence, motion, useMotionValueEvent, useScroll } from "framer-motion";
import { Menu, X } from "lucide-react";
import { useState } from "react";
import { BOT_URL } from "@/lib/site";
import { TelegramIcon, ZecMark } from "./ui";

const links = [
  { href: "#how", label: "How it works" },
  { href: "#benefits", label: "Benefits" },
  { href: "#bitrefill", label: "Bitrefill" },
  { href: "#circles", label: "Circles" },
  { href: "#privacy", label: "Privacy" },
  { href: "#faq", label: "FAQ" },
];

export function Nav() {
  const { scrollY, scrollYProgress } = useScroll();
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  useMotionValueEvent(scrollY, "change", (v) => setScrolled(v > 24));

  return (
    <>
      <motion.div
        style={{ scaleX: scrollYProgress }}
        className="fixed inset-x-0 top-0 z-[60] h-[2px] origin-left bg-gradient-to-r from-gold via-amber to-gold-soft"
      />
      <motion.header
        initial={{ y: -40, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
        className="fixed inset-x-0 top-4 z-50 px-4"
      >
        <nav
          className={`mx-auto flex max-w-6xl items-center justify-between rounded-full px-4 py-2.5 transition-all duration-500 sm:px-5 ${
            scrolled ? "glass shadow-[0_20px_60px_-20px_rgba(0,0,0,0.8)]" : "border border-transparent"
          }`}
        >
          <a href="#top" className="flex items-center gap-2.5">
            <motion.span whileHover={{ rotate: 180 }} transition={{ duration: 0.6 }}>
              <ZecMark className="h-7 w-7" />
            </motion.span>
            <span className="text-[17px] font-semibold tracking-tight text-white">
              Zec<span className="text-gold">Circle</span>
            </span>
          </a>

          <div className="hidden items-center gap-1 md:flex">
            {links.map((l) => (
              <a
                key={l.href}
                href={l.href}
                className="relative rounded-full px-4 py-2 text-sm text-white/60 transition-colors hover:bg-white/[0.05] hover:text-white"
              >
                {l.label}
              </a>
            ))}
          </div>

          <div className="flex items-center gap-2">
            <a
              href={BOT_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="group hidden items-center gap-2 rounded-full bg-white px-4 py-2 text-sm font-semibold text-ink transition-all hover:bg-gold sm:inline-flex"
            >
              <TelegramIcon className="h-4 w-4 transition-transform group-hover:rotate-12" />
              Open App
            </a>
            <button
              aria-label="Menu"
              onClick={() => setOpen((o) => !o)}
              className="rounded-full p-2 text-white/80 hover:bg-white/10 md:hidden"
            >
              {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </button>
          </div>
        </nav>

        <AnimatePresence>
          {open && (
            <motion.div
              initial={{ opacity: 0, y: -10, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -10, scale: 0.98 }}
              className="glass mx-auto mt-2 flex max-w-6xl flex-col gap-1 rounded-3xl p-3 md:hidden"
            >
              {links.map((l) => (
                <a
                  key={l.href}
                  href={l.href}
                  onClick={() => setOpen(false)}
                  className="rounded-2xl px-4 py-3 text-white/75 hover:bg-white/5"
                >
                  {l.label}
                </a>
              ))}
              <a
                href={BOT_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-1 flex items-center justify-center gap-2 rounded-2xl bg-gold px-4 py-3 font-semibold text-ink"
              >
                <TelegramIcon /> Open App
              </a>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.header>
    </>
  );
}
