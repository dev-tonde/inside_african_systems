import {interpolate, spring, useCurrentFrame, useVideoConfig} from "remotion";
import {brand} from "../brand";
import {BrandMark} from "./BrandMark";
import {Canvas} from "./Canvas";

export const HookScene = ({label, title}: {label: string; title: string}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const enter = spring({frame, fps, config: {damping: 18, stiffness: 110}});
  const rule = interpolate(frame, [10, 65], [0, 1], {extrapolateLeft: "clamp", extrapolateRight: "clamp"});

  return (
    <Canvas>
      <div style={{position: "absolute", left: 110, top: 76}}><BrandMark inverse /></div>
      <div style={{position: "absolute", left: 110, bottom: 96, width: 1500}}>
        <div style={{color: brand.colors.sand, fontSize: 28, fontWeight: 800, letterSpacing: 5, marginBottom: 26}}>{label}</div>
        <div
          style={{
            whiteSpace: "pre-line",
            fontSize: 116,
            lineHeight: 0.92,
            fontWeight: 900,
            letterSpacing: -5,
            transform: `translateY(${(1 - enter) * 80}px)`,
            opacity: enter,
          }}
        >
          {title}
        </div>
        <div style={{height: 8, width: `${rule * 100}%`, background: brand.colors.ember, marginTop: 44}} />
      </div>
    </Canvas>
  );
};
