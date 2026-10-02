import type { Scene, ScenePlan } from "@dalang/core";
import { Fragment, useMemo } from "react";
import {
  AbsoluteFill,
  interpolate,
  Sequence,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { easeSettle } from "../../anim";
import { buildCaptionPages, type CaptionPageModel } from "../../captions-model";
import type { AspectMetrics } from "../../layout";
import { TEXT_SIZE_FACTOR } from "../../text-overlay-model";
import { captionStyleOf, captionStyleSpec, splitToken } from "../../type-style";
import { PLATE_WIDTH_FRACTION, wordPop } from "./klip-model";
import type { KlipTheme } from "./theme";

/**
 * Caption klip-01 — bagian terpenting preset ini.
 *
 * Seluruh matematika waktunya tetap milik `captions-model` yang sudah diuji;
 * yang berbeda di sini hanya CARA MENGGAMBARNYA. Tiga keputusan:
 *
 * 1. **Pelat, bukan penggelap layar.** documentary-01 mengandalkan vignette
 *    dan gradien keterbacaan yang meredupkan seluruh bingkai. Di sini hanya
 *    sepetak bidang di belakang kalimatnya yang digelapkan, jadi gambarnya
 *    tetap terang — dan gambar terang yang memenangkan detik pertama.
 * 2. **Hentakan per kata.** Kata yang menyala mendapat pembesaran sesaat yang
 *    lalu pulang (`wordPop`). Gerak terlihat di latar apa pun; warna tidak.
 * 3. **Gaya pilihan pemakai tetap dihormati.** Hentakan dipasang pada
 *    pembungkus, BUKAN menimpa `captionStyleSpec` — jadi "tegas" tetap punya
 *    skala aktifnya sendiri dan keduanya bersusun: hentakan saat kata datang,
 *    lalu duduk di ukuran aktif gayanya.
 */

const CaptionPage: React.FC<{
  page: CaptionPageModel;
  scene: Scene;
  metrics: AspectMetrics;
  theme: KlipTheme;
}> = ({ page, scene, metrics, theme }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const sceneTimeMs = page.startMs + (frame / fps) * 1000;

  const spec = captionStyleSpec(captionStyleOf(scene), {
    ink: theme.ink,
    inkSoft: theme.inkSoft,
    accent: theme.accent,
    onAccent: theme.onAccent,
    // ADR-0041: pita gelap netral, bukan aksen — teks di atasnya harus
    // terbaca, dan aksen gunanya menarik perhatian, bukan jadi latar.
    plate: "rgba(8, 9, 14, 0.82)",
  });
  // Basis lebih besar daripada documentary-01: layar ponsel dipegang jauh
  // lebih dekat, tapi juga jauh lebih kecil, dan caption dibaca sambil
  // menggeser. Yang menang di keadaan itu adalah huruf besar, bukan rapi.
  const fontSize =
    metrics.captionFontSize *
    1.12 *
    spec.sizeFactor *
    TEXT_SIZE_FACTOR[scene.caption.size];
  const plateWidth = Math.min(
    metrics.captionMaxWidth,
    metrics.width * PLATE_WIDTH_FRACTION,
  );
  const placement =
    scene.caption.position === "center"
      ? { top: "50%", translateY: -50 }
      : { bottom: metrics.captionBottom, translateY: 0 };

  // Masuknya 3 frame, bukan 5: di potongan 20 detik, seperlima detik yang
  // dihabiskan untuk memudarkan teks adalah seperlima detik yang hilang.
  const enter = interpolate(frame, [0, 3], [0, 1], {
    extrapolateRight: "clamp",
    easing: easeSettle,
  });

  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <div
        style={{
          position: "absolute",
          ...("top" in placement ? { top: placement.top } : { bottom: placement.bottom }),
          left: "50%",
          // Pelat MEMELUK teksnya, bukan selebar bidang yang tersedia. Lebar
          // tetap membuat baris pendek — dan di konten pendek sebagian besar
          // baris memang pendek — duduk di tengah bilah kosong yang terbaca
          // sebagai elemen antarmuka yang belum jadi, bukan sebagai caption.
          // `maxWidth` tetap yang menentukan di mana barisnya melipat.
          //
          // `max-content`, BUKAN `fit-content`: elemen ini berjangkar di
          // `left: 50%`, sehingga ruang yang dianggap tersedia hanya separuh
          // bingkai — `fit-content` akan menyempit ke situ dan melipat kalimat
          // yang sebenarnya muat satu baris. `max-content` mengabaikan ruang
          // tersedia, lalu `maxWidth` yang menentukan tempat melipatnya.
          width: "max-content",
          maxWidth: plateWidth,
          boxSizing: "border-box",
          padding: `${Math.round(fontSize * 0.34)}px ${Math.round(fontSize * 0.42)}px`,
          borderRadius: Math.round(fontSize * 0.36),
          backgroundColor: theme.plate,
          textAlign: "center",
          fontFamily: theme.fontBody,
          fontSize,
          color: theme.ink,
          whiteSpace: "pre-wrap",
          ...spec.block,
          opacity: enter,
          translate: `-50% calc(${placement.translateY}% + ${interpolate(
            frame,
            [0, 3],
            [14, 0],
            { extrapolateRight: "clamp", easing: easeSettle },
          ).toFixed(2)}px)`,
        }}
      >
        {page.tokens.map((token, tokenIndex) => {
          const started = token.fromMs <= sceneTimeMs;
          const active = started && token.toMs > sceneTimeMs;
          const { lead, word } = splitToken(token.text);
          const pop = wordPop(sceneTimeMs - token.fromMs);
          return (
            <Fragment key={`${token.fromMs}-${tokenIndex}`}>
              {lead}
              {/* Pembungkus hentakan: skala TIDAK mengubah tata letak, jadi
                  bersarang di dalam gaya token aman dan keduanya berlipat. */}
              <span style={{ display: "inline-block", scale: pop.toFixed(4) }}>
                <span style={spec.token(active ? "active" : started ? "past" : "future")}>
                  {word}
                </span>
              </span>
            </Fragment>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};

export const KlipCaptions: React.FC<{
  scene: Scene;
  plan: ScenePlan;
  sceneDurationFrames: number;
  metrics: AspectMetrics;
  theme: KlipTheme;
}> = ({ scene, plan, sceneDurationFrames, metrics, theme }) => {
  const { fps } = useVideoConfig();

  const pages = useMemo(
    () => buildCaptionPages({ scene, plan, sceneDurationFrames, fps }),
    [scene, plan, sceneDurationFrames, fps],
  );

  if (pages.length === 0) return null;

  return (
    <AbsoluteFill>
      {pages.map((page, index) => (
        <Sequence
          key={index}
          from={page.startFrame}
          durationInFrames={page.durationInFrames}
          layout="none"
          name={`caption-${index + 1}`}
        >
          <CaptionPage page={page} scene={scene} metrics={metrics} theme={theme} />
        </Sequence>
      ))}
    </AbsoluteFill>
  );
};
