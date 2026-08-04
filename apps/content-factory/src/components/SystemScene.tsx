import {interpolate, spring, useCurrentFrame, useVideoConfig} from "remotion";
import {brand} from "../brand";
import {Canvas} from "./Canvas";

export const SystemScene = ({items}: {items: string[]}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();

  return (
    <Canvas>
      <div style={{position: "absolute", left: 110, top: 85, fontSize: 28, color: brand.colors.sand, fontWeight: 900, letterSpacing: 5}}>
        FOLLOW THE CONNECTIONS
      </div>
      <div style={{position: "absolute", left: 130, right: 130, top: 330, display: "grid", gridTemplateColumns: `repeat(${items.length}, 1fr)`, gap: 34}}>
        {items.map((item, index) => {
          const progress = spring({frame: frame - index * 14, fps, config: {damping: 16}});
          return (
            <div key={item} style={{position: "relative", opacity: progress, transform: `translateY(${(1 - progress) * 50}px)`}}>
              <div style={{height: 250, border: `2px solid ${brand.colors.sky}`, padding: 28, display: "flex", flexDirection: "column", justifyContent: "space-between"}}>
                <span style={{fontSize: 22, color: brand.colors.ember, fontWeight: 900}}>0{index + 1}</span>
                <span style={{fontSize: 40, fontWeight: 900, letterSpacing: 1}}>{item}</span>
              </div>
              {index < items.length - 1 ? (
                <div style={{position: "absolute", top: 122, right: -34, width: 34, height: 3, background: brand.colors.ember, transform: `scaleX(${interpolate(progress, [0, 1], [0, 1])})`}} />
              ) : null}
            </div>
          );
        })}
      </div>
    </Canvas>
  );
};
