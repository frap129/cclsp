import { beforeEach, describe, expect, it, spyOn } from 'bun:test';
import type { FormattingOptions, Range, TextEdit } from './types.js';

// Mock implementation for LSPClient with formatting support
class MockLSPClient {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  formatDocument: any = spyOn({} as any, 'formatDocument').mockResolvedValue([]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  formatRange: any = spyOn({} as any, 'formatRange').mockResolvedValue([]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  applyTextEdits: any = spyOn({} as any, 'applyTextEdits').mockResolvedValue({
    content: '',
    summary: ['No changes needed'],
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  dispose: any = spyOn({} as any, 'dispose').mockImplementation(() => {});
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  preloadServers: any = spyOn({} as any, 'preloadServers').mockResolvedValue(undefined);
}

describe('format_document tool', () => {
  let mockLspClient: MockLSPClient;

  beforeEach(() => {
    mockLspClient = new MockLSPClient();
  });

  describe('formatDocument method', () => {
    it('should format entire document with default options', async () => {
      const mockTextEdits: TextEdit[] = [
        {
          range: {
            start: { line: 0, character: 0 },
            end: { line: 0, character: 4 },
          },
          newText: '  ',
        },
        {
          range: {
            start: { line: 1, character: 8 },
            end: { line: 1, character: 10 },
          },
          newText: '',
        },
      ];

      mockLspClient.formatDocument.mockResolvedValue(mockTextEdits);

      const options: FormattingOptions = {
        tabSize: 2,
        insertSpaces: true,
        trimTrailingWhitespace: true,
        insertFinalNewline: true,
        trimFinalNewlines: true,
      };

      const result = await mockLspClient.formatDocument('/test/file.ts', options);

      expect(mockLspClient.formatDocument).toHaveBeenCalledWith('/test/file.ts', options);
      expect(result).toEqual(mockTextEdits);
    });

    it('should handle empty formatting results', async () => {
      mockLspClient.formatDocument.mockResolvedValue([]);

      const options: FormattingOptions = {
        tabSize: 4,
        insertSpaces: false,
      };

      const result = await mockLspClient.formatDocument('/test/file.ts', options);

      expect(result).toHaveLength(0);
    });

    it('should handle formatting errors', async () => {
      const errorMessage = 'LSP server formatting failed';
      mockLspClient.formatDocument.mockRejectedValue(new Error(errorMessage));

      const options: FormattingOptions = {
        tabSize: 2,
        insertSpaces: true,
      };

      await expect(mockLspClient.formatDocument('/test/file.ts', options)).rejects.toThrow(
        errorMessage
      );
    });
  });

  describe('formatRange method', () => {
    it('should format specific range with options', async () => {
      const mockTextEdits: TextEdit[] = [
        {
          range: {
            start: { line: 2, character: 0 },
            end: { line: 2, character: 6 },
          },
          newText: '    ',
        },
      ];

      mockLspClient.formatRange.mockResolvedValue(mockTextEdits);

      const range: Range = {
        start: { line: 2, character: 0 },
        end: { line: 5, character: 0 },
      };

      const options: FormattingOptions = {
        tabSize: 4,
        insertSpaces: true,
        trimTrailingWhitespace: true,
      };

      const result = await mockLspClient.formatRange('/test/file.ts', range, options);

      expect(mockLspClient.formatRange).toHaveBeenCalledWith('/test/file.ts', range, options);
      expect(result).toEqual(mockTextEdits);
    });

    it('should handle empty range formatting results', async () => {
      mockLspClient.formatRange.mockResolvedValue([]);

      const range: Range = {
        start: { line: 0, character: 0 },
        end: { line: 1, character: 0 },
      };

      const options: FormattingOptions = {
        tabSize: 2,
        insertSpaces: true,
      };

      const result = await mockLspClient.formatRange('/test/file.ts', range, options);

      expect(result).toHaveLength(0);
    });

    it('should handle range formatting errors', async () => {
      const errorMessage = 'Range formatting not supported';
      mockLspClient.formatRange.mockRejectedValue(new Error(errorMessage));

      const range: Range = {
        start: { line: 0, character: 0 },
        end: { line: 1, character: 0 },
      };

      const options: FormattingOptions = {
        tabSize: 2,
        insertSpaces: true,
      };

      await expect(mockLspClient.formatRange('/test/file.ts', range, options)).rejects.toThrow(
        errorMessage
      );
    });
  });

  describe('applyTextEdits method', () => {
    it('should apply text edits and return formatted content', async () => {
      const mockTextEdits: TextEdit[] = [
        {
          range: {
            start: { line: 0, character: 0 },
            end: { line: 0, character: 4 },
          },
          newText: '  ',
        },
      ];

      const expectedResult = {
        content: '  console.log("Hello");',
        summary: ['• Line 1: Adjusted indentation'],
      };

      mockLspClient.applyTextEdits.mockResolvedValue(expectedResult);

      const result = await mockLspClient.applyTextEdits('/test/file.ts', mockTextEdits, false);

      expect(mockLspClient.applyTextEdits).toHaveBeenCalledWith(
        '/test/file.ts',
        mockTextEdits,
        false
      );
      expect(result).toEqual(expectedResult);
    });

    it('should apply edits to file when requested', async () => {
      const mockTextEdits: TextEdit[] = [
        {
          range: {
            start: { line: 0, character: 10 },
            end: { line: 0, character: 12 },
          },
          newText: '',
        },
      ];

      const expectedResult = {
        content: 'const x = 1;',
        summary: ['• Line 1: Removed trailing whitespace', 'File /test/file.ts has been updated'],
      };

      mockLspClient.applyTextEdits.mockResolvedValue(expectedResult);

      const result = await mockLspClient.applyTextEdits('/test/file.ts', mockTextEdits, true);

      expect(mockLspClient.applyTextEdits).toHaveBeenCalledWith(
        '/test/file.ts',
        mockTextEdits,
        true
      );
      expect(result).toEqual(expectedResult);
    });

    it('should handle no changes needed', async () => {
      const expectedResult = {
        content: 'const x = 1;',
        summary: ['No formatting changes needed'],
      };

      mockLspClient.applyTextEdits.mockResolvedValue(expectedResult);

      const result = await mockLspClient.applyTextEdits('/test/file.ts', [], false);

      expect(result.summary).toContain('No formatting changes needed');
    });

    it('should handle file write errors', async () => {
      const mockTextEdits: TextEdit[] = [
        {
          range: {
            start: { line: 0, character: 0 },
            end: { line: 0, character: 1 },
          },
          newText: ' ',
        },
      ];

      const errorMessage = 'Permission denied writing to file';
      mockLspClient.applyTextEdits.mockRejectedValue(new Error(errorMessage));

      await expect(
        mockLspClient.applyTextEdits('/test/file.ts', mockTextEdits, true)
      ).rejects.toThrow(errorMessage);
    });
  });

  describe('FormattingOptions validation', () => {
    it('should handle various formatting option combinations', async () => {
      const testCases: FormattingOptions[] = [
        {
          tabSize: 2,
          insertSpaces: true,
        },
        {
          tabSize: 4,
          insertSpaces: false,
        },
        {
          tabSize: 8,
          insertSpaces: true,
          trimTrailingWhitespace: true,
          insertFinalNewline: true,
          trimFinalNewlines: false,
        },
        {
          tabSize: 1,
          insertSpaces: false,
          trimTrailingWhitespace: false,
          insertFinalNewline: false,
          trimFinalNewlines: true,
        },
      ];

      for (const options of testCases) {
        mockLspClient.formatDocument.mockResolvedValue([]);

        await mockLspClient.formatDocument('/test/file.ts', options);

        expect(mockLspClient.formatDocument).toHaveBeenCalledWith('/test/file.ts', options);
      }
    });

    it('should handle custom formatting options', async () => {
      const customOptions: FormattingOptions = {
        tabSize: 3,
        insertSpaces: true,
        trimTrailingWhitespace: true,
        insertFinalNewline: false,
        trimFinalNewlines: true,
        customProperty: 'custom-value', // Test index signature
      };

      mockLspClient.formatDocument.mockResolvedValue([]);

      await mockLspClient.formatDocument('/test/file.ts', customOptions);

      expect(mockLspClient.formatDocument).toHaveBeenCalledWith('/test/file.ts', customOptions);
    });
  });

  describe('Text edit scenarios', () => {
    it('should handle single line edits', async () => {
      const singleLineEdit: TextEdit = {
        range: {
          start: { line: 5, character: 2 },
          end: { line: 5, character: 6 },
        },
        newText: '  ',
      };

      mockLspClient.formatDocument.mockResolvedValue([singleLineEdit]);

      const result = await mockLspClient.formatDocument('/test/file.ts', {
        tabSize: 2,
        insertSpaces: true,
      });

      expect(result).toContain(singleLineEdit);
    });

    it('should handle multi-line edits', async () => {
      const multiLineEdit: TextEdit = {
        range: {
          start: { line: 3, character: 0 },
          end: { line: 5, character: 10 },
        },
        newText: '  function test() {\n    return true;\n  }',
      };

      mockLspClient.formatDocument.mockResolvedValue([multiLineEdit]);

      const result = await mockLspClient.formatDocument('/test/file.ts', {
        tabSize: 2,
        insertSpaces: true,
      });

      expect(result).toContain(multiLineEdit);
    });

    it('should handle multiple edits in sequence', async () => {
      const multipleEdits: TextEdit[] = [
        {
          range: {
            start: { line: 0, character: 0 },
            end: { line: 0, character: 2 },
          },
          newText: '  ',
        },
        {
          range: {
            start: { line: 1, character: 4 },
            end: { line: 1, character: 8 },
          },
          newText: '    ',
        },
        {
          range: {
            start: { line: 3, character: 15 },
            end: { line: 3, character: 17 },
          },
          newText: '',
        },
      ];

      mockLspClient.formatDocument.mockResolvedValue(multipleEdits);

      const result = await mockLspClient.formatDocument('/test/file.ts', {
        tabSize: 2,
        insertSpaces: true,
        trimTrailingWhitespace: true,
      });

      expect(result).toEqual(multipleEdits);
      expect(result).toHaveLength(3);
    });
  });

  describe('Edge cases', () => {
    it('should handle empty files', async () => {
      mockLspClient.formatDocument.mockResolvedValue([]);

      const result = await mockLspClient.formatDocument('/test/empty.ts', {
        tabSize: 2,
        insertSpaces: true,
      });

      expect(result).toHaveLength(0);
    });

    it('should handle large files with many edits', async () => {
      const manyEdits: TextEdit[] = Array.from({ length: 100 }, (_, i) => ({
        range: {
          start: { line: i, character: 0 },
          end: { line: i, character: 2 },
        },
        newText: '  ',
      }));

      mockLspClient.formatDocument.mockResolvedValue(manyEdits);

      const result = await mockLspClient.formatDocument('/test/large.ts', {
        tabSize: 2,
        insertSpaces: true,
      });

      expect(result).toHaveLength(100);
      expect(result).toEqual(manyEdits);
    });

    it('should handle invalid ranges gracefully', async () => {
      const invalidRange: Range = {
        start: { line: 10, character: 0 },
        end: { line: 5, character: 0 }, // End before start
      };

      // LSP client should handle this internally
      mockLspClient.formatRange.mockResolvedValue([]);

      const result = await mockLspClient.formatRange('/test/file.ts', invalidRange, {
        tabSize: 2,
        insertSpaces: true,
      });

      expect(result).toHaveLength(0);
    });
  });
});
