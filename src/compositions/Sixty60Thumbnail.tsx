import {AbsoluteFill} from "remotion";
import {brand} from "../brand";

export const Sixty60Thumbnail = () => (
  <AbsoluteFill
    style={{
      background: brand.colors.ink,
      color: brand.colors.paper,
      fontFamily: "Arial, Helvetica, sans-serif",
      overflow: "hidden",
    }}
  >
    <AbsoluteFill
      style={{
        opacity: 0.16,
        backgroundImage:
          "linear-gradient(rgba(133,185,178,.55) 1px, transparent 1px), linear-gradient(90deg, rgba(133,185,178,.55) 1px, transparent 1px)",
        backgroundSize: "64px 64px",
      }}
    />
    <div style={{position: "absolute", left: 66, top: 52, fontSize: 18, fontWeight: 900, letterSpacing: 4, color: brand.colors.sand}}>
      INSIDE AFRICAN SYSTEMS
    </div>
    <div style={{position: "absolute", left: 66, top: 150, width: 720}}>
      <div style={{fontSize: 84, lineHeight: 0.88, fontWeight: 900, letterSpacing: -5}}>
        THE FINAL
        <br />
        <span style={{color: brand.colors.ember}}>5 KM</span>
      </div>
      <div style={{fontSize: 28, lineHeight: 1.1, fontWeight: 800, marginTop: 30, color: brand.colors.sky}}>
        HOW SIXTY60 REALLY WORKS
      </div>
    </div>
    <div style={{position: "absolute", right: 70, top: 110, width: 350, height: 480}}>
      {["APP", "STORE", "PICKER", "PINGO", "DOOR"].map((item, index) => (
        <div key={item} style={{position: "relative", height: 88, marginBottom: 12}}>
          <div
            style={{
              position: "absolute",
              inset: 0,
              background: index === 4 ? brand.colors.ember : "rgba(15,118,110,.22)",
              border: `3px solid ${index === 4 ? brand.colors.ember : brand.colors.sky}`,
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "0 28px",
              fontSize: 25,
              fontWeight: 900,
              letterSpacing: 3,
            }}
          >
            <span>0{index + 1}</span>
            <span>{item}</span>
          </div>
        </div>
      ))}
    </div>
  </AbsoluteFill>
);
