import {Composition} from "remotion";
import {DocumentaryTemplate} from "./compositions/DocumentaryTemplate";
import {Sixty60Pilot} from "./compositions/Sixty60Pilot";
import {Sixty60Thumbnail} from "./compositions/Sixty60Thumbnail";
import {sampleDocumentary} from "./data/sample-documentary";
import timings from "./data/sixty60-timings.json";

export const RemotionRoot = () => (
  <>
    <Composition
      id="InsideAfricanSystems"
      component={DocumentaryTemplate}
      durationInFrames={900}
      fps={30}
      width={1920}
      height={1080}
      defaultProps={sampleDocumentary}
    />
    <Composition
      id="Sixty60Pilot"
      component={Sixty60Pilot}
      durationInFrames={timings.totalFrames}
      fps={30}
      width={1920}
      height={1080}
    />
    <Composition
      id="Sixty60Thumbnail"
      component={Sixty60Thumbnail}
      durationInFrames={1}
      fps={30}
      width={1280}
      height={720}
    />
  </>
);
