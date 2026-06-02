import type { ToolKind, ToolModule } from "@rag-data-toolkit/core";

const kindLabels: Record<ToolKind, string> = {
  converter: "Conversion",
  processor: "Traitement",
  qualifier: "Qualification"
};

interface ToolSidebarProps {
  groups: Record<ToolKind, ToolModule[]>;
  selectedToolId: string;
  onSelectTool: (toolId: string) => void;
}

export function ToolSidebar({ groups, selectedToolId, onSelectTool }: ToolSidebarProps) {
  return (
    <aside className="tool-sidebar" aria-label="Outils disponibles">
      <div className="brand-block">
        <h1>RAG Data Toolkit</h1>
      </div>

      {(Object.keys(kindLabels) as ToolKind[]).map((kind) => (
        <section className="tool-group" key={kind}>
          <h2>{kindLabels[kind]}</h2>
          {groups[kind].length > 0 ? (
            <div className="tool-list">
              {groups[kind].map((tool) => (
                <button
                  className="tool-item"
                  data-selected={tool.meta.id === selectedToolId}
                  key={tool.meta.id}
                  onClick={() => onSelectTool(tool.meta.id)}
                  type="button"
                >
                  <span>{tool.meta.name}</span>
                  <small>{tool.meta.description}</small>
                  <em>{tool.meta.inputExtensions.map((extension) => `.${extension}`).join(", ")}</em>
                </button>
              ))}
            </div>
          ) : (
            <p className="empty-note">Aucun script specifique disponible pour l'instant.</p>
          )}
        </section>
      ))}
    </aside>
  );
}
