import { useTranslation } from "react-i18next";
import { appText } from "@/i18n/text";
import qrcode from "qrcode-generator";
import { useMemo } from "react";
import { cn } from "@/lib/cn";

/** A QR code drawn as one SVG path, always dark on paper so every scanner reads it. */
export function QrCode({ value, className, label = appText("QR code") }: { value: string; className?: string; label?: string }) {
  useTranslation("app");
  const { d, size } = useMemo(() => {
    const qr = qrcode(0, "M");
    qr.addData(value);
    qr.make();
    const n = qr.getModuleCount();
    const quiet = 4;
    let path = "";
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        if (qr.isDark(r, c)) path += `M${c + quiet} ${r + quiet}h1v1h-1z`;
      }
    }
    return { d: path, size: n + quiet * 2 };
  }, [value]);
  return (
    <svg
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label={label}
      shapeRendering="crispEdges"
      className={cn("size-44 rounded-md border border-line bg-white text-[#0a0a0a]", className)}
    >
      <path d={d} fill="currentColor" />
    </svg>
  );
}
