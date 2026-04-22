import type { DaemonSessionBinding } from "./types.js";

/**
 * Minimal sidecar binding store.
 * In a real OpenClaw workspace, you should persist this alongside the OpenClaw session.
 */
export class InMemoryBindingStore {
  private bindings = new Map<string, DaemonSessionBinding>();

  get(openclawSessionId: string): DaemonSessionBinding | undefined {
    return this.bindings.get(openclawSessionId);
  }

  set(binding: DaemonSessionBinding): void {
    this.bindings.set(binding.openclawSessionId, binding);
  }

  delete(openclawSessionId: string): void {
    this.bindings.delete(openclawSessionId);
  }
}

