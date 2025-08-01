#!/usr/bin/env node

import { resolve } from 'node:path';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { LSPClient } from './src/lsp-client.js';
import type {
  Command,
  Diagnostic,
  DocumentSymbol,
  ServerCapabilities,
  SymbolInformation,
  WorkspaceSearchResult,
} from './src/types.js';
import { uriToPath } from './src/utils.js';

// Helper function to format server capabilities
function formatServerCapabilities(
  capabilities: ServerCapabilities,
  filterType?: 'text_document' | 'workspace' | 'experimental',
  detailed = false
): string[] {
  const output: string[] = [];

  // Text Document Capabilities
  if (!filterType || filterType === 'text_document') {
    output.push('✓ Text Document Capabilities:');

    const textCapabilities = [
      { name: 'Hover support', value: capabilities.hoverProvider },
      {
        name: 'Completion support',
        value: capabilities.completionProvider,
        detail: capabilities.completionProvider
          ? `(trigger characters: ${capabilities.completionProvider.triggerCharacters?.join(', ') || 'none'})`
          : '',
      },
      {
        name: 'Signature help',
        value: capabilities.signatureHelpProvider,
        detail: capabilities.signatureHelpProvider
          ? `(trigger characters: ${capabilities.signatureHelpProvider.triggerCharacters?.join(', ') || 'none'})`
          : '',
      },
      { name: 'Go to definition', value: capabilities.definitionProvider },
      { name: 'Type definition', value: capabilities.typeDefinitionProvider },
      { name: 'Implementation', value: capabilities.implementationProvider },
      { name: 'Find references', value: capabilities.referencesProvider },
      { name: 'Document highlights', value: capabilities.documentHighlightProvider },
      { name: 'Document symbols', value: capabilities.documentSymbolProvider },
      { name: 'Code actions', value: capabilities.codeActionProvider },
      { name: 'Code lens', value: capabilities.codeLensProvider },
      { name: 'Document formatting', value: capabilities.documentFormattingProvider },
      { name: 'Range formatting', value: capabilities.documentRangeFormattingProvider },
      { name: 'On-type formatting', value: capabilities.documentOnTypeFormattingProvider },
      { name: 'Rename support', value: capabilities.renameProvider },
      { name: 'Document links', value: capabilities.documentLinkProvider },
      { name: 'Color provider', value: capabilities.colorProvider },
      { name: 'Folding ranges', value: capabilities.foldingRangeProvider },
    ];

    for (const cap of textCapabilities) {
      const isSupported = Boolean(cap.value);
      const icon = isSupported ? '✓' : '✗';
      const detail = detailed && cap.detail ? ` ${cap.detail}` : '';
      output.push(`  ${icon} ${cap.name}${detail}`);
    }
    output.push('');
  }

  // Workspace Capabilities
  if (!filterType || filterType === 'workspace') {
    output.push('✓ Workspace Capabilities:');

    const workspaceCapabilities = [
      { name: 'Workspace symbols', value: capabilities.workspaceSymbolProvider },
      {
        name: 'Execute command',
        value: capabilities.executeCommandProvider,
        detail: capabilities.executeCommandProvider
          ? `(commands: ${capabilities.executeCommandProvider.commands?.length || 0})`
          : '',
      },
      { name: 'Workspace folders', value: capabilities.workspace?.workspaceFolders?.supported },
      { name: 'File operations', value: capabilities.workspace?.fileOperations },
    ];

    for (const cap of workspaceCapabilities) {
      const isSupported = Boolean(cap.value);
      const icon = isSupported ? '✓' : '✗';
      const detail = detailed && cap.detail ? ` ${cap.detail}` : '';
      output.push(`  ${icon} ${cap.name}${detail}`);
    }
    output.push('');
  }

  // Experimental Capabilities
  if (!filterType || filterType === 'experimental') {
    const hasExperimental = Boolean(capabilities.experimental);
    const icon = hasExperimental ? '✓' : '✗';
    output.push(`${icon} Experimental Capabilities:`);

    if (hasExperimental && detailed) {
      output.push('  ✓ Custom experimental features available');
    } else if (!hasExperimental) {
      output.push('  ✗ No experimental features supported');
    }
    output.push('');
  }

  return output;
}

// Handle subcommands
const args = process.argv.slice(2);
if (args.length > 0) {
  const subcommand = args[0];

  if (subcommand === 'setup') {
    const { main } = await import('./src/setup.js');
    await main();
    process.exit(0);
  } else {
    console.error(`Unknown subcommand: ${subcommand}`);
    console.error('Available subcommands:');
    console.error('  setup    Configure cclsp for your project');
    console.error('');
    console.error('Run without arguments to start the MCP server.');
    process.exit(1);
  }
}

const lspClient = new LSPClient();

const server = new Server(
  {
    name: 'cclsp',
    version: '0.1.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'find_definition',
        description:
          'Find the definition of a symbol by name and kind in a file. Returns definitions for all matching symbols.',
        inputSchema: {
          type: 'object',
          properties: {
            file_path: {
              type: 'string',
              description: 'The path to the file',
            },
            symbol_name: {
              type: 'string',
              description: 'The name of the symbol',
            },
            symbol_kind: {
              type: 'string',
              description: 'The kind of symbol (function, class, variable, method, etc.)',
            },
          },
          required: ['file_path', 'symbol_name'],
        },
      },
      {
        name: 'find_references',
        description:
          'Find all references to a symbol by name and kind in a file. Returns references for all matching symbols.',
        inputSchema: {
          type: 'object',
          properties: {
            file_path: {
              type: 'string',
              description: 'The path to the file',
            },
            symbol_name: {
              type: 'string',
              description: 'The name of the symbol',
            },
            symbol_kind: {
              type: 'string',
              description: 'The kind of symbol (function, class, variable, method, etc.)',
            },
            include_declaration: {
              type: 'boolean',
              description: 'Whether to include the declaration',
              default: true,
            },
          },
          required: ['file_path', 'symbol_name'],
        },
      },
      {
        name: 'rename_symbol',
        description:
          'Rename a symbol by name and kind in a file. If multiple symbols match, returns candidate positions and suggests using rename_symbol_strict.',
        inputSchema: {
          type: 'object',
          properties: {
            file_path: {
              type: 'string',
              description: 'The path to the file',
            },
            symbol_name: {
              type: 'string',
              description: 'The name of the symbol',
            },
            symbol_kind: {
              type: 'string',
              description: 'The kind of symbol (function, class, variable, method, etc.)',
            },
            new_name: {
              type: 'string',
              description: 'The new name for the symbol',
            },
          },
          required: ['file_path', 'symbol_name', 'new_name'],
        },
      },
      {
        name: 'rename_symbol_strict',
        description:
          'Rename a symbol at a specific position in a file. Use this when rename_symbol returns multiple candidates.',
        inputSchema: {
          type: 'object',
          properties: {
            file_path: {
              type: 'string',
              description: 'The path to the file',
            },
            line: {
              type: 'number',
              description: 'The line number (1-indexed)',
            },
            character: {
              type: 'number',
              description: 'The character position in the line (1-indexed)',
            },
            new_name: {
              type: 'string',
              description: 'The new name for the symbol',
            },
          },
          required: ['file_path', 'line', 'character', 'new_name'],
        },
      },
      {
        name: 'get_diagnostics',
        description:
          'Get language diagnostics (errors, warnings, hints) for a file. Uses LSP textDocument/diagnostic to pull current diagnostics.',
        inputSchema: {
          type: 'object',
          properties: {
            file_path: {
              type: 'string',
              description: 'The path to the file to get diagnostics for',
            },
          },
          required: ['file_path'],
        },
      },
      {
        name: 'get_class_members',
        description:
          'List all properties and methods of a class. Returns members with their types and signatures.',
        inputSchema: {
          type: 'object',
          properties: {
            file_path: {
              type: 'string',
              description: 'The path to the file containing the class',
            },
            class_name: {
              type: 'string',
              description: 'The name of the class',
            },
          },
          required: ['file_path', 'class_name'],
        },
      },
      {
        name: 'get_method_signature',
        description:
          'Show full method definition with parameters and return type using LSP hover information.',
        inputSchema: {
          type: 'object',
          properties: {
            file_path: {
              type: 'string',
              description: 'The path to the file containing the method',
            },
            method_name: {
              type: 'string',
              description: 'The name of the method',
            },
            class_name: {
              type: 'string',
              description: 'Optional: The name of the class containing the method',
            },
          },
          required: ['file_path', 'method_name'],
        },
      },
      {
        name: 'search_type',
        description:
          'Search for symbols (types, methods, functions, variables, etc.) across the entire workspace by name. Supports wildcards and case-insensitive search by default.',
        inputSchema: {
          type: 'object',
          properties: {
            type_name: {
              type: 'string',
              description:
                'The name or pattern of the symbol to search for. Supports wildcards: * (any sequence), ? (single char). Examples: BreakType, *method, getValue*, ?etData',
            },
            type_kind: {
              type: 'string',
              description: 'Optional: Filter by symbol kind',
              enum: [
                'class',
                'interface',
                'enum',
                'struct',
                'type_parameter',
                'method',
                'function',
                'constructor',
                'field',
                'variable',
                'property',
                'constant',
                'namespace',
                'module',
                'package',
              ],
            },
            case_sensitive: {
              type: 'boolean',
              description: 'Optional: Whether to perform case-sensitive search (default: false)',
              default: false,
            },
          },
          required: ['type_name'],
        },
      },
      {
        name: 'get_document_symbols',
        description:
          'Get all symbols (classes, functions, variables, etc.) in a document with their locations and hierarchy',
        inputSchema: {
          type: 'object',
          properties: {
            file_path: {
              type: 'string',
              description: 'The path to the file to analyze',
            },
            symbol_kind: {
              type: 'string',
              description: 'Optional: Filter by symbol kind (class, function, variable, etc.)',
              enum: [
                'class',
                'function',
                'variable',
                'method',
                'property',
                'field',
                'constructor',
                'enum',
                'interface',
                'namespace',
                'module',
                'constant',
              ],
            },
            include_children: {
              type: 'boolean',
              description: 'Whether to include child symbols (e.g., methods within classes)',
              default: true,
            },
          },
          required: ['file_path'],
        },
      },
      {
        name: 'get_completion',
        description: 'Get code completion suggestions at a specific position in a file',
        inputSchema: {
          type: 'object',
          properties: {
            file_path: {
              type: 'string',
              description: 'The path to the file',
            },
            line: {
              type: 'number',
              description: 'The line number (1-indexed)',
            },
            character: {
              type: 'number',
              description: 'The character position (1-indexed)',
            },
            trigger_character: {
              type: 'string',
              description: 'Optional: The character that triggered completion (e.g., ".", ":")',
            },
            resolve_details: {
              type: 'boolean',
              description:
                'Whether to resolve additional details like documentation and auto-imports',
              default: false,
            },
            include_auto_import: {
              type: 'boolean',
              description: 'Whether to include auto-import suggestions',
              default: false,
            },
            max_results: {
              type: 'number',
              description: 'Maximum number of completion items to return',
              default: 50,
            },
          },
          required: ['file_path', 'line', 'character'],
        },
      },
      {
        name: 'format_document',
        description: 'Format a document or specific range with configurable formatting options',
        inputSchema: {
          type: 'object',
          properties: {
            file_path: {
              type: 'string',
              description: 'The path to the file to format',
            },
            start_line: {
              type: 'number',
              description: 'Optional: Start line for range formatting (1-indexed)',
            },
            end_line: {
              type: 'number',
              description: 'Optional: End line for range formatting (1-indexed)',
            },
            tab_size: {
              type: 'number',
              description: 'Number of spaces per tab',
              default: 2,
            },
            insert_spaces: {
              type: 'boolean',
              description: 'Use spaces instead of tabs',
              default: true,
            },
            trim_trailing_whitespace: {
              type: 'boolean',
              description: 'Remove trailing whitespace',
              default: true,
            },
            insert_final_newline: {
              type: 'boolean',
              description: 'Insert final newline at end of file',
              default: true,
            },
            trim_final_newlines: {
              type: 'boolean',
              description: 'Trim extra newlines at end of file',
              default: true,
            },
            apply_changes: {
              type: 'boolean',
              description: 'Apply formatting changes to the file (default: preview only)',
              default: false,
            },
          },
          required: ['file_path'],
        },
      },
      {
        name: 'get_code_actions',
        description:
          'Get available code actions (quick fixes, refactoring, etc.) for a specific location or range in a file',
        inputSchema: {
          type: 'object',
          properties: {
            file_path: {
              type: 'string',
              description: 'The path to the file',
            },
            start_line: {
              type: 'number',
              description: 'Start line number (1-indexed)',
            },
            end_line: {
              type: 'number',
              description: 'Optional: End line number (1-indexed, defaults to start_line)',
            },
            start_character: {
              type: 'number',
              description: 'Optional: Start character position (1-indexed, defaults to 0)',
            },
            end_character: {
              type: 'number',
              description: 'Optional: End character position (1-indexed, defaults to end of line)',
            },
            include_kinds: {
              type: 'array',
              items: { type: 'string' },
              description:
                'Optional: Filter for specific action kinds (quickfix, refactor, source, etc.)',
            },
            only_preferred: {
              type: 'boolean',
              description: 'Optional: Only return preferred actions',
              default: false,
            },
            apply_action: {
              type: 'string',
              description: 'Optional: Title of the specific action to apply',
            },
          },
          required: ['file_path', 'start_line'],
        },
      },
      {
        name: 'get_hover',
        description:
          'Get hover information (type details, documentation) for a symbol at a specific position',
        inputSchema: {
          type: 'object',
          properties: {
            file_path: {
              type: 'string',
              description: 'The path to the file',
            },
            line: {
              type: 'number',
              description: 'The line number (1-indexed)',
            },
            character: {
              type: 'number',
              description: 'The character position (1-indexed)',
            },
            symbol_name: {
              type: 'string',
              description: 'Optional: Symbol name to search for if position is not exact',
            },
          },
          required: ['file_path', 'line', 'character'],
        },
      },
      {
        name: 'get_signature_help',
        description:
          'Get function signature help with parameter information at a specific position',
        inputSchema: {
          type: 'object',
          properties: {
            file_path: {
              type: 'string',
              description: 'The path to the file',
            },
            line: {
              type: 'number',
              description: 'The line number (1-indexed)',
            },
            character: {
              type: 'number',
              description: 'The character position (1-indexed)',
            },
            trigger_character: {
              type: 'string',
              description: 'Optional: Character that triggered signature help (e.g., "(", ",")',
            },
            function_name: {
              type: 'string',
              description: 'Optional: Function name to help locate the call',
            },
          },
          required: ['file_path', 'line', 'character'],
        },
      },
      {
        name: 'get_workspace_symbols',
        description: 'Search for symbols across the entire workspace by name or pattern',
        inputSchema: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'Search query for symbols (supports wildcards and partial matching)',
            },
            symbol_kind: {
              type: 'string',
              description: 'Optional: Filter by symbol kind',
              enum: [
                'class',
                'function',
                'variable',
                'method',
                'property',
                'field',
                'constructor',
                'enum',
                'interface',
                'namespace',
                'module',
                'constant',
                'file',
                'package',
                'struct',
                'event',
                'operator',
                'type_parameter',
              ],
            },
            max_results: {
              type: 'number',
              description: 'Maximum number of results to return',
              default: 100,
            },
            case_sensitive: {
              type: 'boolean',
              description: 'Whether search should be case sensitive',
              default: false,
            },
          },
          required: ['query'],
        },
      },
      {
        name: 'get_all_diagnostics',
        description: 'Get diagnostics (errors, warnings, hints) for all files in the workspace',
        inputSchema: {
          type: 'object',
          properties: {
            severity_filter: {
              type: 'array',
              items: {
                type: 'string',
                enum: ['error', 'warning', 'information', 'hint'],
              },
              description: 'Filter diagnostics by severity level',
            },
            include_files: {
              type: 'array',
              items: { type: 'string' },
              description: 'Optional: Specific file patterns to include (glob patterns)',
            },
            exclude_files: {
              type: 'array',
              items: { type: 'string' },
              description: 'Optional: File patterns to exclude (glob patterns)',
            },
            max_diagnostics_per_file: {
              type: 'number',
              description: 'Maximum diagnostics to show per file',
              default: 50,
            },
            group_by_severity: {
              type: 'boolean',
              description: 'Group results by severity level',
              default: true,
            },
            include_source: {
              type: 'boolean',
              description: 'Include diagnostic source information',
              default: true,
            },
          },
        },
      },
      {
        name: 'check_capabilities',
        description: 'Check what capabilities are supported by the active LSP servers',
        inputSchema: {
          type: 'object',
          properties: {
            file_extension: {
              type: 'string',
              description:
                'Optional: Check capabilities for specific file extension (e.g., "ts", "py")',
            },
            capability_type: {
              type: 'string',
              description: 'Optional: Filter by capability type',
              enum: ['text_document', 'workspace', 'experimental'],
            },
            detailed: {
              type: 'boolean',
              description: 'Show detailed capability information',
              default: false,
            },
          },
        },
      },
      {
        name: 'delete_symbol',
        description: 'Delete a symbol definition and optionally handle its references',
        inputSchema: {
          type: 'object',
          properties: {
            file_path: {
              type: 'string',
              description: 'The path to the file containing the symbol',
            },
            symbol_name: {
              type: 'string',
              description: 'The name of the symbol to delete',
            },
            symbol_kind: {
              type: 'string',
              description: 'The kind of symbol to delete',
              enum: [
                'function',
                'class',
                'variable',
                'method',
                'property',
                'interface',
                'type',
                'enum',
              ],
            },
            delete_references: {
              type: 'boolean',
              description: 'Whether to also delete references to the symbol',
              default: false,
            },
            dry_run: {
              type: 'boolean',
              description: 'Preview changes without applying them',
              default: true,
            },
            force_delete: {
              type: 'boolean',
              description: 'Delete even if references exist (when delete_references is false)',
              default: false,
            },
          },
          required: ['file_path', 'symbol_name'],
        },
      },
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    if (name === 'find_definition') {
      const { file_path, symbol_name, symbol_kind } = args as {
        file_path: string;
        symbol_name: string;
        symbol_kind?: string;
      };
      const absolutePath = resolve(file_path);

      const result = await lspClient.findSymbolsByName(absolutePath, symbol_name, symbol_kind);
      const { matches: symbolMatches, warning } = result;

      process.stderr.write(
        `[DEBUG find_definition] Found ${symbolMatches.length} symbol matches for "${symbol_name}"\n`
      );

      if (symbolMatches.length === 0) {
        return {
          content: [
            {
              type: 'text',
              text: `No symbols found with name "${symbol_name}"${symbol_kind ? ` and kind "${symbol_kind}"` : ''} in ${file_path}. Please verify the symbol name and ensure the language server is properly configured.`,
            },
          ],
        };
      }

      const results = [];
      for (const match of symbolMatches) {
        process.stderr.write(
          `[DEBUG find_definition] Processing match: ${match.name} (${lspClient.symbolKindToString(match.kind)}) at ${match.position.line}:${match.position.character}\n`
        );
        try {
          const locations = await lspClient.findDefinition(absolutePath, match.position);
          process.stderr.write(
            `[DEBUG find_definition] findDefinition returned ${locations.length} locations\n`
          );

          if (locations.length > 0) {
            const locationResults = locations
              .map((loc) => {
                const filePath = uriToPath(loc.uri);
                const { start, end } = loc.range;
                return `${filePath}:${start.line + 1}:${start.character + 1}`;
              })
              .join('\n');

            results.push(
              `Results for ${match.name} (${lspClient.symbolKindToString(match.kind)}) at ${file_path}:${match.position.line + 1}:${match.position.character + 1}:\n${locationResults}`
            );
          } else {
            process.stderr.write(
              `[DEBUG find_definition] No definition found for ${match.name} at position ${match.position.line}:${match.position.character}\n`
            );
          }
        } catch (error) {
          process.stderr.write(`[DEBUG find_definition] Error processing match: ${error}\n`);
          // Continue trying other symbols if one fails
        }
      }

      if (results.length === 0) {
        const responseText = warning
          ? `${warning}\n\nFound ${symbolMatches.length} symbol(s) but no definitions could be retrieved. Please ensure the language server is properly configured.`
          : `Found ${symbolMatches.length} symbol(s) but no definitions could be retrieved. Please ensure the language server is properly configured.`;

        return {
          content: [
            {
              type: 'text',
              text: responseText,
            },
          ],
        };
      }

      const responseText = warning ? `${warning}\n\n${results.join('\n\n')}` : results.join('\n\n');

      return {
        content: [
          {
            type: 'text',
            text: responseText,
          },
        ],
      };
    }

    if (name === 'find_references') {
      const {
        file_path,
        symbol_name,
        symbol_kind,
        include_declaration = true,
      } = args as {
        file_path: string;
        symbol_name: string;
        symbol_kind?: string;
        include_declaration?: boolean;
      };
      const absolutePath = resolve(file_path);

      const result = await lspClient.findSymbolsByName(absolutePath, symbol_name, symbol_kind);
      const { matches: symbolMatches, warning } = result;

      if (symbolMatches.length === 0) {
        const responseText = warning
          ? `${warning}\n\nNo symbols found with name "${symbol_name}"${symbol_kind ? ` and kind "${symbol_kind}"` : ''} in ${file_path}. Please verify the symbol name and ensure the language server is properly configured.`
          : `No symbols found with name "${symbol_name}"${symbol_kind ? ` and kind "${symbol_kind}"` : ''} in ${file_path}. Please verify the symbol name and ensure the language server is properly configured.`;

        return {
          content: [
            {
              type: 'text',
              text: responseText,
            },
          ],
        };
      }

      const results = [];
      for (const match of symbolMatches) {
        try {
          const locations = await lspClient.findReferences(
            absolutePath,
            match.position,
            include_declaration
          );

          if (locations.length > 0) {
            const locationResults = locations
              .map((loc) => {
                const filePath = uriToPath(loc.uri);
                const { start, end } = loc.range;
                return `${filePath}:${start.line + 1}:${start.character + 1}`;
              })
              .join('\n');

            results.push(
              `Results for ${match.name} (${lspClient.symbolKindToString(match.kind)}) at ${file_path}:${match.position.line + 1}:${match.position.character + 1}:\n${locationResults}`
            );
          }
        } catch (error) {
          // Continue trying other symbols if one fails
        }
      }

      if (results.length === 0) {
        const responseText = warning
          ? `${warning}\n\nFound ${symbolMatches.length} symbol(s) but no references could be retrieved. Please ensure the language server is properly configured.`
          : `Found ${symbolMatches.length} symbol(s) but no references could be retrieved. Please ensure the language server is properly configured.`;

        return {
          content: [
            {
              type: 'text',
              text: responseText,
            },
          ],
        };
      }

      const responseText = warning ? `${warning}\n\n${results.join('\n\n')}` : results.join('\n\n');

      return {
        content: [
          {
            type: 'text',
            text: responseText,
          },
        ],
      };
    }

    if (name === 'rename_symbol') {
      const { file_path, symbol_name, symbol_kind, new_name } = args as {
        file_path: string;
        symbol_name: string;
        symbol_kind?: string;
        new_name: string;
      };
      const absolutePath = resolve(file_path);

      const result = await lspClient.findSymbolsByName(absolutePath, symbol_name, symbol_kind);
      const { matches: symbolMatches, warning } = result;

      if (symbolMatches.length === 0) {
        const responseText = warning
          ? `${warning}\n\nNo symbols found with name "${symbol_name}"${symbol_kind ? ` and kind "${symbol_kind}"` : ''} in ${file_path}. Please verify the symbol name and ensure the language server is properly configured.`
          : `No symbols found with name "${symbol_name}"${symbol_kind ? ` and kind "${symbol_kind}"` : ''} in ${file_path}. Please verify the symbol name and ensure the language server is properly configured.`;

        return {
          content: [
            {
              type: 'text',
              text: responseText,
            },
          ],
        };
      }

      if (symbolMatches.length > 1) {
        const candidatesList = symbolMatches
          .map(
            (match) =>
              `- ${match.name} (${lspClient.symbolKindToString(match.kind)}) at line ${match.position.line + 1}, character ${match.position.character + 1}`
          )
          .join('\n');

        const responseText = warning
          ? `${warning}\n\nMultiple symbols found matching "${symbol_name}"${symbol_kind ? ` with kind "${symbol_kind}"` : ''}. Please use rename_symbol_strict with one of these positions:\n\n${candidatesList}`
          : `Multiple symbols found matching "${symbol_name}"${symbol_kind ? ` with kind "${symbol_kind}"` : ''}. Please use rename_symbol_strict with one of these positions:\n\n${candidatesList}`;

        return {
          content: [
            {
              type: 'text',
              text: responseText,
            },
          ],
        };
      }

      // Single match - proceed with rename
      const match = symbolMatches[0];
      if (!match) {
        throw new Error('Unexpected error: no match found');
      }
      try {
        const workspaceEdit = await lspClient.renameSymbol(absolutePath, match.position, new_name);

        if (workspaceEdit?.changes && Object.keys(workspaceEdit.changes).length > 0) {
          const changes = [];
          for (const [uri, edits] of Object.entries(workspaceEdit.changes)) {
            const filePath = uriToPath(uri);
            changes.push(`File: ${filePath}`);
            for (const edit of edits) {
              const { start, end } = edit.range;
              changes.push(
                `  - Line ${start.line + 1}, Column ${start.character + 1} to Line ${end.line + 1}, Column ${end.character + 1}: "${edit.newText}"`
              );
            }
          }

          const responseText = warning
            ? `${warning}\n\nSuccessfully renamed ${match.name} (${lspClient.symbolKindToString(match.kind)}) to "${new_name}":\n${changes.join('\n')}`
            : `Successfully renamed ${match.name} (${lspClient.symbolKindToString(match.kind)}) to "${new_name}":\n${changes.join('\n')}`;

          return {
            content: [
              {
                type: 'text',
                text: responseText,
              },
            ],
          };
        }
        const responseText = warning
          ? `${warning}\n\nNo rename edits available for ${match.name} (${lspClient.symbolKindToString(match.kind)}). The symbol may not be renameable or the language server doesn't support renaming this type of symbol.`
          : `No rename edits available for ${match.name} (${lspClient.symbolKindToString(match.kind)}). The symbol may not be renameable or the language server doesn't support renaming this type of symbol.`;

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
              text: `Error renaming symbol: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    }

    if (name === 'rename_symbol_strict') {
      const { file_path, line, character, new_name } = args as {
        file_path: string;
        line: number;
        character: number;
        new_name: string;
      };
      const absolutePath = resolve(file_path);

      try {
        const workspaceEdit = await lspClient.renameSymbol(
          absolutePath,
          { line: line - 1, character: character - 1 }, // Convert to 0-indexed
          new_name
        );

        if (workspaceEdit?.changes && Object.keys(workspaceEdit.changes).length > 0) {
          const changes = [];
          for (const [uri, edits] of Object.entries(workspaceEdit.changes)) {
            const filePath = uriToPath(uri);
            changes.push(`File: ${filePath}`);
            for (const edit of edits) {
              const { start, end } = edit.range;
              changes.push(
                `  - Line ${start.line + 1}, Column ${start.character + 1} to Line ${end.line + 1}, Column ${end.character + 1}: "${edit.newText}"`
              );
            }
          }

          return {
            content: [
              {
                type: 'text',
                text: `Successfully renamed symbol at line ${line}, character ${character} to "${new_name}":\n${changes.join('\n')}`,
              },
            ],
          };
        }
        return {
          content: [
            {
              type: 'text',
              text: `No rename edits available at line ${line}, character ${character}. Please verify the symbol location and ensure the language server is properly configured.`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text',
              text: `Error renaming symbol: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    }

    if (name === 'get_diagnostics') {
      const { file_path } = args as { file_path: string };
      const absolutePath = resolve(file_path);

      try {
        const diagnostics = await lspClient.getDiagnostics(absolutePath);

        if (diagnostics.length === 0) {
          return {
            content: [
              {
                type: 'text',
                text: `No diagnostics found for ${file_path}. The file has no errors, warnings, or hints.`,
              },
            ],
          };
        }

        const severityMap = {
          1: 'Error',
          2: 'Warning',
          3: 'Information',
          4: 'Hint',
        };

        const diagnosticMessages = diagnostics.map((diag) => {
          const severity = diag.severity ? severityMap[diag.severity] || 'Unknown' : 'Unknown';
          const code = diag.code ? ` [${diag.code}]` : '';
          const source = diag.source ? ` (${diag.source})` : '';
          const { start, end } = diag.range;

          return `• ${severity}${code}${source}: ${diag.message}\n  Location: Line ${start.line + 1}, Column ${start.character + 1} to Line ${end.line + 1}, Column ${end.character + 1}`;
        });

        return {
          content: [
            {
              type: 'text',
              text: `Found ${diagnostics.length} diagnostic${diagnostics.length === 1 ? '' : 's'} in ${file_path}:\n\n${diagnosticMessages.join('\n\n')}`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text',
              text: `Error getting diagnostics: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    }

    if (name === 'get_class_members') {
      const { file_path, class_name } = args as { file_path: string; class_name: string };
      const absolutePath = resolve(file_path);

      try {
        const members = await lspClient.getClassMembers(absolutePath, class_name);

        if (members.length === 0) {
          return {
            content: [
              {
                type: 'text',
                text: `No members found for class "${class_name}" in ${file_path}. Please verify the class name and ensure the language server is properly configured.`,
              },
            ],
          };
        }

        const memberList = members
          .map((member) => {
            const kindStr = lspClient.symbolKindToString(member.kind);
            const location = `${file_path}:${member.position.line + 1}:${member.position.character + 1}`;
            let output = `• ${member.name} (${kindStr}) at ${location}`;

            if (member.detail) {
              output += `\n  ${member.detail}`;
            }

            if (member.typeInfo) {
              if (member.typeInfo.parameters && member.typeInfo.parameters.length > 0) {
                output += '\n  Parameters:';
                for (const param of member.typeInfo.parameters) {
                  output += `\n    - ${param.name}${param.isOptional ? '?' : ''}: ${param.type}`;
                  if (param.defaultValue) {
                    output += ` = ${param.defaultValue}`;
                  }
                  if (param.definitionLocation) {
                    const defLoc = param.definitionLocation;
                    const filePath = uriToPath(defLoc.uri);
                    output += `\n      Type defined at: ${filePath}:${defLoc.line + 1}:${defLoc.character + 1}`;
                  }
                }
              }
              if (member.typeInfo.returnType) {
                output += `\n  Returns: ${member.typeInfo.returnType}`;
              }
              if (member.typeInfo.definitionLocation) {
                const defLoc = member.typeInfo.definitionLocation;
                const filePath = uriToPath(defLoc.uri);
                output += `\n  Type defined at: ${filePath}:${defLoc.line + 1}:${defLoc.character + 1}`;
              }
            }

            return output;
          })
          .join('\n\n');

        return {
          content: [
            {
              type: 'text',
              text: `Found ${members.length} member${members.length === 1 ? '' : 's'} in class "${class_name}":\n\n${memberList}`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text',
              text: `Error getting class members: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    }

    if (name === 'get_method_signature') {
      const { file_path, method_name, class_name } = args as {
        file_path: string;
        method_name: string;
        class_name?: string;
      };
      const absolutePath = resolve(file_path);

      try {
        const signatures = await lspClient.getMethodSignature(
          absolutePath,
          method_name,
          class_name
        );

        if (signatures.length === 0) {
          return {
            content: [
              {
                type: 'text',
                text: `No signature found for method "${method_name}"${class_name ? ` in class "${class_name}"` : ''} in ${file_path}. Please verify the method name and ensure the language server is properly configured.`,
              },
            ],
          };
        }

        const signatureList = signatures
          .map((sig) => {
            const location = `${file_path}:${sig.position.line + 1}:${sig.position.character + 1}`;
            let output = `Method: ${sig.name} at ${location}\n${sig.signature}`;

            if (sig.typeInfo) {
              output += '\n\nType Details:';
              if (sig.typeInfo.parameters && sig.typeInfo.parameters.length > 0) {
                output += '\n  Parameters:';
                for (const param of sig.typeInfo.parameters) {
                  output += `\n    - ${param.name}${param.isOptional ? '?' : ''}: ${param.type}`;
                  if (param.defaultValue) {
                    output += ` = ${param.defaultValue}`;
                  }
                  if (param.definitionLocation) {
                    const defLoc = param.definitionLocation;
                    const filePath = uriToPath(defLoc.uri);
                    output += `\n      Type defined at: ${filePath}:${defLoc.line + 1}:${defLoc.character + 1}`;
                  }
                }
              }
              if (sig.typeInfo.returnType) {
                output += `\n  Returns: ${sig.typeInfo.returnType}`;
                if (sig.typeInfo.returnTypeDefinitionLocation) {
                  const defLoc = sig.typeInfo.returnTypeDefinitionLocation;
                  process.stderr.write(`[DEBUG] Raw return type URI from LSP: ${defLoc.uri}\n`);
                  const filePath = uriToPath(defLoc.uri);
                  process.stderr.write(`[DEBUG] Converted return type path: ${filePath}\n`);
                  output += `\n    Return type defined at: ${filePath}:${defLoc.line + 1}:${defLoc.character + 1}`;
                }
              }
              if (sig.typeInfo.definitionLocation) {
                const defLoc = sig.typeInfo.definitionLocation;
                const filePath = uriToPath(defLoc.uri);
                output += `\n  Type defined at: ${filePath}:${defLoc.line + 1}:${defLoc.character + 1}`;
              }
            }

            return output;
          })
          .join('\n\n---\n\n');

        return {
          content: [
            {
              type: 'text',
              text: signatureList,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text',
              text: `Error getting method signature: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    }

    if (name === 'search_type') {
      const { type_name, type_kind, case_sensitive } = args as {
        type_name: string;
        type_kind?: string;
        case_sensitive?: boolean;
      };

      try {
        const searchResult = await lspClient.findTypeInWorkspace(
          type_name,
          type_kind,
          case_sensitive
        );

        const { symbols: typeSymbols, debugInfo } = searchResult;

        if (typeSymbols.length === 0) {
          return {
            content: [
              {
                type: 'text',
                text: `No symbol found for "${type_name}"${type_kind ? ` of kind "${type_kind}"` : ''}.\n\nMake sure:\n1. The symbol name is spelled correctly\n2. The language server is configured for the file type containing this symbol\n3. The workspace has been properly indexed by the language server${type_kind ? `\n4. The symbol is actually a ${type_kind}` : ''}`,
              },
            ],
          };
        }

        const typeList = typeSymbols
          .map((symbol: SymbolInformation) => {
            const uri = symbol.location.uri;
            const filePath = uriToPath(uri);
            const location = `${filePath}:${symbol.location.range.start.line + 1}:${symbol.location.range.start.character + 1}`;
            const kindStr = lspClient.symbolKindToString(symbol.kind);

            let output = `• ${symbol.name} (${kindStr}) at ${location}`;
            if (symbol.containerName) {
              output += `\n  Container: ${symbol.containerName}`;
            }

            return output;
          })
          .join('\n\n');

        return {
          content: [
            {
              type: 'text',
              text: `Found ${typeSymbols.length} symbol${typeSymbols.length === 1 ? '' : 's'} matching "${type_name}":\n\n${typeList}`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text',
              text: `Error searching for type: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    }

    if (name === 'get_document_symbols') {
      const {
        file_path,
        symbol_kind,
        include_children = true,
      } = args as {
        file_path: string;
        symbol_kind?: string;
        include_children?: boolean;
      };
      const absolutePath = resolve(file_path);

      try {
        const symbols = await lspClient.getDocumentSymbols(absolutePath);

        if (!symbols || symbols.length === 0) {
          return {
            content: [
              {
                type: 'text',
                text: `No symbols found in ${file_path}. The file may be empty, have no symbols, or the language server may not support this file type.`,
              },
            ],
          };
        }

        // Helper function to filter symbols by kind
        const matchesSymbolKind = (symbolKindValue: number): boolean => {
          if (!symbol_kind) return true;
          return (
            lspClient.symbolKindToString(symbolKindValue).toLowerCase() ===
            symbol_kind.toLowerCase()
          );
        };

        type SymbolWithMetadata = (DocumentSymbol | SymbolInformation) & {
          depth: number;
          isDocumentSymbol: boolean;
        };

        // Helper function to collect symbols with filtering
        const collectSymbols = (
          symbols: (DocumentSymbol | SymbolInformation)[],
          depth = 0
        ): SymbolWithMetadata[] => {
          const collected: SymbolWithMetadata[] = [];

          for (const symbol of symbols) {
            const isDocumentSymbol = 'selectionRange' in symbol;

            if (matchesSymbolKind(symbol.kind)) {
              collected.push({
                ...symbol,
                depth,
                isDocumentSymbol,
              });
            }

            // Handle children if include_children is true and symbol has children
            if (
              include_children &&
              isDocumentSymbol &&
              symbol.children &&
              symbol.children.length > 0
            ) {
              collected.push(...collectSymbols(symbol.children, depth + 1));
            }
          }

          return collected;
        };

        const filteredSymbols = collectSymbols(symbols);

        if (filteredSymbols.length === 0) {
          return {
            content: [
              {
                type: 'text',
                text: `No symbols found${symbol_kind ? ` of kind "${symbol_kind}"` : ''} in ${file_path}.`,
              },
            ],
          };
        }

        // Group symbols by kind for better organization
        const symbolsByKind = new Map<string, SymbolWithMetadata[]>();

        for (const symbol of filteredSymbols) {
          const kindStr = lspClient.symbolKindToString(symbol.kind);
          if (!symbolsByKind.has(kindStr)) {
            symbolsByKind.set(kindStr, []);
          }
          const existingSymbols = symbolsByKind.get(kindStr);
          if (existingSymbols) {
            existingSymbols.push(symbol);
          }
        }

        // Sort groups by importance and format output
        const kindOrder = [
          'class',
          'interface',
          'enum',
          'function',
          'method',
          'constructor',
          'property',
          'field',
          'variable',
          'constant',
        ];
        const sortedKinds = Array.from(symbolsByKind.keys()).sort((a, b) => {
          const aIndex = kindOrder.indexOf(a);
          const bIndex = kindOrder.indexOf(b);
          if (aIndex === -1 && bIndex === -1) return a.localeCompare(b);
          if (aIndex === -1) return 1;
          if (bIndex === -1) return -1;
          return aIndex - bIndex;
        });

        const output: string[] = [
          `Found ${filteredSymbols.length} symbol${filteredSymbols.length === 1 ? '' : 's'} in ${file_path}:`,
        ];

        for (const kindStr of sortedKinds) {
          const symbolsOfKind = symbolsByKind.get(kindStr);
          if (!symbolsOfKind) continue;

          const capitalizedKind = kindStr.charAt(0).toUpperCase() + kindStr.slice(1);
          output.push(`\n${capitalizedKind}${symbolsOfKind.length === 1 ? '' : 's'}:`);

          for (const symbol of symbolsOfKind) {
            const indent = '  '.repeat(symbol.depth);
            const isDocumentSymbol = symbol.isDocumentSymbol;

            let location: string;
            const name: string = symbol.name;
            const detail: string = 'detail' in symbol && symbol.detail ? symbol.detail : '';

            if (isDocumentSymbol) {
              // DocumentSymbol uses selectionRange for precise symbol location
              const documentSymbol = symbol as DocumentSymbol & {
                depth: number;
                isDocumentSymbol: boolean;
              };
              location = `${documentSymbol.selectionRange.start.line + 1}:${documentSymbol.selectionRange.start.character + 1}`;
            } else {
              // SymbolInformation uses location.range
              const symbolInfo = symbol as SymbolInformation & {
                depth: number;
                isDocumentSymbol: boolean;
              };
              location = `${symbolInfo.location.range.start.line + 1}:${symbolInfo.location.range.start.character + 1}`;
            }

            let symbolLine = `${indent}• ${name}`;
            if (detail) {
              symbolLine += ` ${detail}`;
            }
            symbolLine += ` at line ${location}`;

            output.push(symbolLine);
          }
        }

        return {
          content: [
            {
              type: 'text',
              text: output.join('\n'),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text',
              text: `Error getting document symbols: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    }

    if (name === 'get_completion') {
      const {
        file_path,
        line,
        character,
        trigger_character,
        resolve_details = false,
        include_auto_import = false,
        max_results = 50,
      } = args as {
        file_path: string;
        line: number;
        character: number;
        trigger_character?: string;
        resolve_details?: boolean;
        include_auto_import?: boolean;
        max_results?: number;
      };
      const absolutePath = resolve(file_path);

      try {
        const completions = await lspClient.getCompletion(
          absolutePath,
          { line: line - 1, character: character - 1 }, // Convert to 0-indexed
          trigger_character,
          max_results
        );

        if (completions.length === 0) {
          return {
            content: [
              {
                type: 'text',
                text: `No code completion suggestions found at ${file_path}:${line}:${character}. Please ensure the language server is properly configured and the position is valid.`,
              },
            ],
          };
        }

        // Optionally resolve additional details
        let resolvedCompletions = completions;
        if (resolve_details) {
          try {
            resolvedCompletions = await Promise.all(
              completions.map((item) => lspClient.resolveCompletionItem(absolutePath, item))
            );
          } catch (resolveError) {
            process.stderr.write(
              `[DEBUG get_completion] Failed to resolve completion items: ${resolveError}\n`
            );
            // Continue with unresolved items
          }
        }

        // Group completions by kind for better organization
        const completionsByKind = new Map<string, typeof resolvedCompletions>();

        for (const completion of resolvedCompletions) {
          const kind = completion.kind
            ? lspClient.completionItemKindToString(completion.kind)
            : 'other';

          if (!completionsByKind.has(kind)) {
            completionsByKind.set(kind, []);
          }
          completionsByKind.get(kind)?.push(completion);
        }

        // Format output by grouping similar completion types
        const output: string[] = [
          `Found ${completions.length} completion suggestion${completions.length === 1 ? '' : 's'} at line ${line}, character ${character}:`,
        ];

        // Define preferred order for completion kinds
        const kindOrder = [
          'method',
          'function',
          'property',
          'field',
          'variable',
          'constant',
          'class',
          'interface',
          'enum',
          'module',
        ];
        const sortedKinds = Array.from(completionsByKind.keys()).sort((a, b) => {
          const aIndex = kindOrder.indexOf(a);
          const bIndex = kindOrder.indexOf(b);
          if (aIndex === -1 && bIndex === -1) return a.localeCompare(b);
          if (aIndex === -1) return 1;
          if (bIndex === -1) return -1;
          return aIndex - bIndex;
        });

        for (const kind of sortedKinds) {
          const items = completionsByKind.get(kind);
          if (!items || items.length === 0) continue;

          const capitalizedKind = kind.charAt(0).toUpperCase() + kind.slice(1);
          output.push(`\n${capitalizedKind}${items.length === 1 ? '' : 's'}:`);

          for (const item of items.slice(0, 10)) {
            // Limit to first 10 per category
            let line = `• ${item.label}`;

            if (item.detail) {
              line += `: ${item.detail}`;
            }

            if (item.documentation) {
              const doc =
                typeof item.documentation === 'string'
                  ? item.documentation
                  : item.documentation.value;
              if (doc && doc.length > 0) {
                // Truncate long documentation
                const shortDoc = doc.length > 100 ? `${doc.substring(0, 100)}...` : doc;
                line += `\n  ${shortDoc.replace(/\n/g, ' ')}`;
              }
            }

            if (
              include_auto_import &&
              item.additionalTextEdits &&
              item.additionalTextEdits.length > 0
            ) {
              line += '\n  Auto-import available';
            }

            output.push(line);
          }

          if (items.length > 10) {
            output.push(
              `  ... and ${items.length - 10} more ${kind}${items.length - 10 === 1 ? '' : 's'}`
            );
          }
        }

        return {
          content: [
            {
              type: 'text',
              text: output.join('\n'),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text',
              text: `Error getting code completion: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    }

    if (name === 'format_document') {
      const {
        file_path,
        start_line,
        end_line,
        tab_size = 2,
        insert_spaces = true,
        trim_trailing_whitespace = true,
        insert_final_newline = true,
        trim_final_newlines = true,
        apply_changes = false,
      } = args as {
        file_path: string;
        start_line?: number;
        end_line?: number;
        tab_size?: number;
        insert_spaces?: boolean;
        trim_trailing_whitespace?: boolean;
        insert_final_newline?: boolean;
        trim_final_newlines?: boolean;
        apply_changes?: boolean;
      };
      const absolutePath = resolve(file_path);

      try {
        // Build formatting options
        const formattingOptions = {
          tabSize: tab_size,
          insertSpaces: insert_spaces,
          trimTrailingWhitespace: trim_trailing_whitespace,
          insertFinalNewline: insert_final_newline,
          trimFinalNewlines: trim_final_newlines,
        };

        let textEdits: import('./src/types.js').TextEdit[] = [];

        // Determine if this is range formatting or full document formatting
        if (start_line !== undefined && end_line !== undefined) {
          // Range formatting
          const range = {
            start: { line: start_line - 1, character: 0 }, // Convert to 0-indexed
            end: { line: end_line - 1, character: Number.MAX_SAFE_INTEGER }, // End of line
          };

          process.stderr.write(
            `[DEBUG format_document] Formatting range ${start_line}-${end_line} in ${file_path}\n`
          );

          textEdits = await lspClient.formatRange(absolutePath, range, formattingOptions);
        } else {
          // Full document formatting
          process.stderr.write(`[DEBUG format_document] Formatting entire document ${file_path}\n`);

          textEdits = await lspClient.formatDocument(absolutePath, formattingOptions);
        }

        if (textEdits.length === 0) {
          return {
            content: [
              {
                type: 'text',
                text: `No formatting changes needed for ${file_path}. The file is already properly formatted.`,
              },
            ],
          };
        }

        // Apply text edits and get summary
        const { content: formattedContent, summary } = await lspClient.applyTextEdits(
          absolutePath,
          textEdits,
          apply_changes
        );

        // Prepare response
        const changesSummary = summary.join('\n');
        const totalEdits = textEdits.length;

        let responseText = '';

        if (start_line !== undefined && end_line !== undefined) {
          responseText += `Formatting completed for lines ${start_line}-${end_line} in ${file_path}:\n\n`;
        } else {
          responseText += `Formatting completed for ${file_path}:\n\n`;
        }

        responseText += `Changes applied:\n${changesSummary}\n\n`;
        responseText += `Total: ${totalEdits} formatting edit${totalEdits === 1 ? '' : 's'}\n`;

        if (apply_changes) {
          responseText += 'File modified: Yes';
        } else {
          responseText += 'File modified: No (preview mode)\n';
          responseText += '\nTo apply these changes, set apply_changes: true';
        }

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
              text: `Error formatting document: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    }

    if (name === 'get_code_actions') {
      const {
        file_path,
        start_line,
        end_line,
        start_character = 0,
        end_character,
        include_kinds,
        only_preferred = false,
        apply_action,
      } = args as {
        file_path: string;
        start_line: number;
        end_line?: number;
        start_character?: number;
        end_character?: number;
        include_kinds?: string[];
        only_preferred?: boolean;
        apply_action?: string;
      };

      try {
        const absolutePath = resolve(file_path);

        // Default end_line to start_line if not provided
        const effectiveEndLine = end_line ?? start_line;

        // Convert 1-indexed to 0-indexed positions for LSP
        const range = {
          start: {
            line: start_line - 1,
            character: Math.max(0, start_character - 1),
          },
          end: {
            line: effectiveEndLine - 1,
            character: end_character !== undefined ? Math.max(0, end_character - 1) : 999999, // Use large number for end of line
          },
        };

        // Get diagnostics for the file to include in context
        const diagnostics = await lspClient.getDiagnostics(absolutePath);

        // Filter diagnostics to only those that overlap with the range
        const rangeOverlapsDiagnostics = diagnostics.filter((diagnostic) => {
          const diagStart = diagnostic.range.start;
          const diagEnd = diagnostic.range.end;

          // Check if ranges overlap
          return !(
            diagEnd.line < range.start.line ||
            diagStart.line > range.end.line ||
            (diagEnd.line === range.start.line && diagEnd.character < range.start.character) ||
            (diagStart.line === range.end.line && diagStart.character > range.end.character)
          );
        });

        // Build code action context
        const context = {
          diagnostics: rangeOverlapsDiagnostics,
          only: include_kinds,
        };

        process.stderr.write(
          `[DEBUG get_code_actions] Requesting code actions for ${file_path} at line ${start_line}${end_line ? `-${end_line}` : ''}\n`
        );

        const codeActions = await lspClient.getCodeActions(absolutePath, range, context);

        // Filter by preference if requested
        const filteredActions = only_preferred
          ? codeActions.filter((action) => 'isPreferred' in action && action.isPreferred)
          : codeActions;

        if (apply_action) {
          // Find and apply the requested action
          const actionToApply = filteredActions.find(
            (action) => 'title' in action && action.title === apply_action
          );

          if (!actionToApply) {
            return {
              content: [
                {
                  type: 'text',
                  text: `Action "${apply_action}" not found. Available actions:\n${filteredActions.map((a) => `• ${'title' in a ? a.title : 'Unknown action'}`).join('\n')}`,
                },
              ],
            };
          }

          // Apply the action
          if ('edit' in actionToApply && actionToApply.edit) {
            // Apply workspace edit
            const { content: editResult } = await lspClient.applyWorkspaceEdit(actionToApply.edit);
            const title = 'title' in actionToApply ? actionToApply.title : 'Unknown action';
            return {
              content: [
                {
                  type: 'text',
                  text: `Applied code action: "${title}"\n\n${editResult}`,
                },
              ],
            };
          }
          if (
            'command' in actionToApply &&
            actionToApply.command &&
            typeof actionToApply.command === 'object'
          ) {
            // Execute command
            try {
              const commandResult = await lspClient.executeCommand(
                actionToApply.command as Command
              );
              const title = 'title' in actionToApply ? actionToApply.title : 'Unknown action';
              return {
                content: [
                  {
                    type: 'text',
                    text: `Executed code action: "${title}"\n\nCommand result: ${JSON.stringify(commandResult, null, 2)}`,
                  },
                ],
              };
            } catch (commandError) {
              const title = 'title' in actionToApply ? actionToApply.title : 'Unknown action';
              return {
                content: [
                  {
                    type: 'text',
                    text: `Failed to execute code action: "${title}"\n\nError: ${commandError instanceof Error ? commandError.message : String(commandError)}`,
                  },
                ],
              };
            }
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

        // Group actions by kind
        const actionsByKind: Record<
          string,
          Array<{ title: string; kind?: string; disabled?: boolean }>
        > = {};

        for (const action of filteredActions) {
          if ('title' in action) {
            const kind = 'kind' in action && action.kind ? action.kind : 'other';
            const categoryName = kind.includes('quickfix')
              ? 'Quick Fixes'
              : kind.includes('refactor')
                ? 'Refactoring'
                : kind.includes('source')
                  ? 'Source Actions'
                  : 'Other Actions';

            if (!actionsByKind[categoryName]) {
              actionsByKind[categoryName] = [];
            }

            actionsByKind[categoryName].push({
              title: action.title,
              kind: 'kind' in action ? action.kind : undefined,
              disabled: 'disabled' in action ? !!action.disabled : false,
            });
          }
        }

        // Format response
        let responseText = `Found ${filteredActions.length} code action${filteredActions.length === 1 ? '' : 's'} for ${file_path} at line ${start_line}${effectiveEndLine !== start_line ? `-${effectiveEndLine}` : ''}:\n\n`;

        for (const [category, actions] of Object.entries(actionsByKind)) {
          responseText += `${category}:\n`;
          for (const action of actions) {
            const statusIcon = action.disabled ? '⚠️' : '•';
            const kindInfo = action.kind ? ` (${action.kind})` : '';
            responseText += `${statusIcon} "${action.title}"${kindInfo}\n`;
            if (action.disabled) {
              responseText += '  (disabled)\n';
            }
          }
          responseText += '\n';
        }

        responseText +=
          'To apply a specific action, include apply_action parameter with the action title.';

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
              text: `Error getting code actions: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    }

    if (name === 'get_hover') {
      const { file_path, line, character, symbol_name } = args as {
        file_path: string;
        line: number;
        character: number;
        symbol_name?: string;
      };
      const absolutePath = resolve(file_path);

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
            const result = await lspClient.getHover(absolutePath, position);
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

    if (name === 'get_signature_help') {
      const { file_path, line, character, trigger_character, function_name } = args as {
        file_path: string;
        line: number;
        character: number;
        trigger_character?: string;
        function_name?: string;
      };
      const absolutePath = resolve(file_path);

      try {
        const position = { line: line - 1, character: character - 1 };
        const result = await lspClient.getSignatureHelp(absolutePath, position, trigger_character);

        if (!result || result.signatures.length === 0) {
          return {
            content: [
              {
                type: 'text',
                text: `No signature help available for position ${line}:${character} in ${file_path}${function_name ? ` (searching for function: ${function_name})` : ''}`,
              },
            ],
          };
        }

        // Format signature help response
        let responseText = `Signature help for function call at line ${line}, character ${character}:\n\n`;

        const activeSignature = result.activeSignature ?? 0;
        const activeParameter = result.activeParameter;

        if (result.signatures.length === 1) {
          // Single signature
          const sig = result.signatures[0];
          if (!sig) {
            return {
              content: [
                {
                  type: 'text',
                  text: `Invalid signature help data for position ${line}:${character} in ${file_path}`,
                },
              ],
            };
          }

          responseText += `${sig.label}\n`;

          if (activeParameter !== undefined && sig.parameters && sig.parameters[activeParameter]) {
            const param = sig.parameters[activeParameter];
            if (param) {
              const paramLabel =
                typeof param.label === 'string'
                  ? param.label
                  : sig.label.substring(param.label[0], param.label[1]);

              responseText += `\nCurrent Parameter: ${paramLabel}\n`;

              if (param.documentation) {
                const paramDoc =
                  typeof param.documentation === 'string'
                    ? param.documentation
                    : param.documentation.value;
                responseText += `${paramDoc}\n`;
              }
            }
          }

          if (sig.documentation) {
            const doc =
              typeof sig.documentation === 'string' ? sig.documentation : sig.documentation.value;
            responseText += `\nDocumentation:\n${doc}\n`;
          }

          if (sig.parameters && sig.parameters.length > 0) {
            responseText += '\nParameters:\n';
            for (let i = 0; i < sig.parameters.length; i++) {
              const param = sig.parameters[i];
              if (param) {
                const paramLabel =
                  typeof param.label === 'string'
                    ? param.label
                    : sig.label.substring(param.label[0], param.label[1]);

                const isActive = i === activeParameter;
                const prefix = isActive ? '▶ ' : '• ';
                responseText += `${prefix}${paramLabel}`;

                if (param.documentation) {
                  const paramDoc =
                    typeof param.documentation === 'string'
                      ? param.documentation
                      : param.documentation.value;
                  responseText += ` - ${paramDoc}`;
                }
                responseText += '\n';
              }
            }
          }
        } else {
          // Multiple signatures (overloads)
          responseText += `Found ${result.signatures.length} overloads:\n\n`;

          for (let i = 0; i < result.signatures.length; i++) {
            const sig = result.signatures[i];
            if (!sig) continue;

            const isActive = i === activeSignature;
            const prefix = isActive ? '→ ' : '  ';
            responseText += `${prefix}${i + 1}. ${sig.label}`;

            if (isActive) {
              responseText += ' ← ACTIVE';
            }
            responseText += '\n';

            if (sig.documentation) {
              const doc =
                typeof sig.documentation === 'string' ? sig.documentation : sig.documentation.value;
              responseText += `   ${doc}\n`;
            }
            responseText += '\n';
          }

          // Show current parameter for active signature
          const activeSig = result.signatures[activeSignature];
          if (
            activeSig &&
            activeParameter !== undefined &&
            activeSig.parameters &&
            activeSig.parameters[activeParameter]
          ) {
            const param = activeSig.parameters[activeParameter];
            if (param) {
              const paramLabel =
                typeof param.label === 'string'
                  ? param.label
                  : activeSig.label.substring(param.label[0], param.label[1]);

              responseText += `Current Parameter: ${paramLabel}\n`;

              if (param.documentation) {
                const paramDoc =
                  typeof param.documentation === 'string'
                    ? param.documentation
                    : param.documentation.value;
                responseText += `${paramDoc}\n`;
              }
            }
          }
        }

        return {
          content: [
            {
              type: 'text',
              text: responseText.trim(),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text',
              text: `Error getting signature help: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    }

    if (name === 'get_workspace_symbols') {
      const {
        query,
        symbol_kind,
        max_results = 100,
        case_sensitive = false,
      } = args as {
        query: string;
        symbol_kind?: string;
        max_results?: number;
        case_sensitive?: boolean;
      };

      try {
        const startTime = Date.now();
        const allSymbols = await lspClient.getWorkspaceSymbols(query);
        const searchTime = Date.now() - startTime;

        if (allSymbols.length === 0) {
          return {
            content: [
              {
                type: 'text',
                text: `No symbols found matching "${query}"${symbol_kind ? ` of kind "${symbol_kind}"` : ''} across the workspace.\n\nMake sure:\n1. The symbol name is spelled correctly\n2. The language servers are configured for the file types containing these symbols\n3. The workspace has been properly indexed by the language servers`,
              },
            ],
          };
        }

        // Filter by symbol kind if specified
        let filteredSymbols = allSymbols;
        if (symbol_kind) {
          filteredSymbols = allSymbols.filter(
            (symbol) =>
              lspClient.symbolKindToString(symbol.kind).toLowerCase() === symbol_kind.toLowerCase()
          );
        }

        // Apply case sensitivity and name filtering
        const finalSymbols = filteredSymbols.filter((symbol) => {
          const symbolName = case_sensitive ? symbol.name : symbol.name.toLowerCase();
          const searchQuery = case_sensitive ? query : query.toLowerCase();

          // Support wildcard patterns
          if (query.includes('*') || query.includes('?')) {
            const escapedPattern = searchQuery
              .replace(/[.+^${}()|[\]\\]/g, '\\$&')
              .replace(/\*/g, '.*')
              .replace(/\?/g, '.');
            const regex = new RegExp(`^${escapedPattern}$`, case_sensitive ? '' : 'i');
            return regex.test(symbol.name);
          }

          // For exact or partial matching
          return symbolName.includes(searchQuery);
        });

        // Limit results
        const limitedSymbols = finalSymbols.slice(0, max_results);

        if (limitedSymbols.length === 0) {
          return {
            content: [
              {
                type: 'text',
                text: `Found ${allSymbols.length} symbols but none matched the query "${query}"${symbol_kind ? ` with kind "${symbol_kind}"` : ''}${case_sensitive ? ' (case sensitive)' : ''}.`,
              },
            ],
          };
        }

        // Group symbols by kind for better organization
        const symbolsByKind = new Map<string, typeof limitedSymbols>();
        for (const symbol of limitedSymbols) {
          const kindStr = lspClient.symbolKindToString(symbol.kind);
          if (!symbolsByKind.has(kindStr)) {
            symbolsByKind.set(kindStr, []);
          }
          symbolsByKind.get(kindStr)?.push(symbol);
        }

        // Build formatted output
        const output: string[] = [
          `Found ${limitedSymbols.length} symbol${limitedSymbols.length === 1 ? '' : 's'} matching "${query}" across workspace:`,
        ];

        // Sort by symbol kind priority
        const kindOrder = [
          'class',
          'interface',
          'enum',
          'struct',
          'function',
          'method',
          'constructor',
          'property',
          'field',
          'variable',
          'constant',
          'namespace',
          'module',
          'package',
        ];

        const sortedKinds = Array.from(symbolsByKind.keys()).sort((a, b) => {
          const aIndex = kindOrder.indexOf(a);
          const bIndex = kindOrder.indexOf(b);
          if (aIndex === -1 && bIndex === -1) return a.localeCompare(b);
          if (aIndex === -1) return 1;
          if (bIndex === -1) return -1;
          return aIndex - bIndex;
        });

        for (const kindStr of sortedKinds) {
          const symbols = symbolsByKind.get(kindStr);
          if (!symbols || symbols.length === 0) continue;

          const capitalizedKind = kindStr.charAt(0).toUpperCase() + kindStr.slice(1);
          output.push(`\n${capitalizedKind}${symbols.length === 1 ? '' : 's'}:`);

          for (const symbol of symbols) {
            const filePath = uriToPath(symbol.location.uri);
            const location = `${filePath}:${symbol.location.range.start.line + 1}:${symbol.location.range.start.character + 1}`;

            let symbolLine = `• ${symbol.name} at ${location}`;
            if (symbol.containerName) {
              symbolLine += `\n  Container: ${symbol.containerName}`;
            }
            output.push(symbolLine);
          }
        }

        // Add search statistics
        if (limitedSymbols.length < finalSymbols.length) {
          output.push(
            `\nResults: ${limitedSymbols.length} shown, ${finalSymbols.length} total matches`
          );
        } else {
          output.push(`\nResults: ${limitedSymbols.length} total`);
        }
        output.push(`Search completed in ${searchTime}ms`);

        return {
          content: [
            {
              type: 'text',
              text: output.join('\n'),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text',
              text: `Error searching workspace symbols: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    }

    if (name === 'get_all_diagnostics') {
      const {
        severity_filter,
        include_files,
        exclude_files,
        max_diagnostics_per_file = 50,
        group_by_severity = true,
        include_source = true,
      } = args as {
        severity_filter?: string[];
        include_files?: string[];
        exclude_files?: string[];
        max_diagnostics_per_file?: number;
        group_by_severity?: boolean;
        include_source?: boolean;
      };

      try {
        process.stderr.write(
          `[DEBUG get_all_diagnostics] Starting workspace diagnostics analysis with ${include_files?.length || 0} include patterns and ${exclude_files?.length || 0} exclude patterns\n`
        );

        const diagnosticsMap = await lspClient.getAllDiagnostics(include_files, exclude_files);

        if (diagnosticsMap.size === 0) {
          return {
            content: [
              {
                type: 'text',
                text: 'No diagnostics found in the workspace. All files are error-free!',
              },
            ],
          };
        }

        // Convert severity strings to numbers for filtering
        const severityMap = {
          error: 1,
          warning: 2,
          information: 3,
          hint: 4,
        };

        const allowedSeverities = severity_filter
          ?.map((s) => severityMap[s as keyof typeof severityMap])
          .filter(Boolean);

        // Collect and process all diagnostics
        const diagnosticsBySeverity = {
          ERRORS: [] as { file: string; diagnostic: Diagnostic }[],
          WARNINGS: [] as { file: string; diagnostic: Diagnostic }[],
          INFORMATION: [] as { file: string; diagnostic: Diagnostic }[],
          HINTS: [] as { file: string; diagnostic: Diagnostic }[],
        };

        let totalDiagnostics = 0;
        const filesWithIssues = new Set<string>();

        for (const [filePath, diagnostics] of diagnosticsMap) {
          filesWithIssues.add(filePath);

          let fileProcessedCount = 0;

          for (const diagnostic of diagnostics) {
            if (fileProcessedCount >= max_diagnostics_per_file) {
              break; // Limit diagnostics per file
            }

            // Filter by severity if specified
            if (allowedSeverities && allowedSeverities.length > 0) {
              if (!diagnostic.severity || !allowedSeverities.includes(diagnostic.severity)) {
                continue;
              }
            }

            const severityName =
              diagnostic.severity === 1
                ? 'ERRORS'
                : diagnostic.severity === 2
                  ? 'WARNINGS'
                  : diagnostic.severity === 3
                    ? 'INFORMATION'
                    : 'HINTS';

            diagnosticsBySeverity[severityName].push({
              file: filePath,
              diagnostic,
            });

            totalDiagnostics++;
            fileProcessedCount++;
          }
        }

        // Build response
        const output: string[] = [];

        // Summary header
        const errorCount = diagnosticsBySeverity.ERRORS.length;
        const warningCount = diagnosticsBySeverity.WARNINGS.length;
        const infoCount = diagnosticsBySeverity.INFORMATION.length;
        const hintCount = diagnosticsBySeverity.HINTS.length;

        output.push('Workspace diagnostics summary:');
        if (errorCount > 0) output.push(`• ${errorCount} errors across files`);
        if (warningCount > 0) output.push(`• ${warningCount} warnings across files`);
        if (infoCount > 0) output.push(`• ${infoCount} information messages across files`);
        if (hintCount > 0) output.push(`• ${hintCount} hints across files`);
        output.push('');

        // Group by severity if requested
        if (group_by_severity) {
          const severities = ['ERRORS', 'WARNINGS', 'INFORMATION', 'HINTS'];

          for (const severityName of severities) {
            const items = diagnosticsBySeverity[severityName as keyof typeof diagnosticsBySeverity];
            if (items.length === 0) continue;

            output.push(`${severityName} (${items.length}):`);
            output.push('');

            // Group by file for better readability
            const byFile = new Map<string, Diagnostic[]>();
            for (const item of items) {
              if (!byFile.has(item.file)) {
                byFile.set(item.file, []);
              }
              byFile.get(item.file)?.push(item.diagnostic);
            }

            for (const [filePath, fileDiagnostics] of byFile) {
              const relativePath = filePath.replace(process.cwd(), '.');
              output.push(`${relativePath}:`);

              for (const diag of fileDiagnostics) {
                const code = diag.code ? ` [${diag.code}]` : '';
                const source = include_source && diag.source ? ` (${diag.source})` : '';
                const { start, end } = diag.range;

                output.push(`• ${diag.message}${code}${source}`);
                output.push(
                  `  Location: Line ${start.line + 1}, Column ${start.character + 1} to Line ${end.line + 1}, Column ${end.character + 1}`
                );
              }
              output.push('');
            }
          }
        } else {
          // Flat list grouped by file
          for (const [filePath, diagnostics] of diagnosticsMap) {
            const relativePath = filePath.replace(process.cwd(), '.');
            const fileCount = Math.min(diagnostics.length, max_diagnostics_per_file);

            output.push(`${relativePath} (${fileCount} diagnostic${fileCount === 1 ? '' : 's'}):`);

            const limitedDiagnostics = diagnostics.slice(0, max_diagnostics_per_file);
            for (const diag of limitedDiagnostics) {
              // Filter by severity if specified
              if (allowedSeverities && allowedSeverities.length > 0) {
                if (!diag.severity || !allowedSeverities.includes(diag.severity)) {
                  continue;
                }
              }

              const severityName =
                diag.severity === 1
                  ? 'Error'
                  : diag.severity === 2
                    ? 'Warning'
                    : diag.severity === 3
                      ? 'Information'
                      : 'Hint';
              const code = diag.code ? ` [${diag.code}]` : '';
              const source = include_source && diag.source ? ` (${diag.source})` : '';
              const { start, end } = diag.range;

              output.push(`• ${severityName}${code}${source}: ${diag.message}`);
              output.push(
                `  Location: Line ${start.line + 1}, Column ${start.character + 1} to Line ${end.line + 1}, Column ${end.character + 1}`
              );
            }
            output.push('');
          }
        }

        // Summary footer
        output.push(`Files with issues: ${filesWithIssues.size} of total files analyzed`);
        if (filesWithIssues.size > 0) {
          // Find file with most issues
          let mostIssuesFile = '';
          let mostIssuesCount = 0;
          for (const [filePath, diagnostics] of diagnosticsMap) {
            if (diagnostics.length > mostIssuesCount) {
              mostIssuesCount = diagnostics.length;
              mostIssuesFile = filePath;
            }
          }
          if (mostIssuesFile) {
            const relativePath = mostIssuesFile.replace(process.cwd(), '.');
            output.push(`Most issues in: ${relativePath} (${mostIssuesCount} diagnostics)`);
          }
        }

        return {
          content: [
            {
              type: 'text',
              text: output.join('\n'),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text',
              text: `Error getting workspace diagnostics: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    }

    if (name === 'check_capabilities') {
      const {
        file_extension,
        capability_type,
        detailed = false,
      } = args as {
        file_extension?: string;
        capability_type?: 'text_document' | 'workspace' | 'experimental';
        detailed?: boolean;
      };

      try {
        let output: string[] = [];
        output.push('LSP Server Capabilities:');
        output.push('');

        if (file_extension) {
          // Get capabilities for specific file extension
          const capabilities = lspClient.getServerCapabilities(file_extension);
          if (!capabilities) {
            return {
              content: [
                {
                  type: 'text',
                  text: `No LSP server found for file extension "${file_extension}". Check your cclsp.json configuration.`,
                },
              ],
            };
          }

          const serverConfig = lspClient.getServerConfigForExtension(file_extension);
          const serverName = serverConfig ? serverConfig.command.join(' ') : 'Unknown Server';

          output.push(`${serverName} (extension: ${file_extension}):`);
          output = output.concat(formatServerCapabilities(capabilities, capability_type, detailed));
        } else {
          // Get capabilities for all servers
          const allCapabilities = lspClient.getAllServerCapabilities();

          if (allCapabilities.size === 0) {
            return {
              content: [
                {
                  type: 'text',
                  text: 'No active LSP servers found. Make sure servers are configured and running.',
                },
              ],
            };
          }

          for (const [serverKey, capabilities] of allCapabilities) {
            try {
              const serverConfig = JSON.parse(serverKey);
              const serverName = serverConfig.command ? serverConfig.command.join(' ') : 'Unknown';
              const extensions = serverConfig.extensions
                ? serverConfig.extensions.join(', ')
                : 'unknown';

              output.push(`${serverName} (extensions: ${extensions}):`);
              output = output.concat(
                formatServerCapabilities(capabilities, capability_type, detailed)
              );
              output.push('');
            } catch (parseError) {
              output.push(`Server with key ${serverKey}:`);
              output = output.concat(
                formatServerCapabilities(capabilities, capability_type, detailed)
              );
              output.push('');
            }
          }
        }

        // Add summary
        if (!file_extension && !capability_type) {
          const allCapabilities = lspClient.getAllServerCapabilities();
          output.push('Summary:');
          output.push(
            `• ${allCapabilities.size} active LSP server${allCapabilities.size === 1 ? '' : 's'}`
          );

          let hasFullSupport = false;
          let hasLimitedSupport = false;

          for (const capabilities of allCapabilities.values()) {
            const hasNavigation =
              capabilities.definitionProvider && capabilities.referencesProvider;
            const hasFormatting = capabilities.documentFormattingProvider;
            const hasCodeActions = capabilities.codeActionProvider;

            if (hasNavigation && hasFormatting && hasCodeActions) {
              hasFullSupport = true;
            } else if (hasNavigation) {
              hasLimitedSupport = true;
            }
          }

          if (hasFullSupport) {
            output.push('• At least one server has full feature support');
          } else if (hasLimitedSupport) {
            output.push('• Limited feature support available');
          } else {
            output.push('• Basic navigation support available');
          }
        }

        return {
          content: [
            {
              type: 'text',
              text: output.join('\n'),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text',
              text: `Error checking capabilities: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    }

    if (name === 'delete_symbol') {
      const {
        file_path,
        symbol_name,
        symbol_kind,
        delete_references = false,
        dry_run = true,
        force_delete = false,
      } = args as {
        file_path: string;
        symbol_name: string;
        symbol_kind?: string;
        delete_references?: boolean;
        dry_run?: boolean;
        force_delete?: boolean;
      };
      const absolutePath = resolve(file_path);

      try {
        // Analyze the symbol for deletion
        const symbolInfo = await lspClient.analyzeSymbolForDeletion(
          absolutePath,
          symbol_name,
          symbol_kind
        );

        if (!symbolInfo) {
          return {
            content: [
              {
                type: 'text',
                text: `No symbol found with name "${symbol_name}"${symbol_kind ? ` and kind "${symbol_kind}"` : ''} in ${file_path}. Please verify the symbol name and ensure the language server is properly configured.`,
              },
            ],
          };
        }

        // Generate response based on analysis
        const { symbolMatch, definition, references, canSafelyDelete, dependencyInfo } = symbolInfo;
        const kindStr = lspClient.symbolKindToString(symbolMatch.kind);
        const defPath = uriToPath(definition.uri);
        const defLocation = `${defPath}:${definition.range.start.line + 1}:${definition.range.start.character + 1}`;

        // Calculate line count for the definition
        const defStartLine = definition.range.start.line;
        const defEndLine = definition.range.end.line;
        const lineCount = defEndLine - defStartLine + 1;

        let responseText = `Symbol deletion analysis for "${symbol_name}":\n\n`;

        // Symbol found section
        responseText += 'Symbol found:\n';
        responseText += `• ${symbol_name} (${kindStr}) at ${defLocation}\n`;
        responseText += `  Lines ${defStartLine + 1}-${defEndLine + 1} (${lineCount} lines of code)\n\n`;

        // References section
        responseText += `References found: ${references.length} reference${references.length === 1 ? '' : 's'}\n`;

        if (canSafelyDelete) {
          responseText += '✓ Safe to delete - no external references found\n\n';
        } else {
          responseText += '⚠️  Cannot safely delete - references exist:\n';

          // Show external references (excluding the definition itself)
          const externalRefs = references.filter((ref) => {
            const refPath = uriToPath(ref.uri);
            return (
              refPath !== defPath ||
              ref.range.start.line !== definition.range.start.line ||
              ref.range.start.character !== definition.range.start.character
            );
          });

          for (const ref of externalRefs.slice(0, 10)) {
            // Limit to first 10 references
            const refPath = uriToPath(ref.uri);
            const refLocation = `${refPath}:${ref.range.start.line + 1}:${ref.range.start.character + 1}`;
            responseText += `  • ${refLocation}\n`;
          }

          if (externalRefs.length > 10) {
            responseText += `  • ... and ${externalRefs.length - 10} more reference(s)\n`;
          }
          responseText += '\n';
        }

        // Handle dry run vs actual execution
        if (!dry_run) {
          // Check safety and force_delete requirements
          if (!canSafelyDelete && !delete_references && !force_delete) {
            responseText += 'Cannot delete: Symbol has references. Options:\n';
            responseText += '1. Set delete_references=true to remove all references\n';
            responseText += '2. Set force_delete=true to delete definition only (may break code)\n';
            responseText += '3. Set dry_run=true to preview changes first\n';

            return {
              content: [
                {
                  type: 'text',
                  text: responseText,
                },
              ],
            };
          }

          // Apply the deletion
          const workspaceEdit = await lspClient.deleteSymbolWithEdits(
            symbolInfo,
            delete_references
          );
          const { content: editResult } = await lspClient.applyWorkspaceEdit(workspaceEdit);

          responseText += `Deletion completed:\n${editResult}\n`;

          if (force_delete && !canSafelyDelete && !delete_references) {
            responseText +=
              '\n⚠️  Warning: Symbol definition deleted but references remain. This may break your code.\n';
          }
        } else {
          // Dry run mode - show preview
          const workspaceEdit = await lspClient.deleteSymbolWithEdits(
            symbolInfo,
            delete_references
          );

          responseText += 'Deletion preview:\n';

          if (workspaceEdit.changes) {
            let totalEdits = 0;
            let filesModified = 0;

            for (const [uri, edits] of Object.entries(workspaceEdit.changes)) {
              const filePath = uriToPath(uri);
              const relativePath = filePath.replace(process.cwd(), '.');
              filesModified++;
              totalEdits += edits.length;

              responseText += `${relativePath}:\n`;

              for (const edit of edits.slice(0, 3)) {
                // Show first 3 edits per file
                const { start, end } = edit.range;
                const isRemoval = edit.newText === '';
                const editType = isRemoval ? 'Remove' : 'Replace';
                responseText += `  - ${editType} lines ${start.line + 1}-${end.line + 1}\n`;

                if (!isRemoval && edit.newText.length < 100) {
                  responseText += `    With: "${edit.newText}"\n`;
                }
              }

              if (edits.length > 3) {
                responseText += `  - ... and ${edits.length - 3} more edit(s)\n`;
              }
              responseText += '\n';
            }

            responseText += 'Changes to apply:\n';
            responseText += `• ${filesModified} file${filesModified === 1 ? '' : 's'} modified\n`;
            responseText += `• ${totalEdits} edit${totalEdits === 1 ? '' : 's'} total\n`;

            if (delete_references && references.length > 1) {
              responseText += `• ${references.length - 1} reference${references.length - 1 === 1 ? '' : 's'} removed\n`;
            }
          }

          responseText += '\nStatus: ';
          if (canSafelyDelete || delete_references || force_delete) {
            responseText += 'Ready for deletion\n';
            responseText += 'Use dry_run=false to apply these changes.';
          } else {
            responseText += 'Cannot proceed - references exist.\n';
            responseText += 'Options:\n';
            responseText += '1. Set delete_references=true to remove all references\n';
            responseText += '2. Set force_delete=true to delete definition only (may break code)';
          }
        }

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
              text: `Error deleting symbol: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    }

    throw new Error(`Unknown tool: ${name}`);
  } catch (error) {
    return {
      content: [
        {
          type: 'text',
          text: `Error: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
    };
  }
});

process.on('SIGINT', () => {
  lspClient.dispose();
  process.exit(0);
});

process.on('SIGTERM', () => {
  lspClient.dispose();
  process.exit(0);
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write('CCLSP Server running on stdio\n');

  // Preload LSP servers for file types found in the project
  try {
    await lspClient.preloadServers();
  } catch (error) {
    process.stderr.write(`Failed to preload LSP servers: ${error}\n`);
  }
}

main().catch((error) => {
  process.stderr.write(`Server error: ${error}\n`);
  lspClient.dispose();
  process.exit(1);
});
