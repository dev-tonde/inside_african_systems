export type PilotSceneKind =
  | "hook"
  | "timeline"
  | "pipeline"
  | "network"
  | "inventory"
  | "control"
  | "ownership"
  | "metric"
  | "metricGrid"
  | "capacity"
  | "tradeoff"
  | "close";

export type PilotSceneData = {
  id: string;
  chapter: string;
  kind: PilotSceneKind;
  eyebrow: string;
  title: string;
  narration: string;
  claimIds: string[];
  sourceLine: string;
  visual: {
    headline: string;
    support: string;
    items: string[];
  };
};

export type PilotTiming = {
  id: string;
  startFrame: number;
  durationFrames: number;
  startSeconds: number;
  durationSeconds: number;
};

export type PilotCaption = {
  startSeconds: number;
  endSeconds: number;
  text: string;
};
