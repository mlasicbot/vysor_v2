// © ASICBOT Private Limited Inc
// ConfigManager — reads Vysor settings from VS Code configuration

import * as vscode from 'vscode';

export interface VysorConfig {
  // Planner / AI
  plannerBaseUrl: string;
  maxIterations: number;
  requestTimeoutMs: number;
  modelName: string;

  // UI
  showProgressInChat: boolean;
  autoScrollChat: boolean;

  // Hardware-oriented defaults
  hdlDefaultLanguage: 'verilog' | 'vhdl' | 'systemverilog';
  generateTestbench: boolean;
  simulationTool: string;

  // File operation controls
  allowFileWrites: boolean;
  workspaceRootOnly: boolean;
}

export class ConfigManager {
  private static instance: ConfigManager;

  private constructor() {}

  static getInstance(): ConfigManager {
    if (!ConfigManager.instance) {
      ConfigManager.instance = new ConfigManager();
    }
    return ConfigManager.instance;
  }

  getConfig(): VysorConfig {
    const c = vscode.workspace.getConfiguration('vysor');

    return {
      // Planner / AI
      plannerBaseUrl: c.get<string>('plannerBaseUrl', 'http://localhost:8000'),
      maxIterations: c.get<number>('maxIterations', 50),
      requestTimeoutMs: c.get<number>('requestTimeoutMs', 30000),
      modelName: c.get<string>('modelName', 'default-model'),

      // UI
      showProgressInChat: c.get<boolean>('showProgressInChat', true),
      autoScrollChat: c.get<boolean>('autoScrollChat', true),

      // Hardware-oriented defaults
      hdlDefaultLanguage: c.get<'verilog' | 'vhdl' | 'systemverilog'>('hdlDefaultLanguage', 'verilog'),
      generateTestbench: c.get<boolean>('generateTestbench', false),
      simulationTool: c.get<string>('simulationTool', 'iverilog'),

      // File operation controls
      allowFileWrites: c.get<boolean>('allowFileWrites', true),
      workspaceRootOnly: c.get<boolean>('workspaceRootOnly', true),
    };
  }
}