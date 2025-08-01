import { beforeEach, describe, expect, it, spyOn } from 'bun:test';

// Type definitions for test
interface CodeActionArgs {
  file_path: string;
  start_line: number;
  end_line?: number;
  start_character?: number;
  end_character?: number;
  include_kinds?: string[];
  only_preferred?: boolean;
  apply_action?: string;
}

// Mock implementation for LSPClient
class MockLSPClient {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getCodeActions: any = spyOn({} as any, 'getCodeActions').mockResolvedValue([]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  executeCommand: any = spyOn({} as any, 'executeCommand').mockResolvedValue({});
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  applyWorkspaceEdit: any = spyOn({} as any, 'applyWorkspaceEdit').mockResolvedValue({
    content: 'Applied edit',
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getDiagnostics: any = spyOn({} as any, 'getDiagnostics').mockResolvedValue([]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  dispose: any = spyOn({} as any, 'dispose').mockImplementation(() => {});
}

// Tool handler function similar to main index.ts
async function handleGetCodeActionsCall(args: CodeActionArgs, mockLspClient: MockLSPClient) {
  const {
    file_path,
    start_line,
    end_line,
    start_character = 0,
    end_character,
    include_kinds,
    only_preferred = false,
    apply_action,
  } = args;

  const effectiveEndLine = end_line ?? start_line;

  // Convert 1-indexed to 0-indexed positions for LSP
  const range = {
    start: {
      line: start_line - 1,
      character: Math.max(0, start_character - 1),
    },
    end: {
      line: effectiveEndLine - 1,
      character: end_character !== undefined ? Math.max(0, end_character - 1) : 999999,
    },
  };

  // Get diagnostics for the file to include in context
  const diagnostics = await mockLspClient.getDiagnostics(file_path);

  // Build code action context
  const context = {
    diagnostics,
    only: include_kinds,
  };

  const codeActions = await mockLspClient.getCodeActions(file_path, range, context);

  // Filter by preference if requested
  const filteredActions = only_preferred
    ? codeActions.filter((action: any) => 'isPreferred' in action && action.isPreferred)
    : codeActions;

  if (apply_action) {
    // Find and apply the requested action
    const actionToApply = filteredActions.find(
      (action: any) => 'title' in action && action.title === apply_action
    );

    if (!actionToApply) {
      return {
        content: [
          {
            type: 'text',
            text: `Action "${apply_action}" not found. Available actions:\n${filteredActions.map((a: any) => `• ${'title' in a ? a.title : 'Unknown action'}`).join('\n')}`,
          },
        ],
      };
    }

    // Apply the action
    if ('edit' in actionToApply && actionToApply.edit) {
      // Apply workspace edit
      const { content: editResult } = await mockLspClient.applyWorkspaceEdit(actionToApply.edit);
      return {
        content: [
          {
            type: 'text',
            text: `Applied code action: "${actionToApply.title}"\n\n${editResult}`,
          },
        ],
      };
    }
    if ('command' in actionToApply && actionToApply.command) {
      // Execute command
      const commandResult = await mockLspClient.executeCommand(actionToApply.command);
      return {
        content: [
          {
            type: 'text',
            text: `Executed code action: "${actionToApply.title}"\n\nCommand result: ${JSON.stringify(commandResult, null, 2)}`,
          },
        ],
      };
    }
  }

  if (filteredActions.length === 0) {
    return {
      content: [
        {
          type: 'text',
          text: `No code actions available for ${file_path} at line ${start_line}${effectiveEndLine !== start_line ? `-${effectiveEndLine}` : ''}.`,
        },
      ],
    };
  }

  // Format response
  let responseText = `Found ${filteredActions.length} code action${filteredActions.length === 1 ? '' : 's'} for ${file_path} at line ${start_line}${effectiveEndLine !== start_line ? `-${effectiveEndLine}` : ''}:\n\n`;

  // Group actions by kind (simplified for test)
  for (const action of filteredActions) {
    if ('title' in action) {
      responseText += `• "${action.title}"\n`;
    }
  }

  responseText +=
    '\nTo apply a specific action, include apply_action parameter with the action title.';

  return {
    content: [
      {
        type: 'text',
        text: responseText,
      },
    ],
  };
}

describe('get_code_actions tool', () => {
  let mockLspClient: MockLSPClient;

  beforeEach(() => {
    mockLspClient = new MockLSPClient();
  });

  it('should handle basic code actions request', async () => {
    // Mock some code actions
    const mockActions = [
      { title: 'Fix import', kind: 'quickfix' },
      { title: 'Extract method', kind: 'refactor.extract.method' },
    ];
    mockLspClient.getCodeActions.mockResolvedValue(mockActions);

    const result = await handleGetCodeActionsCall(
      {
        file_path: 'test.ts',
        start_line: 5,
      },
      mockLspClient
    );

    expect(mockLspClient.getCodeActions).toHaveBeenCalledWith(
      'test.ts',
      {
        start: { line: 4, character: 0 },
        end: { line: 4, character: 999999 },
      },
      {
        diagnostics: [],
        only: undefined,
      }
    );

    expect(result.content?.[0]?.text).toContain('Found 2 code actions');
    expect(result.content?.[0]?.text).toContain('Fix import');
    expect(result.content?.[0]?.text).toContain('Extract method');
  });

  it('should handle range-based code actions', async () => {
    const mockActions = [{ title: 'Extract to variable', kind: 'refactor.extract.variable' }];
    mockLspClient.getCodeActions.mockResolvedValue(mockActions);

    await handleGetCodeActionsCall(
      {
        file_path: 'test.ts',
        start_line: 5,
        end_line: 8,
        start_character: 10,
        end_character: 25,
      },
      mockLspClient
    );

    expect(mockLspClient.getCodeActions).toHaveBeenCalledWith(
      'test.ts',
      {
        start: { line: 4, character: 9 },
        end: { line: 7, character: 24 },
      },
      {
        diagnostics: [],
        only: undefined,
      }
    );
  });

  it('should filter by preferred actions only', async () => {
    const mockActions = [
      { title: 'Fix import', kind: 'quickfix', isPreferred: true },
      { title: 'Add type annotation', kind: 'quickfix', isPreferred: false },
      { title: 'Extract method', kind: 'refactor.extract.method' },
    ];
    mockLspClient.getCodeActions.mockResolvedValue(mockActions);

    const result = await handleGetCodeActionsCall(
      {
        file_path: 'test.ts',
        start_line: 5,
        only_preferred: true,
      },
      mockLspClient
    );

    expect(result.content?.[0]?.text).toContain('Found 1 code action');
    expect(result.content?.[0]?.text).toContain('Fix import');
    expect(result.content?.[0]?.text).not.toContain('Add type annotation');
    expect(result.content?.[0]?.text).not.toContain('Extract method');
  });

  it('should filter by action kinds', async () => {
    const mockActions = [
      { title: 'Fix import', kind: 'quickfix' },
      { title: 'Extract method', kind: 'refactor.extract.method' },
      { title: 'Organize imports', kind: 'source.organizeImports' },
    ];
    mockLspClient.getCodeActions.mockResolvedValue(mockActions);

    await handleGetCodeActionsCall(
      {
        file_path: 'test.ts',
        start_line: 5,
        include_kinds: ['quickfix'],
      },
      mockLspClient
    );

    expect(mockLspClient.getCodeActions).toHaveBeenCalledWith('test.ts', expect.any(Object), {
      diagnostics: [],
      only: ['quickfix'],
    });
  });

  it('should apply workspace edit action', async () => {
    const mockActions = [
      {
        title: 'Fix import',
        kind: 'quickfix',
        edit: {
          changes: {
            'file:///test.ts': [
              {
                range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
                newText: 'import React from "react";\n',
              },
            ],
          },
        },
      },
    ];
    mockLspClient.getCodeActions.mockResolvedValue(mockActions);

    const result = await handleGetCodeActionsCall(
      {
        file_path: 'test.ts',
        start_line: 5,
        apply_action: 'Fix import',
      },
      mockLspClient
    );

    expect(mockLspClient.applyWorkspaceEdit).toHaveBeenCalledWith(mockActions[0]?.edit);
    expect(result.content?.[0]?.text).toContain('Applied code action: "Fix import"');
    expect(result.content?.[0]?.text).toContain('Applied edit');
  });

  it('should execute command action', async () => {
    const mockActions = [
      {
        title: 'Restart TS Server',
        kind: 'source',
        command: {
          command: 'typescript.restartTsServer',
          title: 'Restart TS Server',
        },
      },
    ];
    mockLspClient.getCodeActions.mockResolvedValue(mockActions);
    mockLspClient.executeCommand.mockResolvedValue({ success: true });

    const result = await handleGetCodeActionsCall(
      {
        file_path: 'test.ts',
        start_line: 5,
        apply_action: 'Restart TS Server',
      },
      mockLspClient
    );

    expect(mockLspClient.executeCommand).toHaveBeenCalledWith(mockActions[0]?.command);
    expect(result.content?.[0]?.text).toContain('Executed code action: "Restart TS Server"');
    expect(result.content?.[0]?.text).toContain('"success": true');
  });

  it('should handle no code actions available', async () => {
    mockLspClient.getCodeActions.mockResolvedValue([]);

    const result = await handleGetCodeActionsCall(
      {
        file_path: 'test.ts',
        start_line: 5,
      },
      mockLspClient
    );

    expect(result.content?.[0]?.text).toContain('No code actions available');
  });

  it('should handle invalid action name', async () => {
    const mockActions = [{ title: 'Fix import', kind: 'quickfix' }];
    mockLspClient.getCodeActions.mockResolvedValue(mockActions);

    const result = await handleGetCodeActionsCall(
      {
        file_path: 'test.ts',
        start_line: 5,
        apply_action: 'Nonexistent action',
      },
      mockLspClient
    );

    expect(result.content?.[0]?.text).toContain('Action "Nonexistent action" not found');
    expect(result.content?.[0]?.text).toContain('• Fix import');
  });
});
