"use client";

import { motion, useMotionValue, useScroll, useSpring, useTransform } from "framer-motion";
import { Check, ShieldCheck } from "lucide-react";
import { useRef } from "react";
import { BitrefillMark, Eyebrow, MagneticButton, PartnerBadge, TelegramIcon, ZecMark } from "./ui";

const headline = ["Your", "circle.", "Your", "funds."];

export function Hero() {
  const ref = useRef<HTMLElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start start", "end start"] });
  const yText = useTransform(scrollYProgress, [0, 1], [0, 140]);
  const yVis = useTransform(scrollYProgress, [0, 1], [0, -60]);
  const fade = useTransform(scrollYProgress, [0, 0.8], [1, 0]);

  const mx = useMotionValue(0);
  const my = useMotionValue(0);
  const rx = useSpring(useTransform(my, [-0.5, 0.5], [8, -8]), { stiffness: 80, damping: 20 });
  const ry = useSpring(useTransform(mx, [-0.5, 0.5], [-8, 8]), { stiffness: 80, damping: 20 });

  return (
    <section
      id="top"
      ref={ref}
      onMouseMove={(e) => {
        mx.set(e.clientX / window.innerWidth - 0.5);
        my.set(e.clientY / window.innerHeight - 0.5);
      }}
      className="relative min-h-[100svh] overflow-hidden pt-32 sm:pt-36"
    >
      {/* backdrop */}
      <div className="grid-bg pointer-events-none absolute inset-0" />
      <motion.div
        aria-hidden
        animate={{ scale: [1, 1.15, 1], opacity: [0.55, 0.8, 0.55] }}
        transition={{ duration: 10, repeat: Infinity, ease: "easeInOut" }}
        className="pointer-events-none absolute -top-40 left-1/2 h-[720px] w-[1100px] -translate-x-1/2 rounded-full bg-[radial-gradient(closest-side,rgba(244,183,40,0.28),transparent)] blur-2xl"
      />
      <motion.div
        aria-hidden
        animate={{ x: [0, 60, 0], y: [0, 40, 0] }}
        transition={{ duration: 16, repeat: Infinity, ease: "easeInOut" }}
        className="pointer-events-none absolute right-[-10%] top-[30%] h-[500px] w-[500px] rounded-full bg-[radial-gradient(closest-side,rgba(255,120,60,0.16),transparent)] blur-2xl"
      />

      <div className="relative mx-auto grid max-w-7xl items-center gap-14 px-6 lg:grid-cols-[1.1fr_1fr]">
        <motion.div style={{ y: yText, opacity: fade }} className="relative z-10">
          <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
            <div className="flex flex-wrap gap-2">
              <Eyebrow>Live on Zcash mainnet</Eyebrow>
              <PartnerBadge />
            </div>
          </motion.div>

          <h1 className="mt-7 text-[13vw] font-semibold leading-[0.95] tracking-[-0.04em] text-white sm:text-7xl lg:text-[86px]">
            {headline.map((w, i) => (
              <span key={i} className="mr-[0.22em] inline-block overflow-hidden pb-2 align-bottom">
                <motion.span
                  className="inline-block"
                  initial={{ y: "110%", rotate: 6 }}
                  animate={{ y: 0, rotate: 0 }}
                  transition={{ delay: 0.3 + i * 0.09, duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
                >
                  {w}
                </motion.span>
              </span>
            ))}
            <br />
            <span className="inline-block overflow-hidden pb-3 align-bottom">
              <motion.span
                className="inline-block font-serif font-normal italic tracking-[-0.01em] text-gradient-gold"
                initial={{ y: "110%" }}
                animate={{ y: 0 }}
                transition={{ delay: 0.75, duration: 1, ease: [0.22, 1, 0.36, 1] }}
              >
                Nobody else&apos;s business.
              </motion.span>
            </span>
          </h1>

          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 1, duration: 0.8 }}
            className="mt-7 max-w-xl text-lg leading-relaxed text-white/60 sm:text-xl"
          >
            Fund one shielded wallet and let your family and friends spend it on anything in the{" "}
            <span className="font-medium text-[#8ff0d0]">Bitrefill</span> store — burgers, groceries, recharges, gift
            cards from thousands of brands. Circle funds stay private, every spend stays anonymous.
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 1.15, duration: 0.8 }}
            className="mt-10 flex flex-wrap items-center gap-4"
          >
            <MagneticButton>
              <span className="flex items-center gap-2">
                <TelegramIcon /> Open App
              </span>
            </MagneticButton>
            <MagneticButton href="#how" variant="ghost">
              See how it works
            </MagneticButton>
          </motion.div>

          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 1.4, duration: 1 }}
            className="mt-10 flex flex-wrap gap-x-6 gap-y-3 text-sm text-white/45"
          >
            {["Shielded by default", "Thousands of Bitrefill brands", "Per-member limits"].map((t) => (
              <span key={t} className="flex items-center gap-2">
                <Check className="h-4 w-4 text-gold" /> {t}
              </span>
            ))}
          </motion.div>
        </motion.div>

        <motion.div style={{ y: yVis, rotateX: rx, rotateY: ry, transformPerspective: 1200 }} className="relative">
          <Orbit />
        </motion.div>
      </div>

      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 2 }}
        className="absolute bottom-8 left-1/2 hidden -translate-x-1/2 flex-col items-center gap-2 text-[11px] uppercase tracking-[0.25em] text-white/30 md:flex"
      >
        Scroll
        <span className="relative h-10 w-[1px] overflow-hidden bg-white/10">
          <motion.span
            animate={{ y: ["-100%", "100%"] }}
            transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
            className="absolute inset-x-0 h-1/2 bg-gold"
          />
        </span>
      </motion.div>
    </section>
  );
}

const members = [
  { name: "Mom", emoji: "👩", color: "from-rose-400 to-orange-300", angle: 0 },
  { name: "Aarav", emoji: "🧑‍🎓", color: "from-sky-400 to-indigo-400", angle: 72 },
  { name: "Dad", emoji: "👨", color: "from-emerald-400 to-teal-300", angle: 144 },
  { name: "Riya", emoji: "👧", color: "from-fuchsia-400 to-pink-300", angle: 216 },
  { name: "Nani", emoji: "👵", color: "from-amber-300 to-yellow-200", angle: 288 },
];

function Orbit() {
  const R = 41; // percent radius
  return (
    <div className="relative mx-auto aspect-square w-full max-w-[560px]">
      {/* rings */}
      {[100, 82, 58].map((s, i) => (
        <motion.div
          key={s}
          initial={{ opacity: 0, scale: 0.6 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.4 + i * 0.15, duration: 1.2, ease: [0.22, 1, 0.36, 1] }}
          className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/[0.07]"
          style={{ width: `${s}%`, height: `${s}%` }}
        />
      ))}
      <motion.div
        animate={{ rotate: 360 }}
        transition={{ duration: 30, repeat: Infinity, ease: "linear" }}
        className="absolute left-1/2 top-1/2 h-[82%] w-[82%] -translate-x-1/2 -translate-y-1/2 rounded-full"
        style={{
          background: "conic-gradient(from 0deg, transparent 0deg, rgba(244,183,40,0.45) 40deg, transparent 90deg)",
          mask: "radial-gradient(closest-side, transparent calc(100% - 2px), black calc(100% - 1px))",
          WebkitMask: "radial-gradient(closest-side, transparent calc(100% - 2px), black calc(100% - 1px))",
        }}
      />

      {/* flowing particles from center to members */}
      <svg viewBox="0 0 100 100" className="absolute inset-0 h-full w-full">
        <defs>
          <radialGradient id="pg">
            <stop offset="0%" stopColor="#ffd772" />
            <stop offset="100%" stopColor="#f4b728" stopOpacity="0" />
          </radialGradient>
        </defs>
        {members.map((m, i) => {
          const a = ((m.angle - 90) * Math.PI) / 180;
          const x = +(50 + R * Math.cos(a)).toFixed(3);
          const y = +(50 + R * Math.sin(a)).toFixed(3);
          return (
            <g key={m.name}>
              <line x1="50" y1="50" x2={x} y2={y} stroke="rgba(244,183,40,0.14)" strokeWidth="0.25" strokeDasharray="0.8 1.2" />
              <motion.circle
                r="1.1"
                fill="url(#pg)"
                initial={{ cx: 50, cy: 50, opacity: 0 }}
                animate={{ cx: [50, x], cy: [50, y], opacity: [0, 1, 0] }}
                transition={{ duration: 2.4, repeat: Infinity, delay: 1.5 + i * 0.5, ease: "easeInOut", repeatDelay: 0.6 }}
              />
            </g>
          );
        })}
      </svg>

      {/* center vault */}
      <motion.div
        initial={{ scale: 0, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ delay: 0.6, type: "spring", stiffness: 120, damping: 14 }}
        className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
      >
        <motion.div
          animate={{ boxShadow: ["0 0 60px 0 rgba(244,183,40,0.35)", "0 0 110px 10px rgba(244,183,40,0.55)", "0 0 60px 0 rgba(244,183,40,0.35)"] }}
          transition={{ duration: 3.5, repeat: Infinity }}
          className="border-glow glass flex h-36 w-36 flex-col items-center justify-center rounded-full sm:h-44 sm:w-44"
        >
          <ZecMark className="h-10 w-10 sm:h-12 sm:w-12" />
          <span className="mt-2 font-mono text-[10px] uppercase tracking-[0.2em] text-white/45">Circle funds</span>
          <span className="mt-0.5 text-lg font-semibold text-white sm:text-xl">
            12.40 <span className="text-gold">ZEC</span>
          </span>
          <span className="mt-1 flex items-center gap-1 text-[10px] text-emerald-300/80">
            <ShieldCheck className="h-3 w-3" /> shielded
          </span>
        </motion.div>
      </motion.div>

      {/* members */}
      {members.map((m, i) => {
        const a = ((m.angle - 90) * Math.PI) / 180;
        return (
          <motion.div
            key={m.name}
            initial={{ opacity: 0, scale: 0 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 1 + i * 0.12, type: "spring", stiffness: 160, damping: 12 }}
            className="absolute -translate-x-1/2 -translate-y-1/2"
            style={{ left: `${(50 + R * Math.cos(a)).toFixed(3)}%`, top: `${(50 + R * Math.sin(a)).toFixed(3)}%` }}
          >
            <motion.div
              animate={{ y: [0, -8, 0] }}
              transition={{ duration: 3 + i * 0.4, repeat: Infinity, ease: "easeInOut" }}
              whileHover={{ scale: 1.15 }}
              className="flex flex-col items-center gap-1.5"
            >
              <div className={`rounded-full bg-gradient-to-br ${m.color} p-[2px] shadow-lg`}>
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-ink text-2xl sm:h-14 sm:w-14">
                  {m.emoji}
                </div>
              </div>
              <span className="rounded-full bg-white/[0.06] px-2.5 py-0.5 text-[11px] font-medium text-white/70 backdrop-blur">
                {m.name}
              </span>
            </motion.div>
          </motion.div>
        );
      })}

      {/* floating toasts */}
      <FloatCard className="-left-2 top-[12%] sm:-left-8" delay={1.8}>
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-400/15 text-emerald-300">
          <Check className="h-4 w-4" />
        </span>
        <div>
          <p className="text-[12px] font-medium text-white">Aarav ordered Burger King 🍔</p>
          <p className="text-[11px] text-white/45">₹400 · within limit</p>
        </div>
      </FloatCard>
      <FloatCard className="-bottom-6 right-[18%]" delay={2.2}>
        <BitrefillMark className="h-8 w-8" />
        <div>
          <p className="text-[12px] font-medium text-white">Riya got groceries 🛒</p>
          <p className="text-[11px] text-white/45">via Bitrefill · ₹1,000</p>
        </div>
      </FloatCard>
    </div>
  );
}

function FloatCard({ children, className, delay }: { children: React.ReactNode; className: string; delay: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20, scale: 0.9 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ delay, duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
      className={`absolute z-20 ${className}`}
    >
      <div className="glass flex items-center gap-3 rounded-2xl px-3.5 py-2.5 shadow-2xl" style={{ animation: "float 5s ease-in-out infinite" }}>
        {children}
      </div>
    </motion.div>
  );
}
