import { describe, expect, it } from "vitest";
import {
  buildSpeechConfigMessage,
  buildSsml,
  buildSsmlMessage,
  EDGE_TRUSTED_CLIENT_TOKEN,
  edgeConnectionUrl,
  escapeXml,
  parseBinaryMessage,
  parseTextMessage,
  parseWordBoundaries,
  resolveEdgeVoice,
  secMsGec,
  ticksToSec,
} from "../src/index";

describe("secMsGec", () => {
  it("is deterministic for a fixed clock and floors to 5 minutes", () => {
    const at = new Date("2026-08-29T10:02:30Z");
    const sameWindow = new Date("2026-08-29T10:04:59Z");
    const nextWindow = new Date("2026-08-29T10:05:00Z");
    expect(secMsGec(at)).toMatch(/^[0-9A-F]{64}$/);
    expect(secMsGec(at)).toBe(secMsGec(sameWindow));
    expect(secMsGec(at)).not.toBe(secMsGec(nextWindow));
  });

  it("connection URL carries token, GEC, version, and connection id", () => {
    const url = edgeConnectionUrl(new Date("2026-08-29T10:00:00Z"));
    expect(url).toContain(`TrustedClientToken=${EDGE_TRUSTED_CLIENT_TOKEN}`);
    expect(url).toMatch(/Sec-MS-GEC=[0-9A-F]{64}/);
    expect(url).toMatch(/Sec-MS-GEC-Version=1-[\d.]+/);
    expect(url).toMatch(/ConnectionId=[0-9a-f]{32}/);
  });
});

describe("SSML & messages", () => {
  it("escapes XML and applies rate from speed", () => {
    expect(escapeXml(`<a & "b">'c'`)).toBe("&lt;a &amp; &quot;b&quot;&gt;&apos;c&apos;");
    const ssml = buildSsml({
      text: "Cepat & <tegas>",
      voiceId: "id-ID-ArdiNeural",
      speed: 1.2,
      language: "id",
    });
    expect(ssml).toContain("rate='+20%'");
    expect(ssml).toContain("Cepat &amp; &lt;tegas&gt;");
    expect(ssml).toContain("<voice name='id-ID-ArdiNeural'>");
  });

  it("resolves foreign voice ids to the language default", () => {
    expect(resolveEdgeVoice("id-ID-GadisNeural", "id")).toBe("id-ID-GadisNeural");
    expect(resolveEdgeVoice("suara-elevenlabs-abc", "id")).toBe("id-ID-ArdiNeural");
    expect(resolveEdgeVoice("apapun", "xx")).toBe("en-US-AriaNeural");
  });

  it("builds protocol messages with CRLF headers and JSON/SSML bodies", () => {
    const config = buildSpeechConfigMessage("Sat, 29 Aug 2026 10:00:00 GMT");
    expect(config).toContain("Path:speech.config\r\n\r\n");
    expect(JSON.parse(config.split("\r\n\r\n")[1]!)).toMatchObject({
      context: {
        synthesis: {
          audio: { metadataoptions: { wordBoundaryEnabled: true } },
        },
      },
    });

    const message = buildSsmlMessage("req123", "ts", "<speak/>");
    const parsed = parseTextMessage(message);
    expect(parsed.headers["X-RequestId"]).toBe("req123");
    expect(parsed.headers.Path).toBe("ssml");
    expect(parsed.body).toBe("<speak/>");
  });
});

describe("frame parsing", () => {
  it("splits binary frames into headers and audio payload", () => {
    const header = "Path:audio\r\nContent-Type:audio/mpeg";
    const headerBytes = new TextEncoder().encode(header);
    const payload = new Uint8Array([1, 2, 3, 4, 5]);
    const frame = new Uint8Array(2 + headerBytes.length + payload.length);
    frame[0] = headerBytes.length >> 8;
    frame[1] = headerBytes.length & 0xff;
    frame.set(headerBytes, 2);
    frame.set(payload, 2 + headerBytes.length);

    const parsed = parseBinaryMessage(frame);
    expect(parsed.headers.Path).toBe("audio");
    expect(parsed.payload).toEqual(payload);
  });

  it("parses WordBoundary metadata into audio-relative seconds", () => {
    expect(ticksToSec(10_000_000)).toBe(1);
    const body = JSON.stringify({
      Metadata: [
        {
          Type: "WordBoundary",
          Data: {
            Offset: 1_000_000,
            Duration: 4_000_000,
            text: { Text: "Halo" },
          },
        },
        { Type: "SentenceBoundary", Data: { Offset: 0, Duration: 1 } },
        {
          Type: "WordBoundary",
          Data: {
            Offset: 6_000_000,
            Duration: 5_500_000,
            text: { Text: "dunia" },
          },
        },
      ],
    });
    expect(parseWordBoundaries(body)).toEqual([
      { word: "Halo", startSec: 0.1, endSec: 0.5 },
      { word: "dunia", startSec: 0.6, endSec: 1.15 },
    ]);
  });
});
