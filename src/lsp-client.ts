import { type ChildProcess, spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { constants, access, readFile, readdir, stat } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadGitignore, scanDirectoryForExtensions } from './file-scanner.js';
import type {
  CodeAction,
  CodeActionContext,
  Command,
  CompletionContext,
  CompletionItem,
  CompletionList,
  Config,
  DeletionAnalysisResult,
  Diagnostic,
  DocumentDiagnosticReport,
  DocumentSymbol,
  FormattingOptions,
  Hover,
  LSPError,
  LSPLocation,
  LSPServerConfig,
  Location,
  MarkupContent,
  ParameterInfo,
  ParameterInformation,
  Position,
  Range,
  ServerCapabilities,
  SignatureHelp,
  SignatureInformation,
  SymbolDeletionInfo,
  SymbolInformation,
  SymbolMatch,
  TextEdit,
  TypeInfo,
  WorkspaceEdit,
  WorkspaceSearchResult,
} from './types.js';
import { CompletionItemKind, CompletionTriggerKind, SymbolKind } from './types.js';
import { pathToUri } from './utils.js';
import { uriToPath } from './utils.js';

interface LSPMessage {
  jsonrpc: string;
  id?: number;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: LSPError;
}

interface ServerState {
  process: ChildProcess;
  initialized: boolean;
  initializationPromise: Promise<void>;
  openFiles: Set<string>;
  startTime: number;
  config: LSPServerConfig;
  restartTimer?: NodeJS.Timeout;
  initializationResolve?: () => void;
  diagnostics: Map<string, Diagnostic[]>; // Store diagnostics by file URI
  lastDiagnosticUpdate: Map<string, number>; // Track last update time per file
  diagnosticVersions: Map<string, number>; // Track diagnostic versions per file
  workspaceIndexed: boolean; // Track if workspace is fully indexed
  indexingStartTime: number; // When indexing started
  filesDiscovered: number; // Number of files discovered during indexing
  capabilities?: ServerCapabilities; // Store server capabilities from initialization
}

export class LSPClient {
  private config: Config;
  private servers: Map<string, ServerState> = new Map();
  private nextId = 1;
  private pendingRequests: Map<
    number,
    { resolve: (value: unknown) => void; reject: (reason?: unknown) => void }
  > = new Map();

  constructor(configPath?: string) {
    // First try to load from environment variable (MCP config)
    if (process.env.CCLSP_CONFIG_PATH) {
      process.stderr.write(
        `Loading config from CCLSP_CONFIG_PATH: ${process.env.CCLSP_CONFIG_PATH}\n`
      );

      if (!existsSync(process.env.CCLSP_CONFIG_PATH)) {
        process.stderr.write(
          `Config file specified in CCLSP_CONFIG_PATH does not exist: ${process.env.CCLSP_CONFIG_PATH}\n`
        );
        process.exit(1);
      }

      try {
        const configData = readFileSync(process.env.CCLSP_CONFIG_PATH, 'utf-8');
        this.config = JSON.parse(configData);
        process.stderr.write(
          `Loaded ${this.config.servers.length} server configurations from env\n`
        );
        return;
      } catch (error) {
        process.stderr.write(`Failed to load config from CCLSP_CONFIG_PATH: ${error}\n`);
        process.exit(1);
      }
    }

    // configPath must be provided if CCLSP_CONFIG_PATH is not set
    if (!configPath) {
      process.stderr.write(
        'Error: configPath is required when CCLSP_CONFIG_PATH environment variable is not set\n'
      );
      process.exit(1);
    }

    // Try to load from config file
    try {
      process.stderr.write(`Loading config from file: ${configPath}\n`);
      const configData = readFileSync(configPath, 'utf-8');
      this.config = JSON.parse(configData);
      process.stderr.write(`Loaded ${this.config.servers.length} server configurations\n`);
    } catch (error) {
      process.stderr.write(`Failed to load config from ${configPath}: ${error}\n`);
      process.exit(1);
    }
  }

  private getServerForFile(filePath: string): LSPServerConfig | null {
    const extension = filePath.split('.').pop();
    if (!extension) {
      process.stderr.write(`[DEBUG] No extension found: ${extension}\n`);
      return null;
    }

    process.stderr.write(`Looking for server for extension: ${extension}\n`);
    process.stderr.write(
      `Available servers: ${this.config.servers.map((s) => s.extensions.join(',')).join(' | ')}\n`
    );

    const server = this.config.servers.find((server) => server.extensions.includes(extension));

    if (server) {
      process.stderr.write(`Found server for ${extension}: ${server.command.join(' ')}\n`);
    } else {
      process.stderr.write(`No server found for extension: ${extension}\n`);
    }

    return server || null;
  }

  private async startServer(serverConfig: LSPServerConfig): Promise<ServerState> {
    const [command, ...args] = serverConfig.command;
    if (!command) {
      throw new Error('No command specified in server config');
    }
    const childProcess = spawn(command, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: serverConfig.rootDir || process.cwd(),
    });

    let initializationResolve: (() => void) | undefined;
    const initializationPromise = new Promise<void>((resolve) => {
      initializationResolve = resolve;
    });

    const serverState: ServerState = {
      process: childProcess,
      initialized: false,
      initializationPromise,
      openFiles: new Set(),
      startTime: Date.now(),
      config: serverConfig,
      restartTimer: undefined,
      diagnostics: new Map(),
      lastDiagnosticUpdate: new Map(),
      diagnosticVersions: new Map(),
      workspaceIndexed: false,
      indexingStartTime: Date.now(),
      filesDiscovered: 0,
    };

    // Store the resolve function to call when initialized notification is received
    serverState.initializationResolve = initializationResolve;

    let buffer = '';
    childProcess.stdout?.on('data', (data: Buffer) => {
      buffer += data.toString();

      while (buffer.includes('\r\n\r\n')) {
        const headerEndIndex = buffer.indexOf('\r\n\r\n');
        const headerPart = buffer.substring(0, headerEndIndex);
        const contentLengthMatch = headerPart.match(/Content-Length: (\d+)/);

        if (contentLengthMatch?.[1]) {
          const contentLength = Number.parseInt(contentLengthMatch[1]);
          const messageStart = headerEndIndex + 4;

          if (buffer.length >= messageStart + contentLength) {
            const messageContent = buffer.substring(messageStart, messageStart + contentLength);
            buffer = buffer.substring(messageStart + contentLength);

            try {
              const message: LSPMessage = JSON.parse(messageContent);
              this.handleMessage(message, serverState);
            } catch (error) {
              process.stderr.write(`Failed to parse LSP message: ${error}\n`);
            }
          } else {
            break;
          }
        } else {
          buffer = buffer.substring(headerEndIndex + 4);
        }
      }
    });

    childProcess.stderr?.on('data', (data: Buffer) => {
      // Forward LSP server stderr directly to MCP stderr
      process.stderr.write(data);
    });

    // Initialize the server
    const initResult = await this.sendRequest(childProcess, 'initialize', {
      processId: childProcess.pid || null,
      clientInfo: { name: 'cclsp', version: '0.1.0' },
      capabilities: {
        textDocument: {
          synchronization: {
            didOpen: true,
            didChange: true,
            didClose: true,
          },
          definition: { linkSupport: false },
          references: {
            includeDeclaration: true,
            dynamicRegistration: false,
          },
          rename: { prepareSupport: false },
          documentSymbol: {
            symbolKind: {
              valueSet: [
                1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23,
                24, 25, 26,
              ],
            },
            hierarchicalDocumentSymbolSupport: true,
          },
          completion: {
            completionItem: {
              snippetSupport: true,
            },
          },
          hover: {},
          signatureHelp: {},
          typeDefinition: {
            linkSupport: false,
          },
          diagnostic: {
            dynamicRegistration: false,
            relatedDocumentSupport: false,
          },
        },
        workspace: {
          workspaceFolders: true,
          symbol: {
            symbolKind: {
              valueSet: [
                1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23,
                24, 25, 26,
              ],
            },
          },
          workDoneProgress: true,
          didChangeConfiguration: {
            dynamicRegistration: true,
          },
        },
        window: {
          workDoneProgress: true,
        },
      },
      rootUri: pathToFileURL(serverConfig.rootDir || process.cwd()).toString(),
      workspaceFolders: [
        {
          uri: pathToFileURL(serverConfig.rootDir || process.cwd()).toString(),
          name: 'workspace',
        },
      ],
      initializationOptions: {
        settings: {
          pylsp: {
            plugins: {
              jedi_completion: { enabled: true },
              jedi_definition: { enabled: true },
              jedi_hover: { enabled: true },
              jedi_references: { enabled: true },
              jedi_signature_help: { enabled: true },
              jedi_symbols: { enabled: true },
              pylint: { enabled: false },
              pycodestyle: { enabled: false },
              pyflakes: { enabled: false },
              yapf: { enabled: false },
              rope_completion: { enabled: false },
            },
          },
        },
      },
    });

    // Store server capabilities from the initialization response
    if (initResult && typeof initResult === 'object' && 'capabilities' in initResult) {
      serverState.capabilities = initResult.capabilities as ServerCapabilities;
      process.stderr.write(
        `[DEBUG startServer] Stored capabilities for ${serverConfig.command.join(' ')}\n`
      );
    } else {
      process.stderr.write(
        `[DEBUG startServer] No capabilities found in initialization response for ${serverConfig.command.join(' ')}\n`
      );
    }

    // Send the initialized notification after receiving the initialize response
    await this.sendNotification(childProcess, 'initialized', {});

    // Wait for the server to send the initialized notification back with timeout
    const INITIALIZATION_TIMEOUT = 3000; // 3 seconds
    try {
      await Promise.race([
        initializationPromise,
        new Promise<void>((_, reject) =>
          setTimeout(() => reject(new Error('Initialization timeout')), INITIALIZATION_TIMEOUT)
        ),
      ]);
    } catch (error) {
      // If timeout or initialization fails, mark as initialized anyway
      process.stderr.write(
        `[DEBUG startServer] Initialization timeout or failed for ${serverConfig.command.join(' ')}, proceeding anyway: ${error}\n`
      );
      serverState.initialized = true;
      if (serverState.initializationResolve) {
        serverState.initializationResolve();
        serverState.initializationResolve = undefined;
      }
    }

    // Set up auto-restart timer if configured
    this.setupRestartTimer(serverState);

    return serverState;
  }

  private handleMessage(message: LSPMessage, serverState?: ServerState) {
    if (message.id && this.pendingRequests.has(message.id)) {
      const request = this.pendingRequests.get(message.id);
      if (!request) return;
      const { resolve, reject } = request;
      this.pendingRequests.delete(message.id);

      if (message.error) {
        reject(new Error(message.error.message || 'LSP Error'));
      } else {
        resolve(message.result);
      }
    }

    // Handle notifications from server
    if (message.method && serverState) {
      if (message.method === 'initialized') {
        process.stderr.write(
          '[DEBUG /ehandleMessage] Received initialized notification from server\n'
        );
        serverState.initialized = true;
        // Start monitoring workspace indexing
        this.startWorkspaceIndexingMonitor(serverState);
        // Resolve the initialization promise
        const resolve = serverState.initializationResolve;
        if (resolve) {
          resolve();
          serverState.initializationResolve = undefined;
        }
      } else if (message.method === '$/progress') {
        // Handle workspace indexing progress
        this.handleWorkspaceProgress(message.params, serverState);
      } else if (message.method === 'textDocument/publishDiagnostics') {
        // Handle diagnostic notifications from the server
        const params = message.params as {
          uri: string;
          diagnostics: Diagnostic[];
          version?: number;
        };
        if (params?.uri) {
          process.stderr.write(
            `[DEBUG handleMessage] Received publishDiagnostics for ${params.uri} with ${params.diagnostics?.length || 0} diagnostics${params.version !== undefined ? ` (version: ${params.version})` : ''}\n`
          );
          serverState.diagnostics.set(params.uri, params.diagnostics || []);
          serverState.lastDiagnosticUpdate.set(params.uri, Date.now());
          if (params.version !== undefined) {
            serverState.diagnosticVersions.set(params.uri, params.version);
          }
        }
      }
    }
  }

  private sendMessage(process: ChildProcess, message: LSPMessage): void {
    const content = JSON.stringify(message);
    const header = `Content-Length: ${Buffer.byteLength(content)}\r\n\r\n`;
    process.stdin?.write(header + content);
  }

  private sendRequest(
    process: ChildProcess,
    method: string,
    params: unknown,
    timeout = 30000
  ): Promise<unknown> {
    const id = this.nextId++;
    const message: LSPMessage = {
      jsonrpc: '2.0',
      id,
      method,
      params,
    };

    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`LSP request timeout: ${method} (${timeout}ms)`));
      }, timeout);

      this.pendingRequests.set(id, {
        resolve: (value: unknown) => {
          clearTimeout(timeoutId);
          resolve(value);
        },
        reject: (reason?: unknown) => {
          clearTimeout(timeoutId);
          reject(reason);
        },
      });

      this.sendMessage(process, message);
    });
  }

  private sendNotification(process: ChildProcess, method: string, params: unknown): void {
    const message: LSPMessage = {
      jsonrpc: '2.0',
      method,
      params,
    };
    this.sendMessage(process, message);
  }

  private setupRestartTimer(serverState: ServerState): void {
    if (serverState.config.restartInterval && serverState.config.restartInterval > 0) {
      // Minimum interval is 0.1 minutes (6 seconds) for testing, practical minimum is 1 minute
      const minInterval = 0.1;
      const actualInterval = Math.max(serverState.config.restartInterval, minInterval);
      const intervalMs = actualInterval * 60 * 1000; // Convert minutes to milliseconds

      process.stderr.write(
        `[DEBUG setupRestartTimer] Setting up restart timer for ${actualInterval} minutes\n`
      );

      serverState.restartTimer = setTimeout(() => {
        this.restartServer(serverState);
      }, intervalMs);
    }
  }

  private async restartServer(serverState: ServerState): Promise<void> {
    const key = JSON.stringify(serverState.config);
    process.stderr.write(
      `[DEBUG restartServer] Restarting LSP server for ${serverState.config.command.join(' ')}\n`
    );

    // Clear existing timer
    if (serverState.restartTimer) {
      clearTimeout(serverState.restartTimer);
      serverState.restartTimer = undefined;
    }

    // Terminate old server
    serverState.process.kill();

    // Remove from servers map
    this.servers.delete(key);

    try {
      // Start new server
      const newServerState = await this.startServer(serverState.config);
      this.servers.set(key, newServerState);

      process.stderr.write(
        `[DEBUG restartServer] Successfully restarted LSP server for ${serverState.config.command.join(' ')}\n`
      );
    } catch (error) {
      process.stderr.write(`[DEBUG restartServer] Failed to restart LSP server: ${error}\n`);
    }
  }

  private async ensureFileOpen(serverState: ServerState, filePath: string): Promise<void> {
    if (serverState.openFiles.has(filePath)) {
      process.stderr.write(`[DEBUG ensureFileOpen] File already open: ${filePath}\n`);
      return;
    }

    process.stderr.write(`[DEBUG ensureFileOpen] Opening file: ${filePath}\n`);

    try {
      const fileContent = readFileSync(filePath, 'utf-8');
      const uri = pathToUri(filePath);
      const languageId = this.getLanguageId(filePath);

      process.stderr.write(
        `[DEBUG ensureFileOpen] File content length: ${fileContent.length}, languageId: ${languageId}\n`
      );

      await this.sendNotification(serverState.process, 'textDocument/didOpen', {
        textDocument: {
          uri,
          languageId,
          version: 1,
          text: fileContent,
        },
      });

      serverState.openFiles.add(filePath);
      process.stderr.write(`[DEBUG ensureFileOpen] File opened successfully: ${filePath}\n`);
    } catch (error) {
      process.stderr.write(`[DEBUG ensureFileOpen] Failed to open file ${filePath}: ${error}\n`);
      throw error;
    }
  }

  private getLanguageId(filePath: string): string {
    const extension = filePath.split('.').pop()?.toLowerCase();
    const languageMap: Record<string, string> = {
      ts: 'typescript',
      tsx: 'typescriptreact',
      js: 'javascript',
      jsx: 'javascriptreact',
      py: 'python',
      go: 'go',
      rs: 'rust',
      c: 'c',
      cpp: 'cpp',
      h: 'c',
      hpp: 'cpp',
      java: 'java',
      cs: 'csharp',
      php: 'php',
      rb: 'ruby',
      swift: 'swift',
      kt: 'kotlin',
      scala: 'scala',
      dart: 'dart',
      lua: 'lua',
      sh: 'shellscript',
      bash: 'shellscript',
      json: 'json',
      yaml: 'yaml',
      yml: 'yaml',
      xml: 'xml',
      html: 'html',
      css: 'css',
      scss: 'scss',
      vue: 'vue',
      svelte: 'svelte',
      tf: 'terraform',
      sql: 'sql',
      graphql: 'graphql',
      gql: 'graphql',
      md: 'markdown',
      tex: 'latex',
      elm: 'elm',
      hs: 'haskell',
      ml: 'ocaml',
      clj: 'clojure',
      fs: 'fsharp',
      r: 'r',
      toml: 'toml',
      zig: 'zig',
    };

    return languageMap[extension || ''] || 'plaintext';
  }

  private async getServer(filePath: string): Promise<ServerState> {
    process.stderr.write(`[DEBUG getServer] Getting server for file: ${filePath}\n`);

    const serverConfig = this.getServerForFile(filePath);
    if (!serverConfig) {
      throw new Error(`No LSP server configured for file: ${filePath}`);
    }

    process.stderr.write(
      `[DEBUG getServer] Found server config: ${serverConfig.command.join(' ')}\n`
    );

    const key = JSON.stringify(serverConfig);
    if (!this.servers.has(key)) {
      process.stderr.write('[DEBUG getServer] Starting new server instance\n');
      const serverState = await this.startServer(serverConfig);
      this.servers.set(key, serverState);
      process.stderr.write('[DEBUG getServer] Server started and cached\n');
    } else {
      process.stderr.write('[DEBUG getServer] Using existing server instance\n');
    }

    const server = this.servers.get(key);
    if (!server) {
      throw new Error('Failed to get or create server');
    }
    return server;
  }

  async findDefinition(filePath: string, position: Position): Promise<Location[]> {
    process.stderr.write(
      `[DEBUG findDefinition] Requesting definition for ${filePath} at ${position.line}:${position.character}\n`
    );

    const serverState = await this.getServer(filePath);

    // Wait for the server to be fully initialized
    await serverState.initializationPromise;

    // Ensure the file is opened and synced with the LSP server
    await this.ensureFileOpen(serverState, filePath);

    process.stderr.write('[DEBUG findDefinition] Sending textDocument/definition request\n');
    const result = await this.sendRequest(serverState.process, 'textDocument/definition', {
      textDocument: { uri: pathToUri(filePath) },
      position,
    });

    process.stderr.write(
      `[DEBUG findDefinition] Result type: ${typeof result}, isArray: ${Array.isArray(result)}\n`
    );

    if (Array.isArray(result)) {
      process.stderr.write(`[DEBUG findDefinition] Array result with ${result.length} locations\n`);
      if (result.length > 0) {
        process.stderr.write(
          `[DEBUG findDefinition] First location: ${JSON.stringify(result[0], null, 2)}\n`
        );
      }
      return result.map((loc: LSPLocation) => ({
        uri: loc.uri,
        range: loc.range,
      }));
    }
    if (result && typeof result === 'object' && 'uri' in result) {
      process.stderr.write(
        `[DEBUG findDefinition] Single location result: ${JSON.stringify(result, null, 2)}\n`
      );
      const location = result as LSPLocation;
      return [
        {
          uri: location.uri,
          range: location.range,
        },
      ];
    }

    process.stderr.write(
      '[DEBUG findDefinition] No definition found or unexpected result format\n'
    );
    return [];
  }

  async findReferences(
    filePath: string,
    position: Position,
    includeDeclaration = true
  ): Promise<Location[]> {
    const serverState = await this.getServer(filePath);

    // Wait for the server to be fully initialized
    await serverState.initializationPromise;

    // Ensure the file is opened and synced with the LSP server
    await this.ensureFileOpen(serverState, filePath);

    process.stderr.write(
      `[DEBUG] findReferences for ${filePath} at ${position.line}:${position.character}, includeDeclaration: ${includeDeclaration}\n`
    );

    const result = await this.sendRequest(serverState.process, 'textDocument/references', {
      textDocument: { uri: pathToUri(filePath) },
      position,
      context: { includeDeclaration },
    });

    process.stderr.write(
      `[DEBUG] findReferences result type: ${typeof result}, isArray: ${Array.isArray(result)}, length: ${Array.isArray(result) ? result.length : 'N/A'}\n`
    );

    if (result && Array.isArray(result) && result.length > 0) {
      process.stderr.write(`[DEBUG] First reference: ${JSON.stringify(result[0], null, 2)}\n`);
    } else if (result === null || result === undefined) {
      process.stderr.write('[DEBUG] findReferences returned null/undefined\n');
    } else {
      process.stderr.write(
        `[DEBUG] findReferences returned unexpected result: ${JSON.stringify(result)}\n`
      );
    }

    if (Array.isArray(result)) {
      return result.map((loc: LSPLocation) => ({
        uri: loc.uri,
        range: loc.range,
      }));
    }

    return [];
  }

  async renameSymbol(
    filePath: string,
    position: Position,
    newName: string
  ): Promise<{
    changes?: Record<string, Array<{ range: { start: Position; end: Position }; newText: string }>>;
  }> {
    process.stderr.write(
      `[DEBUG renameSymbol] Requesting rename for ${filePath} at ${position.line}:${position.character} to "${newName}"\n`
    );

    const serverState = await this.getServer(filePath);

    // Wait for the server to be fully initialized
    await serverState.initializationPromise;

    // Ensure the file is opened and synced with the LSP server
    await this.ensureFileOpen(serverState, filePath);

    process.stderr.write('[DEBUG renameSymbol] Sending textDocument/rename request\n');
    const result = await this.sendRequest(serverState.process, 'textDocument/rename', {
      textDocument: { uri: pathToUri(filePath) },
      position,
      newName,
    });

    process.stderr.write(
      `[DEBUG renameSymbol] Result type: ${typeof result}, hasChanges: ${result && typeof result === 'object' && 'changes' in result}\n`
    );

    if (result && typeof result === 'object' && 'changes' in result) {
      const workspaceEdit = result as {
        changes: Record<
          string,
          Array<{ range: { start: Position; end: Position }; newText: string }>
        >;
      };

      const changeCount = Object.keys(workspaceEdit.changes || {}).length;
      process.stderr.write(
        `[DEBUG renameSymbol] WorkspaceEdit has changes for ${changeCount} files\n`
      );

      return workspaceEdit;
    }

    process.stderr.write('[DEBUG renameSymbol] No rename changes available\n');
    return {};
  }

  async getDocumentSymbols(filePath: string): Promise<DocumentSymbol[] | SymbolInformation[]> {
    const serverState = await this.getServer(filePath);

    // Wait for the server to be fully initialized
    await serverState.initializationPromise;

    // Ensure the file is opened and synced with the LSP server
    await this.ensureFileOpen(serverState, filePath);

    process.stderr.write(`[DEBUG] Requesting documentSymbol for: ${filePath}\n`);

    const result = await this.sendRequest(serverState.process, 'textDocument/documentSymbol', {
      textDocument: { uri: pathToUri(filePath) },
    });

    process.stderr.write(
      `[DEBUG] documentSymbol result type: ${typeof result}, isArray: ${Array.isArray(result)}, length: ${Array.isArray(result) ? result.length : 'N/A'}\n`
    );

    if (result && Array.isArray(result) && result.length > 0) {
      process.stderr.write(`[DEBUG] First symbol: ${JSON.stringify(result[0], null, 2)}\n`);
    } else if (result === null || result === undefined) {
      process.stderr.write('[DEBUG] documentSymbol returned null/undefined\n');
    } else {
      process.stderr.write(
        `[DEBUG] documentSymbol returned unexpected result: ${JSON.stringify(result)}\n`
      );
    }

    if (Array.isArray(result)) {
      return result as DocumentSymbol[] | SymbolInformation[];
    }

    return [];
  }

  private flattenDocumentSymbols(symbols: DocumentSymbol[]): DocumentSymbol[] {
    const flattened: DocumentSymbol[] = [];

    for (const symbol of symbols) {
      flattened.push(symbol);
      if (symbol.children) {
        flattened.push(...this.flattenDocumentSymbols(symbol.children));
      }
    }

    return flattened;
  }

  private isDocumentSymbolArray(
    symbols: DocumentSymbol[] | SymbolInformation[]
  ): symbols is DocumentSymbol[] {
    if (symbols.length === 0) return true;
    const firstSymbol = symbols[0];
    if (!firstSymbol) return true;
    // DocumentSymbol has 'range' and 'selectionRange', SymbolInformation has 'location'
    return 'range' in firstSymbol && 'selectionRange' in firstSymbol;
  }

  symbolKindToString(kind: SymbolKind): string {
    const kindMap: Record<SymbolKind, string> = {
      [SymbolKind.File]: 'file',
      [SymbolKind.Module]: 'module',
      [SymbolKind.Namespace]: 'namespace',
      [SymbolKind.Package]: 'package',
      [SymbolKind.Class]: 'class',
      [SymbolKind.Method]: 'method',
      [SymbolKind.Property]: 'property',
      [SymbolKind.Field]: 'field',
      [SymbolKind.Constructor]: 'constructor',
      [SymbolKind.Enum]: 'enum',
      [SymbolKind.Interface]: 'interface',
      [SymbolKind.Function]: 'function',
      [SymbolKind.Variable]: 'variable',
      [SymbolKind.Constant]: 'constant',
      [SymbolKind.String]: 'string',
      [SymbolKind.Number]: 'number',
      [SymbolKind.Boolean]: 'boolean',
      [SymbolKind.Array]: 'array',
      [SymbolKind.Object]: 'object',
      [SymbolKind.Key]: 'key',
      [SymbolKind.Null]: 'null',
      [SymbolKind.EnumMember]: 'enum_member',
      [SymbolKind.Struct]: 'struct',
      [SymbolKind.Event]: 'event',
      [SymbolKind.Operator]: 'operator',
      [SymbolKind.TypeParameter]: 'type_parameter',
    };
    return kindMap[kind] || 'unknown';
  }

  getValidSymbolKinds(): string[] {
    return [
      'file',
      'module',
      'namespace',
      'package',
      'class',
      'method',
      'property',
      'field',
      'constructor',
      'enum',
      'interface',
      'function',
      'variable',
      'constant',
      'string',
      'number',
      'boolean',
      'array',
      'object',
      'key',
      'null',
      'enum_member',
      'struct',
      'event',
      'operator',
      'type_parameter',
    ];
  }

  private async findSymbolPositionInFile(
    filePath: string,
    symbol: SymbolInformation
  ): Promise<Position> {
    try {
      const fileContent = readFileSync(filePath, 'utf-8');
      const lines = fileContent.split('\n');

      const range = symbol.location.range;
      const startLine = range.start.line;
      const endLine = range.end.line;

      process.stderr.write(
        `[DEBUG findSymbolPositionInFile] Searching for "${symbol.name}" in lines ${startLine}-${endLine}\n`
      );

      // Search within the symbol's range for the symbol name
      for (let lineNum = startLine; lineNum <= endLine && lineNum < lines.length; lineNum++) {
        const line = lines[lineNum];
        if (!line) continue;

        // Find all occurrences of the symbol name in this line
        let searchStart = 0;
        if (lineNum === startLine) {
          searchStart = range.start.character;
        }

        let searchEnd = line.length;
        if (lineNum === endLine) {
          searchEnd = range.end.character;
        }

        const searchText = line.substring(searchStart, searchEnd);
        const symbolIndex = searchText.indexOf(symbol.name);

        if (symbolIndex !== -1) {
          const actualCharacter = searchStart + symbolIndex;
          process.stderr.write(
            `[DEBUG findSymbolPositionInFile] Found "${symbol.name}" at line ${lineNum}, character ${actualCharacter}\n`
          );

          return {
            line: lineNum,
            character: actualCharacter,
          };
        }
      }

      // Fallback to range start if not found
      process.stderr.write(
        `[DEBUG findSymbolPositionInFile] Symbol "${symbol.name}" not found in range, using range start\n`
      );
      return range.start;
    } catch (error) {
      process.stderr.write(
        `[DEBUG findSymbolPositionInFile] Error reading file: ${error}, using range start\n`
      );
      return symbol.location.range.start;
    }
  }

  private stringToSymbolKind(kindStr: string): SymbolKind | null {
    const kindMap: Record<string, SymbolKind> = {
      file: SymbolKind.File,
      module: SymbolKind.Module,
      namespace: SymbolKind.Namespace,
      package: SymbolKind.Package,
      class: SymbolKind.Class,
      method: SymbolKind.Method,
      property: SymbolKind.Property,
      field: SymbolKind.Field,
      constructor: SymbolKind.Constructor,
      enum: SymbolKind.Enum,
      interface: SymbolKind.Interface,
      function: SymbolKind.Function,
      variable: SymbolKind.Variable,
      constant: SymbolKind.Constant,
      string: SymbolKind.String,
      number: SymbolKind.Number,
      boolean: SymbolKind.Boolean,
      array: SymbolKind.Array,
      object: SymbolKind.Object,
      key: SymbolKind.Key,
      null: SymbolKind.Null,
      enum_member: SymbolKind.EnumMember,
      struct: SymbolKind.Struct,
      event: SymbolKind.Event,
      operator: SymbolKind.Operator,
      type_parameter: SymbolKind.TypeParameter,
    };
    return kindMap[kindStr.toLowerCase()] || null;
  }

  async findSymbolsByName(
    filePath: string,
    symbolName: string,
    symbolKind?: string
  ): Promise<{ matches: SymbolMatch[]; warning?: string }> {
    process.stderr.write(
      `[DEBUG findSymbolsByName] Searching for symbol "${symbolName}" with kind "${symbolKind || 'any'}" in ${filePath}\n`
    );

    // Validate symbolKind if provided - return validation info for caller to handle
    let validationWarning: string | undefined;
    let effectiveSymbolKind = symbolKind;
    if (symbolKind && this.stringToSymbolKind(symbolKind) === null) {
      const validKinds = this.getValidSymbolKinds();
      validationWarning = `⚠️ Invalid symbol kind "${symbolKind}". Valid kinds are: ${validKinds.join(', ')}. Searching all symbol types instead.`;
      effectiveSymbolKind = undefined; // Reset to search all kinds
    }

    const symbols = await this.getDocumentSymbols(filePath);
    const matches: SymbolMatch[] = [];

    process.stderr.write(
      `[DEBUG findSymbolsByName] Got ${symbols.length} symbols from documentSymbols\n`
    );

    if (this.isDocumentSymbolArray(symbols)) {
      process.stderr.write(
        '[DEBUG findSymbolsByName] Processing DocumentSymbol[] (hierarchical format)\n'
      );
      // Handle DocumentSymbol[] (hierarchical)
      const flatSymbols = this.flattenDocumentSymbols(symbols);
      process.stderr.write(
        `[DEBUG findSymbolsByName] Flattened to ${flatSymbols.length} symbols\n`
      );

      for (const symbol of flatSymbols) {
        const nameMatches = symbol.name === symbolName || symbol.name.includes(symbolName);
        const kindMatches =
          !effectiveSymbolKind ||
          this.symbolKindToString(symbol.kind) === effectiveSymbolKind.toLowerCase();

        process.stderr.write(
          `[DEBUG findSymbolsByName] Checking DocumentSymbol: ${symbol.name} (${this.symbolKindToString(symbol.kind)}) - nameMatch: ${nameMatches}, kindMatch: ${kindMatches}\n`
        );

        if (nameMatches && kindMatches) {
          process.stderr.write(
            `[DEBUG findSymbolsByName] DocumentSymbol match: ${symbol.name} (kind=${symbol.kind}) using selectionRange ${symbol.selectionRange.start.line}:${symbol.selectionRange.start.character}\n`
          );

          matches.push({
            name: symbol.name,
            kind: symbol.kind,
            position: symbol.selectionRange.start,
            range: symbol.range,
            detail: symbol.detail,
          });
        }
      }
    } else {
      process.stderr.write(
        '[DEBUG findSymbolsByName] Processing SymbolInformation[] (flat format)\n'
      );
      // Handle SymbolInformation[] (flat)
      for (const symbol of symbols) {
        const nameMatches = symbol.name === symbolName || symbol.name.includes(symbolName);
        const kindMatches =
          !effectiveSymbolKind ||
          this.symbolKindToString(symbol.kind) === effectiveSymbolKind.toLowerCase();

        process.stderr.write(
          `[DEBUG findSymbolsByName] Checking SymbolInformation: ${symbol.name} (${this.symbolKindToString(symbol.kind)}) - nameMatch: ${nameMatches}, kindMatch: ${kindMatches}\n`
        );

        if (nameMatches && kindMatches) {
          process.stderr.write(
            `[DEBUG findSymbolsByName] SymbolInformation match: ${symbol.name} (kind=${symbol.kind}) at ${symbol.location.range.start.line}:${symbol.location.range.start.character} to ${symbol.location.range.end.line}:${symbol.location.range.end.character}\n`
          );

          // For SymbolInformation, we need to find the actual symbol name position within the range
          // by reading the file content and searching for the symbol name
          const position = await this.findSymbolPositionInFile(filePath, symbol);

          process.stderr.write(
            `[DEBUG findSymbolsByName] Found symbol position in file: ${position.line}:${position.character}\n`
          );

          matches.push({
            name: symbol.name,
            kind: symbol.kind,
            position: position,
            range: symbol.location.range,
            detail: undefined, // SymbolInformation doesn't have detail
          });
        }
      }
    }

    process.stderr.write(`[DEBUG findSymbolsByName] Found ${matches.length} matching symbols\n`);

    // If a specific symbol kind was requested but no matches found, try searching all kinds as fallback
    let fallbackWarning: string | undefined;
    if (effectiveSymbolKind && matches.length === 0) {
      process.stderr.write(
        `[DEBUG findSymbolsByName] No matches found for kind "${effectiveSymbolKind}", trying fallback search for all kinds\n`
      );

      const fallbackMatches: SymbolMatch[] = [];

      if (this.isDocumentSymbolArray(symbols)) {
        const flatSymbols = this.flattenDocumentSymbols(symbols);
        for (const symbol of flatSymbols) {
          const nameMatches = symbol.name === symbolName || symbol.name.includes(symbolName);
          if (nameMatches) {
            fallbackMatches.push({
              name: symbol.name,
              kind: symbol.kind,
              position: symbol.selectionRange.start,
              range: symbol.range,
              detail: symbol.detail,
            });
          }
        }
      } else {
        for (const symbol of symbols) {
          const nameMatches = symbol.name === symbolName || symbol.name.includes(symbolName);
          if (nameMatches) {
            const position = await this.findSymbolPositionInFile(filePath, symbol);
            fallbackMatches.push({
              name: symbol.name,
              kind: symbol.kind,
              position: position,
              range: symbol.location.range,
              detail: undefined,
            });
          }
        }
      }

      if (fallbackMatches.length > 0) {
        const foundKinds = [
          ...new Set(fallbackMatches.map((m) => this.symbolKindToString(m.kind))),
        ];
        fallbackWarning = `⚠️ No symbols found with kind "${effectiveSymbolKind}". Found ${fallbackMatches.length} symbol(s) with name "${symbolName}" of other kinds: ${foundKinds.join(', ')}.`;
        matches.push(...fallbackMatches);
        process.stderr.write(
          `[DEBUG findSymbolsByName] Fallback search found ${fallbackMatches.length} additional matches\n`
        );
      }
    }

    const combinedWarning = [validationWarning, fallbackWarning].filter(Boolean).join(' ');
    return { matches, warning: combinedWarning || undefined };
  }

  /**
   * Wait for LSP server to become idle after a change.
   * Uses multiple heuristics to determine when diagnostics are likely complete.
   */
  private async waitForDiagnosticsIdle(
    serverState: ServerState,
    fileUri: string,
    options: {
      maxWaitTime?: number; // Maximum time to wait in ms (default: 1000)
      idleTime?: number; // Time without updates to consider idle in ms (default: 100)
      checkInterval?: number; // How often to check for updates in ms (default: 50)
    } = {}
  ): Promise<void> {
    const { maxWaitTime = 1000, idleTime = 100, checkInterval = 50 } = options;

    const startTime = Date.now();
    let lastVersion = serverState.diagnosticVersions.get(fileUri) ?? -1;
    let lastUpdateTime = serverState.lastDiagnosticUpdate.get(fileUri) ?? startTime;

    process.stderr.write(
      `[DEBUG waitForDiagnosticsIdle] Waiting for diagnostics to stabilize for ${fileUri}\n`
    );

    while (Date.now() - startTime < maxWaitTime) {
      await new Promise((resolve) => setTimeout(resolve, checkInterval));

      const currentVersion = serverState.diagnosticVersions.get(fileUri) ?? -1;
      const currentUpdateTime = serverState.lastDiagnosticUpdate.get(fileUri) ?? lastUpdateTime;

      // Check if version changed
      if (currentVersion !== lastVersion) {
        process.stderr.write(
          `[DEBUG waitForDiagnosticsIdle] Version changed from ${lastVersion} to ${currentVersion}\n`
        );
        lastVersion = currentVersion;
        lastUpdateTime = currentUpdateTime;
        continue;
      }

      // Check if enough time has passed without updates
      const timeSinceLastUpdate = Date.now() - currentUpdateTime;
      if (timeSinceLastUpdate >= idleTime) {
        process.stderr.write(
          `[DEBUG waitForDiagnosticsIdle] Server appears idle after ${timeSinceLastUpdate}ms without updates\n`
        );
        return;
      }
    }

    process.stderr.write(
      `[DEBUG waitForDiagnosticsIdle] Max wait time reached (${maxWaitTime}ms)\n`
    );
  }

  async getDiagnostics(filePath: string): Promise<Diagnostic[]> {
    process.stderr.write(`[DEBUG getDiagnostics] Requesting diagnostics for ${filePath}\n`);

    const serverState = await this.getServer(filePath);

    // Wait for the server to be fully initialized
    await serverState.initializationPromise;

    // Ensure the file is opened and synced with the LSP server
    await this.ensureFileOpen(serverState, filePath);

    // First, check if we have cached diagnostics from publishDiagnostics
    const fileUri = pathToUri(filePath);
    const cachedDiagnostics = serverState.diagnostics.get(fileUri);

    if (cachedDiagnostics !== undefined) {
      process.stderr.write(
        `[DEBUG getDiagnostics] Returning ${cachedDiagnostics.length} cached diagnostics from publishDiagnostics\n`
      );
      return cachedDiagnostics;
    }

    // If no cached diagnostics, try the pull-based textDocument/diagnostic
    process.stderr.write(
      '[DEBUG getDiagnostics] No cached diagnostics, trying textDocument/diagnostic request\n'
    );

    try {
      const result = await this.sendRequest(serverState.process, 'textDocument/diagnostic', {
        textDocument: { uri: fileUri },
      });

      process.stderr.write(
        `[DEBUG getDiagnostics] Result type: ${typeof result}, has kind: ${result && typeof result === 'object' && 'kind' in result}\n`
      );

      if (result && typeof result === 'object' && 'kind' in result) {
        const report = result as DocumentDiagnosticReport;

        if (report.kind === 'full' && report.items) {
          process.stderr.write(
            `[DEBUG getDiagnostics] Full report with ${report.items.length} diagnostics\n`
          );
          return report.items;
        }
        if (report.kind === 'unchanged') {
          process.stderr.write('[DEBUG getDiagnostics] Unchanged report (no new diagnostics)\n');
          return [];
        }
      }

      process.stderr.write(
        '[DEBUG getDiagnostics] Unexpected response format, returning empty array\n'
      );
      return [];
    } catch (error) {
      // Some LSP servers may not support textDocument/diagnostic
      // Try falling back to waiting for publishDiagnostics notifications
      process.stderr.write(
        `[DEBUG getDiagnostics] textDocument/diagnostic not supported or failed: ${error}. Waiting for publishDiagnostics...\n`
      );

      // Wait for the server to become idle and publish diagnostics
      // MCP tools can afford longer wait times for better reliability
      await this.waitForDiagnosticsIdle(serverState, fileUri, {
        maxWaitTime: 5000, // 5 seconds - generous timeout for MCP usage
        idleTime: 300, // 300ms idle time to ensure all diagnostics are received
      });

      // Check again for cached diagnostics
      const diagnosticsAfterWait = serverState.diagnostics.get(fileUri);
      if (diagnosticsAfterWait !== undefined) {
        process.stderr.write(
          `[DEBUG getDiagnostics] Returning ${diagnosticsAfterWait.length} diagnostics after waiting for idle state\n`
        );
        return diagnosticsAfterWait;
      }

      // If still no diagnostics, try triggering publishDiagnostics by making a no-op change
      process.stderr.write(
        '[DEBUG getDiagnostics] No diagnostics yet, triggering publishDiagnostics with no-op change\n'
      );

      try {
        // Get current file content
        const fileContent = readFileSync(filePath, 'utf-8');

        // Send a no-op change notification (add and remove a space at the end)
        await this.sendNotification(serverState.process, 'textDocument/didChange', {
          textDocument: {
            uri: fileUri,
            version: Date.now(), // Use timestamp as version
          },
          contentChanges: [
            {
              text: `${fileContent} `,
            },
          ],
        });

        // Immediately revert the change
        await this.sendNotification(serverState.process, 'textDocument/didChange', {
          textDocument: {
            uri: fileUri,
            version: Date.now() + 1,
          },
          contentChanges: [
            {
              text: fileContent,
            },
          ],
        });

        // Wait for the server to process the changes and become idle
        // After making changes, servers may need time to re-analyze
        await this.waitForDiagnosticsIdle(serverState, fileUri, {
          maxWaitTime: 3000, // 3 seconds after triggering changes
          idleTime: 300, // Consistent idle time for reliability
        });

        // Check one more time
        const diagnosticsAfterTrigger = serverState.diagnostics.get(fileUri);
        if (diagnosticsAfterTrigger !== undefined) {
          process.stderr.write(
            `[DEBUG getDiagnostics] Returning ${diagnosticsAfterTrigger.length} diagnostics after triggering publishDiagnostics\n`
          );
          return diagnosticsAfterTrigger;
        }
      } catch (triggerError) {
        process.stderr.write(
          `[DEBUG getDiagnostics] Failed to trigger publishDiagnostics: ${triggerError}\n`
        );
      }

      return [];
    }
  }

  async preloadServers(debug = true): Promise<void> {
    if (debug) {
      process.stderr.write('Scanning configured server directories for supported file types\n');
    }

    const serversToStart = new Set<LSPServerConfig>();

    // Scan each server's rootDir for its configured extensions
    for (const serverConfig of this.config.servers) {
      const serverDir = serverConfig.rootDir || process.cwd();

      if (debug) {
        process.stderr.write(
          `Scanning ${serverDir} for extensions: ${serverConfig.extensions.join(', ')}\n`
        );
      }

      try {
        const ig = await loadGitignore(serverDir);
        const foundExtensions = await scanDirectoryForExtensions(serverDir, 3, ig, false);

        // Check if any of this server's extensions are found in its rootDir
        const hasMatchingExtensions = serverConfig.extensions.some((ext) =>
          foundExtensions.has(ext)
        );

        if (hasMatchingExtensions) {
          serversToStart.add(serverConfig);
          if (debug) {
            const matchingExts = serverConfig.extensions.filter((ext) => foundExtensions.has(ext));
            process.stderr.write(
              `Found matching extensions in ${serverDir}: ${matchingExts.join(', ')}\n`
            );
          }
        }
      } catch (error) {
        if (debug) {
          process.stderr.write(`Failed to scan ${serverDir}: ${error}\n`);
        }
      }
    }

    if (debug) {
      process.stderr.write(`Starting ${serversToStart.size} LSP servers...\n`);
    }

    const startPromises = Array.from(serversToStart).map(async (serverConfig) => {
      try {
        const key = JSON.stringify(serverConfig);
        if (!this.servers.has(key)) {
          if (debug) {
            process.stderr.write(`Preloading LSP server: ${serverConfig.command.join(' ')}\n`);
          }
          const serverState = await this.startServer(serverConfig);
          this.servers.set(key, serverState);
          await serverState.initializationPromise;

          // Ensure workspace context by opening a file if none are open
          if (serverState.openFiles.size === 0) {
            if (debug) {
              process.stderr.write(
                `Server for ${serverConfig.extensions.join(',')} needs workspace context during preload\n`
              );
            }
            const foundFile = await this.findFileInDirectory(
              serverConfig.rootDir || process.cwd(),
              serverConfig.extensions
            );
            if (foundFile) {
              await this.ensureFileOpen(serverState, foundFile);
              if (debug) {
                process.stderr.write(`Opened ${foundFile} for workspace context during preload\n`);
              }
            }
          }

          // Wait for workspace indexing
          await this.waitForWorkspaceIndexing(serverState);
          if (debug) {
            process.stderr.write(
              `Successfully preloaded LSP server for extensions: ${serverConfig.extensions.join(', ')}\n`
            );
          }
        }
      } catch (error) {
        process.stderr.write(
          `Failed to preload LSP server for ${serverConfig.extensions.join(', ')}: ${error}\n`
        );
      }
    });

    await Promise.all(startPromises);
    if (debug) {
      process.stderr.write('LSP server preloading completed\n');
    }
  }

  async getClassMembers(filePath: string, className: string): Promise<SymbolMatch[]> {
    const symbols = await this.getDocumentSymbols(filePath);
    const members: SymbolMatch[] = [];

    process.stderr.write(
      `[DEBUG getClassMembers] Looking for class "${className}" members in ${filePath}\n`
    );

    if (this.isDocumentSymbolArray(symbols)) {
      // Handle hierarchical DocumentSymbol format
      const classSymbol = this.findClassSymbol(symbols, className);
      if (classSymbol?.children) {
        for (const child of classSymbol.children) {
          // Try multiple approaches to get accurate type information
          const position = child.selectionRange.start;
          let typeInfo: TypeInfo | undefined;

          // For methods, try signature help first
          if (child.kind === SymbolKind.Method || child.kind === SymbolKind.Constructor) {
            const signatureHelp = await this.getSignatureHelp(filePath, position);
            if (signatureHelp && signatureHelp.signatures.length > 0) {
              const sig = signatureHelp.signatures[0];
              if (sig) {
                typeInfo = {};

                // Parse return type from signature
                const returnTypeMatch = sig.label.match(/\)\s*(?::|=>|->)\s*(.+)$/);
                if (returnTypeMatch?.[1]) {
                  typeInfo.returnType = returnTypeMatch[1].trim();
                }

                // Extract parameters
                if (sig.parameters) {
                  typeInfo.parameters = [];
                  for (const param of sig.parameters) {
                    const paramLabel =
                      typeof param.label === 'string'
                        ? param.label
                        : sig.label.substring(param.label[0], param.label[1]);

                    const paramMatch = paramLabel.match(/(\w+)(\?)?:\s*(.+?)(?:\s*=\s*(.+))?$/);
                    if (paramMatch) {
                      const [, name, optional, type, defaultValue] = paramMatch;
                      const paramInfo: ParameterInfo = {
                        name: name || '',
                        type: type?.trim() || paramLabel,
                      };
                      if (optional || defaultValue) {
                        paramInfo.isOptional = true;
                      }
                      if (defaultValue) {
                        paramInfo.defaultValue = defaultValue.trim();
                      }
                      typeInfo.parameters.push(paramInfo);
                    }
                  }
                }
              }
            }
          }

          // Get hover info for detail and type parsing
          let hoverInfo: Hover | null = null;
          let detail = child.detail;

          // For properties/fields, try type definition
          if (
            !typeInfo &&
            (child.kind === SymbolKind.Property || child.kind === SymbolKind.Field)
          ) {
            // First get hover info to extract the type name
            hoverInfo = await this.getHover(filePath, position);
            if (hoverInfo) {
              detail = this.extractHoverText(hoverInfo);
              typeInfo = this.parseTypeInfo(this.extractHoverText(hoverInfo), child.name);

              // Now try to get the type definition location
              const typeDefinitions = await this.getTypeDefinition(filePath, position);
              if (typeDefinitions.length > 0) {
                // Get the first type definition location
                const typeDef = typeDefinitions[0];
                if (typeDef) {
                  if (!typeInfo) {
                    typeInfo = {};
                  }
                  typeInfo.definitionLocation = {
                    uri: typeDef.uri,
                    line: typeDef.range.start.line,
                    character: typeDef.range.start.character,
                  };
                }
              }
            }
          }

          // Fallback to hover info if no type info yet
          if (!typeInfo) {
            if (!hoverInfo) {
              hoverInfo = await this.getHover(filePath, position);
            }
            detail = this.extractHoverText(hoverInfo) || child.detail;
            if (hoverInfo) {
              typeInfo = this.parseTypeInfo(this.extractHoverText(hoverInfo), child.name);

              // Try to get type definition if we haven't already
              if (typeInfo && !typeInfo.definitionLocation) {
                const typeDefinitions = await this.getTypeDefinition(filePath, position);
                if (typeDefinitions.length > 0) {
                  const typeDef = typeDefinitions[0];
                  if (typeDef) {
                    typeInfo.definitionLocation = {
                      uri: typeDef.uri,
                      line: typeDef.range.start.line,
                      character: typeDef.range.start.character,
                    };
                  }
                }
              }
            }
          }

          members.push({
            name: child.name,
            kind: child.kind,
            position: position,
            range: child.range,
            detail: detail,
            typeInfo: typeInfo,
          });
        }
      }
    } else {
      // Handle flat SymbolInformation format
      const classSymbol = symbols.find((s) => s.name === className && s.kind === SymbolKind.Class);

      if (classSymbol) {
        for (const symbol of symbols) {
          if (symbol.containerName === className) {
            const position = await this.findSymbolPositionInFile(filePath, symbol);
            let typeInfo: TypeInfo | undefined;

            // Similar approach for SymbolInformation
            if (symbol.kind === SymbolKind.Method || symbol.kind === SymbolKind.Constructor) {
              const signatureHelp = await this.getSignatureHelp(filePath, position);
              if (signatureHelp && signatureHelp.signatures.length > 0) {
                const sig = signatureHelp.signatures[0];
                if (sig) {
                  typeInfo = {};

                  const returnTypeMatch = sig.label.match(/\)\s*(?::|=>|->)\s*(.+)$/);
                  if (returnTypeMatch?.[1]) {
                    typeInfo.returnType = returnTypeMatch[1].trim();
                  }

                  if (sig.parameters) {
                    typeInfo.parameters = [];
                    for (const param of sig.parameters) {
                      const paramLabel =
                        typeof param.label === 'string'
                          ? param.label
                          : sig.label.substring(param.label[0], param.label[1]);

                      const paramMatch = paramLabel.match(/(\w+)(\?)?:\s*(.+?)(?:\s*=\s*(.+))?$/);
                      if (paramMatch) {
                        const [, name, optional, type, defaultValue] = paramMatch;
                        const paramInfo: ParameterInfo = {
                          name: name || '',
                          type: type?.trim() || paramLabel,
                          isOptional: !!optional || !!defaultValue,
                        };
                        if (defaultValue) {
                          paramInfo.defaultValue = defaultValue.trim();
                        }
                        typeInfo.parameters.push(paramInfo);
                      }
                    }
                  }
                }
              }
            }

            // Get hover info for detail and type parsing
            let hoverInfo: Hover | null = null;
            let detail: string | undefined;

            // For properties/fields, try type definition
            if (
              !typeInfo &&
              (symbol.kind === SymbolKind.Property || symbol.kind === SymbolKind.Field)
            ) {
              hoverInfo = await this.getHover(filePath, position);
              if (hoverInfo) {
                detail = this.extractHoverText(hoverInfo);
                typeInfo = this.parseTypeInfo(this.extractHoverText(hoverInfo), symbol.name);

                // Get type definition location
                const typeDefinitions = await this.getTypeDefinition(filePath, position);
                if (typeDefinitions.length > 0) {
                  const typeDef = typeDefinitions[0];
                  if (typeDef) {
                    if (!typeInfo) {
                      typeInfo = {};
                    }
                    typeInfo.definitionLocation = {
                      uri: typeDef.uri,
                      line: typeDef.range.start.line,
                      character: typeDef.range.start.character,
                    };
                  }
                }
              }
            }

            // Fallback to hover info if no type info yet
            if (!typeInfo) {
              if (!hoverInfo) {
                hoverInfo = await this.getHover(filePath, position);
              }
              detail = this.extractHoverText(hoverInfo);
              if (hoverInfo) {
                typeInfo = this.parseTypeInfo(this.extractHoverText(hoverInfo), symbol.name);

                // Try to get type definition if we haven't already
                if (typeInfo && !typeInfo.definitionLocation) {
                  const typeDefinitions = await this.getTypeDefinition(filePath, position);
                  if (typeDefinitions.length > 0) {
                    const typeDef = typeDefinitions[0];
                    if (typeDef) {
                      typeInfo.definitionLocation = {
                        uri: typeDef.uri,
                        line: typeDef.range.start.line,
                        character: typeDef.range.start.character,
                      };
                    }
                  }
                }
              }
            }

            members.push({
              name: symbol.name,
              kind: symbol.kind,
              position: position,
              range: symbol.location.range,
              detail: detail,
              typeInfo: typeInfo,
            });
          }
        }
      }
    }

    process.stderr.write(
      `[DEBUG getClassMembers] Found ${members.length} members for class "${className}"\n`
    );

    return members;
  }

  private findClassSymbol(symbols: DocumentSymbol[], className: string): DocumentSymbol | null {
    for (const symbol of symbols) {
      if (symbol.name === className && symbol.kind === SymbolKind.Class) {
        return symbol;
      }
      if (symbol.children) {
        const found = this.findClassSymbol(symbol.children, className);
        if (found) return found;
      }
    }
    return null;
  }

  async getMethodSignature(
    filePath: string,
    methodName: string,
    className?: string
  ): Promise<{ name: string; position: Position; signature: string; typeInfo?: TypeInfo }[]> {
    const signatures: {
      name: string;
      position: Position;
      signature: string;
      typeInfo?: TypeInfo;
    }[] = [];

    process.stderr.write(
      `[DEBUG getMethodSignature] Looking for method "${methodName}"${className ? ` in class "${className}"` : ''} in ${filePath}\n`
    );

    const result = await this.findSymbolsByName(filePath, methodName, 'method');
    const { matches } = result;

    let filteredMatches = matches;
    if (className) {
      const symbols = await this.getDocumentSymbols(filePath);
      filteredMatches = [];

      if (this.isDocumentSymbolArray(symbols)) {
        const classSymbol = this.findClassSymbol(symbols, className);
        if (classSymbol?.children) {
          for (const match of matches) {
            for (const child of classSymbol.children) {
              if (
                child.name === match.name &&
                child.selectionRange.start.line === match.position.line &&
                child.selectionRange.start.character === match.position.character
              ) {
                filteredMatches.push(match);
                break;
              }
            }
          }
        }
      } else {
        filteredMatches = matches.filter((match) => {
          const symbol = symbols.find(
            (s) =>
              s.name === match.name &&
              s.location.range.start.line === match.range.start.line &&
              s.location.range.start.character === match.range.start.character
          );
          return symbol && symbol.containerName === className;
        });
      }
    }

    for (const match of filteredMatches) {
      const signatureHelp = await this.getSignatureHelp(filePath, match.position);

      if (signatureHelp && signatureHelp.signatures.length > 0) {
        const sig = signatureHelp.signatures[0];
        if (sig) {
          const typeInfo: TypeInfo = { parameters: [] };

          const returnTypeMatch = sig.label.match(/\)\s*(?::|=>|->)\s*(.+)$/);
          if (returnTypeMatch?.[1]) {
            typeInfo.returnType = returnTypeMatch[1].trim();
          }

          if (sig.parameters && sig.parameters.length > 0) {
            for (const param of sig.parameters) {
              const paramLabel =
                typeof param.label === 'string'
                  ? param.label
                  : sig.label.substring(param.label[0], param.label[1]);
              const paramMatch = paramLabel.match(/(\w+)(\?)?:\s*(.+?)(?:\s*=\s*(.+))?$/);

              if (paramMatch) {
                const [, name, optional, type, defaultValue] = paramMatch;
                const paramInfo: ParameterInfo = {
                  name: name || '',
                  type: type?.trim() || paramLabel,
                };
                if (optional || defaultValue) paramInfo.isOptional = true;
                if (defaultValue) paramInfo.defaultValue = defaultValue.trim();

                typeInfo.parameters?.push(paramInfo);
              }
            }
          }

          signatures.push({
            name: match.name,
            position: match.position,
            signature: sig.label,
            typeInfo: typeInfo,
          });
        }
      } else {
        const hoverInfo = await this.getHover(filePath, match.position);
        if (hoverInfo) {
          const hoverText = this.extractHoverText(hoverInfo);
          const typeInfo = this.parseTypeInfo(hoverText, match.name);
          signatures.push({
            name: match.name,
            position: match.position,
            signature: hoverText || '',
            typeInfo: typeInfo,
          });
        }
      }
    }

    process.stderr.write(
      `[DEBUG getMethodSignature] Found ${signatures.length} signatures for method "${methodName}"\n`
    );

    return signatures;
  }

  private async readUriContent(uri: string): Promise<string> {
    const filePath = uri.startsWith('file://') ? uri.substring(7) : uri;
    try {
      return readFileSync(filePath, 'utf-8');
    } catch (error) {
      process.stderr.write(`[DEBUG readUriContent] Error reading file: ${error}\n`);
      return '';
    }
  }

  async getHover(filePath: string, position: Position): Promise<Hover | null> {
    const serverState = await this.getServer(filePath);
    await serverState.initializationPromise;

    try {
      const result = await this.sendRequest(serverState.process, 'textDocument/hover', {
        textDocument: { uri: pathToUri(filePath) },
        position: position,
      });

      if (result && typeof result === 'object' && result !== null && 'contents' in result) {
        return result as Hover;
      }
    } catch (error) {
      process.stderr.write(`[DEBUG getHover] Error getting hover info: ${error}\n`);
    }

    return null;
  }

  async getSignatureHelp(
    filePath: string,
    position: Position,
    triggerCharacter?: string
  ): Promise<SignatureHelp | null> {
    process.stderr.write(
      `[DEBUG getSignatureHelp] Getting signature help for ${filePath} at ${position.line}:${position.character}${triggerCharacter ? ` triggered by '${triggerCharacter}'` : ''}\n`
    );

    const positions = this.generateMultiPositions(position);

    for (const pos of positions) {
      try {
        const result = await this.getSignatureHelpAtPosition(filePath, pos, triggerCharacter);
        if (result && result.signatures.length > 0) {
          process.stderr.write(
            `[DEBUG getSignatureHelp] Found ${result.signatures.length} signatures at position ${pos.line}:${pos.character}\n`
          );
          return result;
        }
      } catch (error) {
        process.stderr.write(
          `[DEBUG getSignatureHelp] Error at position ${pos.line}:${pos.character}: ${error}\n`
        );
      }
    }

    process.stderr.write('[DEBUG getSignatureHelp] No signature help found at any position\n');
    return null;
  }

  private async getSignatureHelpAtPosition(
    filePath: string,
    position: Position,
    triggerCharacter?: string
  ): Promise<SignatureHelp | null> {
    const serverState = await this.getServer(filePath);
    await serverState.initializationPromise;
    await this.ensureFileOpen(serverState, filePath);

    try {
      const result = await this.sendRequest(serverState.process, 'textDocument/signatureHelp', {
        textDocument: { uri: pathToUri(filePath) },
        position: position,
        context: triggerCharacter
          ? {
              triggerKind: 2, // TriggerCharacter
              triggerCharacter: triggerCharacter,
            }
          : {
              triggerKind: 1, // Invoked
            },
      });

      if (result && typeof result === 'object' && 'signatures' in result) {
        return result as SignatureHelp;
      }
    } catch (error) {
      process.stderr.write(
        `[DEBUG getSignatureHelpAtPosition] Error getting signature help: ${error}\n`
      );
    }

    return null;
  }

  /**
   * Get code completion suggestions at a specific position in a file
   */
  async getCompletion(
    filePath: string,
    position: Position,
    triggerCharacter?: string,
    maxResults?: number
  ): Promise<CompletionItem[]> {
    process.stderr.write(
      `[DEBUG getCompletion] Getting completion for ${filePath} at ${position.line}:${position.character}${triggerCharacter ? ` triggered by '${triggerCharacter}'` : ''}\n`
    );

    const positions = this.generateMultiPositions(position);

    for (const pos of positions) {
      try {
        const result = await this.getCompletionAtPosition(filePath, pos, triggerCharacter);
        if (result && result.length > 0) {
          process.stderr.write(
            `[DEBUG getCompletion] Found ${result.length} completions at position ${pos.line}:${pos.character}\n`
          );

          // Apply max results limit if specified
          const finalResults = maxResults ? result.slice(0, maxResults) : result;
          return finalResults;
        }
      } catch (error) {
        process.stderr.write(
          `[DEBUG getCompletion] Error at position ${pos.line}:${pos.character}: ${error}\n`
        );
      }
    }

    process.stderr.write('[DEBUG getCompletion] No completions found at any position\n');
    return [];
  }

  /**
   * Resolve additional details for a completion item
   */
  async resolveCompletionItem(filePath: string, item: CompletionItem): Promise<CompletionItem> {
    try {
      const serverState = await this.getServer(filePath);
      await serverState.initializationPromise;

      const result = await this.sendRequest(serverState.process, 'completionItem/resolve', item);

      if (result && typeof result === 'object') {
        return result as CompletionItem;
      }

      // Return original item if resolution fails
      return item;
    } catch (error) {
      process.stderr.write(
        `[DEBUG resolveCompletionItem] Error resolving completion item: ${error}\n`
      );
      return item;
    }
  }

  /**
   * Helper method to get completions at a specific position
   */
  private async getCompletionAtPosition(
    filePath: string,
    position: Position,
    triggerCharacter?: string
  ): Promise<CompletionItem[]> {
    const serverState = await this.getServer(filePath);
    await serverState.initializationPromise;
    await this.ensureFileOpen(serverState, filePath);

    const context: CompletionContext = {
      triggerKind: triggerCharacter
        ? CompletionTriggerKind.TriggerCharacter
        : CompletionTriggerKind.Invoked,
      triggerCharacter: triggerCharacter,
    };

    const result = await this.sendRequest(serverState.process, 'textDocument/completion', {
      textDocument: { uri: pathToUri(filePath) },
      position: position,
      context: context,
    });

    // Handle both CompletionList and CompletionItem[] responses
    if (Array.isArray(result)) {
      return result as CompletionItem[];
    }

    if (result && typeof result === 'object' && 'items' in result) {
      const completionList = result as CompletionList;
      return completionList.items || [];
    }

    return [];
  }

  /**
   * Generate multiple position combinations for better symbol resolution
   * This handles different indexing conventions used by various editors and clients
   */
  private generateMultiPositions(position: Position): Position[] {
    const originalLine = position.line;
    const originalCharacter = position.character;

    return [
      // Original position (already 0-indexed)
      { line: originalLine, character: originalCharacter },
      // Adjust character by -1 (in case character was 1-indexed)
      { line: originalLine, character: Math.max(0, originalCharacter - 1) },
      // Adjust line by -1 (in case line was 1-indexed)
      { line: Math.max(0, originalLine - 1), character: originalCharacter },
      // Adjust both line and character by -1 (both were 1-indexed)
      { line: Math.max(0, originalLine - 1), character: Math.max(0, originalCharacter - 1) },
    ];
  }

  /**
   * Convert completion item kind to readable string
   */
  completionItemKindToString(kind: CompletionItemKind): string {
    const kindMap: Record<CompletionItemKind, string> = {
      [CompletionItemKind.Text]: 'text',
      [CompletionItemKind.Method]: 'method',
      [CompletionItemKind.Function]: 'function',
      [CompletionItemKind.Constructor]: 'constructor',
      [CompletionItemKind.Field]: 'field',
      [CompletionItemKind.Variable]: 'variable',
      [CompletionItemKind.Class]: 'class',
      [CompletionItemKind.Interface]: 'interface',
      [CompletionItemKind.Module]: 'module',
      [CompletionItemKind.Property]: 'property',
      [CompletionItemKind.Unit]: 'unit',
      [CompletionItemKind.Value]: 'value',
      [CompletionItemKind.Enum]: 'enum',
      [CompletionItemKind.Keyword]: 'keyword',
      [CompletionItemKind.Snippet]: 'snippet',
      [CompletionItemKind.Color]: 'color',
      [CompletionItemKind.File]: 'file',
      [CompletionItemKind.Reference]: 'reference',
      [CompletionItemKind.Folder]: 'folder',
      [CompletionItemKind.EnumMember]: 'enumMember',
      [CompletionItemKind.Constant]: 'constant',
      [CompletionItemKind.Struct]: 'struct',
      [CompletionItemKind.Event]: 'event',
      [CompletionItemKind.Operator]: 'operator',
      [CompletionItemKind.TypeParameter]: 'typeParameter',
    };

    return kindMap[kind] || 'unknown';
  }

  private async getCompletionItem(
    filePath: string,
    position: Position,
    triggerCharacter?: string
  ): Promise<
    | Array<{
        label: string;
        kind?: number;
        detail?: string;
        documentation?: string;
        insertText?: string;
      }>
    | undefined
  > {
    const serverState = await this.getServer(filePath);
    await serverState.initializationPromise;
    await this.ensureFileOpen(serverState, filePath);

    try {
      const result = await this.sendRequest(serverState.process, 'textDocument/completion', {
        textDocument: { uri: pathToUri(filePath) },
        position: position,
        context: {
          triggerKind: triggerCharacter ? 2 : 1, // 2 = TriggerCharacter, 1 = Invoked
          triggerCharacter: triggerCharacter,
        },
      });

      if (Array.isArray(result)) {
        return result as Array<{
          label: string;
          kind?: number;
          detail?: string;
          documentation?: string;
          insertText?: string;
        }>;
      }
      if (result && typeof result === 'object' && 'items' in result) {
        return (
          result as {
            items: Array<{
              label: string;
              kind?: number;
              detail?: string;
              documentation?: string;
              insertText?: string;
            }>;
          }
        ).items;
      }
    } catch (error) {
      process.stderr.write(`[DEBUG getCompletionItem] Error getting completion: ${error}\n`);
    }

    return undefined;
  }

  private async getTypeDefinition(filePath: string, position: Position): Promise<Location[]> {
    const serverState = await this.getServer(filePath);
    await serverState.initializationPromise;
    await this.ensureFileOpen(serverState, filePath);

    try {
      const result = await this.sendRequest(serverState.process, 'textDocument/typeDefinition', {
        textDocument: { uri: pathToUri(filePath) },
        position: position,
      });

      if (Array.isArray(result)) {
        return result.map((loc: LSPLocation) => ({
          uri: loc.uri,
          range: loc.range,
        }));
      }
      if (result && typeof result === 'object' && 'uri' in result) {
        const location = result as LSPLocation;
        return [
          {
            uri: location.uri,
            range: location.range,
          },
        ];
      }
    } catch (error) {
      process.stderr.write(`[DEBUG getTypeDefinition] Error getting type definition: ${error}\n`);
    }

    return [];
  }

  /**
   * Format an entire document using LSP textDocument/formatting
   */
  async formatDocument(filePath: string, options: FormattingOptions): Promise<TextEdit[]> {
    process.stderr.write(`[DEBUG formatDocument] Formatting document ${filePath}\n`);

    const serverState = await this.getServer(filePath);
    await serverState.initializationPromise;
    await this.ensureFileOpen(serverState, filePath);

    try {
      const result = await this.sendRequest(serverState.process, 'textDocument/formatting', {
        textDocument: { uri: pathToUri(filePath) },
        options: options,
      });

      process.stderr.write(
        `[DEBUG formatDocument] Received ${Array.isArray(result) ? result.length : 0} text edits\n`
      );

      if (Array.isArray(result)) {
        return result as TextEdit[];
      }

      return [];
    } catch (error) {
      process.stderr.write(`[DEBUG formatDocument] Error formatting document: ${error}\n`);
      throw error;
    }
  }

  /**
   * Format a specific range in a document using LSP textDocument/rangeFormatting
   */
  async formatRange(
    filePath: string,
    range: Range,
    options: FormattingOptions
  ): Promise<TextEdit[]> {
    process.stderr.write(
      `[DEBUG formatRange] Formatting range ${range.start.line}-${range.end.line} in ${filePath}\n`
    );

    const serverState = await this.getServer(filePath);
    await serverState.initializationPromise;
    await this.ensureFileOpen(serverState, filePath);

    try {
      const result = await this.sendRequest(serverState.process, 'textDocument/rangeFormatting', {
        textDocument: { uri: pathToUri(filePath) },
        range: range,
        options: options,
      });

      process.stderr.write(
        `[DEBUG formatRange] Received ${Array.isArray(result) ? result.length : 0} text edits\n`
      );

      if (Array.isArray(result)) {
        return result as TextEdit[];
      }

      return [];
    } catch (error) {
      process.stderr.write(`[DEBUG formatRange] Error formatting range: ${error}\n`);
      throw error;
    }
  }

  /**
   * Apply text edits to file content and optionally write to file
   */
  async applyTextEdits(
    filePath: string,
    textEdits: TextEdit[],
    applyToFile = false
  ): Promise<{ content: string; summary: string[] }> {
    process.stderr.write(
      `[DEBUG applyTextEdits] Applying ${textEdits.length} edits to ${filePath}\n`
    );

    // Read current file content
    let content: string;
    try {
      content = readFileSync(filePath, 'utf-8');
    } catch (error) {
      throw new Error(`Failed to read file ${filePath}: ${error}`);
    }

    // Sort edits by position (reverse order to apply from end to beginning)
    const sortedEdits = [...textEdits].sort((a, b) => {
      if (a.range.start.line !== b.range.start.line) {
        return b.range.start.line - a.range.start.line;
      }
      return b.range.start.character - a.range.start.character;
    });

    const lines = content.split('\n');
    const summary: string[] = [];

    // Apply edits in reverse order to preserve line/character positions
    for (const edit of sortedEdits) {
      const { start, end } = edit.range;
      const newText = edit.newText;

      // Validate range
      if (start.line < 0 || start.line >= lines.length || end.line < 0 || end.line > lines.length) {
        process.stderr.write(
          `[DEBUG applyTextEdits] Skipping invalid range: ${start.line}:${start.character}-${end.line}:${end.character}\n`
        );
        continue;
      }

      // Create summary of changes
      if (start.line === end.line) {
        const line = lines[start.line];
        if (line !== undefined) {
          const originalText = line.substring(start.character, end.character);
          if (originalText !== newText) {
            if (originalText.trim() === '' && newText.trim() !== '') {
              summary.push(`• Line ${start.line + 1}: Added content`);
            } else if (originalText.trim() !== '' && newText.trim() === '') {
              summary.push(`• Line ${start.line + 1}: Removed content`);
            } else if (originalText.match(/^\s+$/) && newText.match(/^\s+$/)) {
              summary.push(`• Line ${start.line + 1}: Adjusted indentation`);
            } else {
              summary.push(`• Line ${start.line + 1}: Modified content`);
            }
          }
        }
      } else {
        summary.push(`• Lines ${start.line + 1}-${end.line + 1}: Multi-line edit`);
      }

      // Apply the edit
      if (start.line === end.line) {
        // Single line edit
        const line = lines[start.line];
        if (line !== undefined) {
          lines[start.line] =
            line.substring(0, start.character) + newText + line.substring(end.character);
        }
      } else {
        // Multi-line edit
        const startLineContent = lines[start.line];
        const endLineContent = lines[end.line];
        if (startLineContent !== undefined && endLineContent !== undefined) {
          const startLine = startLineContent.substring(0, start.character);
          const endLine = endLineContent.substring(end.character);
          const newLines = newText.split('\n');

          // Replace the range with new content
          lines.splice(
            start.line,
            end.line - start.line + 1,
            startLine + newLines[0],
            ...newLines.slice(1, -1),
            newLines[newLines.length - 1] + endLine
          );
        }
      }
    }

    const formattedContent = lines.join('\n');

    // Write to file if requested
    if (applyToFile) {
      try {
        process.stderr.write(`[DEBUG applyTextEdits] Writing formatted content to ${filePath}\n`);
        require('node:fs').writeFileSync(filePath, formattedContent, 'utf-8');
        summary.push(`File ${filePath} has been updated`);
      } catch (error) {
        throw new Error(`Failed to write formatted content to ${filePath}: ${error}`);
      }
    }

    return {
      content: formattedContent,
      summary: summary.length > 0 ? summary : ['No formatting changes needed'],
    };
  }

  private extractHoverText(hover: Hover | string | null | undefined): string | undefined {
    if (!hover) return undefined;

    if (typeof hover === 'string') return hover;

    if (typeof hover === 'object' && 'contents' in hover) {
      const { contents } = hover;

      if (typeof contents === 'string') {
        return contents;
      }
      if (Array.isArray(contents)) {
        return contents
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
          .join('\n');
      }
      if (typeof contents === 'object' && contents !== null && 'value' in contents) {
        return (contents as { value: string }).value;
      }
    }

    return undefined;
  }

  private parseTypeInfo(hoverText: string | undefined, symbolName: string): TypeInfo | undefined {
    if (!hoverText) return undefined;

    const typeInfo: TypeInfo = {};

    // Extract method/function signature with parameters
    // Look for patterns like "(params) : returnType" or "(params) => returnType"
    // Skip "(method)" or "(property)" prefixes
    const cleanedHover = hoverText.replace(/^\((?:method|property|function)\)\s*/, '');
    const methodMatch = cleanedHover.match(/\(.*?\)\s*(?::|=>)\s*(.+?)(?:\n|$)/);
    if (methodMatch?.[1]) {
      typeInfo.returnType = methodMatch[1].trim();

      // Parse parameters only if we found a method signature
      const paramsMatch = cleanedHover.match(/\(([^)]*)\)/);
      if (paramsMatch?.[1]) {
        typeInfo.parameters = this.parseParameters(paramsMatch[1]);
      } else {
        typeInfo.parameters = [];
      }
    } else {
      // Check for property/field patterns like "propertyName: Type"
      const propertyMatch = cleanedHover.match(/^(\w+):\s*(.+?)(?:\n|$)/);
      if (propertyMatch?.[2] && propertyMatch[1] === symbolName) {
        typeInfo.returnType = propertyMatch[2].trim();
      }
    }

    // Language-specific parsing
    if (hoverText.includes('->') && !hoverText.includes('=>')) {
      // Python style
      const pythonMatch = hoverText.match(/def\s+\w+\([^)]*\)\s*->\s*(.+?)(?:\n|$)/);
      if (pythonMatch?.[1]) {
        typeInfo.returnType = pythonMatch[1].trim();
      }
    }

    return Object.keys(typeInfo).length > 0 ? typeInfo : undefined;
  }

  private parseParameters(paramsString: string): ParameterInfo[] {
    const parameters: ParameterInfo[] = [];

    // Split by comma but respect nested generics/objects
    const params = this.splitParameters(paramsString);

    for (const param of params) {
      const trimmed = param.trim();
      if (!trimmed) continue;

      // TypeScript/JavaScript style: "name: type = default" or "name?: type"
      const tsMatch = trimmed.match(/^(\w+)(\?)?:\s*(.+?)(?:\s*=\s*(.+))?$/);
      if (tsMatch) {
        const [, name, optional, type, defaultValue] = tsMatch;
        const paramInfo: ParameterInfo = {
          name: name || '',
          type: type?.trim() || '',
        };
        if (optional || defaultValue) {
          paramInfo.isOptional = true;
        }
        if (defaultValue) {
          paramInfo.defaultValue = defaultValue.trim();
        }
        parameters.push(paramInfo);
        continue;
      }

      // Python style: "name: type = default"
      const pythonMatch = trimmed.match(/^(\w+):\s*(.+?)(?:\s*=\s*(.+))?$/);
      if (pythonMatch) {
        const [, name, type, defaultValue] = pythonMatch;
        const paramInfo: ParameterInfo = {
          name: name || '',
          type: type?.trim() || '',
        };
        if (defaultValue) {
          paramInfo.defaultValue = defaultValue.trim();
          paramInfo.isOptional = true;
        }
        parameters.push(paramInfo);
        continue;
      }

      // Go style: "name type"
      const goMatch = trimmed.match(/^(\w+)\s+(.+)$/);
      if (goMatch) {
        const [, name, type] = goMatch;
        parameters.push({
          name: name || '',
          type: type?.trim() || '',
        });
        continue;
      }

      // Fallback: just type
      if (trimmed && !trimmed.includes(' ')) {
        parameters.push({
          name: '',
          type: trimmed,
        });
      }
    }

    return parameters;
  }

  private splitParameters(paramsString: string): string[] {
    const params: string[] = [];
    let current = '';
    let depth = 0;

    for (let i = 0; i < paramsString.length; i++) {
      const char = paramsString[i];

      if (char === '<' || char === '(' || char === '[' || char === '{') {
        depth++;
      } else if (char === '>' || char === ')' || char === ']' || char === '}') {
        depth--;
      } else if (char === ',' && depth === 0) {
        params.push(current);
        current = '';
        continue;
      }

      current += char;
    }

    if (current) {
      params.push(current);
    }

    return params;
  }

  private async findFileInDirectory(rootDir: string, extensions: string[]): Promise<string | null> {
    try {
      // Use the same gitignore-aware scanning as scanDirectoryForExtensions
      const ig = await loadGitignore(rootDir);

      const findFileRecursively = async (
        dir: string,
        depth: number,
        relativePath = ''
      ): Promise<string | null> => {
        if (depth > 2) return null;

        try {
          const entries = await readdir(dir);

          // Process files first
          for (const entry of entries) {
            const entryPath = join(dir, entry);
            const entryRelativePath = relativePath ? `${relativePath}/${entry}` : entry;

            // Skip if ignored by gitignore
            if (ig?.ignores(entryRelativePath)) continue;

            try {
              const stats = await stat(entryPath);
              if (stats.isFile()) {
                // Check if file matches any of the required extensions
                for (const ext of extensions) {
                  if (entry.endsWith(`.${ext}`)) {
                    return entryPath;
                  }
                }
              }
            } catch (statError) {}
          }

          // Then process directories
          for (const entry of entries) {
            const entryPath = join(dir, entry);
            const entryRelativePath = relativePath ? `${relativePath}/${entry}` : entry;

            // Skip if ignored by gitignore
            if (ig?.ignores(entryRelativePath)) continue;

            try {
              const stats = await stat(entryPath);
              if (stats.isDirectory()) {
                const result = await findFileRecursively(entryPath, depth + 1, entryRelativePath);
                if (result) return result;
              }
            } catch (statError) {}
          }
        } catch (readdirError) {
          // Skip directories we can't read
        }

        return null;
      };

      return await findFileRecursively(rootDir, 0);
    } catch (error) {
      // If gitignore loading fails, return null and let the server start without workspace context
      process.stderr.write(`[DEBUG findFileInDirectory] Gitignore loading failed: ${error}\n`);
      return null;
    }
  }

  private async ensureAllServersReady(): Promise<Array<[string, ServerState]>> {
    const readyServers: Array<[string, ServerState]> = [];

    process.stderr.write(
      `[DEBUG ensureAllServersReady] Starting ${this.config.servers.length} configured servers\n`
    );

    for (const serverConfig of this.config.servers) {
      try {
        // Create a dummy file path to trigger server creation
        const dummyFilePath = join(
          serverConfig.rootDir || process.cwd(),
          `dummy.${serverConfig.extensions[0]}`
        );
        const serverState = await this.getServer(dummyFilePath);
        await serverState.initializationPromise;

        // Ensure workspace context by opening a file if none are open
        if (serverState.openFiles.size === 0) {
          process.stderr.write(
            `[DEBUG ensureAllServersReady] Server for ${serverConfig.extensions.join(',')} needs workspace context\n`
          );
          const foundFile = await this.findFileInDirectory(
            serverConfig.rootDir || process.cwd(),
            serverConfig.extensions
          );
          if (foundFile) {
            process.stderr.write(
              `[DEBUG ensureAllServersReady] Opening ${foundFile} for workspace context\n`
            );
            await this.ensureFileOpen(serverState, foundFile);
            process.stderr.write(
              `[DEBUG ensureAllServersReady] Opened ${foundFile} for workspace context\n`
            );
          }
        }

        // Wait for workspace indexing
        await this.waitForWorkspaceIndexing(serverState);

        const serverKey = JSON.stringify(serverConfig);
        readyServers.push([serverKey, serverState]);

        process.stderr.write(
          `[DEBUG ensureAllServersReady] Server for ${serverConfig.extensions.join(',')} is ready\n`
        );
      } catch (error) {
        process.stderr.write(
          `[DEBUG ensureAllServersReady] Failed to start server for ${serverConfig.extensions.join(',')}: ${error}\n`
        );
      }
    }

    process.stderr.write(
      `[DEBUG ensureAllServersReady] ${readyServers.length} servers ready for queries\n`
    );
    return readyServers;
  }

  async findTypeInWorkspace(
    typeName: string,
    typeKind?: string,
    caseSensitive = false
  ): Promise<WorkspaceSearchResult> {
    process.stderr.write(
      `[DEBUG findTypeInWorkspace] Searching for symbol "${typeName}"${typeKind ? ` (kind: ${typeKind})` : ''} in workspace\n`
    );

    // Determine if this is a wildcard pattern and prepare queries
    const isWildcardPattern = typeName.includes('*') || typeName.includes('?');
    let finalQuery: string;

    if (isWildcardPattern) {
      // For wildcard patterns, prepare the stripped query now
      let lspQuery = typeName;

      // For LSP query, remove leading/trailing wildcards to get broader results
      lspQuery = typeName.replace(/^\*+/, '').replace(/\*+$/, '');
      if (lspQuery.startsWith('?')) {
        lspQuery = lspQuery.substring(1);
      }

      finalQuery = lspQuery || '';
    } else {
      // For exact matches, use the full name to ensure LSP servers find the symbol
      finalQuery = typeName;
    }

    // Ensure all configured servers are ready with workspace context
    const availableServers = await this.ensureAllServersReady();

    if (availableServers.length === 0) {
      process.stderr.write('[DEBUG findTypeInWorkspace] No LSP servers could be initialized\n');
      return {
        symbols: [],
        debugInfo: {
          rootUri: 'N/A - No servers available',
          serverCount: this.config.servers.length,
          totalSymbolsFound: 0,
          filteredSymbolsCount: 0,
          searchQuery: finalQuery,
          caseSensitive,
          isWildcardPattern,
        },
      };
    }

    const rootUri = pathToFileURL(this.config.servers[0]?.rootDir || process.cwd()).toString();

    try {
      // Prepare regex pattern for wildcard matching (if needed)
      let regexPattern: RegExp | null = null;

      if (isWildcardPattern) {
        // Create regex pattern from wildcard
        const escapedPattern = typeName
          .replace(/[.+^${}()|[\]\\]/g, '\\$&') // Escape regex special chars except * and ?
          .replace(/\*/g, '.*') // * matches any sequence
          .replace(/\?/g, '.'); // ? matches single character

        regexPattern = new RegExp(`^${escapedPattern}$`, caseSensitive ? '' : 'i');

        process.stderr.write(
          `[DEBUG findTypeInWorkspace] Using wildcard pattern. Regex: ${regexPattern}, LSP query: "${finalQuery}"\n`
        );
      }

      // Send workspace/symbol requests to all available servers
      process.stderr.write(
        `[DEBUG findTypeInWorkspace] Sending LSP query: "${finalQuery}" for search term: "${typeName}" to ${availableServers.length} servers\n`
      );

      const allSymbols: SymbolInformation[] = [];
      const serverResults: Array<{ serverKey: string; symbolCount: number }> = [];

      for (const [serverKey, serverState] of availableServers) {
        try {
          process.stderr.write(`[DEBUG findTypeInWorkspace] Querying server: ${serverKey}\n`);

          const symbols = (await this.sendRequest(serverState.process, 'workspace/symbol', {
            query: finalQuery,
          })) as SymbolInformation[] | null;

          if (symbols && symbols.length > 0) {
            allSymbols.push(...symbols);
            serverResults.push({ serverKey, symbolCount: symbols.length });
            process.stderr.write(
              `[DEBUG findTypeInWorkspace] Server ${serverKey} returned ${symbols.length} symbols\n`
            );
          } else {
            process.stderr.write(
              `[DEBUG findTypeInWorkspace] Server ${serverKey} returned no symbols\n`
            );
            serverResults.push({ serverKey, symbolCount: 0 });
          }
        } catch (error) {
          process.stderr.write(
            `[DEBUG findTypeInWorkspace] Error querying server ${serverKey}: ${error}\n`
          );
          serverResults.push({ serverKey, symbolCount: 0 });
        }
      }

      if (allSymbols.length === 0) {
        process.stderr.write(
          `[DEBUG findTypeInWorkspace] No symbols found across ${availableServers.length} servers for query "${finalQuery}"\n`
        );
        return {
          symbols: [],
          debugInfo: {
            rootUri,
            serverCount: availableServers.length,
            totalSymbolsFound: 0,
            filteredSymbolsCount: 0,
            searchQuery: finalQuery,
            caseSensitive,
            isWildcardPattern,
          },
        };
      }

      process.stderr.write(
        `[DEBUG findTypeInWorkspace] Found ${allSymbols.length} total symbols across ${availableServers.length} servers\n`
      );

      // Log server breakdown
      for (const result of serverResults) {
        if (result.symbolCount > 0) {
          process.stderr.write(
            `[DEBUG findTypeInWorkspace] - ${result.serverKey}: ${result.symbolCount} symbols\n`
          );
        }
      }

      // Filter results from all servers
      const filteredSymbols = allSymbols.filter((symbol) => {
        // First apply wildcard filter if needed
        if (isWildcardPattern && regexPattern) {
          if (!regexPattern.test(symbol.name)) {
            return false;
          }
        } else {
          // Exact or case-insensitive match when no wildcards

          // For callable symbols (methods, functions, constructors), use regex matching
          // because they have complex signatures like "void blah(string h)" or "public int GetUser(string userId)"
          const callableKinds = [SymbolKind.Method, SymbolKind.Function, SymbolKind.Constructor];

          if (callableKinds.includes(symbol.kind)) {
            // Use *typeName* regex for callable symbols to handle complex signatures
            const escapedTypeName = typeName.replace(/[.+^${}()|[\]\\]/g, '\\$&');
            const callableRegex = new RegExp(`.*${escapedTypeName}.*`, caseSensitive ? '' : 'i');

            process.stderr.write(
              `[DEBUG findTypeInWorkspace] Callable symbol regex matching: "${symbol.name}" against pattern ".*${typeName}.*" (kind: ${symbol.kind})\n`
            );

            if (!callableRegex.test(symbol.name)) {
              return false;
            }

            process.stderr.write(
              `[DEBUG findTypeInWorkspace] Callable match: "${symbol.name}" contains "${typeName}"\n`
            );
          } else {
            // For non-callable symbols, use exact matching (with signature stripping for safety)
            const symbolNameOnly = symbol.name.split('(')[0] ?? symbol.name;
            const symbolName = caseSensitive ? symbolNameOnly : symbolNameOnly.toLowerCase();
            const searchName = caseSensitive ? typeName : typeName.toLowerCase();

            process.stderr.write(
              `[DEBUG findTypeInWorkspace] Exact matching: "${symbolName}" vs "${searchName}" (original: "${symbol.name}", kind: ${symbol.kind})\n`
            );

            if (symbolName !== searchName) {
              return false;
            }

            process.stderr.write(
              `[DEBUG findTypeInWorkspace] Exact match: "${symbolNameOnly}" matches "${typeName}"\n`
            );
          }
        }

        // Include various symbol types (types, methods, functions, variables, etc.)
        const allowedKinds = [
          // Type-like symbols
          SymbolKind.Class,
          SymbolKind.Interface,
          SymbolKind.Enum,
          SymbolKind.Struct,
          SymbolKind.TypeParameter,
          // Callable symbols
          SymbolKind.Method,
          SymbolKind.Function,
          SymbolKind.Constructor,
          // Data symbols
          SymbolKind.Field,
          SymbolKind.Variable,
          SymbolKind.Property,
          SymbolKind.Constant,
          // Container symbols
          SymbolKind.Namespace,
          SymbolKind.Module,
          SymbolKind.Package,
        ];

        if (!allowedKinds.includes(symbol.kind)) {
          return false;
        }

        // If specific type kind is requested, filter by it
        if (typeKind) {
          const kindMap: Record<string, SymbolKind> = {
            class: SymbolKind.Class,
            interface: SymbolKind.Interface,
            enum: SymbolKind.Enum,
            struct: SymbolKind.Struct,
            type_parameter: SymbolKind.TypeParameter,
            method: SymbolKind.Method,
            function: SymbolKind.Function,
            constructor: SymbolKind.Constructor,
            field: SymbolKind.Field,
            variable: SymbolKind.Variable,
            property: SymbolKind.Property,
            constant: SymbolKind.Constant,
            namespace: SymbolKind.Namespace,
            module: SymbolKind.Module,
            package: SymbolKind.Package,
          };

          const requestedKind = kindMap[typeKind.toLowerCase()];
          if (requestedKind && symbol.kind !== requestedKind) {
            return false;
          }
        }

        return true;
      });

      process.stderr.write(
        `[DEBUG findTypeInWorkspace] After filtering: ${filteredSymbols.length} symbol(s) matching "${typeName}"${typeKind ? ` (kind: ${typeKind})` : ''}\n`
      );

      // Log first few matches for debugging
      if (filteredSymbols.length > 0) {
        const sample = filteredSymbols.slice(0, 3);
        for (const sym of sample) {
          process.stderr.write(
            `[DEBUG findTypeInWorkspace]   - ${sym.name} (kind: ${sym.kind}) at ${sym.location.uri}\n`
          );
        }
      } else {
        // Log some sample symbols to see what's available
        const sample = allSymbols.slice(0, 10);
        process.stderr.write(
          `[DEBUG findTypeInWorkspace] Sample of available symbols (${allSymbols.length} total):\n`
        );
        for (const sym of sample) {
          process.stderr.write(
            `[DEBUG findTypeInWorkspace]   - ${sym.name} (kind: ${sym.kind}${sym.containerName ? `, container: ${sym.containerName}` : ''})\n`
          );
        }

        // Also show what method-like symbols we have
        const methodSymbols = allSymbols.filter((s) => [6, 12].includes(s.kind)); // Method and Function
        if (methodSymbols.length > 0) {
          process.stderr.write(
            `[DEBUG findTypeInWorkspace] Found ${methodSymbols.length} method/function symbols:\n`
          );
          for (const sym of methodSymbols.slice(0, 5)) {
            process.stderr.write(
              `[DEBUG findTypeInWorkspace]   - ${sym.name} (${sym.containerName || 'global'})\n`
            );
          }
        }
      }

      return {
        symbols: filteredSymbols,
        debugInfo: {
          rootUri,
          serverCount: availableServers.length,
          totalSymbolsFound: allSymbols.length,
          filteredSymbolsCount: filteredSymbols.length,
          searchQuery: finalQuery,
          caseSensitive,
          isWildcardPattern,
        },
      };
    } catch (error) {
      process.stderr.write(`[DEBUG findTypeInWorkspace] Error: ${error}\n`);
      return {
        symbols: [],
        debugInfo: {
          rootUri: rootUri || 'N/A - Error occurred',
          serverCount: availableServers?.length || this.servers.size,
          totalSymbolsFound: 0,
          filteredSymbolsCount: 0,
          searchQuery: finalQuery || typeName,
          caseSensitive,
          isWildcardPattern: typeName.includes('*') || typeName.includes('?'),
        },
      };
    }
  }

  private startWorkspaceIndexingMonitor(serverState: ServerState): void {
    process.stderr.write('[DEBUG] Starting workspace indexing monitor\n');

    // For servers that support it, try to get workspace symbols to trigger indexing
    setTimeout(async () => {
      try {
        const testSymbols = await this.sendRequest(serverState.process, 'workspace/symbol', {
          query: '',
        });

        if (testSymbols && Array.isArray(testSymbols)) {
          serverState.filesDiscovered = testSymbols.length;
          process.stderr.write(
            `[DEBUG] Initial symbol discovery: ${serverState.filesDiscovered} symbols\n`
          );
        }

        // Set a fallback timer to mark indexing as complete
        setTimeout(() => {
          if (!serverState.workspaceIndexed) {
            process.stderr.write(
              '[DEBUG] Workspace indexing timeout reached, marking as complete\n'
            );
            serverState.workspaceIndexed = true;
          }
        }, 10000); // 10 second fallback
      } catch (error) {
        process.stderr.write(`[DEBUG] Error during initial workspace discovery: ${error}\n`);
        // Mark as indexed if we can't determine status
        serverState.workspaceIndexed = true;
      }
    }, 1000); // Wait 1 second after initialization
  }

  private handleWorkspaceProgress(params: unknown, serverState: ServerState): void {
    if (!params || typeof params !== 'object' || !params || !('token' in params)) return;

    const progressParams = params as {
      value?: { kind?: string; title?: string; message?: string; percentage?: number };
    };
    if (progressParams.value) {
      const { kind, title, message, percentage } = progressParams.value;

      if (title && (title.includes('index') || title.includes('Index'))) {
        process.stderr.write(
          `[DEBUG] Workspace indexing progress: ${title} - ${message || ''} (${percentage || 0}%)\n`
        );

        if (kind === 'end' || (percentage && percentage >= 100)) {
          process.stderr.write('[DEBUG] Workspace indexing completed via progress notification\n');
          serverState.workspaceIndexed = true;
        }
      }
    }
  }

  private async waitForWorkspaceIndexing(
    serverState: ServerState,
    maxWaitMs = 15000
  ): Promise<void> {
    const startTime = Date.now();

    while (!serverState.workspaceIndexed && Date.now() - startTime < maxWaitMs) {
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Try to detect if indexing is complete by testing symbol queries
      try {
        const testSymbols = await this.sendRequest(serverState.process, 'workspace/symbol', {
          query: '',
        });

        if (testSymbols && Array.isArray(testSymbols)) {
          const currentCount = testSymbols.length;

          if (currentCount > serverState.filesDiscovered) {
            serverState.filesDiscovered = currentCount;
            process.stderr.write(
              `[DEBUG] Symbol count increased to ${currentCount}, indexing likely in progress\n`
            );
          } else if (currentCount > 0) {
            // If we have symbols and count is stable, likely indexed
            serverState.workspaceIndexed = true;
            process.stderr.write(
              `[DEBUG] Workspace indexing complete - ${currentCount} symbols available\n`
            );
            break;
          }
        }
      } catch (error) {
        // Ignore errors during status check
      }
    }

    if (!serverState.workspaceIndexed) {
      process.stderr.write('[DEBUG] Workspace indexing wait timeout reached\n');
      serverState.workspaceIndexed = true; // Proceed anyway
    }
  }

  async getCodeActions(
    filePath: string,
    range: Range,
    context?: CodeActionContext
  ): Promise<(CodeAction | Command)[]> {
    process.stderr.write(`[DEBUG getCodeActions] Requesting code actions for ${filePath}\n`);
    const serverState = await this.getServer(filePath);
    await this.ensureFileOpen(serverState, filePath);

    const uri = pathToUri(filePath);
    const params = {
      textDocument: { uri },
      range,
      context: context || { diagnostics: [] },
    };

    try {
      const result = await this.sendRequest(serverState.process, 'textDocument/codeAction', params);

      if (Array.isArray(result)) {
        process.stderr.write(`[DEBUG getCodeActions] Found ${result.length} code actions\n`);
        return result as (CodeAction | Command)[];
      }

      process.stderr.write('[DEBUG getCodeActions] No code actions found\n');
      return [];
    } catch (error) {
      process.stderr.write(`[DEBUG getCodeActions] Error: ${error}\n`);
      return [];
    }
  }

  async executeCommand(command: Command): Promise<unknown> {
    process.stderr.write(`[DEBUG executeCommand] Executing command: ${command.command}\n`);

    // Find a server that can handle the command
    // For now, use the first available server
    const serverState = Array.from(this.servers.values())[0];
    if (!serverState) {
      throw new Error('No LSP server available to execute command');
    }

    const params = {
      command: command.command,
      arguments: command.arguments || [],
    };

    try {
      const result = await this.sendRequest(
        serverState.process,
        'workspace/executeCommand',
        params
      );

      process.stderr.write('[DEBUG executeCommand] Command executed successfully\n');
      return result;
    } catch (error) {
      process.stderr.write(`[DEBUG executeCommand] Error: ${error}\n`);
      throw error;
    }
  }

  async applyWorkspaceEdit(edit: WorkspaceEdit): Promise<{ content: string }> {
    process.stderr.write('[DEBUG applyWorkspaceEdit] Applying workspace edit\n');

    const changes: string[] = [];

    try {
      // Handle changes object (legacy format)
      if (edit.changes) {
        for (const [uri, textEdits] of Object.entries(edit.changes)) {
          const filePath = uriToPath(uri);
          const result = await this.applyTextEdits(filePath, textEdits, true);
          changes.push(`Modified ${filePath}: ${result.summary.join('; ')}`);
        }
      }

      // Handle documentChanges array (newer format)
      if (edit.documentChanges) {
        for (const change of edit.documentChanges) {
          if ('textDocument' in change) {
            // TextDocumentEdit
            const filePath = uriToPath(change.textDocument.uri);
            const result = await this.applyTextEdits(filePath, change.edits as TextEdit[], true);
            changes.push(`Modified ${filePath}: ${result.summary.join('; ')}`);
          } else if (change.kind === 'create') {
            // CreateFile
            changes.push(`Would create file: ${uriToPath(change.uri)}`);
          } else if (change.kind === 'rename') {
            // RenameFile
            changes.push(`Would rename ${uriToPath(change.oldUri)} to ${uriToPath(change.newUri)}`);
          } else if (change.kind === 'delete') {
            // DeleteFile
            changes.push(`Would delete file: ${uriToPath(change.uri)}`);
          }
        }
      }

      return {
        content: changes.length > 0 ? changes.join('\n') : 'No changes applied',
      };
    } catch (error) {
      process.stderr.write(`[DEBUG applyWorkspaceEdit] Error: ${error}\n`);
      throw error;
    }
  }

  async getWorkspaceSymbols(query: string): Promise<SymbolInformation[]> {
    process.stderr.write(
      `[DEBUG getWorkspaceSymbols] Searching for symbols with query: "${query}"\n`
    );

    // Ensure all configured servers are ready with workspace context
    const availableServers = await this.ensureAllServersReady();

    if (availableServers.length === 0) {
      process.stderr.write('[DEBUG getWorkspaceSymbols] No LSP servers could be initialized\n');
      return [];
    }

    const allSymbols: SymbolInformation[] = [];

    // Send workspace/symbol requests to all available servers
    for (const [serverKey, serverState] of availableServers) {
      try {
        process.stderr.write(`[DEBUG getWorkspaceSymbols] Querying server: ${serverKey}\n`);

        const symbols = (await this.sendRequest(serverState.process, 'workspace/symbol', {
          query: query,
        })) as SymbolInformation[] | null;

        if (symbols && symbols.length > 0) {
          allSymbols.push(...symbols);
          process.stderr.write(
            `[DEBUG getWorkspaceSymbols] Server ${serverKey} returned ${symbols.length} symbols\n`
          );
        } else {
          process.stderr.write(
            `[DEBUG getWorkspaceSymbols] Server ${serverKey} returned no symbols\n`
          );
        }
      } catch (error) {
        process.stderr.write(
          `[DEBUG getWorkspaceSymbols] Error querying server ${serverKey}: ${error}\n`
        );
      }
    }

    process.stderr.write(
      `[DEBUG getWorkspaceSymbols] Found ${allSymbols.length} total symbols across ${availableServers.length} servers\n`
    );

    return allSymbols;
  }

  async getAllDiagnostics(
    filePatterns?: string[],
    excludePatterns?: string[]
  ): Promise<Map<string, Diagnostic[]>> {
    process.stderr.write('[DEBUG getAllDiagnostics] Starting workspace diagnostics collection\n');

    const diagnosticsMap = new Map<string, Diagnostic[]>();

    try {
      // Get all workspace files using existing file scanner infrastructure
      const workspaceFiles = await this.discoverWorkspaceFiles(filePatterns, excludePatterns);

      process.stderr.write(
        `[DEBUG getAllDiagnostics] Found ${workspaceFiles.length} files to analyze\n`
      );

      // Process files in batches to avoid overwhelming LSP servers
      const batchSize = 10;
      for (let i = 0; i < workspaceFiles.length; i += batchSize) {
        const batch = workspaceFiles.slice(i, i + batchSize);

        // Process batch concurrently
        const batchPromises = batch.map(async (filePath) => {
          try {
            const diagnostics = await this.getDiagnostics(filePath);
            if (diagnostics.length > 0) {
              diagnosticsMap.set(filePath, diagnostics);
              process.stderr.write(
                `[DEBUG getAllDiagnostics] Found ${diagnostics.length} diagnostics in ${filePath}\n`
              );
            }
          } catch (error) {
            process.stderr.write(
              `[DEBUG getAllDiagnostics] Error getting diagnostics for ${filePath}: ${error}\n`
            );
            // Continue processing other files
          }
        });

        await Promise.all(batchPromises);

        // Brief pause between batches to not overwhelm servers
        if (i + batchSize < workspaceFiles.length) {
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
      }

      process.stderr.write(
        `[DEBUG getAllDiagnostics] Completed diagnostics collection: ${diagnosticsMap.size} files with issues\n`
      );

      return diagnosticsMap;
    } catch (error) {
      process.stderr.write(`[DEBUG getAllDiagnostics] Error during workspace analysis: ${error}\n`);
      return diagnosticsMap;
    }
  }

  private async discoverWorkspaceFiles(
    includePatterns?: string[],
    excludePatterns?: string[]
  ): Promise<string[]> {
    const files: string[] = [];

    // Scan all configured server directories
    for (const serverConfig of this.config.servers) {
      const serverDir = serverConfig.rootDir || process.cwd();

      try {
        const ig = await loadGitignore(serverDir);

        // Add custom exclude patterns to ignore filter
        if (excludePatterns) {
          ig.add(excludePatterns);
        }

        const foundFiles = await this.scanDirectoryForFiles(
          serverDir,
          serverConfig.extensions,
          Promise.resolve(ig),
          includePatterns
        );

        files.push(...foundFiles);
      } catch (error) {
        process.stderr.write(
          `[DEBUG discoverWorkspaceFiles] Error scanning ${serverDir}: ${error}\n`
        );
      }
    }

    // Remove duplicates
    return [...new Set(files)];
  }

  private async scanDirectoryForFiles(
    dirPath: string,
    allowedExtensions: string[],
    ignoreFilter: ReturnType<typeof loadGitignore>,
    includePatterns?: string[]
  ): Promise<string[]> {
    const files: string[] = [];
    const resolvedIgnoreFilter = await ignoreFilter;

    const scanDirectory = async (
      currentPath: string,
      depth: number,
      relativePath = ''
    ): Promise<void> => {
      if (depth > 3) return; // Limit depth to avoid deep recursion

      try {
        const entries = await readdir(currentPath);

        for (const entry of entries) {
          const fullPath = join(currentPath, entry);
          const entryRelativePath = relativePath ? `${relativePath}/${entry}` : entry;

          // Skip if ignored by gitignore
          if (resolvedIgnoreFilter?.ignores(entryRelativePath)) continue;

          try {
            const stats = await stat(fullPath);

            if (stats.isFile()) {
              // Check if file matches allowed extensions
              const extension = fullPath.split('.').pop()?.toLowerCase();
              if (extension && allowedExtensions.includes(extension)) {
                // Apply include patterns if specified
                if (includePatterns) {
                  const matchesInclude = includePatterns.some(
                    (pattern) =>
                      this.matchesGlobPattern(entryRelativePath, pattern) ||
                      this.matchesGlobPattern(fullPath, pattern)
                  );
                  if (matchesInclude) {
                    files.push(fullPath);
                  }
                } else {
                  files.push(fullPath);
                }
              }
            } else if (stats.isDirectory()) {
              await scanDirectory(fullPath, depth + 1, entryRelativePath);
            }
          } catch (statError) {
            // Skip files we can't stat
          }
        }
      } catch (readdirError) {
        // Skip directories we can't read
      }
    };

    await scanDirectory(dirPath, 0);
    return files;
  }

  private matchesGlobPattern(path: string, pattern: string): boolean {
    // Simple glob pattern matching
    const regexPattern = pattern
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*/g, '.*')
      .replace(/\?/g, '.');

    const regex = new RegExp(`^${regexPattern}$`, 'i');
    return regex.test(path) || regex.test(relative(process.cwd(), path));
  }

  /**
   * Get server capabilities for a specific file extension
   */
  getServerCapabilities(fileExtension?: string): ServerCapabilities | null {
    if (!fileExtension) {
      // Return capabilities from first available server if no extension specified
      const firstServer = Array.from(this.servers.values())[0];
      return firstServer?.capabilities || null;
    }

    // Find server that handles this file extension
    const serverConfig = this.getServerForFile(`dummy.${fileExtension}`);
    if (!serverConfig) {
      return null;
    }

    const serverKey = JSON.stringify(serverConfig);
    const serverState = this.servers.get(serverKey);
    return serverState?.capabilities || null;
  }

  /**
   * Get capabilities for all active LSP servers
   */
  getAllServerCapabilities(): Map<string, ServerCapabilities> {
    const capabilitiesMap = new Map<string, ServerCapabilities>();

    for (const [serverKey, serverState] of this.servers.entries()) {
      if (serverState.capabilities) {
        capabilitiesMap.set(serverKey, serverState.capabilities);
      }
    }

    return capabilitiesMap;
  }

  /**
   * Analyze a symbol for safe deletion by finding its definition and all references
   */
  async analyzeSymbolForDeletion(
    filePath: string,
    symbolName: string,
    symbolKind?: string
  ): Promise<SymbolDeletionInfo | null> {
    process.stderr.write(
      `[DEBUG analyzeSymbolForDeletion] Analyzing symbol "${symbolName}"${symbolKind ? ` of kind "${symbolKind}"` : ''} in ${filePath}\n`
    );

    // Find the symbol using existing robust symbol resolution
    const result = await this.findSymbolsByName(filePath, symbolName, symbolKind);
    const { matches: symbolMatches } = result;

    if (symbolMatches.length === 0) {
      process.stderr.write(
        `[DEBUG analyzeSymbolForDeletion] No symbols found for "${symbolName}"\n`
      );
      return null;
    }

    if (symbolMatches.length > 1) {
      process.stderr.write(
        `[DEBUG analyzeSymbolForDeletion] Multiple symbols found (${symbolMatches.length}), using first match\n`
      );
    }

    const symbolMatch = symbolMatches[0];
    if (!symbolMatch) {
      return null;
    }

    // Find the definition location
    const definitions = await this.findDefinition(filePath, symbolMatch.position);
    if (definitions.length === 0) {
      process.stderr.write(
        `[DEBUG analyzeSymbolForDeletion] No definition found for symbol "${symbolName}"\n`
      );
      return null;
    }

    const definition = definitions[0];
    if (!definition) {
      return null;
    }

    // Find all references to the symbol
    const references = await this.findReferences(filePath, symbolMatch.position, true);

    process.stderr.write(
      `[DEBUG analyzeSymbolForDeletion] Found ${references.length} references for "${symbolName}"\n`
    );

    // Analyze deletion safety
    const canSafelyDelete = references.length <= 1; // Only the definition itself
    const dependencyInfo: string[] = [];

    // Add detailed reference analysis
    const externalReferences = references.filter((ref) => {
      const refPath = uriToPath(ref.uri);
      const defPath = uriToPath(definition.uri);
      return (
        refPath !== defPath ||
        ref.range.start.line !== definition.range.start.line ||
        ref.range.start.character !== definition.range.start.character
      );
    });

    if (externalReferences.length > 0) {
      dependencyInfo.push(`${externalReferences.length} external reference(s) found`);

      // Group references by file for better analysis
      const referencesByFile = new Map<string, Location[]>();
      for (const ref of externalReferences) {
        const refPath = uriToPath(ref.uri);
        if (!referencesByFile.has(refPath)) {
          referencesByFile.set(refPath, []);
        }
        referencesByFile.get(refPath)?.push(ref);
      }

      for (const [refPath, fileRefs] of referencesByFile) {
        dependencyInfo.push(`${fileRefs.length} reference(s) in ${refPath}`);
      }
    } else {
      dependencyInfo.push('No external references found - safe to delete');
    }

    return {
      definition,
      references,
      canSafelyDelete,
      dependencyInfo,
      symbolMatch,
    };
  }

  /**
   * Generate workspace edits to delete a symbol and optionally its references
   */
  async deleteSymbolWithEdits(
    symbolInfo: SymbolDeletionInfo,
    deleteReferences: boolean
  ): Promise<WorkspaceEdit> {
    process.stderr.write(
      `[DEBUG deleteSymbolWithEdits] Generating edits for symbol deletion (deleteReferences: ${deleteReferences})\n`
    );

    const workspaceEdit: WorkspaceEdit = { changes: {} };

    try {
      // Calculate edit for the definition
      const definitionPath = uriToPath(symbolInfo.definition.uri);
      const definitionRange = symbolInfo.definition.range;

      // Read file to determine if we should delete the entire line or just the symbol
      const fileContent = readFileSync(definitionPath, 'utf-8');
      const lines = fileContent.split('\n');

      let editRange = definitionRange;
      let newText = '';

      // Check if the symbol occupies the entire line(s)
      const startLine = definitionRange.start.line;
      const endLine = definitionRange.end.line;

      if (startLine < lines.length) {
        const startLineText = lines[startLine];
        const endLineText = lines[endLine];

        // Check if the definition spans entire lines
        const beforeSymbol = startLineText?.substring(0, definitionRange.start.character) || '';
        const afterSymbol = endLineText?.substring(definitionRange.end.character) || '';

        if (beforeSymbol.trim() === '' && afterSymbol.trim() === '') {
          // Symbol occupies entire line(s), delete the whole lines including newlines
          editRange = {
            start: { line: startLine, character: 0 },
            end: {
              line: endLine < lines.length - 1 ? endLine + 1 : endLine,
              character: endLine < lines.length - 1 ? 0 : endLineText?.length || 0,
            },
          };
          newText = '';
        }
      }

      // Add definition edit
      const definitionEdit: TextEdit = {
        range: editRange,
        newText,
      };

      if (!workspaceEdit.changes) {
        workspaceEdit.changes = {};
      }
      workspaceEdit.changes[symbolInfo.definition.uri] = [definitionEdit];

      // Add reference edits if requested
      if (deleteReferences) {
        const referencesByFile = new Map<string, TextEdit[]>();

        for (const reference of symbolInfo.references) {
          // Skip the definition itself if it's in the references
          const refPath = uriToPath(reference.uri);
          const defPath = uriToPath(symbolInfo.definition.uri);

          if (
            refPath === defPath &&
            reference.range.start.line === symbolInfo.definition.range.start.line &&
            reference.range.start.character === symbolInfo.definition.range.start.character
          ) {
            continue; // Skip the definition
          }

          if (!referencesByFile.has(reference.uri)) {
            referencesByFile.set(reference.uri, []);
          }

          // For references, we typically just remove the symbol usage, not entire lines
          const referenceEdit: TextEdit = {
            range: reference.range,
            newText: '', // Remove the reference
          };

          referencesByFile.get(reference.uri)?.push(referenceEdit);
        }

        // Add reference edits to workspace edit
        for (const [uri, edits] of referencesByFile) {
          if (workspaceEdit.changes[uri]) {
            workspaceEdit.changes[uri].push(...edits);
          } else {
            workspaceEdit.changes[uri] = edits;
          }
        }
      }

      process.stderr.write(
        `[DEBUG deleteSymbolWithEdits] Generated ${Object.keys(workspaceEdit.changes).length} file edit(s)\n`
      );

      return workspaceEdit;
    } catch (error) {
      process.stderr.write(`[DEBUG deleteSymbolWithEdits] Error generating edits: ${error}\n`);
      throw error;
    }
  }

  /**
   * Get server configuration for a file extension
   */
  getServerConfigForExtension(extension: string): LSPServerConfig | null {
    return this.getServerForFile(`dummy.${extension}`);
  }

  dispose(): void {
    for (const serverState of this.servers.values()) {
      // Clear restart timer if exists
      if (serverState.restartTimer) {
        clearTimeout(serverState.restartTimer);
      }
      serverState.process.kill();
    }
    this.servers.clear();
  }
}
