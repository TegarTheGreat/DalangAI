/**
 * Parser SSE minimal (spec text/event-stream) — dipakai stream chat POST
 * (EventSource hanya bisa GET). Murni dan diuji unit: masukkan potongan
 * teks sembarang, keluar event utuh.
 */

export interface SseEvent {
  event: string;
  data: string;
}

export class SseParser {
  private buffer = "";
  private eventName = "";
  private dataLines: string[] = [];

  /** Proses satu chunk; kembalikan event yang selesai. */
  push(chunk: string): SseEvent[] {
    this.buffer += chunk;
    const events: SseEvent[] = [];
    for (;;) {
      const newline = this.buffer.indexOf("\n");
      if (newline < 0) break;
      let line = this.buffer.slice(0, newline);
      this.buffer = this.buffer.slice(newline + 1);
      if (line.endsWith("\r")) line = line.slice(0, -1);

      if (line === "") {
        if (this.dataLines.length > 0 || this.eventName !== "") {
          events.push({
            event: this.eventName || "message",
            data: this.dataLines.join("\n"),
          });
        }
        this.eventName = "";
        this.dataLines = [];
        continue;
      }
      if (line.startsWith(":")) continue; // komentar/heartbeat
      const colon = line.indexOf(":");
      const field = colon < 0 ? line : line.slice(0, colon);
      let value = colon < 0 ? "" : line.slice(colon + 1);
      if (value.startsWith(" ")) value = value.slice(1);
      if (field === "event") this.eventName = value;
      else if (field === "data") this.dataLines.push(value);
      // field lain (id, retry) tidak kami pakai
    }
    return events;
  }
}

/** Baca body fetch sebagai stream SSE; panggil onEvent per event utuh. */
export const readSseBody = async (
  body: ReadableStream<Uint8Array>,
  onEvent: (event: SseEvent) => void,
): Promise<void> => {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const parser = new SseParser();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    for (const event of parser.push(decoder.decode(value, { stream: true }))) {
      onEvent(event);
    }
  }
  for (const event of parser.push(`${decoder.decode()}\n\n`)) {
    onEvent(event);
  }
};
