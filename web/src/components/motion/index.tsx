import { intlLocale } from "@/i18n";
// Shared motion primitives. Use these instead of one-off animations so the app
// moves with one voice; each respects reduced motion.

import { animate, AnimatePresence, motion, useMotionValue, useReducedMotion, useTransform } from "motion/react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { dur, ease, springs } from "@/lib/motion";

/**
 * A number that rolls to its new value. The first paint shows the value as is;
 * `flash` briefly tints the figure when it goes up (new tickets, unread).
 */
export function AnimatedNumber({
  value,
  format = (n) => Math.round(n).toLocaleString(intlLocale()),
  className,
  flash,
}: {
  value: number;
  format?: (n: number) => string;
  className?: string;
  flash?: boolean;
}) {
  const reduce = useReducedMotion();
  const mv = useMotionValue(value);
  const text = useTransform(mv, (v) => format(v));
  const prev = useRef(value);
  const [up, setUp] = useState(0);
  useEffect(() => {
    if (flash && value > prev.current) setUp((n) => n + 1);
    prev.current = value;
    if (reduce) {
      mv.set(value);
      return;
    }
    const c = animate(mv, value, { duration: 0.45, ease: ease.out });
    return () => c.stop();
  }, [value, reduce, mv, flash]);
  return (
    <motion.span
      key={flash ? up : undefined}
      initial={flash && up && !reduce ? { color: "var(--tone-blue-solid)" } : false}
      animate={{ color: "currentColor" }}
      transition={{ duration: 0.9, ease: ease.out }}
      className={cn("tabular-nums", className)}
    >
      {text}
    </motion.span>
  );
}

/** AnimatePresence for lists: rows animate in and out, the first paint stays still. */
export function PresenceList({ children }: { children: ReactNode }) {
  return (
    <AnimatePresence initial={false} mode="popLayout">
      {children}
    </AnimatePresence>
  );
}

/** One row of a PresenceList: rises in, folds away, glides when reordered. */
export function PresenceRow({ children, className, highlight }: { children: ReactNode; className?: string; highlight?: boolean }) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      layout={reduce ? false : "position"}
      initial={reduce ? { opacity: 0 } : { opacity: 0, y: -6, backgroundColor: highlight ? "var(--tone-blue-soft)" : "rgba(0,0,0,0)" }}
      animate={{ opacity: 1, y: 0, backgroundColor: "rgba(0,0,0,0)" }}
      exit={reduce ? { opacity: 0, transition: { duration: 0 } } : { opacity: 0, scale: 0.99, transition: { duration: dur.fast } }}
      transition={{ ...springs.row, backgroundColor: { duration: 1.2, ease: ease.out } }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

/** Children rise in one after another (cards, messages, tips). */
export function Stagger({ children, className, each = 0.04, delay = 0 }: { children: ReactNode; className?: string; each?: number; delay?: number }) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      className={className}
      initial={reduce ? false : "hidden"}
      animate="shown"
      variants={{ hidden: {}, shown: { transition: { staggerChildren: each, delayChildren: delay } } }}
    >
      {children}
    </motion.div>
  );
}

export function StaggerItem({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <motion.div
      className={className}
      variants={{ hidden: { opacity: 0, y: 6 }, shown: { opacity: 1, y: 0, transition: springs.row } }}
    >
      {children}
    </motion.div>
  );
}

/** Swaps between two pieces of content with a quick cross-fade and scale (copy -> check). */
export function Morph({ k, children, className }: { k: string; children: ReactNode; className?: string }) {
  const reduce = useReducedMotion();
  return (
    <AnimatePresence mode="popLayout" initial={false}>
      <motion.span
        key={k}
        className={cn("inline-flex", className)}
        initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.6 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.6 }}
        transition={springs.snap}
      >
        {children}
      </motion.span>
    </AnimatePresence>
  );
}
