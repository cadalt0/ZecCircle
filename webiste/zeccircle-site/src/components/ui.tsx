"use client";

import { motion, useMotionValue, useSpring, type HTMLMotionProps } from "framer-motion";
import { ArrowUpRight } from "lucide-react";
import { useRef, type ReactNode } from "react";
import { BOT_URL } from "@/lib/site";

export function Reveal({
  children,
  delay = 0,
  y = 28,
  className,
  ...rest
}: { children: ReactNode; delay?: number; y?: number; className?: string } & HTMLMotionProps<"div">) {
  return (
    <motion.div
      initial={{ opacity: 0, y, filter: "blur(8px)" }}
      whileInView={{ opacity: 1, y: 0, filter: "blur(0px)" }}
      viewport={{ once: true, margin: "-80px" }}
      transition={{ duration: 0.8, delay, ease: [0.22, 1, 0.36, 1] }}
      className={className}
      {...rest}
    >
      {children}
    </motion.div>
  );
}

export function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-gold/25 bg-gold/[0.06] px-3.5 py-1.5 font-mono text-[11px] uppercase tracking-[0.18em] text-gold-soft">
      <span className="h-1.5 w-1.5 rounded-full bg-gold shadow-[0_0_10px_#f4b728]" />
      {children}
    </span>
  );
}

export function SectionHeading({
  eyebrow,
  title,
  sub,
  center = true,
}: {
  eyebrow: string;
  title: ReactNode;
  sub?: ReactNode;
  center?: boolean;
}) {
  return (
    <div className={center ? "mx-auto max-w-3xl text-center" : "max-w-2xl"}>
      <Reveal>
        <Eyebrow>{eyebrow}</Eyebrow>
      </Reveal>
      <Reveal delay={0.08}>
        <h2 className="mt-6 text-4xl font-semibold leading-[1.05] tracking-tight text-white sm:text-5xl md:text-6xl">
          {title}
        </h2>
      </Reveal>
      {sub && (
        <Reveal delay={0.16}>
          <p className="mt-5 text-lg leading-relaxed text-white/55">{sub}</p>
        </Reveal>
      )}
    </div>
  );
}

export function Serif({ children }: { children: ReactNode }) {
  return <span className="font-serif font-normal italic tracking-normal text-gradient-gold">{children}</span>;
}

export function MagneticButton({
  children,
  href = BOT_URL,
  variant = "primary",
  className = "",
}: {
  children: ReactNode;
  href?: string;
  variant?: "primary" | "ghost";
  className?: string;
}) {
  const ref = useRef<HTMLAnchorElement>(null);
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const sx = useSpring(x, { stiffness: 200, damping: 15, mass: 0.3 });
  const sy = useSpring(y, { stiffness: 200, damping: 15, mass: 0.3 });

  const external = href.startsWith("http");

  return (
    <motion.a
      ref={ref}
      href={href}
      target={external ? "_blank" : undefined}
      rel={external ? "noopener noreferrer" : undefined}
      style={{ x: sx, y: sy }}
      onMouseMove={(e) => {
        const r = ref.current?.getBoundingClientRect();
        if (!r) return;
        x.set((e.clientX - (r.left + r.width / 2)) * 0.25);
        y.set((e.clientY - (r.top + r.height / 2)) * 0.35);
      }}
      onMouseLeave={() => {
        x.set(0);
        y.set(0);
      }}
      whileTap={{ scale: 0.96 }}
      className={
        (variant === "primary"
          ? "group relative inline-flex items-center gap-2 overflow-hidden rounded-full bg-gold px-7 py-3.5 text-[15px] font-semibold text-ink shadow-[0_10px_40px_-10px_rgba(244,183,40,0.7)]"
          : "group relative inline-flex items-center gap-2 rounded-full border border-white/12 bg-white/[0.03] px-7 py-3.5 text-[15px] font-medium text-white/85 transition-colors hover:border-white/25 hover:bg-white/[0.06]") +
        " " +
        className
      }
    >
      {variant === "primary" && (
        <span className="pointer-events-none absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/50 to-transparent transition-transform duration-700 group-hover:translate-x-full" />
      )}
      <span className="relative">{children}</span>
      {variant === "primary" && (
        <ArrowUpRight className="relative h-4 w-4 transition-transform duration-300 group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
      )}
    </motion.a>
  );
}

export function TelegramIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
      <path d="M9.78 15.27 9.6 19.4c.4 0 .58-.17.79-.38l1.9-1.82 3.94 2.88c.72.4 1.24.19 1.43-.67l2.6-12.18c.25-1.08-.4-1.5-1.1-1.24L3.9 11.86c-1.04.4-1.03.98-.18 1.24l3.92 1.22 9.1-5.74c.43-.28.82-.12.5.16" />
    </svg>
  );
}

export function ZecMark({ className = "h-5 w-5" }: { className?: string }) {
  // Official Zcash mark (gold disc, black Z).
  return (
    <svg viewBox="0 0 2500 2500" className={className} aria-hidden>
      <defs>
        <linearGradient
          id="zec-grad"
          x1="782.84"
          y1="165.91"
          x2="799.34"
          y2="165.91"
          gradientTransform="translate(-81568.2 55372.05) rotate(-45) scale(122.41)"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0" stopColor="#cf8724" />
          <stop offset="1" stopColor="#fdce58" />
        </linearGradient>
      </defs>
      <path
        fill="url(#zec-grad)"
        d="M1263.05,2297.61c-569.6,0-1034.57-465.43-1034.57-1034.56,0-569.6,465.44-1034.57,1034.57-1034.57,569.6,0,1034.56,465.44,1034.56,1034.57C2297.61,1832.65,1832.65,2297.61,1263.05,2297.61Z"
      />
      <path
        fill="#0a0a0a"
        d="M1250,2500C562.5,2500,0,1937.5,0,1250S562.5,0,1250,0,2500,562.5,2500,1250,1937.5,2500,1250,2500Zm0-2222.06c-534.56,0-972.06,437.5-972.06,972.06s437.5,972.06,972.06,972.06,972.06-437.5,972.06-972.06S1784.56,277.94,1250,277.94Z"
      />
      <path
        fill="#0a0a0a"
        d="M1221.05,1588.59h541.67v270.84h-319.6v229.16H1165.18V1866.53H831.85c0-90.44-13.73-180.4,7.1-263.73,7.1-41.67,55.4-83.34,90.43-125,104.17-125,208.34-250,319.61-375,41.66-48.77,83.33-90.44,132.1-145.83H860.26V686.13h305.39V457h270.84V679h333.33c0,90.43,13.73,180.4-7.1,263.73-7.1,41.67-55.4,83.33-90.44,125-104.16,125-208.33,250-319.6,375C1311,1491.53,1269.35,1539.82,1221.05,1588.59Z"
      />
    </svg>
  );
}

export function BitrefillMark({ className = "h-5 w-5" }: { className?: string }) {
  // Official Bitrefill icon.
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden>
      <rect width="32" height="32" rx="7" fill="#002B28" />
      <path
        fill="#E7E7E7"
        d="M8.37594 12.9215L12.5551 9.82194V23.1495H17.669C19.5984 23.1495 20.9402 21.9083 20.9402 20.1096C20.9402 18.311 19.5984 17.0698 17.669 17.0698H14.865L18.4501 13.5056C19.4448 12.5167 19.6651 11.8928 19.6651 11.2091C19.6651 9.84849 18.6036 8.8861 16.9213 8.8861H8.37594V5.16925H17.6356C21.254 5.16925 23.8376 7.33962 23.8376 10.4658C23.8376 11.9525 23.5239 13.0675 22.4023 14.1826L21.6546 14.926C23.6841 15.9149 25.1128 17.9326 25.1128 20.5079C25.1128 24.2579 22.0885 26.8597 17.8492 26.8597H8.36926V12.9215H8.37594Z"
      />
    </svg>
  );
}

export function PartnerBadge() {
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-[#2fd0a0]/30 bg-[#2fd0a0]/[0.08] px-3.5 py-1.5 font-mono text-[11px] uppercase tracking-[0.18em] text-[#8ff0d0]">
      <BitrefillMark className="h-3.5 w-3.5" />
      Powered by Bitrefill
    </span>
  );
}
