import { useEffect, useState } from "react";

const PREVIEW_BYTES = 256 * 1024;
const MAX_PREVIEW_CHARS = 12000;
const SMALL_JSON_FORMAT_LIMIT = 1024 * 1024;

export interface FilePreviewState {
  text: string;
  truncated: boolean;
  note: string;
}

function getExtension(fileName: string): string {
  const lastDot = fileName.lastIndexOf(".");
  return lastDot === -1 ? "" : fileName.slice(lastDot + 1).toLowerCase();
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} o`;
  }

  if (bytes < 1024 * 1024) {
    return `${Math.round(bytes / 1024)} Ko`;
  }

  return `${(bytes / 1024 / 1024).toFixed(1)} Mo`;
}

async function readPreviewText(file: File): Promise<{ text: string; truncated: boolean }> {
  const sliced = file.slice(0, PREVIEW_BYTES);
  const text = await sliced.text();

  return {
    text,
    truncated: file.size > PREVIEW_BYTES
  };
}

function clampPreview(text: string, truncated: boolean): FilePreviewState {
  const tooLong = text.length > MAX_PREVIEW_CHARS;

  return {
    text: tooLong ? text.slice(0, MAX_PREVIEW_CHARS) : text,
    truncated: truncated || tooLong,
    note: tooLong ? `Apercu limite a ${MAX_PREVIEW_CHARS.toLocaleString("fr-FR")} caracteres.` : ""
  };
}

async function previewFile(file: File): Promise<FilePreviewState> {
  const extension = getExtension(file.name);

  if (extension === "csv") {
    const { text, truncated } = await readPreviewText(file);
    const rows = text.split(/\r?\n/).slice(0, 40).join("\n");
    return {
      ...clampPreview(rows, truncated),
      note: `40 premieres lignes maximum, lecture limitee a ${formatBytes(PREVIEW_BYTES)}.`
    };
  }

  if (extension === "json") {
    if (file.size <= SMALL_JSON_FORMAT_LIMIT) {
      const text = await file.text();
      return clampPreview(JSON.stringify(JSON.parse(text), null, 2), false);
    }

    const { text, truncated } = await readPreviewText(file);
    return {
      ...clampPreview(text, truncated),
      note: `JSON volumineux : extrait brut limite a ${formatBytes(PREVIEW_BYTES)}.`
    };
  }

  if (extension === "xlsx" || extension === "xls") {
    return {
      text: `${file.name}\n${formatBytes(file.size)}`,
      truncated: false,
      note: "Apercu XLSX genere apres execution pour eviter de parser un fichier lourd dans la preview."
    };
  }

  if (extension === "pdf") {
    return {
      text: `${file.name}\n${formatBytes(file.size)}`,
      truncated: false,
      note: "Apercu texte disponible apres execution."
    };
  }

  return {
    text: `${file.name}\n${formatBytes(file.size)}`,
    truncated: false,
    note: ""
  };
}

export function useFilePreview(files: File[]) {
  const [preview, setPreview] = useState<FilePreviewState>({ text: "", truncated: false, note: "" });
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function loadPreview() {
      setError("");

      if (files.length === 0) {
        setPreview({ text: "", truncated: false, note: "" });
        return;
      }

      try {
        const previews = await Promise.all(files.slice(0, 3).map(previewFile));

        if (!cancelled) {
          setPreview({
            text: previews.map((item) => item.text).join("\n\n---\n\n"),
            truncated: previews.some((item) => item.truncated),
            note: previews
              .map((item) => item.note)
              .filter(Boolean)
              .join(" ")
          });
        }
      } catch (previewError) {
        if (!cancelled) {
          setPreview({ text: "", truncated: false, note: "" });
          setError(previewError instanceof Error ? previewError.message : String(previewError));
        }
      }
    }

    void loadPreview();

    return () => {
      cancelled = true;
    };
  }, [files]);

  return { preview, error };
}
