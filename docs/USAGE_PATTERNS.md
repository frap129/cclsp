# Common CCLSP Usage Patterns

This document outlines common usage patterns for the CCLSP MCP server in development workflows.

## Table of Contents
1. [Basic Symbol Navigation](#basic-symbol-navigation)
2. [Code Exploration](#code-exploration)
3. [Workspace Discovery](#workspace-discovery)
4. [Refactoring](#refactoring)
5. [Debugging and Diagnostics](#debugging-and-diagnostics)
6. [API Documentation](#api-documentation)

## Basic Symbol Navigation

### Finding Symbol Definitions

Find where a function, class, or variable is defined:

```
find_definition:
  file_path: "src/index.ts"
  symbol_name: "processRequest"
  symbol_kind: "function"  # optional, helps narrow results
```

### Finding All References

Locate all places where a symbol is used:

```
find_references:
  file_path: "src/models/user.ts"
  symbol_name: "User"
  symbol_kind: "class"
  include_declaration: true  # include the definition location
```

## Code Exploration

### Exploring File Structure

Get all symbols in a document to understand its organization:

```
get_document_symbols:
  file_path: "src/services/api.ts"
  include_children: true  # show methods within classes
```

This returns:
- Hierarchical view of all symbols in the file
- Classes, functions, variables, methods, etc.
- Location information for each symbol
- Parent-child relationships (methods within classes)

### Filtering Document Symbols

Get only specific types of symbols from a file:

```
get_document_symbols:
  file_path: "src/components/button.tsx"
  symbol_kind: "function"  # only show functions
  include_children: false  # don't show nested symbols
```

### Exploring Class Structure

Get all members (properties and methods) of a class:

```
get_class_members:
  file_path: "src/services/api.ts"
  class_name: "ApiService"
```

This returns:
- All properties with their types
- All methods with their signatures
- Member visibility (public/private/protected)
- Location information for each member

### Understanding Method Signatures

Get detailed method signature information including parameters and return types:

```
get_method_signature:
  file_path: "src/utils/helpers.ts"
  method_name: "formatDate"
  class_name: "DateFormatter"  # optional, for class methods
```

Returns:
- Full method signature with parameter types
- Return type information
- JSDoc comments if available
- Overload signatures if applicable

## Code Completion

### Getting Autocomplete Suggestions

Get code completion suggestions at any position in a file:

```
get_completion:
  file_path: "src/api/user.ts"
  line: 25
  character: 10
```

This returns organized completion suggestions:
- Methods and functions with their signatures
- Properties and fields with their types
- Variables and constants in scope
- Available imports and auto-import suggestions

### Trigger Character Completion

Get completions triggered by specific characters like `.` or `:`:

```
get_completion:
  file_path: "src/api/user.ts"
  line: 25
  character: 12
  trigger_character: "."
```

Useful for:
- Object property/method completion after `.`
- Type annotations after `:`
- Module imports after accessing properties

### Detailed Completion Information

Get comprehensive completion details including documentation:

```
get_completion:
  file_path: "src/api/user.ts"
  line: 25
  character: 10
  resolve_details: true
  include_auto_import: true
  max_results: 25
```

Returns:
- Detailed documentation for each completion item
- Auto-import suggestions for external symbols
- Parameter information for methods and functions
- Type information and definitions

### Completion for Development Workflows

**When writing new code:**
```
get_completion:
  file_path: "src/components/Button.tsx"
  line: 15
  character: 8
  trigger_character: "."
  max_results: 10
```

**When exploring APIs:**
```
get_completion:
  file_path: "src/services/api.ts"
  line: 42
  character: 15
  resolve_details: true
  include_auto_import: true
```

**When implementing interfaces:**
```
get_completion:
  file_path: "src/models/User.ts"
  line: 20
  character: 5
  resolve_details: true
```

## Document Formatting

### Basic Document Formatting

Format an entire document with default options:

```
format_document:
  file_path: "src/components/Button.tsx"
```

This applies standard formatting:
- 2-space indentation
- Spaces instead of tabs
- Trailing whitespace removal
- Final newline insertion
- Preview mode (no changes applied)

### Range Formatting

Format only specific lines in a document:

```
format_document:
  file_path: "src/utils/helpers.ts"
  start_line: 25
  end_line: 45
```

Useful for:
- Formatting newly added code sections
- Cleaning up specific function definitions
- Applying consistent style to modified regions

### Custom Formatting Options

Specify custom formatting preferences:

```
format_document:
  file_path: "src/legacy/old-code.js"
  tab_size: 4
  insert_spaces: false  # use tabs instead of spaces
  trim_trailing_whitespace: true
  insert_final_newline: false
  apply_changes: true  # actually apply the changes
```

### Preview vs Apply Mode

**Preview Mode (default):**
```
format_document:
  file_path: "src/api/client.ts"
  apply_changes: false  # default
```

Shows what changes would be made without modifying the file. Useful for:
- Reviewing formatting changes before applying
- Understanding what the formatter will do
- Safe exploration of formatting options

**Apply Mode:**
```
format_document:
  file_path: "src/api/client.ts"
  apply_changes: true
```

Actually writes the formatted content to the file. Use when:
- You've reviewed the changes and want to apply them
- You trust the formatting settings
- You're ready to commit the formatting changes

### Formatting Different File Types

**TypeScript/JavaScript:**
```
format_document:
  file_path: "src/components/Header.tsx"
  tab_size: 2
  insert_spaces: true
  trim_trailing_whitespace: true
```

**Python:**
```
format_document:
  file_path: "src/main.py"
  tab_size: 4
  insert_spaces: true
  trim_final_newlines: true
```

**Go:**
```
format_document:
  file_path: "cmd/server/main.go"
  tab_size: 8
  insert_spaces: false  # Go prefers tabs
```

### Workflow Integration

**Before committing code:**
```
# 1. Check current formatting
format_document:
  file_path: "src/services/api.ts"
  apply_changes: false

# 2. Apply if changes look good
format_document:
  file_path: "src/services/api.ts"
  apply_changes: true
```

**Batch formatting workflow:**
```
# Format multiple files with consistent settings
format_document:
  file_path: "src/utils/date.ts"
  tab_size: 2
  insert_spaces: true
  apply_changes: true

format_document:
  file_path: "src/utils/string.ts"
  tab_size: 2
  insert_spaces: true
  apply_changes: true
```

**Project standardization:**
```
# Apply project-wide formatting standards
format_document:
  file_path: "src/index.ts"
  tab_size: 2
  insert_spaces: true
  trim_trailing_whitespace: true
  insert_final_newline: true
  trim_final_newlines: true
  apply_changes: true
```

## Workspace Discovery

### Finding Symbols Across the Workspace

Search for symbols when you don't know their exact location:

```
search_type:
  type_name: "UserController"
  type_kind: "class"  # optional filter
  case_sensitive: false  # default
```

### Comprehensive Workspace Symbol Search

Use the new workspace symbols tool for enhanced workspace-wide searching:

```
get_workspace_symbols:
  query: "UserService"
  symbol_kind: "class"  # optional filter
  max_results: 50       # optional limit
  case_sensitive: false # optional sensitivity
```

This provides more comprehensive results than `search_type` including:
- Multi-language server support
- Performance metrics
- Container information
- Grouped output by symbol kind

### Using Wildcards for Pattern Matching

Find symbols matching patterns:

```
search_type:
  type_name: "*Error*"  # find all symbols containing "Error"
  type_kind: "class"
```

```
get_workspace_symbols:
  query: "get*"  # find all symbols starting with "get"
  symbol_kind: "method"
  max_results: 25
```

```
search_type:
  type_name: "?etUser"  # find symbols like "getUser", "setUser"
  type_kind: "function"
```

### Advanced Pattern Examples

**Find all API endpoints:**
```
get_workspace_symbols:
  query: "*Controller"
  symbol_kind: "class"
```

**Find all error types:**
```
get_workspace_symbols:
  query: "*Error*"
  symbol_kind: "class"
  case_sensitive: false
```

**Find specific method patterns:**
```
get_workspace_symbols:
  query: "handle*"
  symbol_kind: "method"
  max_results: 10
```

### Workspace vs Document vs Type Search Comparison

**Use `get_workspace_symbols` when:**
- You need comprehensive workspace-wide search
- You want performance metrics and detailed output
- You're working with multiple language servers
- You need container/namespace information

**Use `search_type` when:**
- You need basic workspace search functionality
- You're looking for specific types with advanced filtering
- You want wildcard pattern matching with case sensitivity options

**Use `get_document_symbols` when:**
- You want to explore a specific file's structure
- You need hierarchical symbol information
- You want to understand file organization

### Discovering API Endpoints

Find all controller methods:

```
search_type:
  type_name: "*Controller"
  type_kind: "class"
```

Then explore each controller:

```
get_class_members:
  file_path: "src/controllers/user-controller.ts"
  class_name: "UserController"
```

## Refactoring

### Safe Symbol Renaming

Rename symbols across the entire codebase:

```
# For unique symbols
rename_symbol:
  file_path: "src/config.ts"
  symbol_name: "oldConfigName"
  symbol_kind: "variable"  # optional, helps narrow results
  new_name: "newConfigName"

# For ambiguous symbols (multiple matches)
rename_symbol_strict:
  file_path: "src/config.ts"
  line: 42
  character: 10
  new_name: "newConfigName"
```

## Debugging and Diagnostics

### Getting File Diagnostics

Check for errors, warnings, and hints in a file:

```
get_diagnostics:
  file_path: "src/components/button.tsx"
```

Returns:
- Syntax errors
- Type errors
- Linting warnings
- Code hints and suggestions
- Exact location of each issue

### Workspace-wide Diagnostics Analysis

Get comprehensive diagnostics for all files in the workspace:

```
get_all_diagnostics:
  severity_filter: ["error", "warning"]
  exclude_files: ["**/*.test.ts", "dist/**"]
  max_diagnostics_per_file: 10
```

**Advanced filtering:**
```
get_all_diagnostics:
  include_files: ["src/**/*.ts", "src/**/*.tsx"] 
  exclude_files: ["**/*.d.ts", "**/*.stories.ts"]
  severity_filter: ["error"]
  group_by_severity: true
```

**Project health overview:**
```
get_all_diagnostics:
  group_by_severity: true
  include_source: true
```

Returns:
- Complete workspace diagnostic summary
- Issues grouped by severity level
- File-by-file breakdown with exact locations
- Statistics on project health
- Most problematic files identification

## API Documentation

### Complete Workflow Example

Here's a complete workflow for exploring and understanding an API:

1. **Find the main API class**:
   ```
   get_workspace_symbols:
     query: "ApiClient"
     symbol_kind: "class"
   ```

2. **Get complete file overview**:
   ```
   get_document_symbols:
     file_path: "src/api/client.ts"
     include_children: true
   ```

3. **Explore its structure**:
   ```
   get_class_members:
     file_path: "src/api/client.ts"
     class_name: "ApiClient"
   ```

4. **Get method details**:
   ```
   get_method_signature:
     file_path: "src/api/client.ts"
     method_name: "request"
     class_name: "ApiClient"
   ```

5. **Find usage examples**:
   ```
   find_references:
     file_path: "src/api/client.ts"
     symbol_name: "request"
     symbol_kind: "method"
   ```

### Discovery-First Approach

When exploring unknown codebases:

1. **Find relevant files**:
   ```
   get_workspace_symbols:
     query: "*Api*"
     case_sensitive: false
   ```

2. **Explore each file**:
   ```
   get_document_symbols:
     file_path: "src/services/user-api.ts"
   ```

3. **Deep dive into interesting symbols**:
   ```
   get_class_members:
     file_path: "src/services/user-api.ts"
     class_name: "UserApi"
   ```

## Best Practices

1. **Use symbol_kind when available**: This helps narrow down results and improves accuracy.

2. **Check diagnostics before refactoring**: Run `get_diagnostics` on specific files or `get_all_diagnostics` for workspace-wide health checks to ensure code is error-free before making changes.

3. **Use strict mode for ambiguous renames**: If `rename_symbol` returns multiple candidates, use `rename_symbol_strict` with specific coordinates.

4. **Combine tools for comprehensive understanding**: 
   - Use `get_workspace_symbols` for enhanced workspace-wide discovery
   - Use `search_type` for basic workspace search with advanced filtering  
   - Use `get_document_symbols` for file-level exploration  
   - Use `get_class_members` for detailed class analysis
   - Use `get_method_signature` for complete API documentation
   - Use `get_completion` for interactive code development and exploration

5. **Use completion effectively**: 
   - Enable `resolve_details` when you need comprehensive information about completion items
   - Use `trigger_character` for context-specific completions (e.g., after `.` or `:`)
   - Set appropriate `max_results` to limit output for better readability
   - Enable `include_auto_import` when working with external libraries

6. **Start with discovery tools**: When exploring unknown codebases, begin with `get_workspace_symbols` and `get_document_symbols` to understand the overall structure.

7. **Use workspace symbols effectively**:
   - Use `get_workspace_symbols` for comprehensive cross-file searches
   - Set appropriate `max_results` to limit output for better readability
   - Use `symbol_kind` filters to narrow down large result sets
   - Leverage wildcard patterns for pattern-based discovery

8. **Use wildcards effectively**: Leverage `*` and `?` in workspace symbol queries for pattern-based discovery.

9. **Verify LSP server configuration**: Ensure the appropriate language server is configured for your file types in `cclsp.json`.

10. **Use formatting strategically**: 
   - Always use preview mode first to review formatting changes before applying
   - Use `format_document` before code reviews to ensure consistent style
   - Apply range formatting for localized changes to avoid unnecessary diffs
   - Configure formatting options to match your project's style guide
   - Use formatting as the final step in your development workflow

10. **Choose appropriate formatting scope**:
    - Use full document formatting for new files or major refactoring
    - Use range formatting for specific function or class modifications
    - Consider the impact on version control diffs when formatting entire files

## Troubleshooting

If tools return no results:
1. Verify the file path is correct and absolute
2. Check that the appropriate LSP server is configured for the file type
3. Ensure the symbol name is spelled correctly
4. Try without `symbol_kind` parameter for broader search
5. For workspace searches, try using `get_workspace_symbols` with wildcards
6. For file exploration, use `get_document_symbols` to see what symbols exist
7. Check server logs for any LSP errors
8. For workspace symbols, ensure workspace has been indexed by LSP servers

## Language-Specific Notes

### TypeScript/JavaScript
- Supports JSDoc comments in hover information
- Handles type aliases and interfaces
- Works with both `.ts` and `.tsx` files

### Python
- Returns type hints when available
- Supports docstring information
- Works with virtual environments when configured

### Go
- Provides interface implementation information
- Includes package documentation
- Supports workspace modules