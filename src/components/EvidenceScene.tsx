import {interpolate, useCurrentFrame} from "remotion";
import {brand} from "../brand";
import {Canvas} from "./Canvas";

type Props = {label: string; value: string; note: string; source: string};

export const EvidenceScene = ({label, value, note, source}: Props) => {
  const frame = useCurrentFrame();
  const reveal = interpolate(frame, [15, 80], [0, 1], {extrapolateLeft: "clamp", extrapolateRight: "clamp"});

  return (
    <Canvas tone="light">
      <div style={{position: "absolute", left: 110, right: 110, top: 130, bottom: 120, display: "grid", gridTemplateColumns: "0.9fr 1.1fr", border: `3px solid ${brand.colors.ink}`}}>
        <div style={{background: brand.colors.ember, color: brand.colors.paper, padding: 54, display: "flex", flexDirection: "column", justifyContent: "space-between"}}>
          <span style={{fontSize: 28, fontWeight: 900, letterSpacing: 4}}>{label}</span>
          <span style={{fontSize: 126, lineHeight: 0.9, fontWeight: 900, transform: `scale(${0.86 + reveal * 0.14})`}}>{value}</span>
        </div>
        <div style={{padding: 60, display: "flex", flexDirection: "column", justifyContent: "space-between"}}>
          <p style={{fontSize: 55, lineHeight: 1.12, fontWeight: 800, margin: 0}}>{note}</p>
          <p style={{fontSize: 20, lineHeight: 1.4, color: brand.colors.muted, letterSpacing: 1.5, margin: 0}}>{source}</p>
        </div>
      </div>
    </Canvas>
  );
};
