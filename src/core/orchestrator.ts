// © ASICBOT Private Limited Inc
// Orchestrator — coordinates UI ↔ Planner ↔ File Tools workflow (strict per-hop trajectory)

import { PlannerClient } from './planner/plannerClient';
import { FileOperationTools } from './tools';
import * as util from 'util';

export interface OrchestratorConfig {
  plannerBaseUrl: string;
  maxIterations: number;
  requestTimeoutMs?: number;
  modelName?: string;
  networkRetries?: number;
  networkRetryBackoffMs?: number;
}

export interface QueryRequest {
  query: string;
  context?: string;
  maxIterations?: number;
  hopIndex?: number; // (unused in this version; hop numbers are internal)
}

export type ProgressCallback = (text: string, done?: boolean) => void;

export class Orchestrator {
  private raw(x: unknown): string {
    try {
      return JSON.stringify(x, (_k, v) => (typeof v === 'bigint' ? v.toString() : v), 2);
    } catch {
      return util.inspect(x, { depth: null, colors: false, maxArrayLength: null });
    }
  }

  private isGenerating = false;
  private abortController: AbortController | null = null;
  private planner: PlannerClient;
  private fileTools: FileOperationTools;

  private maxIterations: number;
  private currentCfg: OrchestratorConfig;

  constructor(config: OrchestratorConfig, deps?: { planner?: PlannerClient; fileTools?: FileOperationTools }) {
    this.currentCfg = { ...config };
    this.maxIterations = config.maxIterations ?? 50;

    this.planner =
      deps?.planner ??
      new PlannerClient({
        baseUrl: config.plannerBaseUrl,
        timeoutMs: config.requestTimeoutMs ?? 120_000,
        retries: config.networkRetries ?? 1,
        retryBackoffMs: config.networkRetryBackoffMs ?? 1500,
        modelName: config.modelName,
      });

    this.fileTools = deps?.fileTools ?? new FileOperationTools();
  }

  isCurrentlyGenerating(): boolean { return this.isGenerating; }
  stopGeneration(): void { if (this.isGenerating && this.abortController) this.abortController.abort(); }

  async generateInlineCompletion(
    before: string,
    after: string,
    languageId: string,
    signal?: AbortSignal
  ): Promise<string> {
    // Compose a compact trajectory/prompt tailored for completions.
    // Keep it short for low-latency: only send last ~1000 chars before cursor.
    const maxBefore = 1024;
    const ctxBefore = before.length > maxBefore ? before.slice(-maxBefore) : before;
    const ctxAfter = (after || '').slice(0, 512);

    const prompt = [
      '### TASK: Provide a concise inline completion for the code at the cursor.',
      `### LANGUAGE: ${languageId}`,
      '### CONTEXT BEFORE:',
      ctxBefore,
      '### CONTEXT AFTER:',
      ctxAfter,
      '### INSTRUCTIONS: Return only the text that should be inserted at the cursor (no surrounding commentary). Prefer minimal, syntactically correct completions. Do not repeat existing text before the cursor.'
    ].join('\n');

    try {
      const resp = await this.planner.think({ trajectory: prompt }, signal);
      const out = this.out<string>(resp) ?? '';
      // Post-process: trim leading whitespace equal to what cursor already has, return first plausible completion
      const completion = String(out).trim();
      // Optionally strip code fences or markers
      return completion.replace(/^```(?:\w+)?\n?/, '').replace(/```$/, '').trim();
    } catch (e) {
      // On error, return empty string (quiet failure; provider will show nothing)
      return '';
    }
  }

  async processQuery(req: QueryRequest, onProgress?: ProgressCallback): Promise<string> {
    if (this.isGenerating) {
      onProgress?.('Another request is already running. Stop it or wait.', true);
      return 'Busy';
    }

    this.isGenerating = true;
    this.abortController = new AbortController();

    const iterations = req.maxIterations ?? this.maxIterations;

    // Trajectory we send to the planner (composed of completed/ongoing HOP blocks)
    let trajectory = '';

    const miscOnce = this.buildMiscBlock(req.context);

    let finalResponse = '';
    let consecutiveTimeouts = 0;
    let hopNo = 0;

    try {
      for (let i = 0; i < iterations; i++) {
        this.ensureNotCancelled();

        // ---------- Start a new hop with QUERY + CONTEXT ----------
        hopNo++;
        const dirPre = await this.safeDirTree();
        const hopStart = this.startHop(hopNo, req.query, dirPre, hopNo === 1 ? miscOnce : '');
        trajectory += hopStart;
        // Emit hop header (and initial context) to TRACE so UI can segment hops
        onProgress?.(hopStart, false);

        // ---------- 1) THINK ----------
        let thought = '';
        try {
          const thinkResp = await this.planner.think({ trajectory }, this.abortController.signal);
          thought = String(this.out<string>(thinkResp) ?? '');
          // Append to trajectory (typed block)
          trajectory += this.block('THOUGHTS', thought);
          // Stream minimal line for compressed view
          onProgress?.(this.pretty(`Thought #${i + 1}`, thought), false);
        } catch (e) {
          if (/(timed out)/i.test(String(e))) consecutiveTimeouts++;
          const errText = this.stepError('Think', e);
          onProgress?.(errText, false);

          // Close hop with placeholders + error as execution result
          trajectory += this.block('THOUGHTS', '(error in think)');
          trajectory += this.block('TOOL SELECTION', '(none)');
          trajectory += this.block('TOOL ARGUMENTS', {});
          trajectory += this.block('TOOL EXECUTION RESULT', errText);
          trajectory += '<<<END HOP>>>\n';

          // Make sure mini-HUD shows a Result line too
          onProgress?.(this.pretty('Execution Result', errText), false);

          if (consecutiveTimeouts >= 2) {
            finalResponse = 'Planner timed out repeatedly. Increase "vysor.requestTimeoutMs" (e.g., 120000) or try a smaller step.';
            onProgress?.(this.pretty('Final', finalResponse), true);
            return finalResponse;
          } else {
            continue;
          }
        }

        this.ensureNotCancelled();

        // ---------- 2) TOOL SELECTION ----------
        let selectedTool = '';
        try {
          const selResp = await this.planner.selectTool({ trajectory }, this.abortController.signal);
          selectedTool = String(this.out<string>(selResp) ?? '').trim();
          trajectory += this.block('TOOL SELECTION', selectedTool || '(none)');
          onProgress?.(this.pretty('Selected Tool', selectedTool || '(none)'), false);
        } catch (e) {
          const errText = this.stepError('Tool Selection', e);
          onProgress?.(errText, false);

          trajectory += this.block('TOOL SELECTION', '(error)');
          trajectory += this.block('TOOL ARGUMENTS', {});
          trajectory += this.block('TOOL EXECUTION RESULT', errText);
          trajectory += '<<<END HOP>>>\n';
          onProgress?.(this.pretty('Execution Result', errText), false);
          continue;
        }

        this.ensureNotCancelled();

        // ---------- 3) TOOL FORMATTER ----------
        let formatterOut: any = {};
        try {
          const fmtResp = await this.planner.formatTool(
            { tool_name: selectedTool, trajectory },
            this.abortController.signal
          );
          formatterOut = this.out<Record<string, unknown> | string>(fmtResp) ?? {};
          trajectory += this.block('TOOL ARGUMENTS', formatterOut);
          onProgress?.(this.pretty('Tool Args', formatterOut), false);

          // Terminal tools return final text directly via formatter (simple_query / final_answer)
          const finalFromFormatter = this.pickFinalText(selectedTool, formatterOut);
          if (finalFromFormatter && finalFromFormatter.trim()) {
            // Treat as execution result for this hop, then END HOP and finalize
            trajectory += this.block('TOOL EXECUTION RESULT', finalFromFormatter);
            trajectory += '<<<END HOP>>>\n';

            onProgress?.(this.pretty('Execution Result', finalFromFormatter), false);
            onProgress?.(this.pretty('Final', finalFromFormatter), true);
            return finalFromFormatter;
          }
        } catch (e) {
          const errText = this.stepError('Tool Formatter', e);
          onProgress?.(errText, false);

          trajectory += this.block('TOOL ARGUMENTS', { error: true, stage: 'format' });
          trajectory += this.block('TOOL EXECUTION RESULT', errText);
          trajectory += '<<<END HOP>>>\n';
          onProgress?.(this.pretty('Execution Result', errText), false);
          continue;
        }

        this.ensureNotCancelled();

        // ---------- 4) EXECUTE TOOL (VS Code / FS side) ----------
        let execResult = '';
        try {
          execResult = await this.fileTools.executeFileOperation(selectedTool, formatterOut);
          onProgress?.(this.pretty('Execution Result', execResult), false);
        } catch (e) {
          execResult = this.stepError('Tool Execution', e);
          onProgress?.(execResult, false);
        }

        // Append EXECUTION RESULT then close hop
        trajectory += this.block('TOOL EXECUTION RESULT', execResult);
        trajectory += '<<<END HOP>>>\n';

        // If this non-reasoning tool still yielded a final user-facing response, finalize.
        if (this.fileTools.isFinalResponse(selectedTool, formatterOut)) {
          finalResponse = execResult || 'OK';
          onProgress?.(this.pretty('Final', finalResponse), true);
          return finalResponse;
        }

        onProgress?.(this.fileTools.formatProgressMessage(selectedTool, execResult, i + 1), false);
      }

      finalResponse = finalResponse || 'Maximum iterations reached without final response.';
      onProgress?.(this.pretty('Done', finalResponse), true);
      return finalResponse;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const isAbort = /AbortError|cancelled|canceled/i.test(msg);
      if (isAbort) {
        onProgress?.('## Stopped\nUser requested stop.');
        throw err instanceof Error ? err : new Error('Request cancelled');
      }
      onProgress?.(this.stepError('Unhandled', msg), true);
      return `Error: ${msg}`;
    } finally {
      this.isGenerating = false;
      this.abortController = null;
    }
  }

  updateConfig(partial: Partial<OrchestratorConfig>) {
    this.currentCfg = { ...this.currentCfg, ...partial };
    if (typeof partial.maxIterations === 'number') this.maxIterations = partial.maxIterations;

    if (
      partial.plannerBaseUrl !== undefined ||
      partial.requestTimeoutMs !== undefined ||
      partial.modelName !== undefined ||
      partial.networkRetries !== undefined ||
      partial.networkRetryBackoffMs !== undefined
    ) {
      this.planner = new PlannerClient({
        baseUrl: this.currentCfg.plannerBaseUrl,
        timeoutMs: this.currentCfg.requestTimeoutMs ?? 120_000,
        modelName: this.currentCfg.modelName,
        retries: this.currentCfg.networkRetries ?? 1,
        retryBackoffMs: this.currentCfg.networkRetryBackoffMs ?? 1500,
      });
    }
  }

  // ---- Minimal helpers ----

  private out<T>(resp: any): T {
    return (resp && typeof resp === 'object' && 'output' in resp)
      ? (resp as any).output as T
      : (resp as T);
  }

  /** Extract end-user text for terminal tools from formatter payload. */
  private pickFinalText(tool: string, args: any): string {
    const t = (tool || '').toLowerCase();
    if (t === 'simple_query') return String(args?.answer ?? '');
    if (t === 'final_answer') return String(args?.final_answer ?? '');
    return '';
  }

  private ensureNotCancelled() {
    if (this.abortController?.signal.aborted) throw new Error('Request cancelled');
  }

  private safeString(v: unknown): string {
    try { return typeof v === 'string' ? v : JSON.stringify(v); }
    catch { return String(v); }
  }

  private pretty(title: string, body: unknown): string {
    const text = typeof body === 'string' ? body : this.safeString(body);
    return `## ${title}\n${text}`;
  }

  private stepError(stage: string, err: unknown): string {
    const msg = err instanceof Error ? err.message : String(err);
    if (/timed out/i.test(msg)) {
      return `## ${stage} Timeout\nPlanner call exceeded timeout. You can increase "vysor.requestTimeoutMs" in Settings or try again.`;
    }
    if (/cancelled by user/i.test(msg)) {
      return `## ${stage}\nStopped by user.`;
    }
    return `## ${stage} Error\n${msg}`;
  }

  // ---- Directory tree (safe) ----
  private async safeDirTree(): Promise<string> {
    try {
      const ws = this.fileTools.getWorkspacePath();
      return (await this.fileTools.generateDirectoryStructure(ws)).trimEnd();
    } catch (e) {
      return `<<error generating workspace tree: ${String(e)}>>`;
    }
  }

  // ---- Blocks for the strict trajectory ----

  private buildMiscBlock(context?: string): string {
    const ctx = (context || '').trim();
    if (!ctx) return '';
    // Pass-through typed DOC/CODE blocks if provided
    return ['<<<CONTEXT:MISC>>>', ctx, '<<<END CONTEXT:MISC>>>'].join('\n');
  }

  private startHop(hopNo: number, query: string, dirTree: string, miscBlock?: string): string {
    return [
      `<<<HOP #${hopNo}>>>`,
      `<<<QUERY>>>${(query || '').trim()}<<<END QUERY>>>`,
      `<<<CONTEXT:DIR name="workspace">>`,
      dirTree.trimEnd(),
      `<<<END CONTEXT:DIR>>>`,
      miscBlock ? miscBlock : '',
      ''
    ].filter(Boolean).join('\n');
  }

  private block(tag: 'THOUGHTS' | 'TOOL SELECTION' | 'TOOL ARGUMENTS' | 'TOOL EXECUTION RESULT', body: unknown): string {
    const text = typeof body === 'string' ? body : this.raw(body);
    return [`<<<${tag}>>>`, text, `<<<END ${tag}>>>`, ''].join('\n');
  }
}
