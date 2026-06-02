import { openAIJsonQualifierTool } from "./processors/openai-json-qualifier.js";
import { tools } from "./registry.js";
import type { ToolKind, ToolModule } from "./types.js";

export const nodeTools: ToolModule[] = [...tools, openAIJsonQualifierTool];

export function listNodeTools(): ToolModule[] {
  return nodeTools;
}

export function getNodeToolById(id: string): ToolModule | undefined {
  return nodeTools.find((tool) => tool.meta.id === id);
}

export function groupNodeToolsByKind(): Record<ToolKind, ToolModule[]> {
  return nodeTools.reduce<Record<ToolKind, ToolModule[]>>(
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
