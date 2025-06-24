#!/usr/bin/env node

import { resolve } from 'node:path';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { LSPClient } from './src/lsp-client.js';

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
        description: 'Find the definition of a symbol at a specific position in a file',
        inputSchema: {
          type: 'object',
          properties: {
            file_path: {
              type: 'string',
              description: 'The path to the file',
            },
            line: {
              type: 'number',
              description: 'The line number (0-based)',
            },
            character: {
              type: 'number',
              description: 'The character position in the line (0-based)',
            },
          },
          required: ['file_path', 'line', 'character'],
        },
      },
      {
        name: 'find_references',
        description: 'Find all references to a symbol at a specific position in a file',
        inputSchema: {
          type: 'object',
          properties: {
            file_path: {
              type: 'string',
              description: 'The path to the file',
            },
            line: {
              type: 'number',
              description: 'The line number (0-based)',
            },
            character: {
              type: 'number',
              description: 'The character position in the line (0-based)',
            },
            include_declaration: {
              type: 'boolean',
              description: 'Whether to include the declaration',
              default: true,
            },
          },
          required: ['file_path', 'line', 'character'],
        },
      },
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    if (name === 'find_definition') {
      const { file_path, line, character } = args as {
        file_path: string;
        line: number;
        character: number;
      };
      const absolutePath = resolve(file_path);

      const locations = await lspClient.findDefinition(absolutePath, { line, character });

      if (locations.length === 0) {
        return {
          content: [
            {
              type: 'text',
              text: 'No definition found',
            },
          ],
        };
      }

      const results = locations
        .map((loc) => {
          const filePath = loc.uri.replace('file://', '');
          const { start, end } = loc.range;
          return `${filePath}:${start.line + 1}:${start.character + 1}`;
        })
        .join('\n');

      return {
        content: [
          {
            type: 'text',
            text: `Definition found:\n${results}`,
          },
        ],
      };
    }

    if (name === 'find_references') {
      const {
        file_path,
        line,
        character,
        include_declaration = true,
      } = args as {
        file_path: string;
        line: number;
        character: number;
        include_declaration?: boolean;
      };
      const absolutePath = resolve(file_path);

      const locations = await lspClient.findReferences(
        absolutePath,
        { line, character },
        include_declaration
      );

      if (locations.length === 0) {
        return {
          content: [
            {
              type: 'text',
              text: 'No references found',
            },
          ],
        };
      }

      const results = locations
        .map((loc) => {
          const filePath = loc.uri.replace('file://', '');
          const { start, end } = loc.range;
          return `${filePath}:${start.line + 1}:${start.character + 1}`;
        })
        .join('\n');

      return {
        content: [
          {
            type: 'text',
            text: `References found:\n${results}`,
          },
        ],
      };
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
  console.error('CCLSP Server running on stdio');
}

main().catch((error) => {
  console.error('Server error:', error);
  lspClient.dispose();
  process.exit(1);
});
