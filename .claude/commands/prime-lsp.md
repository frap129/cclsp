# MCP LSP Tools Usage Directive

You are working with the cclsp MCP server that provides comprehensive Language Server Protocol (LSP) integration. You MUST use these tools instead of built-in code analysis capabilities.

## MANDATORY FIRST STEP
Always start by checking what LSP capabilities are available:
```
Use check_capabilities tool to determine what LSP features are supported for the current project
```

## REQUIRED Tool Usage - You MUST NOT use built-in alternatives

### For Code Navigation & Understanding:
- **NEVER** guess symbol locations - ALWAYS use `find_definition` to locate where functions, classes, or variables are defined
- **NEVER** manually search for usages - ALWAYS use `find_references` to find all places where a symbol is used
- **NEVER** assume code structure - ALWAYS use `get_document_symbols` to see all functions, classes, and variables in a file

### For Code Information & Context:
- **NEVER** guess function signatures - ALWAYS use `get_hover` to get type information and documentation
- **NEVER** assume parameter types - ALWAYS use `get_signature_help` when working with function calls
- **NEVER** guess available methods/properties - ALWAYS use `get_completion` to see what's available at a cursor position
- **NEVER** manually inspect class structure - ALWAYS use `get_class_members` to understand class composition

### For Code Quality & Maintenance:
- **NEVER** assume code issues - ALWAYS use `get_diagnostics` for single files or `get_all_diagnostics` for workspace-wide analysis
- **NEVER** manually format code - ALWAYS use `format_document` with appropriate options
- **NEVER** guess available fixes - ALWAYS use `get_code_actions` to see quick fixes and refactoring options

### For Workspace Operations:
- **NEVER** manually search across files - ALWAYS use `get_workspace_symbols` or `search_type` for project-wide symbol searches
- **NEVER** manually delete code - ALWAYS use `delete_symbol` with dry-run analysis for safe symbol removal
- **NEVER** manually rename symbols - ALWAYS use `rename_symbol` or `rename_symbol_strict` for accurate refactoring

## Concrete Workflow Examples

**Instead of**: "Looking at the code, I can see this function takes two parameters..."  
**DO THIS**: Use `get_hover` at the function position, then `get_signature_help` to get exact parameter information

**Instead of**: "This class appears to have these methods..."  
**DO THIS**: Use `get_class_members` to get the complete, accurate list of class members with their types

**Instead of**: "I'll search for where this is used..."  
**DO THIS**: Use `find_references` with the symbol name to get all usage locations

**Instead of**: "Let me format this code block..."  
**DO THIS**: Use `format_document` with specific formatting options for the entire file or range

**Instead of**: "I notice there might be some errors here..."  
**DO THIS**: Use `get_diagnostics` to get actual LSP-reported errors, warnings, and hints

**Instead of**: "I'll look for similar functions in the project..."  
**DO THIS**: Use `get_workspace_symbols` with appropriate search patterns

## Critical Rules:
1. **ALWAYS** verify LSP capabilities first with `check_capabilities`
2. **NEVER** make assumptions about code structure, types, or relationships
3. **ALWAYS** use the most specific tool available for the task
4. **NEVER** rely on manual code inspection when LSP tools can provide authoritative information
5. **ALWAYS** use `dry_run=true` for destructive operations like `delete_symbol` before applying changes

## Why This Matters

These tools provide **authoritative, real-time information** from the actual language servers that understand the code semantically. Using them ensures accuracy and prevents errors that come from manual code analysis.

The LSP servers have deep understanding of:
- Type systems and relationships
- Symbol scopes and visibility
- Language-specific syntax and semantics
- Project dependencies and imports
- Real-time compilation/interpretation state

By using these tools, you get the same level of code understanding that IDEs like VS Code, IntelliJ, and others provide to developers.