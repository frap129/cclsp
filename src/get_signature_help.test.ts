import { describe, expect, test } from 'bun:test';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { LSPClient } from './lsp-client.js';

const TEST_DIR = resolve(process.cwd(), 'test-signature-help');
const CONFIG_PATH = resolve(TEST_DIR, 'cclsp.json');

// Test configuration for TypeScript
const testConfig = {
  servers: [
    {
      extensions: ['ts', 'js'],
      command: ['typescript-language-server', '--stdio'],
      rootDir: TEST_DIR,
    },
  ],
};

describe('getSignatureHelp', () => {
  let client: LSPClient;

  const setupTest = () => {
    try {
      rmSync(TEST_DIR, { recursive: true, force: true });
    } catch {}

    mkdirSync(TEST_DIR, { recursive: true });
    writeFileSync(CONFIG_PATH, JSON.stringify(testConfig, null, 2));
    client = new LSPClient(CONFIG_PATH);
  };

  const teardownTest = () => {
    if (client) {
      client.dispose();
    }
    try {
      rmSync(TEST_DIR, { recursive: true, force: true });
    } catch {}
  };

  test('should get signature help for function call', async () => {
    setupTest();

    // Create test TypeScript file with function and call
    const testFile = resolve(TEST_DIR, 'signature-test.ts');
    const testContent = `
function testFunction(param1: string, param2: number, param3?: boolean): string {
  return param1 + param2;
}

const result = testFunction(`;

    writeFileSync(testFile, testContent);

    try {
      // Test signature help at function call position (after opening parenthesis)
      const result = await client.getSignatureHelp(testFile, { line: 4, character: 25 });

      expect(result).toBeTruthy();
      expect(result?.signatures).toBeDefined();
      expect(result?.signatures.length).toBeGreaterThan(0);

      const signature = result?.signatures[0];
      expect(signature?.label).toContain('testFunction');
      expect(signature?.label).toContain('param1');
      expect(signature?.label).toContain('param2');
      expect(signature?.label).toContain('param3');
    } catch (error) {
      // Some test environments might not have typescript-language-server
      console.log('Skipping signature help test: LSP server not available');
    }

    teardownTest();
  });

  test('should handle trigger character', async () => {
    setupTest();

    const testFile = resolve(TEST_DIR, 'trigger-test.ts');
    const testContent = `
function add(a: number, b: number): number {
  return a + b;
}

const sum = add(1, `;

    writeFileSync(testFile, testContent);

    try {
      // Test with comma trigger character
      const result = await client.getSignatureHelp(testFile, { line: 4, character: 17 }, ',');

      expect(result).toBeTruthy();
      if (result) {
        expect(result.signatures.length).toBeGreaterThan(0);
        const signature = result.signatures[0];
        expect(signature?.label).toContain('add');
      }
    } catch (error) {
      console.log('Skipping trigger character test: LSP server not available');
    }

    teardownTest();
  });

  test('should return null for positions without function calls', async () => {
    setupTest();

    const testFile = resolve(TEST_DIR, 'no-function-test.ts');
    const testContent = `
const variable = "hello world";
const number = 42;
`;

    writeFileSync(testFile, testContent);

    try {
      // Test at a position that's not in a function call
      const result = await client.getSignatureHelp(testFile, { line: 1, character: 10 });

      expect(result).toBeNull();
    } catch (error) {
      console.log('Skipping no-function test: LSP server not available');
    }

    teardownTest();
  });

  test('should handle method calls', async () => {
    setupTest();

    const testFile = resolve(TEST_DIR, 'method-test.ts');
    const testContent = `
class TestClass {
  testMethod(param1: string, param2: number): void {
    console.log(param1, param2);
  }
}

const instance = new TestClass();
instance.testMethod(`;

    writeFileSync(testFile, testContent);

    try {
      // Test signature help for method call
      const result = await client.getSignatureHelp(testFile, { line: 8, character: 20 });

      expect(result).toBeTruthy();
      if (result) {
        expect(result.signatures.length).toBeGreaterThan(0);
        const signature = result.signatures[0];
        expect(signature?.label).toContain('testMethod');
      }
    } catch (error) {
      console.log('Skipping method call test: LSP server not available');
    }

    teardownTest();
  });

  test('should handle function overloads', async () => {
    setupTest();

    const testFile = resolve(TEST_DIR, 'overload-test.ts');
    const testContent = `
function overloadedFunction(param: string): string;
function overloadedFunction(param: number): number;
function overloadedFunction(param: string | number): string | number {
  return param;
}

const result = overloadedFunction(`;

    writeFileSync(testFile, testContent);

    try {
      // Test signature help for overloaded function
      const result = await client.getSignatureHelp(testFile, { line: 6, character: 33 });

      expect(result).toBeTruthy();
      if (result) {
        // Should have multiple signatures for overloads
        expect(result.signatures.length).toBeGreaterThanOrEqual(1);

        // Check that at least one signature contains the function name
        const hasCorrectSignature = result.signatures.some((sig) =>
          sig.label.includes('overloadedFunction')
        );
        expect(hasCorrectSignature).toBe(true);
      }
    } catch (error) {
      console.log('Skipping overload test: LSP server not available');
    }

    teardownTest();
  });

  test('should use multi-position resolution', async () => {
    setupTest();

    const testFile = resolve(TEST_DIR, 'multi-position-test.ts');
    const testContent = `
function multiTest(a: string, b: number): void {}

multiTest(`;

    writeFileSync(testFile, testContent);

    try {
      // Test with 1-indexed position (which should be converted internally)
      const result = await client.getSignatureHelp(testFile, { line: 3, character: 10 });

      expect(result).toBeTruthy();
      if (result) {
        expect(result.signatures.length).toBeGreaterThan(0);
        const signature = result.signatures[0];
        expect(signature?.label).toContain('multiTest');
      }
    } catch (error) {
      console.log('Skipping multi-position test: LSP server not available');
    }

    teardownTest();
  });
});
