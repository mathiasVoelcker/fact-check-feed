"use client";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

export function VariantBar({ variants, current }: { variants: string[]; current: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const go = (v: string) => {
    const next = new URLSearchParams(params.toString());
    next.set("variant", v);
    router.push(`${pathname}?${next}`);
  };
  return (
    <div
      style={{
        position: "fixed", bottom: 16, left: "50%", transform: "translateX(-50%)", display: "flex", gap: 4,
        padding: 6, background: "#111", borderRadius: 999, boxShadow: "0 4px 16px #0006", zIndex: 10,
      }}
    >
      <span style={{ color: "#888", padding: "6px 10px", fontSize: 12 }}>PROTOTYPE</span>
      {variants.map((v) => (
        <button
          key={v}
          onClick={() => go(v)}
          style={{
            padding: "6px 14px", borderRadius: 999, border: 0, cursor: "pointer",
            background: v === current ? "#fff" : "transparent", color: v === current ? "#111" : "#fff",
          }}
        >
          {v}
        </button>
      ))}
    </div>
  );
}
