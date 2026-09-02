import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { type ServerType, serve } from "@hono/node-server";
import { StudioHost, type StudioHostOptions } from "./host";

/**
 * Titik masuk paket server: satu port menyajikan lobi (daftar proyek) DAN
 * proyek yang sedang terbuka. Lihat host.ts untuk alasan pemisahannya.
 */

/** Folder hasil `vite build` app milik paket ini (untuk CLI `dalang studio`). */
export const studioAppDistDir = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "dist",
);

export interface StartedStudioHost {
  host: StudioHost;
  server: ServerType;
  port: number;
  url: string;
  close: () => void;
}

export const startStudioServer = (
  options: StudioHostOptions & { port?: number; hostname?: string },
): Promise<StartedStudioHost> => {
  // Alamat ikat sendiri selalu sah sebagai host (ADR-0031): mengikat ke LAN
  // dengan sengaja tidak boleh berarti server menolak dirinya sendiri.
  const host = new StudioHost({
    ...options,
    allowedHosts: [
      ...(options.allowedHosts ?? []),
      ...(options.hostname ? [options.hostname] : []),
    ],
  });
  return new Promise((resolve, reject) => {
    const server = serve(
      {
        fetch: host.app.fetch,
        port: options.port ?? 4646,
        hostname: options.hostname ?? "127.0.0.1",
      },
      (info) => {
        resolve({
          host,
          server,
          port: info.port,
          url: `http://${options.hostname ?? "127.0.0.1"}:${info.port}`,
          close: () => {
            host.close();
            server.close();
          },
        });
      },
    );
    server.on("error", reject);
  });
};

export type { CreateStudioOptions, Studio } from "./app";
export { createStudioApp } from "./app";
export type { ChatBridge, StudioContext, StudioDeps } from "./context";
export { guardDecision, hostnameOf, isLoopbackHostname, localOnlyGuard } from "./guard";
export type { StudioHostOptions } from "./host";
export { StudioHost } from "./host";
export { StudioBusyError, StudioStore } from "./store";
export {
  createProject,
  listProjects,
  projectIdOf,
  resolveEntry,
  slugify,
  type WorkspaceProject,
} from "./workspace";
