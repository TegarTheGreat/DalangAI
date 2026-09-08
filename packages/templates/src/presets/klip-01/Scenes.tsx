import {
  primaryClip,
  type ResolvedAsset,
  type Scene,
  type ScenePlan,
} from "@dalang/core";
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { easeSettle } from "../../anim";
import { buildClipVolume, type DuckWindow } from "../../audio-model";
import { ClipStrip } from "../../ClipStrip";
import type { AspectMetrics } from "../../layout";
import { Backdrop, clipSeed } from "../documentary-01/Backdrop";
import { KlipCaptions } from "./KlipCaptions";
import { hookFontSize } from "./klip-model";
import type { KlipTheme } from "./theme";

/**
 * Tiga bentuk scene klip-01.
 *
 * `Backdrop` sengaja DIPINJAM dari documentary-01, bukan disalin: ia adalah
 * mesin seni prosedural sekaligus pemutar media yang sudah diuji, dan satu-
 * satunya yang dibacanya dari tema adalah `bg` serta `duotones` — keduanya
 * ada di `KlipTheme`. Yang membedakan preset ini adalah cara MENGGAMBAR di
 * atas gambar itu, bukan cara mengambil gambarnya.
 */

type SceneProps = {
  scene: Scene;
  sceneIndex: number;
  plan: ScenePlan;
  asset: ResolvedAsset | undefined;
  metrics: AspectMetrics;
  theme: KlipTheme;
  durationInFrames: number;
};

/**
 * Kartu hook (`template-anim` / variant "title").
 *
 * Kartu judul dokumenter membangun suasana selama satu setengah detik. Di
 * konten pendek, satu setengah detik adalah seluruh anggaran perhatian yang
 * dipunyai — kaidah agent sendiri menulisnya: "klip yang dibuka kartu judul
 * kehilangan penonton di detik pertama".
 *
 * Jadi kartu ini bukan kartu judul yang dipercepat. Ia dirancang untuk MENDARAT:
 * seluruh judul masuk sekaligus dalam 6 frame (0,2 detik) dengan sentakan
 * skala, bukan kata demi kata; tidak ada kicker, tidak ada garis yang tumbuh
 * pelan. Yang menyusul hanyalah satu baris penjelas — dan itu pun boleh
 * kosong.
 */
export const HookScene: React.FC<SceneProps> = ({
  scene,
  sceneIndex,
  plan,
  asset,
  metrics,
  theme,
  durationInFrames,
}) => {
  const frame = useCurrentFrame();
  const fontSize = hookFontSize(plan.meta.title, metrics.titleFontSize);

  // Mendarat di frame 6, lalu diam. Skala masuk dari 0,88 — cukup terasa
  // sebagai hentakan, tidak cukup besar untuk terlihat seperti kesalahan.
  const land = interpolate(frame, [0, 6], [0, 1], {
    extrapolateRight: "clamp",
    easing: easeSettle,
  });

  return (
    <AbsoluteFill>
      <Backdrop
        clip={primaryClip(scene)}
        seedKey={clipSeed(scene, 0)}
        sceneIndex={sceneIndex}
        asset={asset}
        theme={theme}
        durationInFrames={durationInFrames}
        // Lebih terang daripada documentary-01 (0,34): gambar yang redup di
        // umpan media sosial adalah gambar yang dilewati jempol.
        dim={0.26}
      />
      <AbsoluteFill
        style={{
          justifyContent: "center",
          alignItems: "center",
          padding: `${metrics.marginTop}px ${metrics.marginX}px`,
        }}
      >
        <h1
          style={{
            margin: 0,
            fontFamily: theme.fontDisplay,
            fontSize,
            // 1,08 dan bukan lebih rapat: Anton punya caps tinggi TANPA ruang
            // bawah yang lega, jadi tanda baca yang menjulur di baris atas
            // ditubruk oleh caps baris berikutnya. Ini bukan selera — pada
            // 0,98 judul dua baris benar-benar saling menimpa saat dirender,
            // dan pada 1,05 ekor koma hanya berjarak beberapa piksel: cukup
            // untuk judul contoh ini, tidak cukup untuk judul mana pun.
            lineHeight: 1.08,
            textAlign: "center",
            color: theme.ink,
            textTransform: "uppercase",
            letterSpacing: "-0.01em",
            textWrap: "balance",
            maxWidth: "100%",
            textShadow: "0 6px 34px rgba(0, 0, 0, 0.6)",
            opacity: land,
            scale: String(0.88 + 0.12 * land),
          }}
        >
          {plan.meta.title}
        </h1>

        {/* Balok aksen: melebar sekali, cepat, lalu berhenti. Penanda merek,
            bukan hiasan yang terus bergerak. */}
        <div
          style={{
            height: 8,
            width: interpolate(frame, [5, 13], [0, Math.round(fontSize * 1.5)], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
              easing: easeSettle,
            }),
            backgroundColor: theme.accent,
            borderRadius: 4,
            marginTop: Math.round(fontSize * 0.3),
          }}
        />

        {scene.narration.trim() !== "" ? (
          <p
            style={{
              margin: 0,
              marginTop: Math.round(fontSize * 0.26),
              fontFamily: theme.fontBody,
              fontWeight: 600,
              fontSize: Math.max(Math.round(fontSize * 0.26), 34),
              lineHeight: 1.34,
              textAlign: "center",
              color: theme.inkSoft,
              maxWidth: "88%",
              textWrap: "balance",
              textShadow: "0 2px 18px rgba(0, 0, 0, 0.72)",
              opacity: interpolate(frame, [10, 20], [0, 1], {
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
                easing: easeSettle,
              }),
            }}
          >
            {scene.narration}
          </p>
        ) : null}
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

/**
 * Penutup (`template-anim` / variant "outro").
 *
 * Sengaja pendek dan satu gagasan: chip aksen berisi narasi penutup. Outro
 * klip yang panjang tidak dilihat siapa pun — penonton sudah menggeser.
 */
export const KlipOutroScene: React.FC<SceneProps> = ({
  scene,
  sceneIndex,
  plan,
  asset,
  metrics,
  theme,
  durationInFrames,
}) => {
  const frame = useCurrentFrame();
  const line = scene.narration.trim() || plan.meta.title;
  const fontSize = Math.max(Math.round(metrics.titleFontSize * 0.58), 56);
  const land = interpolate(frame, [0, 7], [0, 1], {
    extrapolateRight: "clamp",
    easing: easeSettle,
  });

  return (
    <AbsoluteFill>
      <Backdrop
        clip={primaryClip(scene)}
        seedKey={clipSeed(scene, 0)}
        sceneIndex={sceneIndex}
        asset={asset}
        theme={theme}
        durationInFrames={durationInFrames}
        dim={0.44}
      />
      <AbsoluteFill
        style={{
          justifyContent: "center",
          alignItems: "center",
          padding: `${metrics.marginTop}px ${metrics.marginX}px`,
        }}
      >
        <div
          style={{
            fontFamily: theme.fontDisplay,
            fontSize,
            lineHeight: 1.06,
            textAlign: "center",
            textTransform: "uppercase",
            letterSpacing: "-0.005em",
            color: theme.onAccent,
            backgroundColor: theme.accent,
            padding: `${Math.round(fontSize * 0.28)}px ${Math.round(fontSize * 0.5)}px`,
            borderRadius: Math.round(fontSize * 0.24),
            maxWidth: "92%",
            textWrap: "balance",
            opacity: land,
            scale: String(0.9 + 0.1 * land),
          }}
        >
          {line}
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

/**
 * Scene isi: strip klip layar penuh + caption berat.
 *
 * Sama seperti documentary-01, visualnya adalah STRIP KLIP (ADR-0033) — scene
 * berklip satu jatuh ke jalur yang sama persis, scene berklip banyak memutar
 * potongannya berurutan, dan caption tetap milik scene serta menyeberangi
 * seluruh potongan.
 */
export const KlipBodyScene: React.FC<
  SceneProps & {
    debug: boolean;
    sceneStartFrame: number;
    ducks: readonly DuckWindow[];
  }
> = ({
  scene,
  sceneIndex,
  plan,
  metrics,
  theme,
  durationInFrames,
  debug,
  sceneStartFrame,
  ducks,
}) => {
  const { fps } = useVideoConfig();

  return (
    <AbsoluteFill>
      <ClipStrip scene={scene} plan={plan} durationInFrames={durationInFrames}>
        {({ clip, asset, index, durationInFrames: clipFrames, startFrame }) => {
          const unresolved =
            !asset &&
            (clip.type === "stock" ||
              clip.type === "image" ||
              clip.type === "generated" ||
              clip.type === "screenshot");
          return (
            <AbsoluteFill>
              <Backdrop
                clip={clip}
                seedKey={clipSeed(scene, index)}
                sceneIndex={sceneIndex}
                asset={asset}
                theme={theme}
                durationInFrames={clipFrames}
                volume={buildClipVolume({
                  audio: clip.audio,
                  lufs: asset?.lufs,
                  channels: asset?.channels,
                  targetLufs: plan.meta.loudnessTarget,
                  startFrame: sceneStartFrame + startFrame,
                  frames: clipFrames,
                  fps,
                  ducks,
                })}
              />
              {debug && unresolved ? (
                <div
                  style={{
                    position: "absolute",
                    left: metrics.marginX,
                    bottom: metrics.marginTop * 0.5,
                    fontFamily: "monospace",
                    fontSize: 22,
                    color: "rgba(255, 255, 255, 0.6)",
                    backgroundColor: "rgba(0, 0, 0, 0.45)",
                    padding: "6px 12px",
                    borderRadius: 6,
                  }}
                >
                  aset belum di-resolve · {clip.query ?? clip.type}
                </div>
              ) : null}
            </AbsoluteFill>
          );
        }}
      </ClipStrip>
      <KlipCaptions
        scene={scene}
        plan={plan}
        sceneDurationFrames={durationInFrames}
        metrics={metrics}
        theme={theme}
      />
    </AbsoluteFill>
  );
};
