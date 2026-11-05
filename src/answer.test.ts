import { describe, expect, it } from "vitest";
import { parseAnswer, resolveFacts, sourcesFrom, type Fact } from "./answer.ts";
import { documents, financials } from "./data.ts";

const doc = documents[0];
const docFact: Fact = {
  claim: "A claim",
  type: "reported",
  sourceType: "document",
  sourceId: doc.id,
};

describe("resolveFacts", () => {
  it("verifies a retrieved document and uses our own title and date", () => {
    const [fact] = resolveFacts([docFact], new Set(sourcesFrom("searchDocuments", [doc])));
    expect(fact.source).toEqual({
      label: doc.title,
      date: doc.date,
      excerpt: doc.body,
      verified: true,
    });
  });

  it("flags a real document that was not retrieved for this question", () => {
    const [fact] = resolveFacts([docFact], new Set());
    expect(fact.source.verified).toBe(false);
  });

  it("flags a document id that does not exist", () => {
    const [fact] = resolveFacts([{ ...docFact, sourceId: "DOC-FAKE-999" }], new Set());
    expect(fact.source).toEqual({
      label: "DOC-FAKE-999",
      date: null,
      excerpt: null,
      verified: false,
    });
  });

  it("verifies financials only for the company that was retrieved", () => {
    const retrieved = new Set(sourcesFrom("getFinancials", financials[0]));
    const fact = (sourceId: string): Fact => ({
      claim: "A claim",
      type: "calculated",
      sourceType: "financials",
      sourceId,
    });
    const [pulled, notPulled] = resolveFacts(
      [fact(financials[0].company), fact(financials[1].company)],
      retrieved,
    );
    expect(pulled.source.verified).toBe(true);
    expect(notPulled.source.verified).toBe(false);
  });
});

describe("parseAnswer", () => {
  it("accepts a complete reply", () => {
    expect(parseAnswer(JSON.stringify({ answer: " Yes. ", facts: [docFact] }))).toEqual({
      answer: "Yes.",
      facts: [docFact],
    });
  });

  it.each([
    "{}",
    '{"answer":"","facts":[]}',
    '{"answer":"Yes."}',
    "null",
    '{"answer":"Yes',
    "Sorry.",
    '{"answer":"Yes.}} Wait, let me not break JSON...","facts":[]}',
  ])(
    "rejects an unusable reply: %s",
    (text) => {
      expect(parseAnswer(text)).toBeNull();
    },
  );
});
