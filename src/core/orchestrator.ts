    // © ASICBOT Private Limited Inc
// Orchestrator — coordinates UI ↔ Planner ↔ File Tools workflow

import { PlannerClient } from './planner/plannerClient';
import { FileOperationTools } from './tools';

export interface OrchestratorConfig {
  plannerBaseUrl: string;
  maxIterations: number;
  requestTimeoutMs?: number;
  modelName?: string;
}

export interface QueryRequest {
  query: string;
  context?: string;
  maxIterations?: number;
}

export type ProgressCallback = (text: string, done: boolean) => void;

export class Orchestrator {
  private isGenerating = false;
  private abortController: AbortController | null = null;
  private planner: PlannerClient;
  private fileTools: FileOperationTools;

  private maxIterations: number;
  private currentCfg: OrchestratorConfig;

  private sanitizeStringToken(s: string): string {
    let t = s.trim();
    // drop fenced code block markers entirely
    if (t.includes('```')) {
      t = t.split('\n').filter(l => !/^```/.test(l.trim())).join('\n').trim();
    }
    // strip surrounding quotes/backticks again
    t = t.replace(/^([`'"])(.*)\1$/s, '$2').trim();
    t = t.replace(/^[`'"]+|[`'"]+$/g, '');
    return t;
  }

  /** Recursively sanitize any strings inside tool args */
  private sanitizeArgsDeep(v: unknown): unknown {
    if (typeof v === 'string') return this.sanitizeStringToken(v);
    if (Array.isArray(v)) return v.map(x => this.sanitizeArgsDeep(x));
    if (v && typeof v === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
        // sanitize keys too just in case
        const sk = this.sanitizeStringToken(String(k));
        out[sk] = this.sanitizeArgsDeep(val);
      }
      return out;
    }
    return v;
  }

  constructor(config: OrchestratorConfig, deps?: { planner?: PlannerClient; fileTools?: FileOperationTools }) {
    this.currentCfg = { ...config };
    this.maxIterations = config.maxIterations ?? 50;

    this.planner =
      deps?.planner ??
      new PlannerClient({
        baseUrl: config.plannerBaseUrl,
        timeoutMs: config.requestTimeoutMs ?? 30_000,
        modelName: config.modelName,
      });

    this.fileTools = deps?.fileTools ?? new FileOperationTools();
  }

  isCurrentlyGenerating(): boolean { return this.isGenerating; }
  stopGeneration(): void { if (this.isGenerating && this.abortController) this.abortController.abort(); }

  async processQuery(req: QueryRequest, onProgress?: ProgressCallback): Promise<string> {
    if (this.isGenerating) {
      onProgress?.('Another request is already running. Stop it or wait.', true);
      return 'Busy';
    }

    this.isGenerating = true;
    this.abortController = new AbortController();

    const iterations = req.maxIterations ?? this.maxIterations;
    let trajectory = await this.composeHeader(req.context, req.query);
    let finalResponse = '';

    try {
      for (let i = 0; i < iterations; i++) {
        this.ensureNotCancelled();

        // --- 1) THINK ---
        let thought = '';
        try {
          const think = await this.planner.think({ trajectory }, this.abortController.signal);
          thought = String(think.output ?? '');
          onProgress?.(this.pretty(`Thought #${i + 1}`, thought), false);
        } catch (e) {
          const errText = this.stepError('Think', e);
          onProgress?.(errText, false);
          // Append error to trajectory so planner can react in the next iteration
          trajectory = this.appendIterationBlock(trajectory, '(error in think)', '(skipped)', {}, errText);
          // Continue to next iteration to let planner recover
          continue;
        }

        this.ensureNotCancelled();

        // --- 2) TOOL SELECTION ---
        let selectedTool = '';
        try {
          const toolSel = await this.planner.selectTool({ trajectory }, this.abortController.signal);
          selectedTool = String(toolSel.output ?? '').trim();
          selectedTool = selectedTool.replace(/^([`'"])(.*)\1$/s, '$2').trim();
          selectedTool = this.sanitizeStringToken(selectedTool);
          onProgress?.(this.pretty('Selected Tool', selectedTool || '(none)'), false);
        } catch (e) {
          const errText = this.stepError('Tool Selection', e);
          onProgress?.(errText, false);
          trajectory = this.appendIterationBlock(trajectory, thought, '(error selecting tool)', {}, errText);
          continue;
        }

        this.ensureNotCancelled();

        // If planner decides no tool / final text-only answer
        if (!selectedTool || selectedTool.toLowerCase() === 'none') {
          const execResult = thought || 'No further action.';
          trajectory = this.appendIterationBlock(trajectory, thought, '(none)', {}, execResult);
          finalResponse = execResult;
          onProgress?.(this.pretty('Final', finalResponse), true);
          return finalResponse;
        }

        // --- 3) TOOL FORMATTER (args) ---
        let toolArgs: unknown = {};
        try {
          const toolFmt = await this.planner.formatTool(
            { tool_name: selectedTool, trajectory },
            this.abortController.signal
          );
          toolArgs = this.maybeParseJson(toolFmt.output);
          toolArgs = this.sanitizeArgsDeep(toolArgs);
          onProgress?.(this.pretty('Tool Args', toolArgs), false);
        } catch (e) {
          const errText = this.stepError('Tool Formatter', e);
          onProgress?.(errText, false);
          // Append formatter error and continue
          trajectory = this.appendIterationBlock(trajectory, thought, selectedTool, { error: true, stage: 'format', message: errText }, errText);
          continue;
        }

        // --- 4) EXECUTE TOOL ---
        let execResult = '';
        try {
          execResult = await this.fileTools.executeFileOperation(selectedTool, toolArgs);
          onProgress?.(this.pretty('Execution Result', execResult), false);
        } catch (e) {
          // executeFileOperation already tries to return strings, but if anything bubbles:
          execResult = this.stepError('Tool Execution', e);
          onProgress?.(execResult, false);
        }

        // Append one iteration block to the trajectory
        trajectory = this.appendIterationBlock(trajectory, thought, selectedTool, toolArgs, execResult);

        // Finalization check
        if (this.fileTools.isFinalResponse(selectedTool, toolArgs)) {
          finalResponse = execResult;
          onProgress?.(this.pretty('Final', finalResponse), true);
          return finalResponse || 'OK';
        }

        // Stream a friendly progress line
        onProgress?.(this.fileTools.formatProgressMessage(selectedTool, execResult, i + 1), false);
      }

      finalResponse = finalResponse || 'Maximum iterations reached without final response.';
      onProgress?.(this.pretty('Done', finalResponse), true);
      return finalResponse;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // Do NOT swallow silently — report as final line but keep consistent format
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

    if (partial.plannerBaseUrl !== undefined || partial.requestTimeoutMs !== undefined || partial.modelName !== undefined) {
      this.planner = new PlannerClient({
        baseUrl: this.currentCfg.plannerBaseUrl,
        timeoutMs: this.currentCfg.requestTimeoutMs ?? 30_000,
        modelName: this.currentCfg.modelName,
      });
    }
  }

  // ---- Trajectory formatting ----

  private async composeHeader(context: string | undefined, query: string): Promise<string> {
    const lines: string[] = [];
    
    // Always generate directory structure as context
    try {
      const workspacePath = this.fileTools.getWorkspacePath();
      const dirStructure = await this.fileTools.generateDirectoryStructure(workspacePath);
      // lines.push(`Directory Structure:\n\`\`\`markdown\n${dirStructure}\n\`\`\``);
      lines.push(`Directory Structure:\n${dirStructure}`);
    } catch (error) {
      lines.push(`Directory Structure: Error generating - ${error}`);
    }
    
    if (context && context.trim().length > 0) lines.push(`Additional Context: ${context.trim()}`);
    lines.push(`Query: ${query.trim()}`, '');
    return lines.join('\n');
  }

  private appendIterationBlock(
    trajectory: string,
    thought: string,
    selectedTool: string,
    toolArgs: unknown,
    execResult: string
  ): string {
    const block = [
      `Thought: ${thought}`,
      `Selected Tool: ${selectedTool}`,
      `Tool Args: ${this.safeString(toolArgs)}`,
      `Execution Result: ${execResult}`,
      ''
    ].join('\n');
    return trajectory + block;
  }

  // ---- Utilities ----

  private ensureNotCancelled() {
    if (this.abortController?.signal.aborted) throw new Error('Request cancelled');
  }

  private maybeParseJson(v: unknown): unknown {
    if (typeof v === 'string') {
      const s = v.trim();
      if ((s.startsWith('{') && s.endsWith('}')) || (s.startsWith('[') && s.endsWith(']'))) {
        try { return JSON.parse(s); } catch { /* ignore */ }
      }
    }
    return v;
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
    return `## ${stage} Error\n${msg}`;
  }
}
