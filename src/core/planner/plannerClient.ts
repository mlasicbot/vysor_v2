// © ASICBOT Private Limited Inc
// PlannerClient — typed HTTP wrapper for planner (FastAPI) endpoints using fetch

export interface PlannerClientConfig {
  baseUrl: string;
  /** Request timeout (ms). Default: 30_000 */
  timeoutMs?: number;
  /** If provided, injected into kwargs.model on each request */
  modelName?: string;
  /** Extra kwargs included on every request (merged with per-call kwargs) */
  defaultKwargs?: Record<string, unknown>;

  retries?: number;

  retryBackoffMs?: number;
}

// FastAPI response envelope: { output: T }
export interface PlannerResponse<T = unknown> {
  output: T;
}

// Request payload shapes
export interface ThinkRequest {
  trajectory: string;
  kwargs?: Record<string, unknown>;
}
export interface ToolSelectRequest {
  trajectory: string;
  kwargs?: Record<string, unknown>;
}
export interface ToolFormatRequest {
  trajectory: string;
  tool_name: string;
  kwargs?: Record<string, unknown>;
}

export class PlannerClient {
  readonly baseUrl: string;
  readonly timeoutMs: number;
  readonly modelName?: string;
  readonly defaultKwargs?: Record<string, unknown>;
  readonly retries: number;
  readonly retryBackoffMs: number;


  constructor(cfg: PlannerClientConfig) {
    this.baseUrl = cfg.baseUrl.replace(/\/+$/, ''); // trim trailing slash
    this.timeoutMs = cfg.timeoutMs ?? 30_000;
    this.modelName = cfg.modelName;
    this.defaultKwargs = cfg.defaultKwargs;
    this.retries = Math.max(0, cfg.retries ?? 1);
    this.retryBackoffMs = Math.max(0, cfg.retryBackoffMs ?? 1500);
  }

  /** POST /think → { output: string } */
  async think(
    body: ThinkRequest,
    signal?: AbortSignal
  ): Promise<PlannerResponse<string>> {
    const payload = this.withKwargs(body);
    return this.post<PlannerResponse<string>>('/think', payload, signal);
  }

  /** POST /toolselection → { output: string } (tool name) */
  async selectTool(
    body: ToolSelectRequest,
    signal?: AbortSignal
  ): Promise<PlannerResponse<string>> {
    const payload = this.withKwargs(body);
    return this.post<PlannerResponse<string>>('/toolselection', payload, signal);
  }

  /** POST /toolformatter → { output: object|string } (tool args) */
  async formatTool(
    body: ToolFormatRequest,
    signal?: AbortSignal
  ): Promise<PlannerResponse<Record<string, unknown> | string>> {
    const payload = this.withKwargs(body);
    return this.post<PlannerResponse<Record<string, unknown> | string>>('/toolformatter', payload, signal);
  }

  // ---------- internals ----------

  private async post<T>(
    path: string,
    body: unknown,
    externalSignal?: AbortSignal
  ): Promise<T> {
        const url = this.baseUrl + path;
    const attempt = async (): Promise<T> => {
      // Compose timeout + external abort into one signal
      const controller = new AbortController();
      let timedOut = false;
      const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, this.timeoutMs);
      const onAbort = () => controller.abort();

      try {
        if (externalSignal) {
          if (externalSignal.aborted) {
            throw new Error('Request cancelled by user');
          }
          externalSignal.addEventListener('abort', onAbort, { once: true });
        }

        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
    // const url = this.baseUrl + path;

    // // Compose timeout + external abort into one signal
    // const controller = new AbortController();
    // const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    // const onAbort = () => controller.abort();

    // try {
    //   if (externalSignal) {
    //     if (externalSignal.aborted) controller.abort();
    //     else externalSignal.addEventListener('abort', onAbort, { once: true });
    //   }

    //   const res = await fetch(url, {
    //     method: 'POST',
    //     headers: { 'Content-Type': 'application/json' },
    //     body: JSON.stringify(body),
    //     signal: controller.signal,
    //   });

  //     const text = await res.text();
  //     let data: any;
  //     try {
  //       data = text ? JSON.parse(text) : {};
  //     } catch {
  //       throw new Error(`Non-JSON response from ${path}: ${text?.slice(0, 200)}`);
  //     }

  //     if (!res.ok) {
  //       // FastAPI typically returns {"detail": "..."}
  //       const detail = typeof data?.detail === 'string' ? data.detail : JSON.stringify(data);
  //       throw new Error(`Planner ${path} failed: ${detail}`);
  //     }

  //     return data as T;
  //   } catch (err: any) {
  //     if (err?.name === 'AbortError') throw new Error('Request cancelled');
  //     throw err instanceof Error ? err : new Error(String(err));
  //   } finally {
  //     clearTimeout(timeout);
  //     if (externalSignal) externalSignal.removeEventListener('abort', onAbort);
  //   }
  // }

        const text = await res.text();
        let data: any;
        try {
          data = text ? JSON.parse(text) : {};
        } catch {
          throw new Error(`Non-JSON response from ${path}: ${text?.slice(0, 200)}`);
        }

        if (!res.ok) {
          const detail = typeof data?.detail === 'string' ? data.detail : JSON.stringify(data);
          throw new Error(`Planner ${path} failed: ${detail}`);
        }
        return data as T;
      } catch (err: any) {
        if (err?.name === 'AbortError') {
          if (timedOut) throw new Error('Request timed out');
          throw new Error('Request cancelled by user');
        }
        throw err instanceof Error ? err : new Error(String(err));
      } finally {
        clearTimeout(timeout);
        if (externalSignal) externalSignal.removeEventListener('abort', onAbort);
      }
    };

    // retry loop
    let lastErr: any;
    for (let i = 0; i <= this.retries; i++) {
      try {
        return await attempt();
      } catch (e: any) {
        lastErr = e;
        const msg = String(e?.message || e);
        const transient = /timed out|ECONN|ENOTFOUND|EAI_AGAIN|ETIMEDOUT/i.test(msg);
        if (i < this.retries && transient) {
          await new Promise(r => setTimeout(r, this.retryBackoffMs * (i + 1)));
          continue;
        }
        break;
      }
    }
    throw lastErr;
   }

  /** Merge default kwargs + per-call kwargs + inject modelName as kwargs.model */
  private withKwargs<T extends { kwargs?: Record<string, unknown> }>(body: T): T {
    const mergedKwargs = {
      ...(this.defaultKwargs ?? {}),
      ...(body.kwargs ?? {}),
      ...(this.modelName ? { model: this.modelName } : {}),
    };
    return { ...(body as any), kwargs: mergedKwargs };
  }
}
