import {useCurrentFrame, useVideoConfig} from "remotion";
import {brand} from "../../brand";
import type {PilotCaption} from "../../pilot-types";

export const CaptionLayer = ({captions}: {captions: PilotCaption[]}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const seconds = frame / fps;
  const caption = captions.find(
    (candidate) => seconds >= candidate.startSeconds && seconds < candidate.endSeconds,
  );

  if (!caption) {
    return null;
  }

  return (
    <div
      style={{
        position: "absolute",
        zIndex: 50,
        left: 250,
        right: 250,
        bottom: 38,
        display: "flex",
        justifyContent: "center",
        pointerEvents: "none",
      }}
    >
      <div
        style={{
          maxWidth: 1320,
          background: "rgba(8, 28, 26, 0.93)",
          color: brand.colors.paper,
          border: `1px solid ${brand.colors.sky}`,
          boxShadow: "0 10px 35px rgba(0,0,0,.28)",
          padding: "13px 24px 15px",
          fontSize: 30,
          lineHeight: 1.22,
          fontWeight: 700,
          textAlign: "center",
        }}
      >
        {caption.text}
      </div>
    </div>
  );
};
