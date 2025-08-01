import { beforeEach, describe, expect, it, spyOn } from 'bun:test';

// Type definitions for test
interface GetHoverArgs {
  file_path: string;
  line: number;
  character: number;
  symbol_name?: string;
}

interface MockHover {
  contents:
    | string
    | { kind: string; value: string }
    | Array<string | { kind: string; value: string }>;
  range?: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
}

// Mock implementation for LSPClient
class MockLSPClient {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getHover: any = spyOn({} as any, 'getHover').mockResolvedValue(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  dispose: any = spyOn({} as any, 'dispose').mockImplementation(() => {});
}

// Mock the actual handler function
async function handleGetHover(args: GetHoverArgs, mockClient: MockLSPClient) {
  const { file_path, line, character, symbol_name } = args;

  try {
    // Try multiple position combinations for better symbol resolution
    const positions = [
      { line: line - 1, character: character - 1 }, // Both adjusted by -1
      { line: line, character: character - 1 }, // Only character adjusted by -1
      { line: line - 1, character: character }, // Only line adjusted by -1
      { line: line, character: character }, // Original position
    ];

    let hoverResult = null;
    let successfulPosition = null;

    for (const position of positions) {
      try {
        const result = await mockClient.getHover(file_path, position);
        if (result && 'contents' in result) {
          hoverResult = result;
          successfulPosition = position;
          break;
        }
      } catch (positionError) {}
    }

    if (!hoverResult) {
      return {
        content: [
          {
            type: 'text',
            text: `No hover information available for position ${line}:${character} in ${file_path}${symbol_name ? ` (searching for symbol: ${symbol_name})` : ''}`,
          },
        ],
      };
    }

    // Format hover contents
    let formattedContent = '';
    const { contents } = hoverResult;

    if (typeof contents === 'string') {
      formattedContent = contents;
    } else if (Array.isArray(contents)) {
      formattedContent = contents
        .map((item) => {
          if (typeof item === 'string') {
            return item;
          }
          if (typeof item === 'object' && item !== null && 'value' in item) {
            return (item as { value: string }).value;
          }
          return '';
        })
        .filter(Boolean)
        .join('\n\n');
    } else if (typeof contents === 'object' && contents !== null && 'value' in contents) {
      formattedContent = (contents as { value: string }).value;
    }

    // Include position information if successful position differs from requested
    const positionInfo =
      successfulPosition &&
      (successfulPosition.line !== line - 1 || successfulPosition.character !== character - 1)
        ? `\n\n(Found at position ${successfulPosition.line + 1}:${successfulPosition.character + 1})`
        : '';

    const responseText = `Hover information for ${file_path} at line ${line}, character ${character}:\n\n${formattedContent}${positionInfo}`;

    return {
      content: [
        {
          type: 'text',
          text: responseText,
        },
      ],
    };
  } catch (error) {
    return {
      content: [
        {
          type: 'text',
          text: `Error getting hover information: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
    };
  }
}

describe('get_hover tool', () => {
  let mockClient: MockLSPClient;

  beforeEach(() => {
    mockClient = new MockLSPClient();
  });

  it('should return hover information for string contents', async () => {
    const mockHoverResult: MockHover = {
      contents: 'function test(): void',
    };

    mockClient.getHover.mockResolvedValue(mockHoverResult);

    const result = await handleGetHover(
      {
        file_path: 'test.ts',
        line: 10,
        character: 5,
      },
      mockClient
    );

    expect(result.content?.[0]?.text).toContain(
      'Hover information for test.ts at line 10, character 5:'
    );
    expect(result.content?.[0]?.text).toContain('function test(): void');
  });

  it('should return hover information for MarkupContent', async () => {
    const mockHoverResult: MockHover = {
      contents: {
        kind: 'markdown',
        value: '**function** `test(): void`\n\nA test function',
      },
    };

    mockClient.getHover.mockResolvedValue(mockHoverResult);

    const result = await handleGetHover(
      {
        file_path: 'test.ts',
        line: 15,
        character: 10,
      },
      mockClient
    );

    expect(result.content?.[0]?.text).toContain(
      'Hover information for test.ts at line 15, character 10:'
    );
    expect(result.content?.[0]?.text).toContain('**function** `test(): void`');
    expect(result.content?.[0]?.text).toContain('A test function');
  });

  it('should return hover information for array contents', async () => {
    const mockHoverResult: MockHover = {
      contents: [
        'function test(): void',
        { kind: 'markdown', value: 'Documentation for test function' },
      ],
    };

    mockClient.getHover.mockResolvedValue(mockHoverResult);

    const result = await handleGetHover(
      {
        file_path: 'test.ts',
        line: 20,
        character: 15,
      },
      mockClient
    );

    expect(result.content?.[0]?.text).toContain('function test(): void');
    expect(result.content?.[0]?.text).toContain('Documentation for test function');
    expect(result.content?.[0]?.text.split('\n\n')).toHaveLength(3); // Header + 2 content items
  });

  it('should try multiple positions and use successful one', async () => {
    // First three positions return null, fourth one succeeds
    mockClient.getHover
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ contents: 'function found(): void' });

    const result = await handleGetHover(
      {
        file_path: 'test.ts',
        line: 5,
        character: 8,
      },
      mockClient
    );

    expect(result.content?.[0]?.text).toContain('function found(): void');
    expect(result.content?.[0]?.text).toContain('(Found at position 6:9)');
    expect(mockClient.getHover).toHaveBeenCalledTimes(4);
  });

  it('should return error message when no hover information is available', async () => {
    mockClient.getHover.mockResolvedValue(null);

    const result = await handleGetHover(
      {
        file_path: 'test.ts',
        line: 100,
        character: 50,
      },
      mockClient
    );

    expect(result.content?.[0]?.text).toBe(
      'No hover information available for position 100:50 in test.ts'
    );
  });

  it('should include symbol name in error message when provided', async () => {
    mockClient.getHover.mockResolvedValue(null);

    const result = await handleGetHover(
      {
        file_path: 'test.ts',
        line: 100,
        character: 50,
        symbol_name: 'myFunction',
      },
      mockClient
    );

    expect(result.content?.[0]?.text).toBe(
      'No hover information available for position 100:50 in test.ts (searching for symbol: myFunction)'
    );
  });

  it('should handle LSP errors gracefully when all positions fail', async () => {
    // All positions return null (no hover info found)
    mockClient.getHover.mockResolvedValue(null);

    const result = await handleGetHover(
      {
        file_path: 'test.ts',
        line: 10,
        character: 5,
      },
      mockClient
    );

    expect(result.content?.[0]?.text).toContain(
      'No hover information available for position 10:5 in test.ts'
    );
  });

  it('should filter empty content items in arrays', async () => {
    const mockHoverResult: MockHover = {
      contents: [
        'Valid content',
        '',
        { kind: 'markdown', value: '' },
        { kind: 'markdown', value: 'More content' },
      ],
    };

    mockClient.getHover.mockResolvedValue(mockHoverResult);

    const result = await handleGetHover(
      {
        file_path: 'test.ts',
        line: 10,
        character: 5,
      },
      mockClient
    );

    const contentLines = result.content?.[0]?.text.split('\n\n');
    expect(contentLines).toHaveLength(3); // Header + 2 valid content items
    expect(result.content?.[0]?.text).toContain('Valid content');
    expect(result.content?.[0]?.text).toContain('More content');
  });

  it('should handle empty contents gracefully', async () => {
    const mockHoverResult: MockHover = {
      contents: '',
    };

    mockClient.getHover.mockResolvedValue(mockHoverResult);

    const result = await handleGetHover(
      {
        file_path: 'test.ts',
        line: 10,
        character: 5,
      },
      mockClient
    );

    expect(result.content?.[0]?.text).toContain(
      'Hover information for test.ts at line 10, character 5:'
    );
    // Should have empty content section but still show the header
  });
});
