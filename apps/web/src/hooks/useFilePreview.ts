import { useEffect, useState } from "react";

const PREVIEW_BYTES = 256 * 1024;
const MAX_PREVIEW_CHARS = 12000;
const SMALL_JSON_FORMAT_LIMIT = 1024 * 1024;
const PREVIEW_ITEMS = 10;

export interface FilePreviewState {
  text: string;
  truncated: boolean;
  note: string;
  table?: PreviewTable;
}

export interface PreviewTable {
  headers: string[];
  rows: string[][];
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

function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const nextChar = line[index + 1];

    if (char === '"' && inQuotes && nextChar === '"') {
      current += '"';
      index += 1;
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      cells.push(current);
      current = "";
    } else {
      current += char;
    }
  }

  cells.push(current);
  return cells;
}

function rowsToTable(lines: string[]): PreviewTable | undefined {
  const [headerLine, ...rowLines] = lines.filter((line) => line.trim() !== "");

  if (!headerLine) {
    return undefined;
  }

  const headers = parseCsvLine(headerLine);
  const rows = rowLines.slice(0, PREVIEW_ITEMS).map((line) => {
    const cells = parseCsvLine(line);
    return headers.map((_, index) => cells[index] ?? "");
  });

  return { headers, rows };
}

function arrayRowsToTable(rawRows: unknown[][]): PreviewTable | undefined {
  const [headerRow, ...bodyRows] = rawRows.filter((row) => row.some((cell) => String(cell ?? "").trim() !== ""));

  if (!headerRow) {
    return undefined;
  }

  const headers = headerRow.map((cell, index) => String(cell || `colonne_${index + 1}`));
  const rows = bodyRows.slice(0, PREVIEW_ITEMS).map((row) => headers.map((_, index) => String(row[index] ?? "")));

  return { headers, rows };
}

function recordsToTable(value: unknown): PreviewTable | undefined {
  if (Array.isArray(value) && value.every((item) => !item || typeof item !== "object" || Array.isArray(item))) {
    return {
      headers: ["element"],
      rows: value.slice(0, PREVIEW_ITEMS).map((item) => [String(item ?? "")])
    };
  }

  if (value && typeof value === "object" && !Array.isArray(value)) {
    return {
      headers: ["cle", "valeur"],
      rows: Object.entries(value)
        .slice(0, PREVIEW_ITEMS)
        .map(([key, item]) => [key, typeof item === "string" ? item : JSON.stringify(item ?? "")])
    };
  }

  const records = Array.isArray(value) ? value.slice(0, PREVIEW_ITEMS) : [value];
  const objects = records.filter((record): record is Record<string, unknown> =>
    Boolean(record && typeof record === "object" && !Array.isArray(record))
  );

  if (objects.length === 0) {
    return undefined;
  }

  const headers = Array.from(new Set(objects.flatMap((record) => Object.keys(record)))).slice(0, 12);
  const rows = objects.map((record) =>
    headers.map((header) => {
      const cell = record[header];
      return typeof cell === "string" ? cell : JSON.stringify(cell ?? "");
    })
  );

  return { headers, rows };
}

async function previewFile(file: File): Promise<FilePreviewState> {
  const extension = getExtension(file.name);

  if (extension === "csv") {
    const { text, truncated } = await readPreviewText(file);
    const lines = text
      .split(/\r?\n/)
      .filter((line) => line.trim() !== "")
      .slice(0, PREVIEW_ITEMS + 1);
    const preview = clampPreview(lines.join("\n"), truncated);
    return {
      ...preview,
      table: rowsToTable(lines),
      note: `Tableau limite aux ${PREVIEW_ITEMS} premiers elements, lecture limitee a ${formatBytes(PREVIEW_BYTES)}.`
    };
  }

  if (extension === "json") {
    if (file.size <= SMALL_JSON_FORMAT_LIMIT) {
      const text = await file.text();
      const json = JSON.parse(text);
      return {
        ...clampPreview(JSON.stringify(Array.isArray(json) ? json.slice(0, PREVIEW_ITEMS) : json, null, 2), false),
        table: recordsToTable(json),
        note: `Tableau limite aux ${PREVIEW_ITEMS} premiers elements.`
      };
    }

    return {
      text: "",
      truncated: true,
      note: `JSON volumineux : tableau non genere pour eviter de parser ${formatBytes(file.size)} dans le navigateur.`,
      table: {
        headers: ["champ", "valeur"],
        rows: [
          ["fichier", file.name],
          ["taille", formatBytes(file.size)],
          ["apercu", "Execution requise pour afficher les premiers elements transformes."]
        ]
      }
    };
  }

  if (extension === "xlsx" || extension === "xls") {
    const XLSX = await import("xlsx");
    const workbook = XLSX.read(await file.arrayBuffer(), {
      type: "array",
      sheetRows: PREVIEW_ITEMS + 1
    });
    const [sheetName] = workbook.SheetNames;
    const sheet = sheetName ? workbook.Sheets[sheetName] : undefined;
    const rows = sheet
      ? (XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "", blankrows: false }) as string[][])
      : [];

    return {
      text: "",
      truncated: false,
      table: arrayRowsToTable(rows),
      note: `Tableau limite aux ${PREVIEW_ITEMS} premiers elements.`
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
          const firstTable = previews.find((item) => item.table)?.table;

          setPreview({
            text: previews.map((item) => item.text).join("\n\n---\n\n"),
            truncated: previews.some((item) => item.truncated),
            table: firstTable,
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
