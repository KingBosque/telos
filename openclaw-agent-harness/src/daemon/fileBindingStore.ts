import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { DaemonSessionBinding } from "./types.js";

export class FileBindingStore {
  private path: string;

  constructor(opts?: { runsDir?: string; filename?: string }) {
    const runsDir = opts?.runsDir ?? join(process.cwd(), "runs");
    mkdirSync(runsDir, { recursive: true });
    this.path = join(runsDir, opts?.filename ?? "bindings.json");
    mkdirSync(dirname(this.path), { recursive: true });
  }

  get(openclawSessionId: string): DaemonSessionBinding | undefined {
    const all = this.readAll();
    return all[openclawSessionId];
  }

  set(binding: DaemonSessionBinding): void {
    const all = this.readAll();
    all[binding.openclawSessionId] = binding;
    this.writeAll(all);
  }

  delete(openclawSessionId: string): void {
    const all = this.readAll();
    delete all[openclawSessionId];
    this.writeAll(all);
  }

  private readAll(): Record<string, DaemonSessionBinding> {
    try {
      const raw = readFileSync(this.path, "utf8").trim();
      if (!raw) return {};
      const parsed = JSON.parse(raw) as Record<string, DaemonSessionBinding>;
      if (!parsed || typeof parsed !== "object") return {};
      return parsed;
    } catch {
      return {};
    }
  }

  private writeAll(all: Record<string, DaemonSessionBinding>): void {
    writeFileSync(this.path, JSON.stringify(all, null, 2) + "\n", { encoding: "utf8" });
  }
}

