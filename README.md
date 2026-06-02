# RAG Data Toolkit

Application locale TypeScript pour préparer, convertir et nettoyer des fichiers avant ingestion RAG / LLM.

Le projet reste volontairement simple : pas de cloud obligatoire, pas de base de données, pas d'authentification et pas d'appel IA. Les fichiers sont lus et transformés localement.

## Architecture

```txt
apps/
  web/            Interface React + Vite
packages/
  core/           Types, registre, convertisseurs, processeurs, utilitaires
  cli/            CLI Node qui appelle le même core
```

## Prérequis

- Node.js 20+ recommandé
- pnpm via Corepack

```bash
corepack pnpm install
```

Si `pnpm` est déjà disponible globalement, `pnpm install` fonctionne aussi.

## Lancer l'interface locale

```bash
corepack pnpm dev
```

L'application démarre sur `http://127.0.0.1:5173/`.

## Utiliser la CLI

```bash
corepack pnpm cli -- convert --tool csv-xlsx-to-json --input ./input.xlsx --output ./output.json --mode canonical
corepack pnpm cli -- process --tool json-cleaner --input ./input.json --output ./clean.json --mode rag
corepack pnpm cli -- convert --tool pdf-to-markdown --input ./doc.pdf --output ./doc.md --mode document
```

Options utiles :

- `--mode` : `canonical`, `document`, `rag` ou `jsonl`
- `--exclude` : champs à supprimer, séparés par des virgules
- `--rename` : renommages au format `ancien:nouveau,autre:cible`

## Outils V0

- `csv-xlsx-to-json` : CSV/XLSX vers JSON canonique, documents RAG ou JSONL.
- `json-cleaner` : nettoyage générique d'un JSON existant.
- `pdf-to-markdown` : extraction PDF simple vers Markdown ou documents RAG page par page.

Chaque outil retourne un diagnostic avec les fichiers lus, le nombre de lignes ou documents, les champs vides, les corrections d'encodage, une estimation de tokens et les warnings.

## Scripts

```bash
corepack pnpm typecheck
corepack pnpm build
corepack pnpm --filter @rag-data-toolkit/cli start -- --help
```

## Ajouter un outil

1. Créer un module dans `packages/core/src/converters`, `processors` ou `qualifiers`.
2. Exporter un `ToolModule` avec `meta`, `defaultConfig` et `run`.
3. Ajouter l'outil dans `packages/core/src/registry.ts`.
4. L'interface web et la CLI le récupèrent automatiquement via le registre.
