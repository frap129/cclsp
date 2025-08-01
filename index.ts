#!/usr/bin/env node

import { resolve } from 'node:path';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { LSPClient } from './src/lsp-client.js';
import type {
  Command,
  DocumentSymbol,
  SymbolInformation,
  WorkspaceSearchResult,
} from './src/types.js';
import { uriToPath } from './src/utils.js';

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
