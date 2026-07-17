import { existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import {
  parseSnippetDocument,
  type SnippetBlock,
  type SnippetDiagnostic,
  type SnippetDocument
} from "./engine/snippetDocument";
import { getSnippetFiles } from "./engine/snippetProfiles";

export interface SnippetManagerDocument extends SnippetDocument {
  sourceScope?: "base" | "profile" | "workspace";
  profile?: string;
  workspaceFolder?: string;
}

function crossDocumentDiagnostic(message: string, snippet: SnippetBlock): SnippetDiagnostic {
  return {
    severity: "warning",
    message,
    line: snippet.startLine,
    snippetId: snippet.id
  };
}

function addCrossDocumentDuplicateDiagnostics(documents: SnippetManagerDocument[]): void {
  const byTrigger = new Map<string, SnippetBlock[]>();
  const automaticByTrigger = new Map<string, SnippetBlock[]>();

  for (const document of documents) {
    for (const snippet of document.snippets) {
      if (snippet.isRegex || !snippet.trigger) continue;
      byTrigger.set(snippet.trigger, [...(byTrigger.get(snippet.trigger) || []), snippet]);
      if (snippet.flags.includes("A")) {
        automaticByTrigger.set(snippet.trigger, [...(automaticByTrigger.get(snippet.trigger) || []), snippet]);
      }
    }
  }

  for (const snippets of byTrigger.values()) {
    if (new Set(snippets.map((snippet) => snippet.filePath)).size < 2) continue;
    for (const snippet of snippets) {
      const diagnostic = crossDocumentDiagnostic(`Duplicate trigger "${snippet.trigger}" across loaded snippet files.`, snippet);
      snippet.diagnostics.push(diagnostic);
      documents.find((document) => document.filePath === snippet.filePath)?.diagnostics.push(diagnostic);
    }
  }

  for (const snippets of automaticByTrigger.values()) {
    if (new Set(snippets.map((snippet) => snippet.filePath)).size < 2) continue;
    for (const snippet of snippets) {
      const diagnostic = crossDocumentDiagnostic(`Multiple automatic snippets use trigger "${snippet.trigger}" across loaded snippet files.`, snippet);
      snippet.diagnostics.push(diagnostic);
      documents.find((document) => document.filePath === snippet.filePath)?.diagnostics.push(diagnostic);
    }
  }
}

export function readSnippetDocuments(
  snippetDir: string,
  activeProfile = "",
  workspaceSnippetDir?: string,
  workspaceFolder?: string
): SnippetManagerDocument[] {
  if (!existsSync(snippetDir)) mkdirSync(snippetDir, { recursive: true });

  const documents: SnippetManagerDocument[] = [];
  for (const entry of getSnippetFiles(snippetDir, activeProfile, workspaceSnippetDir, workspaceFolder)) {
    try {
      const content = readFileSync(entry.filePath, "utf8");
      const document = parseSnippetDocument(content, entry.filePath, entry.language) as SnippetManagerDocument;
      document.mtimeMs = statSync(entry.filePath).mtimeMs;
      document.sourceScope = entry.scope;
      document.profile = entry.profile;
      document.workspaceFolder = entry.workspaceFolder;
      documents.push(document);
    } catch {
      // The host's parser/reload path reports malformed files in the shared Output channel.
    }
  }
  addCrossDocumentDuplicateDiagnostics(documents);
  return documents;
}
