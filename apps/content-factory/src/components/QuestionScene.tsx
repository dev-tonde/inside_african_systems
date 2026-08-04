import {interpolate, useCurrentFrame} from "remotion";
import {brand} from "../brand";
import {Canvas} from "./Canvas";

export const QuestionScene = ({question}: {question: string}) => {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame, [0, 25, 145, 180], [0, 1, 1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <Canvas tone="light">
      <div style={{position: "absolute", left: 110, top: 90, color: brand.colors.ember, fontSize: 25, fontWeight: 900, letterSpacing: 4}}>
        THE CENTRAL QUESTION
      </div>
      <div style={{position: "absolute", left: 210, top: 280, width: 1500, opacity, fontSize: 82, lineHeight: 1.08, fontWeight: 800, letterSpacing: -2}}>
        {question}
      </div>
      <div style={{position: "absolute", left: 110, bottom: 80, fontSize: 22, letterSpacing: 2, color: brand.colors.teal}}>
        PEOPLE · SYSTEMS · CONSEQUENCES
      </div>
    </Canvas>
  );
};
