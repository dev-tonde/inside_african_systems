import {spring, useCurrentFrame, useVideoConfig} from "remotion";
import {BrandMark} from "./BrandMark";
import {Canvas} from "./Canvas";

export const EndScene = ({line}: {line: string}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const scale = spring({frame, fps, from: 0.9, to: 1, config: {damping: 18}});

  return (
    <Canvas>
      <div style={{position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 38, transform: `scale(${scale})`}}>
        <BrandMark inverse />
        <div style={{fontSize: 62, fontWeight: 900, letterSpacing: 5}}>{line}</div>
        <div style={{fontSize: 24, letterSpacing: 4, opacity: 0.7}}>SOUTH AFRICA · SEASON 01</div>
      </div>
    </Canvas>
  );
};
