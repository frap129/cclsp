export interface LSPServerConfig {
  extensions: string[];
  command: string[];
  rootDir?: string;
  restartInterval?: number; // in minutes, optional auto-restart interval
}

export interface Config {
  servers: LSPServerConfig[];
}

export interface Position {
  line: number;
  character: number;
}

export interface Location {
  uri: string;
  range: {
    start: Position;
    end: Position;
  };
}

export interface DefinitionResult {
  locations: Location[];
}

export interface ReferenceResult {
  locations: Location[];
}

export interface SymbolSearchParams {
  file_path: string;
  symbol_name: string;
  symbol_kind: string;
}

export interface LSPError {
  code: number;
  message: string;
  data?: unknown;
}

export interface LSPLocation {
  uri: string;
  range: {
    start: Position;
    end: Position;
  };
}

export interface DocumentSymbol {
  name: string;
  detail?: string;
  kind: SymbolKind;
  tags?: SymbolTag[];
  deprecated?: boolean;
  range: {
    start: Position;
    end: Position;
  };
  selectionRange: {
    start: Position;
    end: Position;
  };
  children?: DocumentSymbol[];
}

export enum SymbolKind {
  File = 1,
  Module = 2,
  Namespace = 3,
  Package = 4,
  Class = 5,
  Method = 6,
  Property = 7,
  Field = 8,
  Constructor = 9,
  Enum = 10,
  Interface = 11,
  Function = 12,
  Variable = 13,
  Constant = 14,
  String = 15,
  Number = 16,
  Boolean = 17,
  Array = 18,
  Object = 19,
  Key = 20,
  Null = 21,
  EnumMember = 22,
  Struct = 23,
  Event = 24,
  Operator = 25,
  TypeParameter = 26,
}

export enum SymbolTag {
  Deprecated = 1,
}

export interface SymbolInformation {
  name: string;
  kind: SymbolKind;
  tags?: SymbolTag[];
  deprecated?: boolean;
  location: {
    uri: string;
    range: {
      start: Position;
      end: Position;
    };
  };
  containerName?: string;
}

export interface SymbolMatch {
  name: string;
  kind: SymbolKind;
  position: Position;
  range: {
    start: Position;
    end: Position;
  };
  detail?: string;
  typeInfo?: TypeInfo;
}

export interface WorkspaceSearchResult {
  symbols: SymbolInformation[];
  debugInfo: {
    rootUri: string;
    serverCount: number;
    totalSymbolsFound: number;
    filteredSymbolsCount: number;
    searchQuery: string;
    caseSensitive: boolean;
    isWildcardPattern: boolean;
  };
}

export interface TypeInfo {
  parameters?: ParameterInfo[];
  returnType?: string;
  returnTypeDefinitionLocation?: {
    uri: string;
    line: number;
    character: number;
  };
  definitionLocation?: {
    uri: string;
    line: number;
    character: number;
  };
  definition?: string;
}

export interface ParameterInfo {
  name: string;
  type: string;
  isOptional?: boolean;
  defaultValue?: string;
  definitionLocation?: {
    uri: string;
    line: number;
    character: number;
  };
  definition?: string;
}

export enum DiagnosticSeverity {
  Error = 1,
  Warning = 2,
  Information = 3,
  Hint = 4,
}

export interface DiagnosticRelatedInformation {
  location: Location;
  message: string;
}

export interface CodeDescription {
  href: string;
}

export interface Diagnostic {
  range: {
    start: Position;
    end: Position;
  };
  severity?: DiagnosticSeverity;
  code?: number | string;
  codeDescription?: CodeDescription;
  source?: string;
  message: string;
  tags?: DiagnosticTag[];
  relatedInformation?: DiagnosticRelatedInformation[];
  data?: unknown;
}

export enum DiagnosticTag {
  Unnecessary = 1,
  Deprecated = 2,
}

export interface DocumentDiagnosticReport {
  kind: 'full' | 'unchanged';
  resultId?: string;
  items?: Diagnostic[];
}

export enum CompletionItemKind {
  Text = 1,
  Method = 2,
  Function = 3,
  Constructor = 4,
  Field = 5,
  Variable = 6,
  Class = 7,
  Interface = 8,
  Module = 9,
  Property = 10,
  Unit = 11,
  Value = 12,
  Enum = 13,
  Keyword = 14,
  Snippet = 15,
  Color = 16,
  File = 17,
  Reference = 18,
  Folder = 19,
  EnumMember = 20,
  Constant = 21,
  Struct = 22,
  Event = 23,
  Operator = 24,
  TypeParameter = 25,
}

export interface CompletionItem {
  label: string;
  kind?: CompletionItemKind;
  tags?: CompletionItemTag[];
  detail?: string;
  documentation?: string | { kind: 'markdown' | 'plaintext'; value: string };
  deprecated?: boolean;
  preselect?: boolean;
  sortText?: string;
  filterText?: string;
  insertText?: string;
  insertTextFormat?: InsertTextFormat;
  textEdit?: TextEdit;
  additionalTextEdits?: TextEdit[];
  commitCharacters?: string[];
  command?: Command;
  data?: unknown;
}

export enum CompletionItemTag {
  Deprecated = 1,
}

export enum InsertTextFormat {
  PlainText = 1,
  Snippet = 2,
}

export interface TextEdit {
  range: {
    start: Position;
    end: Position;
  };
  newText: string;
}

export interface Command {
  title: string;
  command: string;
  arguments?: unknown[];
}

export interface CompletionList {
  isIncomplete: boolean;
  items: CompletionItem[];
}

export interface CompletionContext {
  triggerKind: CompletionTriggerKind;
  triggerCharacter?: string;
}

export enum CompletionTriggerKind {
  Invoked = 1,
  TriggerCharacter = 2,
  TriggerForIncompleteCompletions = 3,
}

export interface SignatureHelp {
  signatures: SignatureInformation[];
  activeSignature?: number;
  activeParameter?: number;
}

export interface SignatureInformation {
  label: string;
  documentation?: string | MarkupContent;
  parameters?: ParameterInformation[];
}

export interface ParameterInformation {
  label: string | [number, number];
  documentation?: string | MarkupContent;
}

export interface FormattingOptions {
  tabSize: number;
  insertSpaces: boolean;
  trimTrailingWhitespace?: boolean;
  insertFinalNewline?: boolean;
  trimFinalNewlines?: boolean;
  [key: string]: boolean | number | string | undefined;
}

export interface Range {
  start: Position;
  end: Position;
}

export interface CodeAction {
  title: string;
  kind?: string;
  diagnostics?: Diagnostic[];
  isPreferred?: boolean;
  disabled?: {
    reason: string;
  };
  edit?: WorkspaceEdit;
  command?: Command;
  data?: unknown;
}

export interface WorkspaceEdit {
  changes?: { [uri: string]: TextEdit[] };
  documentChanges?: (TextDocumentEdit | CreateFile | RenameFile | DeleteFile)[];
  changeAnnotations?: { [id: string]: ChangeAnnotation };
}

export interface TextDocumentEdit {
  textDocument: VersionedTextDocumentIdentifier;
  edits: (TextEdit | AnnotatedTextEdit)[];
}

export interface VersionedTextDocumentIdentifier {
  uri: string;
  version: number | null;
}

export interface AnnotatedTextEdit extends TextEdit {
  annotationId?: string;
}

export interface CreateFile {
  kind: 'create';
  uri: string;
  options?: CreateFileOptions;
  annotationId?: string;
}

export interface CreateFileOptions {
  overwrite?: boolean;
  ignoreIfExists?: boolean;
}

export interface RenameFile {
  kind: 'rename';
  oldUri: string;
  newUri: string;
  options?: RenameFileOptions;
  annotationId?: string;
}

export interface RenameFileOptions {
  overwrite?: boolean;
  ignoreIfExists?: boolean;
}

export interface DeleteFile {
  kind: 'delete';
  uri: string;
  options?: DeleteFileOptions;
  annotationId?: string;
}

export interface DeleteFileOptions {
  recursive?: boolean;
  ignoreIfNotExists?: boolean;
}

export interface ChangeAnnotation {
  label: string;
  needsConfirmation?: boolean;
  description?: string;
}

export interface CodeActionContext {
  diagnostics: Diagnostic[];
  only?: string[];
  triggerKind?: CodeActionTriggerKind;
}

export enum CodeActionTriggerKind {
  Invoked = 1,
  Automatic = 2,
}

export interface MarkupContent {
  kind: 'plaintext' | 'markdown';
  value: string;
}

export interface Hover {
  contents: string | MarkupContent | MarkupContent[] | string[];
  range?: Range;
}

export interface SymbolDeletionInfo {
  definition: Location;
  references: Location[];
  canSafelyDelete: boolean;
  dependencyInfo: string[];
  symbolMatch: SymbolMatch;
}

export interface DeletionAnalysisResult {
  symbolInfo: SymbolDeletionInfo;
  deletionPreview: {
    definitionEdit: TextEdit;
    referenceEdits: TextEdit[];
    affectedFiles: string[];
    totalLinesRemoved: number;
  };
}

export interface ServerCapabilities {
  textDocumentSync?: unknown;
  hoverProvider?: boolean | unknown;
  completionProvider?: {
    triggerCharacters?: string[];
    resolveProvider?: boolean;
  };
  signatureHelpProvider?: {
    triggerCharacters?: string[];
    retriggerCharacters?: string[];
  };
  definitionProvider?: boolean | unknown;
  typeDefinitionProvider?: boolean | unknown;
  implementationProvider?: boolean | unknown;
  referencesProvider?: boolean | unknown;
  documentHighlightProvider?: boolean | unknown;
  documentSymbolProvider?: boolean | unknown;
  workspaceSymbolProvider?: boolean | unknown;
  codeActionProvider?: boolean | unknown;
  codeLensProvider?: {
    resolveProvider?: boolean;
  };
  documentFormattingProvider?: boolean | unknown;
  documentRangeFormattingProvider?: boolean | unknown;
  documentOnTypeFormattingProvider?: {
    firstTriggerCharacter: string;
    moreTriggerCharacter?: string[];
  };
  renameProvider?: boolean | unknown;
  documentLinkProvider?: {
    resolveProvider?: boolean;
  };
  colorProvider?: boolean | unknown;
  foldingRangeProvider?: boolean | unknown;
  executeCommandProvider?: {
    commands: string[];
  };
  workspace?: {
    workspaceFolders?: {
      supported?: boolean;
      changeNotifications?: string | boolean;
    };
    fileOperations?: {
      didCreate?: unknown;
      willCreate?: unknown;
      didRename?: unknown;
      willRename?: unknown;
      didDelete?: unknown;
      willDelete?: unknown;
    };
  };
  experimental?: unknown;
}
