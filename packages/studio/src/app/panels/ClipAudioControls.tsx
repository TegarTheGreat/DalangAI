import { type ClipAudio, loudnessGain, loudnessGainClamped } from "@dalang/core";
import { Switch } from "../components/controls";
import { SliderRow } from "./InspectorPanel";

/**
 * Kendali amplop audio satu klip (ADR-0026, roadmap §9.4).
 *
 * SATU komponen untuk suara aset visual, suara lapisan, dan trek audio
 * tambahan — sama seperti `clipAudioSchema` adalah satu bentuk untuk ketiganya.
 * Tiga panel kendali yang harus tetap sama selamanya adalah cara paling pasti
 * untuk punya satu panel yang diam-diam kehilangan sakelar ducking.
 *
 * Yang ditampilkan bukan cuma slider: baris terakhir MENGATAKAN hasil ukur
 * berkasnya dan berapa penguatan yang dipakai. Normalisasi yang bekerja diam-
 * diam membuat orang mengira slider volumenya rusak — angka yang terlihat
 * membuat perilakunya bisa ditebak.
 */
export const ClipAudioControls: React.FC<{
  audio: ClipAudio;
  /** Hasil ukur berkasnya; undefined = belum diukur. */
  lufs?: number | undefined;
  /** Kanal sumbernya — mono terdengar 3 LU lebih keras di campuran stereo. */
  channels?: number | undefined;
  targetLufs: number | null;
  onChange: (audio: ClipAudio) => void;
}> = ({ audio, lufs, channels, targetLufs, onChange }) => {
  const set = (patch: Partial<ClipAudio>) => onChange({ ...audio, ...patch });
  const silent = audio.volume <= 0;
  const gain = audio.normalize ? loudnessGain(lufs, targetLufs, channels) : 1;
  const gainDb = 20 * Math.log10(gain);

  return (
    <>
      <SliderRow
        label="Suara"
        min={0}
        max={1}
        step={0.05}
        value={audio.volume}
        neutral={0}
        format={(value) => (value === 0 ? "bisu" : `${Math.round(value * 100)}%`)}
        onCommit={(volume) => set({ volume })}
      />
      {/* Sisa kendali hanya muncul saat klipnya memang berbunyi: fade dan
          ducking untuk trek bisu adalah kendali yang tidak melakukan apa pun,
          dan kendali seperti itu mengajarkan mata untuk berhenti membacanya. */}
      {silent ? null : (
        <>
          <SliderRow
            label="Fade masuk"
            min={0}
            max={5}
            step={0.1}
            value={audio.fadeInSec}
            neutral={0}
            format={(value) => (value === 0 ? "tanpa" : `${value.toFixed(1)}s`)}
            onCommit={(fadeInSec) => set({ fadeInSec })}
          />
          <SliderRow
            label="Fade keluar"
            min={0}
            max={5}
            step={0.1}
            value={audio.fadeOutSec}
            neutral={0}
            format={(value) => (value === 0 ? "tanpa" : `${value.toFixed(1)}s`)}
            onCommit={(fadeOutSec) => set({ fadeOutSec })}
          />
          <Switch
            checked={audio.ducking}
            label="Mengecil di bawah narasi"
            title="Ducking otomatis saat scene bernarasi berbunyi"
            onChange={(ducking) => set({ ducking })}
          />
          <Switch
            checked={audio.normalize}
            label="Samakan kenyaringan"
            title="Bawa klip ini ke sasaran LUFS proyek sebelum volume diterapkan"
            onChange={(normalize) => set({ normalize })}
          />
          <span className="meta-line wrap">
            {lufs === undefined
              ? "Belum diukur — jalankan tahap Aset supaya kenyaringannya terukur; sampai itu klip ini tidak dinormalisasi."
              : targetLufs === null
                ? `Terukur ${lufs} LUFS · normalisasi proyek dimatikan.`
                : audio.normalize
                  ? `Terukur ${lufs} LUFS${channels === 1 ? " (mono; terdengar +3,0 LU di campuran stereo)" : ""} -> ${targetLufs} LUFS (${gainDb >= 0 ? "+" : ""}${gainDb.toFixed(1)} dB)${
                      loudnessGainClamped(lufs, targetLufs, channels)
                        ? " · terpotong batas penguatan"
                        : ""
                    }`
                  : `Terukur ${lufs} LUFS · dipakai apa adanya.`}
          </span>
        </>
      )}
    </>
  );
};
