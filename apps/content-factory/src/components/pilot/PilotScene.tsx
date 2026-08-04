import {interpolate, spring, useCurrentFrame, useVideoConfig} from "remotion";
import {brand} from "../../brand";
import type {PilotSceneData} from "../../pilot-types";
import {BrandMark} from "../BrandMark";
import {Canvas} from "../Canvas";

type Props = {
  scene: PilotSceneData;
  index: number;
  sceneCount: number;
  durationFrames: number;
};

const clamp = {
  extrapolateLeft: "clamp" as const,
  extrapolateRight: "clamp" as const,
};

const PipelineVisual = ({
  items,
  progress,
  compact = false,
}: {
  items: string[];
  progress: number;
  compact?: boolean;
}) => (
  <div
    style={{
      display: "grid",
      gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))`,
      alignItems: "center",
      gap: compact ? 16 : 26,
      width: "100%",
    }}
  >
    {items.map((item, index) => {
      const itemProgress = interpolate(progress, [index / items.length, (index + 1) / items.length], [0, 1], clamp);
      return (
        <div key={item} style={{position: "relative", minWidth: 0}}>
          <div
            style={{
              minHeight: compact ? 112 : 156,
              border: `2px solid ${index === items.length - 1 ? brand.colors.ember : brand.colors.sky}`,
              background: index === items.length - 1 ? brand.colors.ember : "rgba(15,118,110,.16)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: compact ? 14 : 20,
              opacity: itemProgress,
              transform: `translateY(${(1 - itemProgress) * 28}px)`,
            }}
          >
            <span
              style={{
                color: brand.colors.paper,
                fontSize: compact ? 20 : 27,
                fontWeight: 900,
                letterSpacing: compact ? 1.5 : 2.5,
                textAlign: "center",
                overflowWrap: "anywhere",
              }}
            >
              {item}
            </span>
          </div>
          {index < items.length - 1 ? (
            <div
              style={{
                position: "absolute",
                width: compact ? 16 : 26,
                height: 3,
                right: compact ? -16 : -26,
                top: "50%",
                background: brand.colors.sand,
                transform: `scaleX(${itemProgress})`,
                transformOrigin: "left",
              }}
            />
          ) : null}
        </div>
      );
    })}
  </div>
);

const NetworkVisual = ({items, progress}: {items: string[]; progress: number}) => {
  const positions = [
    {left: 30, top: 80},
    {right: 30, top: 80},
    {left: 30, bottom: 75},
    {right: 30, bottom: 75},
    {left: "50%", top: 20, transform: "translateX(-50%)"},
  ];
  return (
    <div style={{position: "relative", width: "100%", height: 380}}>
      <svg width="100%" height="100%" viewBox="0 0 1200 380" style={{position: "absolute", inset: 0}}>
        {[
          [180, 145],
          [1020, 145],
          [180, 300],
          [1020, 300],
          [600, 70],
        ].slice(0, items.length).map(([x, y], index) => (
          <line
            key={`${x}-${y}`}
            x1="600"
            y1="210"
            x2={x}
            y2={y}
            stroke={index === items.length - 1 ? brand.colors.ember : brand.colors.sky}
            strokeWidth="4"
            strokeDasharray="12 12"
            strokeDashoffset={(1 - progress) * 180}
            opacity={0.65}
          />
        ))}
      </svg>
      <div
        style={{
          position: "absolute",
          left: "50%",
          top: "55%",
          width: 240,
          height: 120,
          transform: `translate(-50%, -50%) scale(${0.86 + progress * 0.14})`,
          background: brand.colors.ember,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 29,
          fontWeight: 900,
          letterSpacing: 3,
        }}
      >
        SYSTEM
      </div>
      {items.map((item, index) => (
        <div
          key={item}
          style={{
            position: "absolute",
            width: 260,
            minHeight: 78,
            border: `2px solid ${brand.colors.sky}`,
            background: brand.colors.ink,
            padding: 17,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 21,
            fontWeight: 900,
            textAlign: "center",
            letterSpacing: 2,
            opacity: interpolate(progress, [index * 0.12, 0.5 + index * 0.1], [0, 1], clamp),
            ...positions[index],
          }}
        >
          {item}
        </div>
      ))}
    </div>
  );
};

const MetricVisual = ({headline, support, items, progress}: PilotSceneData["visual"] & {progress: number}) => (
  <div style={{display: "grid", gridTemplateColumns: "1.28fr .72fr", gap: 34, width: "100%", alignItems: "stretch"}}>
    <div
      style={{
        border: `3px solid ${brand.colors.paper}`,
        background: brand.colors.ember,
        minHeight: 340,
        padding: 42,
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        transform: `scale(${0.93 + progress * 0.07})`,
        transformOrigin: "left center",
      }}
    >
      <div style={{fontSize: headline.length > 18 ? 66 : 110, lineHeight: 0.92, fontWeight: 900, letterSpacing: -3}}>
        {headline}
      </div>
      <div style={{fontSize: 29, lineHeight: 1.25, fontWeight: 700}}>{support}</div>
    </div>
    <div style={{display: "grid", gap: 14}}>
      {items.map((item, index) => (
        <div
          key={item}
          style={{
            border: `2px solid ${brand.colors.sky}`,
            padding: "22px 26px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            fontSize: 24,
            fontWeight: 900,
            letterSpacing: 2,
            opacity: interpolate(progress, [0.12 * index, 0.5 + index * 0.1], [0, 1], clamp),
          }}
        >
          <span>{item}</span>
          <span style={{color: brand.colors.sand}}>0{index + 1}</span>
        </div>
      ))}
    </div>
  </div>
);

export const PilotScene = ({scene, index, sceneCount, durationFrames}: Props) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const entrance = spring({frame, fps, config: {damping: 17, mass: 0.8}});
  const sceneOpacity = interpolate(
    frame,
    [0, 10, Math.max(11, durationFrames - 18), Math.max(12, durationFrames - 1)],
    [0, 1, 1, 0],
    clamp,
  );
  const progress = interpolate(frame, [0, Math.min(durationFrames * 0.55, 150)], [0, 1], clamp);
  const headlineSize = scene.visual.headline.length > 22 ? 50 : scene.visual.headline.length > 14 ? 64 : 88;
  const networkKinds = new Set(["network", "ownership", "close"]);
  const metricKinds = new Set(["metric", "metricGrid", "capacity", "tradeoff"]);

  return (
    <Canvas>
      <div style={{position: "absolute", inset: 0, opacity: sceneOpacity}}>
      <div style={{position: "absolute", left: 88, right: 88, top: 56, display: "flex", justifyContent: "space-between", alignItems: "center"}}>
        <BrandMark inverse />
        <div style={{display: "flex", gap: 12, alignItems: "center"}}>
          <span style={{fontSize: 18, fontWeight: 900, letterSpacing: 2, color: brand.colors.sand}}>
            {String(index + 1).padStart(2, "0")} / {String(sceneCount).padStart(2, "0")}
          </span>
          <div style={{width: 220, height: 5, background: "rgba(244,238,223,.18)"}}>
            <div style={{height: "100%", width: `${((index + progress) / sceneCount) * 100}%`, background: brand.colors.ember}} />
          </div>
        </div>
      </div>

      <div
        style={{
          position: "absolute",
          left: 108,
          right: 108,
          top: 152,
          opacity: entrance,
          transform: `translateY(${(1 - entrance) * 24}px)`,
        }}
      >
        <div style={{fontSize: 20, fontWeight: 900, letterSpacing: 4.5, color: brand.colors.sand, marginBottom: 14}}>
          {scene.eyebrow}
        </div>
        <h1 style={{fontSize: 61, lineHeight: 1.02, maxWidth: 1380, margin: 0, letterSpacing: -2, fontWeight: 900}}>
          {scene.title}
        </h1>
      </div>

      <div
        style={{
          position: "absolute",
          left: 108,
          right: 108,
          top: 360,
          bottom: 205,
          display: "flex",
          alignItems: "center",
        }}
      >
        {metricKinds.has(scene.kind) ? (
          <MetricVisual {...scene.visual} progress={progress} />
        ) : networkKinds.has(scene.kind) ? (
          <NetworkVisual items={scene.visual.items} progress={progress} />
        ) : (
          <div style={{width: "100%", display: "grid", gap: 28}}>
            <div style={{fontSize: headlineSize, lineHeight: 0.96, fontWeight: 900, letterSpacing: -2, color: brand.colors.ember}}>
              {scene.visual.headline}
            </div>
            <PipelineVisual items={scene.visual.items} progress={progress} compact={scene.visual.items.length > 4} />
            <div style={{fontSize: 27, fontWeight: 700, color: brand.colors.sky}}>{scene.visual.support}</div>
          </div>
        )}
      </div>

      <div
        style={{
          position: "absolute",
          left: 108,
          right: 108,
          bottom: 146,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-end",
          gap: 40,
          color: brand.colors.muted,
          fontSize: 17,
          letterSpacing: 1.1,
        }}
      >
        <span style={{maxWidth: 1300}}>{scene.sourceLine}</span>
        <span style={{whiteSpace: "nowrap"}}>{scene.claimIds.join(" · ")}</span>
      </div>
      </div>
    </Canvas>
  );
};
