# cclsp - not your average LSP adapter

[![npm version](https://badge.fury.io/js/cclsp.svg)](https://www.npmjs.com/package/cclsp)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js Version](https://img.shields.io/node/v/cclsp.svg)](https://nodejs.org)
[![CI](https://github.com/ktnyt/cclsp/actions/workflows/ci.yml/badge.svg)](https://github.com/ktnyt/cclsp/actions/workflows/ci.yml)
[![npm downloads](https://img.shields.io/npm/dm/cclsp.svg)](https://www.npmjs.com/package/cclsp)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

**cclsp** is a Model Context Protocol (MCP) server that seamlessly integrates LLM-based coding agents with Language Server Protocol (LSP) servers. LLM-based coding agents often struggle with providing accurate line/column numbers, which makes naive attempts to integrate with LSP servers fragile and frustrating. cclsp solves this by intelligently trying multiple position combinations and providing robust symbol resolution that just works, no matter how your AI assistant counts lines.

## Setup & Usage Demo

https://github.com/user-attachments/assets/52980f32-64d6-4b78-9cbf-18d6ae120cdd

## Table of Contents

- [Why cclsp?](#why-cclsp)
- [Features](#features)
- [📋 Prerequisites](#-prerequisites)
- [⚡ Setup](#-setup)
  - [Automated Setup (Recommended)](#automated-setup-recommended)
  - [Claude Code Quick Setup](#claude-code-quick-setup)
  - [Manual Setup](#manual-setup)
  - [Language Server Installation](#language-server-installation)
  - [Verification](#verification)
- [🚀 Usage](#-usage)
  - [As MCP Server](#as-mcp-server)
  - [Configuration](#configuration)
- [🛠️ Development](#️-development)
- [🔧 MCP Tools](#-mcp-tools)
  - [`find_definition`](#find_definition)
  - [`find_references`](#find_references)
  - [`rename_symbol`](#rename_symbol)
  - [`rename_symbol_strict`](#rename_symbol_strict)
  - [`get_diagnostics`](#get_diagnostics)
  - [`get_all_diagnostics`](#get_all_diagnostics)
  - [`get_class_members`](#get_class_members)
  - [`get_method_signature`](#get_method_signature)
  - [`search_type`](#search_type)
  - [`get_document_symbols`](#get_document_symbols)
  - [`get_workspace_symbols`](#get_workspace_symbols)
  - [`get_code_actions`](#get_code_actions)
- [💡 Real-world Examples](#-real-world-examples)
  - [Finding Function Definitions](#finding-function-definitions)
  - [Finding All References](#finding-all-references)
  - [Renaming Symbols](#renaming-symbols)
- [🔍 Troubleshooting](#-troubleshooting)
- [🤝 Contributing](#-contributing)
- [📄 License](#-license)

## Why cclsp?

When using AI-powered coding assistants like Claude, you often need to navigate codebases to understand symbol relationships. **cclsp** bridges the gap between Language Server Protocol capabilities and Model Context Protocol, enabling:

- 🔍 **Instant symbol navigation** - Jump to definitions without manually searching
- 📚 **Complete reference finding** - Find all usages of functions, variables, and types
- ✏️ **Safe symbol renaming** - Rename across entire codebases with confidence
- 🌍 **Universal language support** - Works with any LSP-compatible language server
- 🤖 **AI-friendly interface** - Designed for LLMs to understand and use effectively

## Features

- **Go to Definition**: Find where symbols are defined
- **Find References**: Locate all references to a symbol
- **Code Actions**: Get quick fixes, refactoring suggestions, and automated improvements
- **Class Exploration**: List all members of a class with their types
- **Method Signatures**: Get full method signatures with parameters and return types
- **Code Diagnostics**: Get errors, warnings, and hints for your code
- **Multi-language Support**: Configurable LSP servers for different file types
- **TypeScript**: Built-in support via typescript-language-server
- **Python**: Support via python-lsp-server (pylsp)
- **Go**: Support via gopls
- **And many more**: Extensive language server configurations

## 📋 Prerequisites

- Node.js 18+ or Bun runtime
- Language servers for your target languages (installed separately)

## ⚡ Setup

cclsp provides an interactive setup wizard that automates the entire configuration process. Choose your preferred method:

### Automated Setup (Recommended)

Run the interactive setup wizard:

```bash
# One-time setup (no installation required)
npx cclsp@latest setup

# For user-wide configuration
npx cclsp@latest setup --user
```

The setup wizard will:

1. **🔍 Auto-detect languages** in your project by scanning files
2. **📋 Show pre-selected LSP servers** based on detected languages
3. **📦 Display installation requirements** with detailed guides
4. **⚡ Install LSPs automatically** (optional, with user confirmation)
5. **🔗 Add to Claude MCP** (optional, with user confirmation)
6. **✅ Verify setup** and show available tools

#### Setup Options

- **Project Configuration** (default): Creates `.claude/cclsp.json` in current directory
- **User Configuration** (`--user`): Creates global config in `~/.config/claude/cclsp.json`

### Manual Setup

If you prefer manual configuration:

1. **Install cclsp**:

   ```bash
   npm install -g cclsp
   ```

2. **Install language servers** (see [Language Server Installation](#language-server-installation))

3. **Create configuration file**:

   ```bash
   # Use the interactive generator
   cclsp setup

   # Or create manually (see Configuration section)
   ```

4. **Add to Claude MCP**:
   ```bash
   claude mcp add cclsp npx cclsp@latest --env CCLSP_CONFIG_PATH=/path/to/cclsp.json
   ```

### Language Server Installation

The setup wizard shows installation commands for each LSP, but you can also install them manually:

<details>
<summary>📦 Common Language Servers</summary>

#### TypeScript/JavaScript

```bash
npm install -g typescript-language-server typescript
```

#### Python

```bash
pip install "python-lsp-server[all]"
# Or basic installation: pip install python-lsp-server
```

#### Go

```bash
go install golang.org/x/tools/gopls@latest
```

#### Rust

```bash
rustup component add rust-analyzer
rustup component add rust-src
```

#### C/C++

```bash
# Ubuntu/Debian
sudo apt install clangd

# macOS
brew install llvm

# Windows: Download from LLVM releases
```

#### Ruby

```bash
gem install solargraph
```

#### PHP

```bash
npm install -g intelephense
```

For more languages and detailed instructions, run `npx cclsp@latest setup` and select "Show detailed installation guides".

</details>

## 🚀 Usage

### As MCP Server

Configure in your MCP client (e.g., Claude Code):

#### Using npm package (after global install)

```json
{
  "mcpServers": {
    "cclsp": {
      "command": "cclsp",
      "env": {
        "CCLSP_CONFIG_PATH": "/path/to/your/cclsp.json"
      }
    }
  }
}
```

#### Using local installation

```json
{
  "mcpServers": {
    "cclsp": {
      "command": "node",
      "args": ["/path/to/cclsp/dist/index.js"],
      "env": {
        "CCLSP_CONFIG_PATH": "/path/to/your/cclsp.json"
      }
    }
  }
}
```

### Configuration

#### Interactive Configuration Generator

For easy setup, use the interactive configuration generator:

```bash
# Using npx (recommended for one-time setup)
npx cclsp@latest setup

# If installed globally
cclsp setup

# Or run directly with the development version
bun run setup
```

The interactive tool will:

- Show you all available language servers
- Let you select which ones to configure with intuitive controls:
  - **Navigation**: ↑/↓ arrow keys or Ctrl+P/Ctrl+N (Emacs-style)
  - **Selection**: Space to toggle, A to toggle all, I to invert selection
  - **Confirm**: Enter to proceed
- Display installation instructions for your selected languages
- Generate the configuration file automatically
- Show you the final configuration

#### Manual Configuration

Alternatively, create an `cclsp.json` configuration file manually:

```json
{
  "servers": [
    {
      "extensions": ["py", "pyi"],
      "command": ["uvx", "--from", "python-lsp-server", "pylsp"],
      "rootDir": "."
    },
    {
      "extensions": ["js", "ts", "jsx", "tsx"],
      "command": ["npx", "--", "typescript-language-server", "--stdio"],
      "rootDir": "."
    }
  ]
}
```

<details>
<summary>📋 More Language Server Examples</summary>

```json
{
  "servers": [
    {
      "extensions": ["go"],
      "command": ["gopls"],
      "rootDir": "."
    },
    {
      "extensions": ["rs"],
      "command": ["rust-analyzer"],
      "rootDir": "."
    },
    {
      "extensions": ["c", "cpp", "cc", "h", "hpp"],
      "command": ["clangd"],
      "rootDir": "."
    },
    {
      "extensions": ["java"],
      "command": ["jdtls"],
      "rootDir": "."
    },
    {
      "extensions": ["rb"],
      "command": ["solargraph", "stdio"],
      "rootDir": "."
    },
    {
      "extensions": ["php"],
      "command": ["intelephense", "--stdio"],
      "rootDir": "."
    },
    {
      "extensions": ["cs"],
      "command": ["omnisharp", "-lsp"],
      "rootDir": "."
    },
    {
      "extensions": ["swift"],
      "command": ["sourcekit-lsp"],
      "rootDir": "."
    }
  ]
}
```

</details>

## 🛠️ Development

```bash
# Run in development mode
bun run dev

# Run tests
bun test

# Run manual integration test
bun run test:manual

# Lint code
bun run lint

# Format code
bun run format

# Type check
bun run typecheck
```

## 🔧 MCP Tools

The server exposes these MCP tools:

### `find_definition`

Find the definition of a symbol by name and kind in a file. Returns definitions for all matching symbols.

**Parameters:**

- `file_path`: The path to the file
- `symbol_name`: The name of the symbol
- `symbol_kind`: Optional - The kind of symbol (function, class, variable, method, etc.)

### `find_references`

Find all references to a symbol by name and kind in a file. Returns references for all matching symbols.

**Parameters:**

- `file_path`: The path to the file
- `symbol_name`: The name of the symbol
- `symbol_kind`: Optional - The kind of symbol (function, class, variable, method, etc.)
- `include_declaration`: Whether to include the declaration (optional, default: true)

### `rename_symbol`

Rename a symbol by name and kind in a file. If multiple symbols match, returns candidate positions and suggests using rename_symbol_strict.

**Parameters:**

- `file_path`: The path to the file
- `symbol_name`: The name of the symbol
- `symbol_kind`: Optional - The kind of symbol (function, class, variable, method, etc.)
- `new_name`: The new name for the symbol

### `rename_symbol_strict`

Rename a symbol at a specific position in a file. Use this when rename_symbol returns multiple candidates.

**Parameters:**

- `file_path`: The path to the file
- `line`: The line number (1-indexed)
- `character`: The character position in the line (1-indexed)
- `new_name`: The new name for the symbol

### `get_diagnostics`

Get language diagnostics (errors, warnings, hints) for a file. Supports both pull-based (textDocument/diagnostic) and push-based (textDocument/publishDiagnostics) diagnostic reporting for maximum compatibility with different LSP servers.

**Parameters:**
- `file_path`: The path to the file

### `get_all_diagnostics`

Get comprehensive workspace-wide diagnostics analysis. This tool scans all configured files in the workspace to provide a complete project health assessment with errors, warnings, information messages, and hints.

**Parameters:**
- `severity_filter` (optional): Array of severity levels to include (`['error', 'warning', 'information', 'hint']`)
- `include_files` (optional): Array of glob patterns for files to include (e.g., `['src/**/*.ts', '*.js']`)
- `exclude_files` (optional): Array of glob patterns for files to exclude (e.g., `['**/*.test.ts', 'dist/**']`)
- `max_diagnostics_per_file` (optional): Maximum diagnostics to show per file (default: 50)
- `group_by_severity` (optional): Group results by severity level for better organization (default: true)
- `include_source` (optional): Include diagnostic source tool information (default: true)

**Features:**
- **Workspace-wide scanning**: Analyzes all files across configured language servers
- **Flexible filtering**: Filter by file patterns and diagnostic severity
- **Organized output**: Groups diagnostics by severity with summary statistics
- **Performance optimized**: Batch processing for large workspaces
- **Gitignore-aware**: Automatically respects .gitignore patterns
- **Error resilient**: Continues processing when individual files fail

**Example Output:**
```
Workspace diagnostics summary:
• 8 errors across files
• 15 warnings across files
• 3 hints across files

ERRORS (8):

./src/utils/validation.ts:
• Type 'string' is not assignable to type 'number' [TS2322] (typescript)
  Location: Line 45, Column 12 to Line 45, Column 18

./src/components/Header.tsx:
• Cannot find name 'React' [TS2304] (typescript)
  Location: Line 1, Column 8 to Line 1, Column 13

Files with issues: 12 of 156 total files analyzed
Most issues in: ./src/utils/validation.ts (5 diagnostics)
```

### `get_class_members`

List all properties and methods of a class. Returns members with their types and signatures using LSP hover information, including namespace/package information and detailed parameter types.

**Parameters:**
- `file_path`: The path to the file containing the class
- `class_name`: The name of the class

**Enhanced Response Includes:**
- Full type signatures with documentation
- Namespace and package information for imported types
- Parameter details including names, types, optional flags, and default values
- Return type information for methods

### `get_method_signature`

Show full method definition with parameters and return type using LSP hover information. Particularly useful for understanding API methods and their expected parameters.

**Parameters:**
- `file_path`: The path to the file containing the method
- `method_name`: The name of the method
- `class_name`: Optional - The name of the class containing the method (helps narrow results)

**Enhanced Response Includes:**
- Complete method signature with all type information
- Parsed parameter details with types and default values
- Namespace/package information for complex types
- Documentation comments when available

### `search_type`

Search for symbols (types, methods, functions, variables, etc.) across the entire workspace by name. Supports wildcards and case-insensitive search by default, making it perfect for discovering symbols when you don't know the exact location.

**Parameters:**
- `type_name`: The name or pattern of the symbol to search for. Supports wildcards: `*` (any sequence), `?` (single char). Examples: `BreakType`, `*method`, `getValue*`, `?etData`
- `type_kind`: Optional - Filter by symbol kind (`class`, `interface`, `enum`, `struct`, `type_parameter`, `method`, `function`, `constructor`, `field`, `variable`, `property`, `constant`, `namespace`, `module`, `package`)
- `case_sensitive`: Optional - Whether to perform case-sensitive search (default: false)

**Features:**
- **Workspace-wide search**: Searches across all files in the workspace
- **Wildcard support**: Use `*` and `?` for pattern matching
- **Symbol filtering**: Filter results by specific symbol types
- **Case-insensitive by default**: Finds symbols regardless of case
- **Smart symbol resolution**: Handles complex signatures for methods and functions

### `get_document_symbols`

Get all symbols (classes, functions, variables, etc.) in a document with their locations and hierarchy. Perfect for exploring unfamiliar files and understanding code structure at a glance.

**Parameters:**
- `file_path`: The path to the file to analyze
- `symbol_kind`: Optional - Filter by symbol kind (`class`, `function`, `variable`, `method`, `property`, `field`, `constructor`, `enum`, `interface`, `namespace`, `module`, `constant`)
- `include_children`: Whether to include child symbols (e.g., methods within classes) - default: true

**Features:**
- **Complete file overview**: Lists all symbols in a single file without needing to know what to look for
- **Hierarchical structure**: Shows parent-child relationships (e.g., methods within classes)  
- **Symbol filtering**: Optionally filter by specific symbol types
- **Location information**: Provides exact line and character positions
- **Discovery-oriented**: Ideal for code exploration and understanding file architecture

### `get_workspace_symbols`

Search for symbols across the entire workspace by name or pattern. Perfect for finding symbols when you don't know their exact location or exploring large codebases.

**Parameters:**
- `query`: Search query for symbols (supports wildcards and partial matching)
- `symbol_kind`: Optional - Filter by symbol kind (`class`, `function`, `variable`, `method`, `property`, `field`, `constructor`, `enum`, `interface`, `namespace`, `module`, `constant`, `file`, `package`, `struct`, `event`, `operator`, `type_parameter`)
- `max_results`: Maximum number of results to return (default: 100)
- `case_sensitive`: Whether search should be case sensitive (default: false)

**Features:**
- **Workspace-wide search**: Searches across all files and language servers in the workspace
- **Wildcard support**: Use `*` and `?` for pattern matching (e.g., `*Error*`, `get*`, `?etUser`)
- **Symbol filtering**: Filter results by specific symbol types
- **Multi-language support**: Queries all configured language servers simultaneously
- **Performance metrics**: Shows search time and result statistics
- **Grouped output**: Results organized by symbol kind with file locations and container information
- **Container information**: Shows which namespace/module/class contains each symbol

### `get_code_actions`

Get available code actions (quick fixes, refactoring suggestions, etc.) for a specific location or range in a file. Code actions provide automated code improvements and transformations.

**Parameters:**
- `file_path`: The path to the file
- `start_line`: Start line number (1-indexed)
- `end_line`: Optional - End line number (1-indexed, defaults to start_line)
- `start_character`: Optional - Start character position (1-indexed, defaults to 0)
- `end_character`: Optional - End character position (1-indexed, defaults to end of line)
- `include_kinds`: Optional - Filter for specific action kinds (`quickfix`, `refactor`, `source`, etc.)
- `only_preferred`: Optional - Only return preferred actions (default: false)
- `apply_action`: Optional - Title of the specific action to apply

**Features:**
- **Quick fixes**: Automatic fixes for diagnostics and errors
- **Refactoring**: Extract methods, rename variables, organize imports, etc.
- **Source actions**: Organize imports, remove unused imports, format code
- **Action filtering**: Filter by action kind or preference
- **Action execution**: Apply specific actions directly by providing the action title
- **Workspace edits**: Handles actions that modify multiple files
- **Diagnostic integration**: Uses file diagnostics to provide relevant fixes

### `get_completion`

Get code completion suggestions at a specific position in a file. Provides intelligent autocomplete functionality to assist with code development and exploration.

**Parameters:**
- `file_path`: The path to the file
- `line`: The line number (1-indexed)
- `character`: The character position (1-indexed)
- `trigger_character`: Optional - The character that triggered completion (e.g., ".", ":")
- `resolve_details`: Whether to resolve additional details like documentation and auto-imports (default: false)
- `include_auto_import`: Whether to include auto-import suggestions (default: false)
- `max_results`: Maximum number of completion items to return (default: 50)

**Features:**
- **Context-aware suggestions**: Provides relevant completions based on current scope and position
- **Type information**: Shows parameter types and return types for methods and functions
- **Documentation**: Includes brief descriptions when available and when resolve_details is enabled
- **Auto-import support**: Suggests imports for external symbols when include_auto_import is enabled
- **Organized output**: Groups completions by kind (methods, properties, variables, etc.)
- **Multi-position support**: Automatically tries different position combinations for better accuracy

### `format_document`

Format a document or specific range with configurable formatting options. Provides consistent code style and formatting using the LSP server's formatting capabilities.

**Parameters:**
- `file_path`: The path to the file to format
- `start_line`: Optional - Start line for range formatting (1-indexed)
- `end_line`: Optional - End line for range formatting (1-indexed)
- `tab_size`: Number of spaces per tab (default: 2)
- `insert_spaces`: Use spaces instead of tabs (default: true)
- `trim_trailing_whitespace`: Remove trailing whitespace (default: true)
- `insert_final_newline`: Insert final newline at end of file (default: true)
- `trim_final_newlines`: Trim extra newlines at end of file (default: true)
- `apply_changes`: Apply formatting changes to the file (default: false - preview only)

**Features:**
- **Full document formatting**: Format entire files with consistent style
- **Range formatting**: Format specific line ranges only
- **Preview mode**: Show formatting changes without applying them (default)
- **Apply mode**: Optionally apply changes directly to files
- **Configurable options**: Customizable indentation, whitespace, and newline handling
- **Detailed change summary**: Shows what formatting changes were made
- **Multiple language support**: Works with any LSP server that supports formatting

## 💡 Real-world Examples

### Finding Function Definitions

When Claude needs to understand how a function works:

```
Claude: Let me find the definition of the `processRequest` function
> Using cclsp.find_definition at line 42, character 15

Result: Found definition at src/handlers/request.ts:127
```

### Finding All References

When refactoring or understanding code impact:

```
Claude: I'll find all places where `CONFIG_PATH` is used
> Using cclsp.find_references at line 10, character 20

Results: Found 5 references:
- src/config.ts:10 (declaration)
- src/index.ts:45
- src/utils/loader.ts:23
- tests/config.test.ts:15
- tests/config.test.ts:89
```

### Renaming Symbols

Safe refactoring across the entire codebase:

```
Claude: I'll rename `getUserData` to `fetchUserProfile`
> Using cclsp.rename_symbol at line 55, character 10

Result: 12 files will be updated with the new name
```

### Checking File Diagnostics

When analyzing code quality:

```
Claude: Let me check for any errors or warnings in this file
> Using cclsp.get_diagnostics

Results: Found 3 diagnostics:
- Error [TS2304]: Cannot find name 'undefinedVar' (Line 10, Column 5)
- Warning [no-unused-vars]: 'config' is defined but never used (Line 25, Column 10)
- Hint: Consider using const instead of let (Line 30, Column 1)
```

### Workspace-wide Health Assessment

When assessing project quality across the entire codebase:

```
Claude: Let me analyze the overall health of this project
> Using cclsp.get_all_diagnostics

Workspace diagnostics summary:
• 12 errors across files
• 28 warnings across files
• 5 hints across files

ERRORS (12):

./src/utils/validation.ts:
• Type 'string' is not assignable to type 'number' [TS2322] (typescript)
  Location: Line 45, Column 12 to Line 45, Column 18
• Cannot find name 'ValidationError' [TS2304] (typescript)
  Location: Line 23, Column 11 to Line 23, Column 25

./src/components/Header.tsx:
• Cannot find name 'React' [TS2304] (typescript)
  Location: Line 1, Column 8 to Line 1, Column 13

Files with issues: 15 of 89 total files analyzed (16.9%)
Most issues in: ./src/utils/validation.ts (5 diagnostics)

Claude: I can see this project has some critical issues that need attention. 
The validation utility has type mismatches, and there are missing imports 
in the React components. Let me help you fix these systematically.
```

### Exploring Class Structure

When understanding API architecture:

```
Claude: Let me explore the ApiService class structure
> Using cclsp.get_class_members for class "ApiService"

Results: Found 8 members in class "ApiService":
• constructor (constructor) at src/services/api.ts:10:3
• baseUrl (property) at src/services/api.ts:12:3
  private baseUrl: string
  Type: string
• request (method) at src/services/api.ts:20:3
  async request<T>(endpoint: string, options?: RequestOptions): Promise<T>
  Parameters:
    - endpoint: string
    - options?: RequestOptions
  Returns: Promise<T>
• get (method) at src/services/api.ts:35:3
  async get<T>(endpoint: string): Promise<T>
  Parameters:
    - endpoint: string
  Returns: Promise<T>
• post (method) at src/services/api.ts:40:3
  async post<T>(endpoint: string, data: unknown): Promise<T>
  Parameters:
    - endpoint: string
    - data: unknown
  Returns: Promise<T>
```

### Getting Method Signatures

When understanding function APIs:

```
Claude: I need to understand the formatDate method signature
> Using cclsp.get_method_signature for method "formatDate"

Method: formatDate at src/utils/date.ts:15:10
formatDate(date: Date | string, format?: string): string

Type Details:
  Parameters:
    - date: Date | string
    - format?: string = "YYYY-MM-DD"
  Returns: string
```

### Searching Across the Workspace

When you need to find symbols but don't know their exact location:

```
Claude: I need to find all error handling functions in this codebase
> Using cclsp.search_type with type_name "*Error*"

Results: Found 12 symbols matching "*Error*":
• CustomError (class) at src/utils/errors.ts:5:1
• handleError (function) at src/handlers/error.ts:10:1
• ApiError (class) at src/services/api-client.ts:15:1
• logError (method) at src/logger.ts:45:3
• parseErrorResponse (function) at src/utils/response.ts:23:1
```

### Workspace Symbol Search

When you need to find symbols across the entire project:

```
Claude: I need to find all UserService implementations in this codebase
> Using cclsp.get_workspace_symbols with query "UserService"

Found 7 symbols matching "UserService" across workspace:

Classes:
• UserService at src/services/UserService.ts:15:1
  Container: services

• MockUserService at tests/mocks/UserService.mock.ts:8:1
  Container: mocks

Interfaces:
• IUserService at src/interfaces/UserService.interface.ts:5:1
  Container: interfaces

Functions:
• createUserService at src/factories/userServiceFactory.ts:12:1
  Container: factories

• getUserService at src/utils/serviceRegistry.ts:45:1
  Container: utils

Variables:
• userService at src/app.ts:23:1
  Container: app

• defaultUserService at src/config/services.ts:18:1
  Container: config

Results: 7 total
Search completed in 145ms
```

### Pattern-Based Workspace Search

When you want to find symbols matching a pattern:

```
Claude: I need to find all error handling functions and classes
> Using cclsp.get_workspace_symbols with query "*Error*"

Found 12 symbols matching "*Error*" across workspace:

Classes:
• CustomError at src/utils/errors.ts:5:1
• ApiError at src/services/api-client.ts:15:1
• ValidationError at src/validators/error.ts:8:1

Functions:
• handleError at src/handlers/error.ts:10:1
• logError at src/logger.ts:45:3
• parseErrorResponse at src/utils/response.ts:23:1
```

### Exploring Unfamiliar Files

When you encounter a new file and want to understand its structure:

```
Claude: Let me see what's in this authentication module
> Using cclsp.get_document_symbols for file "src/auth/jwt.ts"

Found 8 symbols in src/auth/jwt.ts:

Classes:
• JwtService at line 10:1
  - constructor() at line 12:3
  - generateToken(payload: object): string at line 15:3
  - verifyToken(token: string): object at line 25:3
  - refreshToken(token: string): string at line 35:3

Functions:
• createJwtSecret(): string at line 45:1
• isTokenExpired(token: string): boolean at line 50:1

Constants:
• JWT_ALGORITHM: string at line 5:1
• DEFAULT_EXPIRY: number at line 6:1
```

### Getting Code Completion

When you need autocomplete suggestions while writing code:

```
Claude: I need to see what methods are available on this user object
> Using cclsp.get_completion at line 25, character 10

Found 12 completion suggestions at line 25, character 10:

Methods:
• toString(): string
  Returns a string representation of the object
  
• save(): Promise<User>
  Saves the user to the database
  
• delete(): Promise<void>
  Removes the user from the database

Properties:
• id: string
  Unique identifier for the user
  
• email: string
  User's email address
  
• name: string
  User's display name

Functions:
• validateEmail(email: string): boolean
  Validates an email address format
  Auto-import available
```

### Formatting Documents

When you need to format code for consistency:

```
Claude: I need to format this TypeScript file to follow our coding standards
> Using cclsp.format_document with file_path: "src/utils/helpers.ts"

Formatting completed for src/utils/helpers.ts:

Changes applied:
• Line 5: Adjusted indentation from 4 to 2 spaces
• Line 12: Trailing whitespace removed
• Line 18: Missing semicolon added
• Line 25: Line break adjusted for function parameters

Total: 4 formatting edits
File modified: No (preview mode)

To apply these changes, set apply_changes: true
```

### Range Formatting

When you only need to format specific lines:

```
Claude: I need to format just the function definition on lines 15-20
> Using cclsp.format_document with start_line: 15, end_line: 20, apply_changes: true

Formatting completed for lines 15-20 in src/components/button.tsx:

Changes applied:
• Line 16: Adjusted indentation
• Line 18: Added missing spaces around operators
• Line 19: Formatted function parameters

Total: 3 formatting edits
File modified: Yes
```

### Custom Formatting Options

When you need specific formatting preferences:

```
Claude: I need to format this file using tabs instead of spaces, with 4-space tab size
> Using cclsp.format_document with tab_size: 4, insert_spaces: false, apply_changes: true

Formatting completed for src/legacy/old-code.js:

Changes applied:
• Line 3: Converted spaces to tabs
• Line 8: Adjusted tab indentation
• Line 15: Converted spaces to tabs
• Line 22: Removed trailing whitespace

Total: 12 formatting edits
File modified: Yes
```

## 🔍 Troubleshooting

### Known Issues

<details>
<summary>🐍 Python LSP Server (pylsp) Performance Degradation</summary>

**Problem**: The Python Language Server (pylsp) may become slow or unresponsive after extended use (several hours), affecting symbol resolution and code navigation.

**Symptoms**:
- Slow or missing "go to definition" results for Python files
- Delayed or incomplete symbol references
- General responsiveness issues with Python code analysis

**Solution**: Use the auto-restart feature to periodically restart the pylsp server:

Add `restartInterval` to your Python server configuration:

```json
{
  "servers": [
    {
      "extensions": ["py", "pyi"],
      "command": ["pylsp"],
      "restartInterval": 5
    }
  ]
}
```

This will automatically restart the Python LSP server every 5 minutes, maintaining optimal performance for long coding sessions.

**Note**: The setup wizard automatically configures this for Python servers when detected.

</details>

### Common Issues

<details>
<summary>🔧 LSP server not starting</summary>

**Problem**: Error message about LSP server not found

**Solution**: Ensure the language server is installed:

```bash
# For TypeScript
npm install -g typescript-language-server

# For Python
pip install python-lsp-server

# For Go
go install golang.org/x/tools/gopls@latest
```

</details>

<details>
<summary>🔧 Configuration not loading</summary>

**Problem**: cclsp uses default TypeScript configuration only

**Solution**: Check that:

1. Your config file is named `cclsp.json` (not `cclsp.config.json`)
2. The `CCLSP_CONFIG_PATH` environment variable points to the correct file
3. The JSON syntax is valid
</details>

<details>
<summary>🔧 Symbol not found errors</summary>

**Problem**: "Go to definition" returns no results

**Solution**:

1. Ensure the file is saved and part of the project
2. Check that the language server supports the file type
3. Some language servers need a few seconds to index the project
</details>

## 🤝 Contributing

We welcome contributions! Here's how you can help:

### Reporting Issues

Found a bug or have a feature request? [Open an issue](https://github.com/ktnyt/cclsp/issues) with:

- Clear description of the problem
- Steps to reproduce
- Expected vs actual behavior
- Your environment (OS, Node version, etc.)

### Adding Language Support

Want to add support for a new language?

1. Find the LSP server for your language
2. Test the configuration locally
3. Submit a PR with:
   - Updated README examples
   - Test files if possible
   - Configuration documentation

### Code Contributions

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/amazing-feature`
3. Make your changes
4. Run tests: `bun test`
5. Commit: `git commit -m '✨ feat: add amazing feature'`
6. Push: `git push origin feature/amazing-feature`
7. Open a Pull Request

## 📄 License

MIT
