import type {
  RedactionCounts,
  RedactionFinding,
  ToolConfig,
  ToolInput,
  ToolInputFile,
  ToolModule
} from "../types.js";
import { toUint8Array } from "../utils/binary.js";
import { createDiagnostics } from "../utils/diagnostics.js";
import { fixEncoding } from "../utils/encoding-fix.js";
import { cloneEmptyRedactionCounts, mergeRedactionCounts, redactSensitiveText } from "../utils/redact-sensitive.js";
import { cleanForRag, normalizeWhitespace } from "../utils/text-cleanup.js";

type TicketKind =
  | "support_case"
  | "notification"
  | "monitoring"
  | "spam_or_auto"
  | "internal_infra"
  | "empty"
  | "unknown";

interface CleanMessage {
  date?: string;
  date_raw?: unknown;
  sujet: string;
  contenu_texte: string;
  auteur?: string;
}

interface CleanTicket {
  ticket_id?: string;
  priorite?: string;
  sujet?: string;
  categorie?: string;
  equipe_d_assistance?: string;
  client?: string;
  heures_passees: number;
  cree_le?: string;
  cree_le_raw?: unknown;
  type?: string;
  etiquettes?: unknown;
  messages: CleanMessage[];
  ticket_kind: TicketKind;
  relevance_score: number;
  relevance_flags: string[];
  rag_candidate: boolean;
}

interface TextResult {
  text: string;
  corrections: number;
  redactionCounts: RedactionCounts;
  redactionFindings: RedactionFinding[];
}

interface DateResult {
  iso?: string;
  raw?: unknown;
  sortTime?: number;
}

interface MessageCleaningResult {
  messages: CleanMessage[];
  removedMessages: number;
  removedAutoMessages: number;
  removedDuplicateMessages: number;
  encodingFixCount: number;
  redactionCounts: RedactionCounts;
  redactionFindings: RedactionFinding[];
  rawContentSearch: string;
  rawAuthorSearch: string;
  onlyWeakSourceMessages: boolean;
}

interface CleanTicketResult {
  ticket?: CleanTicket;
  removedMessages: number;
  removedAutoMessages: number;
  removedDuplicateMessages: number;
  ticketWithoutUsefulMessages: boolean;
  ragCandidate: boolean;
  encodingFixCount: number;
  redactionCounts: RedactionCounts;
  redactionFindings: RedactionFinding[];
}

export interface SupportTicketCleanerReport {
  inputTickets: number;
  outputTickets: number;
  removedMessages: number;
  removedAutoMessages: number;
  ticketsWithoutUsefulMessages: number;
  ragCandidates: number;
  redactedSecrets: number;
  redactedIps: number;
  warnings: string[];
}

const excelEpochMs = Date.UTC(1899, 11, 30);
const maxWarnings = 500;
const maxDiagnosticRedactionFindings = 50;

const monitoringTerms = ["updown alert", "updown.io", "[down]", "[up]", "status page", "downtime details"];
const spamTerms = ["mailinblack", "delivrer mon email", "ma messagerie est protegee", "anti-spam", "antispam"];
const notificationTerms = [
  "antai",
  "validation de la notification",
  "changement de prestataire",
  "va-pilote",
  "mif restant"
];
const resolutionTerms = ["corrig", "resolu", "solution", "contournement", "mise a jour corrective", "maj corrective"];
const procedureTerms = ["relancer", "verifier", "synchroniser", "modifier", "parametrer", "parametrage"];
const anomalyTerms = [
  "anomalie",
  "erreur",
  "impossible",
  "ne fonctionne pas",
  "bloque",
  "dysfonctionnement",
  "incident",
  "rejet",
  "echec",
  "incorrect",
  "incoherence"
];
const technicalAlertTerms = [
  "alerte",
  "alert",
  "down",
  "up",
  "downtime",
  "supervision",
  "cpu",
  "disque",
  "certificat expire",
  "sauvegarde",
  "serveur"
];

function readTextInput(input: ToolInput): string {
  if (input.text) {
    return input.text;
  }

  const [file] = input.files ?? [];

  if (!file) {
    throw new Error("Support ticket cleaner expects a JSON input file.");
  }

  return new TextDecoder("utf-8").decode(toUint8Array(file.buffer));
}

function inputFileName(files: ToolInputFile[] | undefined): string {
  return files?.[0]?.name ?? "support-tickets.json";
}

function getValue(record: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    if (key in record) {
      return record[key];
    }
  }

  return undefined;
}

function appendWarning(warnings: string[], warning: string): void {
  if (warnings.length < maxWarnings) {
    warnings.push(warning);
    return;
  }

  if (warnings.length === maxWarnings) {
    warnings.push("Additional warnings omitted.");
  }
}

function cleanTextValue(value: unknown, config: ToolConfig, fieldPath: string, redact: boolean): TextResult {
  const raw = value === null || value === undefined ? "" : String(value);
  const fixed = config.fixEncoding === false ? { text: raw, corrections: 0 } : fixEncoding(raw);
  const cleaned = cleanForRag(fixed.text, {
    normalizeWhitespace: config.normalizeWhitespace,
    stripControlChars: config.stripControlChars,
    stripHtml: false
  });

  if (!redact) {
    return {
      text: cleaned,
      corrections: fixed.corrections,
      redactionCounts: cloneEmptyRedactionCounts(),
      redactionFindings: []
    };
  }

  const redacted = redactSensitiveText(cleaned, config, fieldPath);

  return {
    text: redacted.text,
    corrections: fixed.corrections,
    redactionCounts: redacted.counts,
    redactionFindings: redacted.findings
  };
}

function mergeTextResult(
  redactionCounts: RedactionCounts,
  redactionFindings: RedactionFinding[],
  result: TextResult
): number {
  mergeRedactionCounts(redactionCounts, result.redactionCounts);
  redactionFindings.push(...result.redactionFindings);
  return result.corrections;
}

function appendDiagnosticRedactionFindings(target: RedactionFinding[], findings: RedactionFinding[]): void {
  const remaining = maxDiagnosticRedactionFindings - target.length;

  if (remaining > 0) {
    target.push(...findings.slice(0, remaining));
  }
}

function toSearchText(value: unknown): string {
  const text = value === null || value === undefined ? "" : String(value);

  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[’`]/g, "'")
    .toLowerCase();
}

function includesAny(searchText: string, terms: string[]): boolean {
  return terms.some((term) => searchText.includes(term));
}

function hasResolutionSignal(searchText: string): boolean {
  return includesAny(searchText, resolutionTerms);
}

function hasProcedureSignal(searchText: string): boolean {
  return includesAny(searchText, procedureTerms);
}

function hasAnomalySignal(searchText: string): boolean {
  return includesAny(searchText, anomalyTerms);
}

function hasTechnicalAlertSignal(searchText: string): boolean {
  return includesAny(searchText, technicalAlertTerms);
}

function isUsefulMessage(text: string): boolean {
  const searchText = toSearchText(text);

  return (
    text.length >= 40 ||
    hasResolutionSignal(searchText) ||
    hasProcedureSignal(searchText) ||
    hasAnomalySignal(searchText)
  );
}

function isOnlyLinkOrShortAlert(text: string): boolean {
  const searchText = toSearchText(text);
  const withoutLinks = normalizeWhitespace(
    text
      .replace(/https?:\/\/\S+/gi, " ")
      .replace(/\[[^\]]+\]\([^)]+\)/g, " ")
      .replace(/\bvoir le ticket\b/gi, " ")
  );

  return withoutLinks.length < 20 || (hasTechnicalAlertSignal(searchText) && !hasProcedureSignal(searchText));
}

function weakMessageReason(text: string): "auto" | "weak" | undefined {
  const searchText = toSearchText(text);
  const compact = searchText.replace(/[^a-z0-9]+/g, " ").trim();
  const hasUsefulSignal = hasResolutionSignal(searchText) || hasProcedureSignal(searchText) || hasAnomalySignal(searchText);

  if (compact === "a faire terminee" || compact === "a faire termine") {
    return "weak";
  }

  if (compact === "voir le ticket" || compact === "merci le service support") {
    return "weak";
  }

  if (includesAny(searchText, spamTerms)) {
    return "auto";
  }

  if (
    searchText.includes("demande d'evaluation du service") ||
    searchText.includes("evaluer nos services") ||
    searchText.includes("cliquez sur l'un de ces smileys") ||
    searchText.includes("enquete de satisfaction")
  ) {
    return "auto";
  }

  if (searchText.includes("votre demande a bien ete recue") && !hasUsefulSignal) {
    return "auto";
  }

  if (searchText.includes("pas de retour client") && searchText.includes("cloture") && !hasUsefulSignal) {
    return "weak";
  }

  if (searchText.includes("merci") && searchText.includes("le service support") && text.length < 160 && !hasUsefulSignal) {
    return "weak";
  }

  if (isOnlyLinkOrShortAlert(text) && !hasUsefulSignal) {
    return "weak";
  }

  return undefined;
}

function parseDateValue(value: unknown): DateResult {
  if (value === null || value === undefined || value === "") {
    return {};
  }

  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return { iso: value.toISOString(), sortTime: value.getTime() };
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    if (value > 20_000 && value < 80_000) {
      const time = excelEpochMs + value * 86_400_000;
      return { iso: new Date(time).toISOString(), sortTime: time };
    }

    if (value > 1_000_000_000_000 && value < 4_102_444_800_000) {
      return { iso: new Date(value).toISOString(), sortTime: value };
    }

    if (value > 1_000_000_000 && value < 4_102_444_800) {
      const time = value * 1000;
      return { iso: new Date(time).toISOString(), sortTime: time };
    }
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    const numeric = Number(trimmed.replace(",", "."));

    if (trimmed && Number.isFinite(numeric)) {
      return parseDateValue(numeric);
    }

    const isoLike = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(trimmed);

    if (isoLike) {
      const [, year, month, day, hour, minute, second] = isoLike;
      const time = Date.UTC(
        Number(year),
        Number(month) - 1,
        Number(day),
        Number(hour),
        Number(minute),
        Number(second ?? "0")
      );
      return { iso: new Date(time).toISOString(), sortTime: time };
    }

    const frenchDate = /^(\d{2})\/(\d{2})\/(\d{4})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(trimmed);

    if (frenchDate) {
      const [, day, month, year, hour = "0", minute = "0", second = "0"] = frenchDate;
      const time = Date.UTC(
        Number(year),
        Number(month) - 1,
        Number(day),
        Number(hour),
        Number(minute),
        Number(second)
      );
      return { iso: new Date(time).toISOString(), sortTime: time };
    }

    const timestamp = Date.parse(trimmed);

    if (Number.isFinite(timestamp)) {
      return { iso: new Date(timestamp).toISOString(), sortTime: timestamp };
    }
  }

  return { raw: value };
}

function toRoundedHours(value: unknown): number {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value.trim().replace(",", "."))
        : Number.NaN;

  if (!Number.isFinite(parsed)) {
    return 0;
  }

  return Math.round(parsed * 100) / 100;
}

function isSameSubject(messageSubject: string, ticketSubject: string): boolean {
  const messageSearch = toSearchText(messageSubject).replace(/\s+/g, " ").trim();
  const ticketSearch = toSearchText(ticketSubject).replace(/\s+/g, " ").trim();

  return messageSearch !== "" && messageSearch === ticketSearch;
}

function cleanMessages(
  rawMessages: unknown,
  ticketSubject: string,
  config: ToolConfig,
  ticketLabel: string,
  warnings: string[]
): MessageCleaningResult {
  const messages = Array.isArray(rawMessages) ? rawMessages : [];
  const redactionCounts = cloneEmptyRedactionCounts();
  const redactionFindings: RedactionFinding[] = [];
  const seen = new Set<string>();
  const cleanedMessages: Array<CleanMessage & { sortTime?: number; sourceIndex: number }> = [];
  let encodingFixCount = 0;
  let removedMessages = 0;
  let removedAutoMessages = 0;
  let removedDuplicateMessages = 0;
  const rawContentParts: string[] = [];
  const rawAuthorParts: string[] = [];
  let sourceMessageCount = 0;

  messages.forEach((message, index) => {
    sourceMessageCount += 1;

    if (!message || typeof message !== "object" || Array.isArray(message)) {
      removedMessages += 1;
      appendWarning(warnings, `${ticketLabel}: message ${index + 1} ignored because it is not an object.`);
      return;
    }

    const record = message as Record<string, unknown>;
    const rawContent = getValue(record, ["contenu_texte"]);
    const rawSubject = getValue(record, ["sujet"]);
    const rawAuthor = getValue(record, ["auteur"]);
    rawContentParts.push(String(rawContent ?? ""));
    rawContentParts.push(String(rawSubject ?? ""));
    rawAuthorParts.push(String(rawAuthor ?? ""));

    const content = cleanTextValue(rawContent, config, `messages[${index}].contenu_texte`, true);
    encodingFixCount += mergeTextResult(redactionCounts, redactionFindings, content);

    if (!content.text) {
      removedMessages += 1;
      return;
    }

    const reason = weakMessageReason(content.text);

    if (reason) {
      removedMessages += 1;
      removedAutoMessages += reason === "auto" ? 1 : 0;
      return;
    }

    const messageSubject = cleanTextValue(rawSubject, config, `messages[${index}].sujet`, true);
    encodingFixCount += mergeTextResult(redactionCounts, redactionFindings, messageSubject);
    const normalizedSubject = isSameSubject(messageSubject.text, ticketSubject) ? "" : messageSubject.text;
    const duplicateKey = `${normalizedSubject}\u0000${content.text}`;

    if (seen.has(duplicateKey)) {
      removedMessages += 1;
      removedDuplicateMessages += 1;
      return;
    }

    seen.add(duplicateKey);

    const date = parseDateValue(getValue(record, ["date"]));
    const cleanMessage: CleanMessage & { sortTime?: number; sourceIndex: number } = {
      sujet: normalizedSubject,
      contenu_texte: content.text,
      sourceIndex: index
    };

    if (date.iso) {
      cleanMessage.date = date.iso;
      cleanMessage.sortTime = date.sortTime;
    } else if (date.raw !== undefined) {
      cleanMessage.date_raw = date.raw;
      appendWarning(warnings, `${ticketLabel}: message ${index + 1} date not converted.`);
    }

    if (config.keepAuthor === true) {
      const author = cleanTextValue(rawAuthor, config, `messages[${index}].auteur`, false);
      encodingFixCount += author.corrections;

      if (author.text) {
        cleanMessage.auteur = author.text;
      }
    }

    cleanedMessages.push(cleanMessage);
  });

  cleanedMessages.sort((left, right) => {
    if (left.sortTime !== undefined && right.sortTime !== undefined) {
      return left.sortTime - right.sortTime;
    }

    if (left.sortTime !== undefined) {
      return -1;
    }

    if (right.sortTime !== undefined) {
      return 1;
    }

    return left.sourceIndex - right.sourceIndex;
  });

  return {
    messages: cleanedMessages.map(({ sortTime: _sortTime, sourceIndex: _sourceIndex, ...message }) => message),
    removedMessages,
    removedAutoMessages,
    removedDuplicateMessages,
    encodingFixCount,
    redactionCounts,
    redactionFindings,
    rawContentSearch: toSearchText(rawContentParts.join("\n")),
    rawAuthorSearch: toSearchText(rawAuthorParts.join("\n")),
    onlyWeakSourceMessages: sourceMessageCount > 0 && cleanedMessages.length === 0
  };
}

function classifyTicket(input: {
  subjectSearch: string;
  contentSearch: string;
  authorSearch: string;
  teamSearch: string;
  categorySearch: string;
  messageCount: number;
}): TicketKind {
  const subjectOrAuthor = `${input.subjectSearch}\n${input.authorSearch}`;
  const allText = `${subjectOrAuthor}\n${input.contentSearch}`;
  const infraContext = input.teamSearch.includes("infra") || input.categorySearch.trim() === "infra_saas";

  if (includesAny(subjectOrAuthor, monitoringTerms) || includesAny(input.contentSearch, ["downtime details"])) {
    return "monitoring";
  }

  if (includesAny(allText, spamTerms)) {
    return "spam_or_auto";
  }

  if (includesAny(allText, notificationTerms)) {
    return "notification";
  }

  if (infraContext && hasTechnicalAlertSignal(allText)) {
    return includesAny(allText, monitoringTerms) ? "monitoring" : "internal_infra";
  }

  if (input.messageCount === 0) {
    return "empty";
  }

  if (
    input.messageCount >= 2 ||
    hasAnomalySignal(allText) ||
    hasProcedureSignal(allText) ||
    input.subjectSearch.length >= 12
  ) {
    return "support_case";
  }

  return "unknown";
}

function scoreTicket(input: {
  ticketKind: TicketKind;
  subject: string;
  category: string;
  type: string;
  hours: number;
  messages: CleanMessage[];
  contentSearch: string;
  removedDuplicateMessages: number;
  onlyWeakSourceMessages: boolean;
}): { score: number; flags: string[] } {
  const flags: string[] = [];
  const subjectSearch = toSearchText(input.subject);
  const categorySearch = toSearchText(input.category);
  const typeSearch = toSearchText(input.type);
  const usefulMessageCount = input.messages.filter((message) => isUsefulMessage(message.contenu_texte)).length;
  const allSearch = `${subjectSearch}\n${categorySearch}\n${typeSearch}\n${input.contentSearch}`;
  let score =
    {
      support_case: 40,
      internal_infra: 20,
      notification: 10,
      monitoring: 5,
      spam_or_auto: -50,
      empty: -50,
      unknown: 0
    }[input.ticketKind] ?? 0;

  if (hasResolutionSignal(allSearch)) {
    score += 25;
    flags.push("resolution_explicit");

    if (allSearch.includes("mise a jour corrective") || allSearch.includes("maj corrective") || /\b\d+\.\d+/.test(allSearch)) {
      flags.push("correction_version");
    }
  }

  if (hasProcedureSignal(allSearch)) {
    score += 20;
    flags.push("procedure_reproductible");
  }

  if (hasAnomalySignal(allSearch)) {
    score += 15;
    flags.push("anomalie_metier");
  }

  if (categorySearch && !["divers", "autre", "general", "n/a"].includes(categorySearch)) {
    score += 10;
    flags.push("categorie_exploitable");
  }

  if (usefulMessageCount >= 2) {
    score += 10;
    flags.push("echanges_humains_utiles");
  }

  if (input.hours > 0.25) {
    score += 5;
    flags.push("heures_passees");
  }

  if (input.ticketKind === "spam_or_auto") {
    score -= 40;
    flags.push("spam_auto");
  }

  if (input.ticketKind === "monitoring" && !hasProcedureSignal(allSearch) && !hasResolutionSignal(allSearch)) {
    score -= 35;
    flags.push("monitoring_pur");
  }

  if (input.ticketKind === "notification" && !hasProcedureSignal(allSearch) && !hasResolutionSignal(allSearch)) {
    score -= 30;
    flags.push("notification_auto");
  }

  if (typeSearch.includes("ne pas utiliser")) {
    score -= 25;
    flags.push("type_ne_pas_utiliser");
  }

  if (input.hours === 0) {
    score -= 20;
    flags.push("heures_nulles");
  }

  if (usefulMessageCount === 0) {
    score -= 20;
    flags.push("aucun_message_utile");
  } else {
    flags.push("messages_utiles");
  }

  if (input.onlyWeakSourceMessages || input.messages.every((message) => isOnlyLinkOrShortAlert(message.contenu_texte))) {
    score -= 15;
    flags.push("contenu_faible");
  }

  if (input.removedDuplicateMessages > 0) {
    score -= 15;
    flags.push("doublon_probable");
  }

  if (["test", "client critique", "divers"].includes(subjectSearch.trim())) {
    score -= 10;
    flags.push("sujet_vague");
  }

  return {
    score: Math.max(0, Math.min(100, score)),
    flags
  };
}

function cleanTicket(
  source: Record<string, unknown>,
  index: number,
  config: ToolConfig,
  warnings: string[]
): CleanTicketResult {
  const redactionCounts = cloneEmptyRedactionCounts();
  const redactionFindings: RedactionFinding[] = [];
  let encodingFixCount = 0;
  const ticketId = cleanTextValue(getValue(source, ["sequence_des_id_des_tickets", "ticket_id", "id"]), config, "ticket_id", false);
  const subject = cleanTextValue(getValue(source, ["sujet"]), config, "sujet", true);
  const priority = cleanTextValue(getValue(source, ["gravite", "priorite"]), config, "priorite", false);
  const category = cleanTextValue(getValue(source, ["categorie_perimetre", "categorie"]), config, "categorie", false);
  const team = cleanTextValue(getValue(source, ["equipe_d_assistance"]), config, "equipe_d_assistance", false);
  const type = cleanTextValue(getValue(source, ["type"]), config, "type", false);
  const labels = getValue(source, ["etiquettes"]);
  const labelText = cleanTextValue(labels, config, "etiquettes", false);
  const client = cleanTextValue(getValue(source, ["client"]), config, "client", false);

  for (const result of [ticketId, subject, priority, category, team, type, labelText, client]) {
    encodingFixCount += mergeTextResult(redactionCounts, redactionFindings, result);
  }

  const hours = toRoundedHours(getValue(source, ["heures_passees"]));
  const ticketLabel = ticketId.text ? `Ticket ${ticketId.text}` : `Ticket at index ${index + 1}`;
  const messages = cleanMessages(getValue(source, ["messages"]), subject.text, config, ticketLabel, warnings);
  encodingFixCount += messages.encodingFixCount;
  mergeRedactionCounts(redactionCounts, messages.redactionCounts);
  redactionFindings.push(...messages.redactionFindings);

  const createdAt = parseDateValue(getValue(source, ["cree_le"]));

  if (createdAt.raw !== undefined) {
    appendWarning(warnings, `${ticketLabel}: cree_le date not converted.`);
  }

  const ticketKind = classifyTicket({
    subjectSearch: toSearchText(subject.text),
    contentSearch: messages.rawContentSearch,
    authorSearch: messages.rawAuthorSearch,
    teamSearch: toSearchText(team.text),
    categorySearch: toSearchText(category.text),
    messageCount: messages.messages.length
  });
  const scoring = scoreTicket({
    ticketKind,
    subject: subject.text,
    category: category.text,
    type: type.text,
    hours,
    messages: messages.messages,
    contentSearch: messages.rawContentSearch,
    removedDuplicateMessages: messages.removedDuplicateMessages,
    onlyWeakSourceMessages: messages.onlyWeakSourceMessages
  });
  const ragCandidate = scoring.score >= 70 && ticketKind === "support_case";
  const ticket: CleanTicket = {
    ...(ticketId.text ? { ticket_id: ticketId.text } : {}),
    ...(priority.text ? { priorite: priority.text } : {}),
    ...(subject.text ? { sujet: subject.text } : {}),
    ...(category.text ? { categorie: category.text } : {}),
    ...(team.text ? { equipe_d_assistance: team.text } : {}),
    ...(config.keepClient !== false && client.text
      ? { client: config.redactClient === true ? "[CLIENT_REDACTED]" : client.text }
      : {}),
    heures_passees: hours,
    ...(createdAt.iso ? { cree_le: createdAt.iso } : {}),
    ...(!createdAt.iso && createdAt.raw !== undefined ? { cree_le_raw: createdAt.raw } : {}),
    ...(type.text ? { type: type.text } : {}),
    ...(labelText.text ? { etiquettes: labelText.text } : {}),
    messages: messages.messages,
    ticket_kind: ticketKind,
    relevance_score: scoring.score,
    relevance_flags: scoring.flags,
    rag_candidate: ragCandidate
  };

  return {
    ticket,
    removedMessages: messages.removedMessages,
    removedAutoMessages: messages.removedAutoMessages,
    removedDuplicateMessages: messages.removedDuplicateMessages,
    ticketWithoutUsefulMessages: messages.messages.length === 0,
    ragCandidate,
    encodingFixCount,
    redactionCounts,
    redactionFindings
  };
}

function shouldExportTicket(ticket: CleanTicket, config: ToolConfig): boolean {
  const minScore = config.minScore ?? 0;

  if (ticket.relevance_score < minScore) {
    return false;
  }

  if (config.onlyRagCandidates === true && !ticket.rag_candidate) {
    return false;
  }

  return true;
}

export const supportTicketCleanerTool: ToolModule = {
  meta: {
    id: "support-ticket-cleaner",
    name: "Support Ticket Cleaner",
    description: "Nettoie des exports JSON de tickets support pour un RAG support.",
    kind: "processor",
    inputExtensions: ["json"],
    outputModes: ["canonical"]
  },
  defaultConfig: {
    outputMode: "canonical",
    normalizeWhitespace: true,
    fixEncoding: true,
    stripControlChars: true,
    redactSensitive: true,
    redactSecrets: true,
    redactCertificates: true,
    redactIps: true,
    redactInternalPaths: true,
    minScore: 0,
    onlyRagCandidates: false,
    keepAuthor: false,
    keepClient: true,
    redactClient: false,
    pretty: true
  },
  async run(input, config) {
    const sourceFile = inputFileName(input.files);
    const raw = input.json ?? JSON.parse(readTextInput(input));

    if (!Array.isArray(raw)) {
      throw new Error("Support ticket cleaner expects a JSON array of tickets.");
    }

    const warnings: string[] = [];
    const redactionCounts = cloneEmptyRedactionCounts();
    const redactionFindings: RedactionFinding[] = [];
    const tickets: CleanTicket[] = [];
    let encodingFixCount = 0;
    let removedMessages = 0;
    let removedAutoMessages = 0;
    let ticketsWithoutUsefulMessages = 0;

    raw.forEach((item, index) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        appendWarning(warnings, `Element ${index + 1}: ticket ignored because it is not an object.`);
        return;
      }

      const result = cleanTicket(item as Record<string, unknown>, index, config, warnings);
      encodingFixCount += result.encodingFixCount;
      removedMessages += result.removedMessages;
      removedAutoMessages += result.removedAutoMessages;
      ticketsWithoutUsefulMessages += result.ticketWithoutUsefulMessages ? 1 : 0;
      mergeRedactionCounts(redactionCounts, result.redactionCounts);
      appendDiagnosticRedactionFindings(redactionFindings, result.redactionFindings);

      if (result.ticket && shouldExportTicket(result.ticket, config)) {
        tickets.push(result.ticket);
      }
    });

    const report: SupportTicketCleanerReport = {
      inputTickets: raw.length,
      outputTickets: tickets.length,
      removedMessages,
      removedAutoMessages,
      ticketsWithoutUsefulMessages,
      ragCandidates: tickets.filter((ticket) => ticket.rag_candidate).length,
      redactedSecrets: redactionCounts.secret,
      redactedIps: redactionCounts.ip,
      warnings
    };

    return {
      data: tickets,
      report,
      diagnostics: createDiagnostics({
        inputFiles: [sourceFile],
        rowCount: raw.length,
        data: tickets,
        encodingFixCount,
        redactionCounts,
        redactionFindings,
        warnings
      })
    };
  }
};
