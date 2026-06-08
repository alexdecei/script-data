import { csvXlsxToJsonTool } from "./converters/csv-xlsx-to-json.js";
import { pdfToMarkdownTool } from "./converters/pdf-to-markdown.js";
import { jsonCleanerTool } from "./processors/json-cleaner.js";
import { supportTicketCleanerTool } from "./processors/support-ticket-cleaner.js";
import { odooKnowledgeCleanerTool } from "./qualifiers/odoo-knowledge-cleaner.js";
import type { ToolKind, ToolModule } from "./types.js";

export const tools: ToolModule[] = [
  csvXlsxToJsonTool,
  jsonCleanerTool,
  supportTicketCleanerTool,
  pdfToMarkdownTool,
  odooKnowledgeCleanerTool
];

export function listTools(): ToolModule[] {
  return tools;
}

export function getToolById(id: string): ToolModule | undefined {
  return tools.find((tool) => tool.meta.id === id);
}

export function groupToolsByKind(): Record<ToolKind, ToolModule[]> {
  return tools.reduce<Record<ToolKind, ToolModule[]>>(
    (groups, tool) => {
      groups[tool.meta.kind].push(tool);
      return groups;
    },
    {
      converter: [],
      processor: [],
      qualifier: []
    }
  );
}
