import { AbsoluteFill, useCurrentFrame } from "remotion";

/**
 * Global cinematic finish, rendered once above the scene stack:
 * readability gradients, vignette, animated film grain.
 */

export const ReadabilityGradients: React.FC = () => (
  <AbsoluteFill
    style={{
      backgroundImage: [
        "linear-gradient(to bottom, rgba(4, 6, 12, 0.5) 0%, rgba(4, 6, 12, 0) 20%)",
        "linear-gradient(to top, rgba(4, 6, 12, 0.66) 0%, rgba(4, 6, 12, 0) 34%)",
      ].join(", "),
    }}
  />
);

export const Vignette: React.FC = () => (
  <AbsoluteFill
    style={{
      backgroundImage:
        "radial-gradient(120% 100% at 50% 46%, rgba(0,0,0,0) 55%, rgba(0,0,0,0.4) 100%)",
    }}
  />
);

export const FilmGrain: React.FC<{ opacity?: number }> = ({ opacity = 0.055 }) => {
  const frame = useCurrentFrame();
  const seed = 2 + (Math.floor(frame / 2) % 500);
  return (
    <AbsoluteFill style={{ opacity, mixBlendMode: "overlay" }}>
      <svg width="100%" height="100%" role="presentation" aria-hidden="true">
        <filter id="dalang-grain">
          <feTurbulence
            type="fractalNoise"
            baseFrequency="0.9"
            numOctaves="2"
            seed={seed}
            stitchTiles="stitch"
          />
          <feColorMatrix type="saturate" values="0" />
        </filter>
        <rect width="100%" height="100%" filter="url(#dalang-grain)" />
      </svg>
    </AbsoluteFill>
  );
};
