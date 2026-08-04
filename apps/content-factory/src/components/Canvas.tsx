import type {CSSProperties, ReactNode} from "react";
import {AbsoluteFill} from "remotion";
import {brand} from "../brand";

type Props = {
  children: ReactNode;
  tone?: "dark" | "light";
  style?: CSSProperties;
};

export const Canvas = ({children, tone = "dark", style}: Props) => {
  const dark = tone === "dark";

  return (
    <AbsoluteFill
      style={{
        background: dark ? brand.colors.ink : brand.colors.paper,
        color: dark ? brand.colors.paper : brand.colors.ink,
        fontFamily: "Arial, Helvetica, sans-serif",
        overflow: "hidden",
        ...style,
      }}
    >
      <AbsoluteFill
        style={{
          opacity: dark ? 0.12 : 0.08,
          backgroundImage:
            "linear-gradient(rgba(255,255,255,.35) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.35) 1px, transparent 1px)",
          backgroundSize: "72px 72px",
        }}
      />
      {children}
    </AbsoluteFill>
  );
};
