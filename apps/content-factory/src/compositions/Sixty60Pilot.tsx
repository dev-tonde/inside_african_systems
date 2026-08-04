import {Audio, Sequence, staticFile} from "remotion";
import scenesJson from "../../content/episodes/sixty60/scenes.json";
import timingsJson from "../data/sixty60-timings.json";
import type {PilotSceneData} from "../pilot-types";
import {CaptionLayer} from "../components/pilot/CaptionLayer";
import {PilotScene} from "../components/pilot/PilotScene";

const scenes = scenesJson as PilotSceneData[];

export const Sixty60Pilot = () => (
  <>
    <Audio src={staticFile(timingsJson.audioPath)} />
    {timingsJson.scenes.map((timing, index) => {
      const scene = scenes.find((candidate) => candidate.id === timing.id);
      if (!scene) {
        throw new Error(`Missing scene data for timing: ${timing.id}`);
      }
      return (
        <Sequence
          key={timing.id}
          from={timing.startFrame}
          durationInFrames={timing.durationFrames}
          premountFor={30}
        >
          <PilotScene
            scene={scene}
            index={index}
            sceneCount={scenes.length}
            durationFrames={timing.durationFrames}
          />
        </Sequence>
      );
    })}
    <CaptionLayer captions={timingsJson.captions} />
  </>
);
