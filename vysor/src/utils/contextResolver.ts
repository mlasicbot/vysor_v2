import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

export async function resolveContextFromInput(input: string): Promise<{ input: string, context: string[] }> {
  const contextFiles: string[] = [];

  const matches = [...input.matchAll(/@([^\s]+)/g)];

  if (!vscode.workspace.workspaceFolders) {
    vscode.window.showWarningMessage('Workspace not found.');
    return { input, context: [] };
  }

  const workspaceRoot = vscode.workspace.workspaceFolders[0].uri.fsPath;
  console.log(`Workspace root: ${workspaceRoot}`);

  for (const match of matches) {
    const filePath = match[1];
    console.log(`Looking for file: ${filePath}`);
    
    let fullPath: string;
    
    // Handle absolute paths
    if (path.isAbsolute(filePath)) {
      fullPath = filePath;
      console.log(`Absolute path detected: ${fullPath}`);
    } else {
      // Handle relative paths from workspace root
      fullPath = path.join(workspaceRoot, filePath);
      console.log(`Relative path resolved to: ${fullPath}`);
    }

    if (fs.existsSync(fullPath)) {
      console.log(`File found: ${fullPath}`);
      const stat = fs.statSync(fullPath);

      if (stat.isFile()) {
        const ext = path.extname(fullPath).toLowerCase();
        if (['.png', '.jpg', '.jpeg'].includes(ext)) {
          const buffer = fs.readFileSync(fullPath);
          const base64 = buffer.toString('base64');
          contextFiles.push(`[Image: ${filePath}] data:image/${ext.slice(1)};base64,${base64}`);
        } else {
          const content = fs.readFileSync(fullPath, 'utf-8');
          contextFiles.push(`[File: ${filePath}]\n${content}`);
        }
      }

      if (stat.isDirectory()) {
        const filePaths = getAllFilesInDirectory(fullPath);
        for (const filePath of filePaths) {
          const content = fs.readFileSync(filePath, 'utf-8');
          const relPath = path.relative(workspaceRoot, filePath);
          contextFiles.push(`[File: ${relPath}]\n${content}`);
        }
      }
    } else {
      console.log(`File not found: ${fullPath}`);
      // Try to suggest alternative paths
      const workspaceFiles = getAllFilesInDirectory(workspaceRoot);
      const matchingFiles = workspaceFiles.filter(f => 
        f.toLowerCase().includes(filePath.toLowerCase().split('/').pop() || '')
      );
      if (matchingFiles.length > 0) {
        console.log(`Suggestions for similar files: ${matchingFiles.slice(0, 3).join(', ')}`);
      }
    }
  }

  // Strip @... mentions from input
  const cleanedInput = input.replace(/@([^\s]+)/g, '').trim();

  return { input: cleanedInput, context: contextFiles };
}

function getAllFilesInDirectory(dirPath: string): string[] {
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });

  const files = entries.flatMap((entry) => {
    const fullPath = path.join(dirPath, entry.name);
    return entry.isDirectory()
      ? getAllFilesInDirectory(fullPath)
      : [fullPath];
  });

  return files;
}
