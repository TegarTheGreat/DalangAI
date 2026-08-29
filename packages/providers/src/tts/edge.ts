import { createHash, randomUUID } from "node:crypto";
import type { WordTimestamp } from "@dalang/core";
import type { TtsProvider, TtsRequest } from "@dalang/pipeline";

/**
 * Microsoft Edge "Read Aloud" TTS — the free fallback per PRD §4.2. Speaks
 * Indonesian (id-ID-ArdiNeural / id-ID-GadisNeural) and emits native
 * WordBoundary events → word timestamps without forced alignment (R-3).
 *
 * Implements the public Edge websocket protocol (as used by the browser and
 * the edge-tts ecosystem). All protocol pieces are pure functions with unit
 * tests; the socket itself is injectable. NOTE: live behavior could not be
 * verified in the sandboxed dev environment (egress blocked) — see ADR-0007.
 */

export const EDGE_TRUSTED_CLIENT_TOKEN = "6A5AA1D4EAFF4E9FB37E23D68491D6F4";
const EDGE_CHROMIUM_VERSION = "131.0.2903.99";
const EDGE_WSS_BASE =
  "wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1";
export const EDGE_OUTPUT_FORMAT = "audio-24khz-48kbitrate-mono-mp3";

const DEFAULT_VOICE_BY_LANGUAGE: Record<string, string> = {
  id: "id-ID-ArdiNeural",
  en: "en-US-AriaNeural",
};

const WINDOWS_EPOCH_OFFSET_SEC = 11_644_473_600n;

/** Sec-MS-GEC DRM token: SHA-256 of (Windows ticks floored to 5 min + token). */
export const secMsGec = (now: Date = new Date()): string => {
  const unixSec = BigInt(Math.floor(now.getTime() / 1000));
  const windowsSec = unixSec + WINDOWS_EPOCH_OFFSET_SEC;
  const rounded = windowsSec - (windowsSec % 300n);
  const ticks = rounded * 10_000_000n;
  return createHash("sha256")
    .update(`${ticks}${EDGE_TRUSTED_CLIENT_TOKEN}`)
    .digest("hex")
    .toUpperCase();
};

export const edgeConnectionUrl = (now: Date = new Date()): string =>
  `${EDGE_WSS_BASE}?TrustedClientToken=${EDGE_TRUSTED_CLIENT_TOKEN}` +
  `&Sec-MS-GEC=${secMsGec(now)}&Sec-MS-GEC-Version=1-${EDGE_CHROMIUM_VERSION}` +
  `&ConnectionId=${randomUUID().replaceAll("-", "")}`;

/** Use the requested voice when it is an Azure voice name; else the language default. */
export const resolveEdgeVoice = (voiceId: string, language: string): string =>
  /^[a-z]{2,3}-[A-Z]{2}(-[A-Za-z]+)?-\w+Neural$/.test(voiceId)
    ? voiceId
    : (DEFAULT_VOICE_BY_LANGUAGE[language] ?? DEFAULT_VOICE_BY_LANGUAGE.en!);

export const escapeXml = (text: string): string =>
  text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");

export const buildSsml = (request: TtsRequest): string => {
  const voice = resolveEdgeVoice(request.voiceId, request.language);
  const ratePercent = Math.round((request.speed - 1) * 100);
  const rate = `${ratePercent >= 0 ? "+" : ""}${ratePercent}%`;
  return (
    `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='${request.language}'>` +
    `<voice name='${voice}'>` +
    `<prosody pitch='+0Hz' rate='${rate}' volume='+0%'>${escapeXml(request.text)}</prosody>` +
    `</voice></speak>`
  );
};

export const buildSpeechConfigMessage = (timestamp: string): string =>
  `X-Timestamp:${timestamp}\r\nContent-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n` +
  JSON.stringify({
    context: {
      synthesis: {
        audio: {
          metadataoptions: {
            sentenceBoundaryEnabled: false,
            wordBoundaryEnabled: true,
          },
          outputFormat: EDGE_OUTPUT_FORMAT,
        },
      },
    },
  });

export const buildSsmlMessage = (
  requestId: string,
  timestamp: string,
  ssml: string,
): string =>
  `X-RequestId:${requestId}\r\nContent-Type:application/ssml+xml\r\n` +
  `X-Timestamp:${timestamp}\r\nPath:ssml\r\n\r\n${ssml}`;

export interface EdgeTextMessage {
  headers: Record<string, string>;
  body: string;
}

export const parseTextMessage = (message: string): EdgeTextMessage => {
  const separator = message.indexOf("\r\n\r\n");
  const headerBlock = separator >= 0 ? message.slice(0, separator) : message;
  const body = separator >= 0 ? message.slice(separator + 4) : "";
  const headers: Record<string, string> = {};
  for (const line of headerBlock.split("\r\n")) {
    const colon = line.indexOf(":");
    if (colon > 0) headers[line.slice(0, colon)] = line.slice(colon + 1);
  }
  return { headers, body };
};

/** Binary frames: 2-byte big-endian header length, header text, then payload. */
export const parseBinaryMessage = (
  frame: Uint8Array,
): { headers: Record<string, string>; payload: Uint8Array } => {
  const headerLength = (frame[0]! << 8) | frame[1]!;
  const headerText = new TextDecoder().decode(frame.slice(2, 2 + headerLength));
  return {
    headers: parseTextMessage(headerText).headers,
    payload: frame.slice(2 + headerLength),
  };
};

export const ticksToSec = (ticks: number): number =>
  Number((ticks / 10_000_000).toFixed(3));

interface EdgeMetadata {
  Metadata?: Array<{
    Type: string;
    Data: {
      Offset: number;
      Duration: number;
      text?: { Text?: string };
    };
  }>;
}

export const parseWordBoundaries = (body: string): WordTimestamp[] => {
  const json = JSON.parse(body) as EdgeMetadata;
  const words: WordTimestamp[] = [];
  for (const item of json.Metadata ?? []) {
    if (item.Type !== "WordBoundary") continue;
    const word = item.Data.text?.Text ?? "";
    if (!word) continue;
    words.push({
      word,
      startSec: ticksToSec(item.Data.Offset),
      endSec: ticksToSec(item.Data.Offset + item.Data.Duration),
    });
  }
  return words;
};

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

type WebSocketCtor = new (url: string) => WebSocket;

export interface EdgeTtsOptions {
  webSocketImpl?: WebSocketCtor;
  clock?: () => Date;
  timeoutMs?: number;
}

export const createEdgeTts = ({
  webSocketImpl,
  clock = () => new Date(),
  timeoutMs = 30_000,
}: EdgeTtsOptions = {}): TtsProvider => ({
  id: "edge",
  label: "Edge TTS (gratis)",
  placeholderQuality: false,
  synthesize: (request) =>
    new Promise((resolve, reject) => {
      const WS = webSocketImpl ?? (globalThis.WebSocket as WebSocketCtor);
      if (!WS) {
        reject(new Error("WebSocket tidak tersedia di runtime ini"));
        return;
      }

      const socket = new WS(edgeConnectionUrl(clock()));
      socket.binaryType = "arraybuffer";
      const requestId = randomUUID().replaceAll("-", "");
      const audioChunks: Uint8Array[] = [];
      const words: WordTimestamp[] = [];
      let settled = false;

      const timer = setTimeout(() => {
        fail(new Error(`Edge TTS timeout setelah ${timeoutMs}ms`));
      }, timeoutMs);

      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        socket.close();
        if (audioChunks.length === 0) {
          reject(new Error("Edge TTS tidak mengirimkan audio"));
          return;
        }
        const totalBytes = audioChunks.reduce((sum, c) => sum + c.byteLength, 0);
        const audio = new Uint8Array(totalBytes);
        let offset = 0;
        for (const chunk of audioChunks) {
          audio.set(chunk, offset);
          offset += chunk.byteLength;
        }
        const lastEnd = words.at(-1)?.endSec ?? 0;
        resolve({
          audio,
          format: "mp3",
          // MP3 length is not decoded here; last boundary + tail padding is a
          // close upper bound (calibrate against real audio in R-2 eval).
          durationSec: Number((lastEnd + 0.4).toFixed(3)),
          wordTimestamps: words,
          timestampsSource: "native",
          costUsd: 0,
        });
      };

      const fail = (error: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        try {
          socket.close();
        } catch {
          // ignore
        }
        reject(error);
      };

      socket.onopen = () => {
        const timestamp = clock().toUTCString();
        socket.send(buildSpeechConfigMessage(timestamp));
        socket.send(buildSsmlMessage(requestId, timestamp, buildSsml(request)));
      };

      socket.onmessage = (event: MessageEvent) => {
        if (typeof event.data === "string") {
          const { headers, body } = parseTextMessage(event.data);
          if (headers.Path === "audio.metadata") {
            try {
              words.push(...parseWordBoundaries(body));
            } catch {
              // metadata parse failure is non-fatal; captions fall back to estimates
            }
          } else if (headers.Path === "turn.end") {
            finish();
          }
          return;
        }
        const frame = new Uint8Array(event.data as ArrayBuffer);
        const { headers, payload } = parseBinaryMessage(frame);
        if (headers.Path === "audio" && payload.byteLength > 0) {
          audioChunks.push(payload);
        }
      };

      socket.onerror = () => fail(new Error("Koneksi Edge TTS gagal"));
      socket.onclose = () => {
        if (!settled && audioChunks.length > 0) finish();
        else fail(new Error("Koneksi Edge TTS ditutup sebelum selesai"));
      };
    }),
});
