"use client";

import { motion, useMotionTemplate, useMotionValue } from "framer-motion";
import { EyeOff, Gauge, Gift, KeyRound, PauseCircle, ScrollText, Smartphone, Zap } from "lucide-react";
import type { ReactNode } from "react";
import { Reveal, SectionHeading, Serif } from "./ui";

export function Benefits() {
  return (
    <section id="benefits" className="relative py-32 sm:py-40">
      <div className="pointer-events-none absolute left-1/2 top-40 h-[500px] w-[900px] -translate-x-1/2 rounded-full bg-[radial-gradient(closest-side,rgba(244,183,40,0.08),transparent)]" />
      <div className="relative mx-auto max-w-6xl px-6">
        <SectionHeading
          eyebrow="Benefits"
          title={
            <>
              Share money like family. <br className="hidden sm:block" />
              <Serif>Keep it private like cash.</Serif>
            </>
          }
          sub="Everything you'd want from a shared family wallet — without exposing a single balance, name or purchase to the world."
        />

        <div className="mt-20 grid auto-rows-[minmax(220px,auto)] gap-5 md:grid-cols-6">
          <Card className="md:col-span-4 md:row-span-2" delay={0}>
            <Icon><EyeOff /></Icon>
            <h3 className="mt-6 text-3xl font-semibold tracking-tight text-white">Circle funds, fully shielded</h3>
            <p className="mt-3 max-w-md text-white/55">
              Your circle wallet runs on Zcash shielded pools. Who funded it, how much is inside and where it goes —
              encrypted end to end. Only your circle knows.
            </p>
            <ShieldViz />
            <div className="mt-8 grid grid-cols-3 gap-3 border-t border-white/[0.06] pt-6">
              {[
                { k: "100%", v: "shielded transfers" },
                { k: "0", v: "public balances" },
                { k: "1", v: "circle that sees it" },
              ].map((s, i) => (
                <motion.div
                  key={s.v}
                  initial={{ opacity: 0, y: 12 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: 0.5 + i * 0.1 }}
                >
                  <p className="text-3xl font-semibold tracking-tight text-gold">{s.k}</p>
                  <p className="mt-1 text-xs text-white/45">{s.v}</p>
                </motion.div>
              ))}
            </div>
          </Card>

          <Card className="md:col-span-2" delay={0.08}>
            <Icon><Gauge /></Icon>
            <h3 className="mt-5 text-xl font-semibold text-white">Limits per person</h3>
            <p className="mt-2 text-sm text-white/55">Set a per-purchase cap and a monthly budget for every member.</p>
            <LimitBar />
          </Card>

          <Card className="md:col-span-2" delay={0.16}>
            <Icon><PauseCircle /></Icon>
            <h3 className="mt-5 text-xl font-semibold text-white">Pause in one tap</h3>
            <p className="mt-2 text-sm text-white/55">
              Pause a member, or the whole circle, instantly. Resume just as fast.
            </p>
            <Toggle />
          </Card>

          <Card className="md:col-span-2" delay={0.05}>
            <Icon><KeyRound /></Icon>
            <h3 className="mt-5 text-xl font-semibold text-white">Nothing to hand over</h3>
            <p className="mt-2 text-sm text-white/55">
              No card numbers, no passwords, no seed phrases passed around the family group chat.
            </p>
          </Card>

          <Card className="md:col-span-2" delay={0.12}>
            <Icon><Gift /></Icon>
            <h3 className="mt-5 text-xl font-semibold text-white">Spend on real things</h3>
            <p className="mt-2 text-sm text-white/55">
              Food, groceries, gift cards, mobile recharges and eSIMs — thousands of brands via Bitrefill.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              {["Burger King", "Swiggy", "Groceries", "Amazon", "Jio", "Uber", "eSIM"].map((b, i) => (
                <motion.span
                  key={b}
                  initial={{ opacity: 0, scale: 0.6 }}
                  whileInView={{ opacity: 1, scale: 1 }}
                  viewport={{ once: true }}
                  transition={{ delay: 0.3 + i * 0.06, type: "spring" }}
                  className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-xs text-white/70"
                >
                  {b}
                </motion.span>
              ))}
            </div>
          </Card>

          <Card className="md:col-span-2" delay={0.18}>
            <Icon><ScrollText /></Icon>
            <h3 className="mt-5 text-xl font-semibold text-white">Clarity for you alone</h3>
            <p className="mt-2 text-sm text-white/55">
              As the owner you see every spend in your circle. The outside world sees nothing.
            </p>
          </Card>

          <Card className="md:col-span-3" delay={0.06}>
            <Icon><Smartphone /></Icon>
            <h3 className="mt-5 text-xl font-semibold text-white">Lives in the chat you already use</h3>
            <p className="mt-2 text-sm text-white/55">
              No new app to install. ZecCircle runs right inside Telegram — open it, talk to it, done. Works great
              for parents and grandparents too.
            </p>
          </Card>

          <Card className="md:col-span-3" delay={0.14}>
            <Icon><Zap /></Icon>
            <h3 className="mt-5 text-xl font-semibold text-white">Ask in plain words</h3>
            <p className="mt-2 text-sm text-white/55">
              “I&apos;m craving a burger, order from Burger King.” That&apos;s it. The circle agent finds it, checks your limit and pays through
              Bitrefill and delivers it right in chat.
            </p>
          </Card>
        </div>
      </div>
    </section>
  );
}

function Card({ children, className = "", delay = 0 }: { children: ReactNode; className?: string; delay?: number }) {
  const mx = useMotionValue(-400);
  const my = useMotionValue(-400);
  const bg = useMotionTemplate`radial-gradient(420px circle at ${mx}px ${my}px, rgba(244,183,40,0.13), transparent 60%)`;
  return (
    <Reveal delay={delay} className={className}>
      <motion.div
        onMouseMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          mx.set(e.clientX - r.left);
          my.set(e.clientY - r.top);
        }}
        onMouseLeave={() => {
          mx.set(-400);
          my.set(-400);
        }}
        whileHover={{ y: -4 }}
        transition={{ type: "spring", stiffness: 260, damping: 22 }}
        className="group relative h-full overflow-hidden rounded-3xl border border-white/[0.08] bg-white/[0.025] p-7 transition-colors hover:border-gold/25"
      >
        <motion.div className="pointer-events-none absolute inset-0" style={{ background: bg }} />
        <div className="relative">{children}</div>
      </motion.div>
    </Reveal>
  );
}

function Icon({ children }: { children: ReactNode }) {
  return (
    <span className="flex h-11 w-11 items-center justify-center rounded-xl border border-gold/20 bg-gold/10 text-gold transition-transform duration-500 group-hover:scale-110 group-hover:rotate-[-6deg] [&>svg]:h-5 [&>svg]:w-5">
      {children}
    </span>
  );
}

function ShieldViz() {
  const rows = ["zs1q8f…kx9w", "zs1m2a…7pdl", "zs1yt4…c0ve", "zs1h9r…u3qa"];
  return (
    <div className="mt-10 grid gap-3 sm:grid-cols-2">
      {rows.map((r, i) => (
        <motion.div
          key={r}
          initial={{ opacity: 0, x: -20 }}
          whileInView={{ opacity: 1, x: 0 }}
          viewport={{ once: true }}
          transition={{ delay: 0.2 + i * 0.1 }}
          className="flex items-center justify-between rounded-2xl border border-white/[0.07] bg-black/30 px-4 py-3.5"
        >
          <span className="font-mono text-xs text-white/50">{r}</span>
          <span className="relative overflow-hidden rounded-md bg-white/[0.06] px-2 py-1 font-mono text-xs text-transparent">
            ██.████
            <motion.span
              animate={{ x: ["-100%", "200%"] }}
              transition={{ duration: 2.2, repeat: Infinity, delay: i * 0.3, ease: "easeInOut" }}
              className="absolute inset-y-0 left-0 w-1/2 bg-gradient-to-r from-transparent via-gold/50 to-transparent"
            />
          </span>
        </motion.div>
      ))}
    </div>
  );
}

function LimitBar() {
  return (
    <div className="mt-6">
      <div className="mb-2 flex justify-between font-mono text-[11px] text-white/45">
        <span>Aarav · this month</span>
        <span className="text-gold-soft">0.31 / 0.50 ZEC</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-white/[0.06]">
        <motion.div
          initial={{ width: 0 }}
          whileInView={{ width: "62%" }}
          viewport={{ once: true }}
          transition={{ duration: 1.6, delay: 0.3, ease: [0.22, 1, 0.36, 1] }}
          className="h-full rounded-full bg-gradient-to-r from-gold to-amber"
        />
      </div>
    </div>
  );
}

function Toggle() {
  return (
    <div className="mt-6 flex items-center justify-between rounded-2xl border border-white/[0.07] bg-black/30 px-4 py-3">
      <span className="text-sm text-white/70">Riya</span>
      <motion.div
        animate={{ backgroundColor: ["rgba(244,183,40,1)", "rgba(255,255,255,0.12)", "rgba(244,183,40,1)"] }}
        transition={{ duration: 4, repeat: Infinity, times: [0, 0.5, 1] }}
        className="relative h-6 w-11 rounded-full"
      >
        <motion.span
          animate={{ x: [22, 2, 22] }}
          transition={{ duration: 4, repeat: Infinity, times: [0, 0.5, 1] }}
          className="absolute top-1 h-4 w-4 rounded-full bg-white shadow"
        />
      </motion.div>
    </div>
  );
}
