import {Sequence} from "remotion";
import type {DocumentaryProps} from "../types";
import {EndScene} from "../components/EndScene";
import {EvidenceScene} from "../components/EvidenceScene";
import {HookScene} from "../components/HookScene";
import {QuestionScene} from "../components/QuestionScene";
import {SystemScene} from "../components/SystemScene";

export const DocumentaryTemplate = (props: DocumentaryProps) => (
  <>
    <Sequence from={0} durationInFrames={150}>
      <HookScene label={props.episodeLabel} title={props.title} />
    </Sequence>
    <Sequence from={150} durationInFrames={180}>
      <QuestionScene question={props.question} />
    </Sequence>
    <Sequence from={330} durationInFrames={240}>
      <SystemScene items={props.mechanism} />
    </Sequence>
    <Sequence from={570} durationInFrames={210}>
      <EvidenceScene
        label={props.evidenceLabel}
        value={props.evidenceValue}
        note={props.evidenceNote}
        source={props.sourceLine}
      />
    </Sequence>
    <Sequence from={780} durationInFrames={120}>
      <EndScene line={props.closingLine} />
    </Sequence>
  </>
);
