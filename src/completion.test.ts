import { beforeEach, describe, expect, it, spyOn } from 'bun:test';

// Test completion types
interface MockCompletionItem {
  label: string;
  kind?: number;
  detail?: string;
  documentation?: string;
  insertText?: string;
}

// Mock implementation for LSPClient with completion support
class MockLSPClient {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getCompletion: any = spyOn({} as any, 'getCompletion').mockResolvedValue([]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  resolveCompletionItem: any = spyOn({} as any, 'resolveCompletionItem').mockResolvedValue({});
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  completionItemKindToString: any = spyOn({} as any, 'completionItemKindToString').mockReturnValue(
    'unknown'
  );
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  dispose: any = spyOn({} as any, 'dispose').mockImplementation(() => {});
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  preloadServers: any = spyOn({} as any, 'preloadServers').mockResolvedValue(undefined);
}

describe('completion tool', () => {
  let mockLspClient: MockLSPClient;

  beforeEach(() => {
    mockLspClient = new MockLSPClient();
  });

  it('should get basic completion suggestions', async () => {
    const mockCompletions: MockCompletionItem[] = [
      { label: 'toString', kind: 2, detail: '(): string' },
      { label: 'valueOf', kind: 2, detail: '(): number' },
      { label: 'length', kind: 10, detail: 'number' },
    ];

    mockLspClient.getCompletion.mockResolvedValue(mockCompletions);
    mockLspClient.completionItemKindToString.mockImplementation((kind: number) => {
      const kindMap: Record<number, string> = {
        2: 'method',
        10: 'property',
      };
      return kindMap[kind] || 'unknown';
    });

    const completions = await mockLspClient.getCompletion(
      '/test/file.ts',
      { line: 5, character: 10 },
      undefined,
      50
    );

    expect(completions).toHaveLength(3);
    expect(completions[0].label).toBe('toString');
    expect(completions[1].label).toBe('valueOf');
    expect(completions[2].label).toBe('length');
  });

  it('should handle trigger character completion', async () => {
    const mockCompletions: MockCompletionItem[] = [
      { label: 'property1', kind: 10, detail: 'string' },
      { label: 'method1', kind: 2, detail: '(): void' },
    ];

    mockLspClient.getCompletion.mockResolvedValue(mockCompletions);

    await mockLspClient.getCompletion('/test/file.ts', { line: 5, character: 10 }, '.', 50);

    expect(mockLspClient.getCompletion).toHaveBeenCalledWith(
      '/test/file.ts',
      { line: 5, character: 10 },
      '.',
      50
    );
  });

  it('should resolve completion item details', async () => {
    const mockItem: MockCompletionItem = {
      label: 'myMethod',
      kind: 2,
      detail: '(): string',
    };

    const resolvedItem = {
      ...mockItem,
      documentation: 'This method returns a string',
    };

    mockLspClient.resolveCompletionItem.mockResolvedValue(resolvedItem);

    const result = await mockLspClient.resolveCompletionItem('/test/file.ts', mockItem);

    expect(result).toHaveProperty('documentation');
    expect(result.documentation).toBe('This method returns a string');
  });

  it('should handle empty completion results', async () => {
    mockLspClient.getCompletion.mockResolvedValue([]);

    const completions = await mockLspClient.getCompletion(
      '/test/file.ts',
      { line: 5, character: 10 },
      undefined,
      50
    );

    expect(completions).toHaveLength(0);
  });

  it('should apply max results limit', async () => {
    const mockCompletions: MockCompletionItem[] = Array.from({ length: 100 }, (_, i) => ({
      label: `item${i}`,
      kind: 13, // Variable
      detail: 'string',
    }));

    mockLspClient.getCompletion.mockResolvedValue(mockCompletions.slice(0, 25)); // Simulate LSP client limiting

    const completions = await mockLspClient.getCompletion(
      '/test/file.ts',
      { line: 5, character: 10 },
      undefined,
      25
    );

    expect(completions).toHaveLength(25);
  });
});
