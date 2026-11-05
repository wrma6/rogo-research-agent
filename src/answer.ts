/**
 * The agent's final output: a brief answer plus the facts behind it. Citations are
 * checked in code against what the tools actually returned during this question.
 */

import type Anthropic from "@anthropic-ai/sdk";
import {
  documents,
  type Company,
  type FinancialRecord,
  type ResearchDocument,
} from "./data.ts";

/** Constrains the model's final reply to this JSON shape. */
export const answerFormat: Anthropic.JSONOutputFormat = {
  type: "json_schema",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["answer", "facts"],
    properties: {
      answer: {
        type: "string",
        description:
          "A conversational summary in plain text, at most three sentences: the conclusion first, the key figure, and any caveat that could change the conclusion.",
      },
      facts: {
        type: "array",
        description: "Every factual claim behind the answer and all other detail, each with its source.",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["claim", "type", "sourceType", "sourceId"],
          properties: {
            claim: { type: "string", description: "One factual claim, including its period." },
            type: {
              type: "string",
              enum: ["reported", "calculated"],
              description: "Use calculated for anything you worked out yourself.",
            },
            sourceType: { type: "string", enum: ["document", "financials", "profile"] },
            sourceId: {
              type: "string",
              description: "For a document, its id. Otherwise, the company's exact name.",
            },
          },
        },
      },
    },
  },
};

export interface Fact {
  claim: string;
  type: "reported" | "calculated";
  sourceType: "document" | "financials" | "profile";
  sourceId: string;
}

export interface ResolvedFact {
  claim: string;
  type: Fact["type"];
  source: {
    label: string;
    date: string | null;
    excerpt: string | null;
    /** True only if a tool returned this source while answering this question. */
    verified: boolean;
  };
}

const sourceKey = (sourceType: Fact["sourceType"], id: string) => `${sourceType}:${id}`;

/** The citable sources in a tool's output. */
export function sourcesFrom(toolName: string, output: unknown): string[] {
  switch (toolName) {
    case "searchDocuments":
      return (output as ResearchDocument[]).map((doc) => sourceKey("document", doc.id));
    case "getFinancials":
      return [sourceKey("financials", (output as FinancialRecord).company)];
    case "getCompanyProfile":
      return [sourceKey("profile", (output as Company).name)];
    default:
      return [];
  }
}

/** Returns null if the reply isn't usable, for example if it was cut off or refused. */
export function parseAnswer(text: string): { answer: string; facts: Fact[] } | null {
  let parsed: { answer?: unknown; facts?: unknown } | null;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  const { answer, facts } = parsed ?? {};
  if (typeof answer !== "string" || !answer.trim() || !Array.isArray(facts)) return null;
  return { answer: answer.trim(), facts: facts as Fact[] };
}

/** Takes titles and dates from our own data, never from the model's description of them. */
export function resolveFacts(facts: Fact[], retrieved: ReadonlySet<string>): ResolvedFact[] {
  return facts.map(({ claim, type, sourceType, sourceId }) => {
    const verified = retrieved.has(sourceKey(sourceType, sourceId));
    const doc = sourceType === "document" ? documents.find((d) => d.id === sourceId) : undefined;

    if (doc) {
      return {
        claim,
        type,
        source: { label: doc.title, date: doc.date, excerpt: doc.body, verified },
      };
    }

    const label =
      sourceType === "financials"
        ? `Financials: ${sourceId}`
        : sourceType === "profile"
          ? `Company profile: ${sourceId}`
          : sourceId;
    return { claim, type, source: { label, date: null, excerpt: null, verified } };
  });
}
