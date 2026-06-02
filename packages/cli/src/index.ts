#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  getToolById,
  type OutputMode,
  type ToolConfig,
  type ToolInput,
  type ToolResult
} from "@rag-data-toolkit/core";

interface CliArgs {
  command?: string;
  tool?: string;
  input?: string;
  output?: string;
  mode?: OutputMode;
  excludedFields?: string[];
  fieldRenames?: Record<string, string>;
  help?: boolean;
}

const outputModes = new Set<OutputMode>(["canonical", "document", "rag", "jsonl"]);

function printHelp(): void {
  console.log(`RAG Data Toolkit CLI

Usage:
  pnpm cli convert --tool csv-xlsx-to-json --input ./input.xlsx --output ./output.json --mode canonical
  pnpm cli process --tool json-cleaner --input ./input.json --output ./clean.json --mode rag
  pnpm cli convert --tool pdf-to-markdown --input ./doc.pdf --output ./doc.md --mode document

Options:
  --tool       Tool id from the registry
  --input      Local input file
  --output     Local output file
  --mode       canonical | document | rag | jsonl
  --exclude    Comma-separated fields to remove
  --rename     Comma-separated renames, e.g. old:new,title:name
`);
}

function parseRenames(value: string | undefined): Record<string, string> | undefined {
  if (!value) {
    return undefined;
  }

  return Object.fromEntries(
    value
      .split(",")
      .map((pair) => pair.trim())
      .filter(Boolean)
      .map((pair) => {
        const [source, target] = pair.split(":").map((item) => item.trim());

        if (!source || !target) {
          throw new Error(`Invalid rename pair: ${pair}`);
        }

        return [source, target] as const;
      })
  );
}

function parseArgs(argv: string[]): CliArgs {
  const normalizedArgv = argv[0] === "--" ? argv.slice(1) : argv;
  const [command, ...tokens] = normalizedArgv;
  const args: CliArgs = { command };

  if (command === "--help" || command === "-h") {
    args.help = true;
    return args;
  }

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];

    if (token === "--help" || token === "-h") {
      args.help = true;
      continue;
    }

    if (!token?.startsWith("--")) {
      continue;
    }

    const key = token.slice(2);
    const value = tokens[index + 1];

    if (!value || value.startsWith("--")) {
      throw new Error(`Missing value for --${key}`);
    }

    index += 1;

    if (key === "tool") {
      args.tool = value;
    } else if (key === "input") {
      args.input = value;
    } else if (key === "output") {
      args.output = value;
    } else if (key === "mode") {
      if (!outputModes.has(value as OutputMode)) {
        throw new Error(`Unsupported output mode: ${value}`);
      }

      args.mode = value as OutputMode;
    } else if (key === "exclude") {
      args.excludedFields = value
        .split(",")
        .map((field) => field.trim())
        .filter(Boolean);
    } else if (key === "rename") {
      args.fieldRenames = parseRenames(value);
    }
  }

  return args;
}

function getExtension(fileName: string): string {
  const lastDot = fileName.lastIndexOf(".");
  return lastDot === -1 ? "" : fileName.slice(lastDot + 1).toLowerCase();
}

function serializeResult(result: ToolResult): string {
  if (result.text !== undefined) {
    return result.text;
  }

  if (result.documents) {
    return JSON.stringify(result.documents, null, 2);
  }

  return JSON.stringify(result.data ?? null, null, 2);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (args.help || !args.command) {
    printHelp();
    return;
  }

  if (!args.tool || !args.input || !args.output) {
    printHelp();
    throw new Error("--tool, --input and --output are required.");
  }

  const tool = getToolById(args.tool);

  if (!tool) {
    throw new Error(`Unknown tool: ${args.tool}`);
  }

  const callerCwd = process.env.INIT_CWD ?? process.cwd();
  const inputPath = resolve(callerCwd, args.input);
  const outputPath = resolve(callerCwd, args.output);
  const buffer = await readFile(inputPath);
  const extension = getExtension(inputPath);
  const input: ToolInput = {
    files: [
      {
        name: inputPath.split(/[\\/]/).at(-1) ?? inputPath,
        extension,
        buffer
      }
    ]
  };

  if (extension === "json") {
    input.text = buffer.toString("utf8");
  }

  const config: ToolConfig = {
    ...tool.defaultConfig,
    outputMode: args.mode ?? tool.defaultConfig.outputMode,
    excludedFields: args.excludedFields,
    fieldRenames: args.fieldRenames
  };
  const result = await tool.run(input, config);
  const serialized = serializeResult(result);

  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, serialized, "utf8");

  console.log(`Wrote ${outputPath}`);
  console.log(JSON.stringify(result.diagnostics, null, 2));
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Error: ${message}`);
  process.exitCode = 1;
});
