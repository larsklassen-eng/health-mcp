import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";

import { afterEach, describe, expect, it } from "vitest";

import {
  judgeFailures,
  judgeMessage,
  type JudgeVerdict,
  openRouterJudge,
  parseJudgement,
} from "../src/index.js";

const criteria = ["Says he no longer takes dexamethasone.", "Gives the stop date."];

describe("judgeMessage", () => {
  it("gives the question, each tool's input and result, the answer and numbered criteria", () => {
    const message = judgeMessage({
      question: "Is he still on dexamethasone?",
      answer: "No, it was stopped on 2026-08-30.",
      toolResults: [
        { name: "get_medications", input: { status: "all" }, output: { medications: [] } },
        { name: "search_patient_records", input: { query: "steroid" } },
      ],
      criteria,
    });

    expect(message).toBe(`<question>
Is he still on dexamethasone?
</question>

<tool_results>
get_medications {"status":"all"}
{"medications":[]}

search_patient_records {"query":"steroid"}
(no result)
</tool_results>

<answer>
No, it was stopped on 2026-08-30.
</answer>

<criteria>
1. Says he no longer takes dexamethasone.
2. Gives the stop date.
</criteria>`);
  });

  it("puts the earlier conversation of a follow-up before the question", () => {
    const message = judgeMessage({
      earlierTurns: [{ question: "Is he still on dexamethasone?", answer: "No, it was stopped." }],
      question: "When did he stop it?",
      answer: "On 2026-08-30.",
      toolResults: [],
      criteria,
    });

    expect(
      message.startsWith(`<earlier_conversation>
Clinician: Is he still on dexamethasone?
Assistant: No, it was stopped.
</earlier_conversation>

<question>
When did he stop it?`),
    ).toBe(true);
  });

  it("says when no tools were called", () => {
    expect(judgeMessage({ question: "Q", answer: "A", toolResults: [], criteria })).toContain(
      "(no tools were called)",
    );
  });
});

describe("parseJudgement", () => {
  it("returns one verdict per criterion, in order, whatever order the reply has", () => {
    const reply = JSON.stringify({
      verdicts: [
        { criterion: 2, reason: "No date.", met: false },
        { criterion: 1, reason: "Says it was stopped.", met: true },
      ],
    });

    expect(parseJudgement(reply, criteria)).toEqual([
      { criterion: criteria[0], met: true, reason: "Says it was stopped." },
      { criterion: criteria[1], met: false, reason: "No date." },
    ]);
  });

  it("rejects a reply that misses or repeats a criterion, or is not JSON", () => {
    const one = { criterion: 1, reason: "r", met: true };
    expect(() => parseJudgement(JSON.stringify({ verdicts: [one] }), criteria)).toThrow(
      "0 verdicts for criterion 2",
    );
    expect(() =>
      parseJudgement(JSON.stringify({ verdicts: [one, one, { ...one, criterion: 2 }] }), criteria),
    ).toThrow("2 verdicts for criterion 1");
    expect(() => parseJudgement("Yes, both are met.", criteria)).toThrow();
  });
});

describe("judgeFailures", () => {
  it("lists only the statements that are not met, with the judge's reason", () => {
    const verdicts: JudgeVerdict[] = [
      { criterion: criteria[0]!, met: true, reason: "Fine." },
      { criterion: criteria[1]!, met: false, reason: "No date." },
    ];
    expect(judgeFailures(verdicts)).toEqual([`Judge: not met: "Gives the stop date." (No date.)`]);
  });
});

describe("openRouterJudge", () => {
  let close: (() => void) | undefined;
  afterEach(() => close?.());

  /** A fake OpenRouter that records the request and answers with `content`. */
  async function fakeOpenRouter(content: string) {
    const requests: Record<string, unknown>[] = [];
    const server = createServer((req: IncomingMessage, res) => {
      let body = "";
      req.on("data", (chunk: Buffer) => (body += chunk.toString()));
      req.on("end", () => {
        requests.push(JSON.parse(body) as Record<string, unknown>);
        res.setHeader("Content-Type", "application/json");
        res.end(
          JSON.stringify({
            id: "gen-1",
            object: "chat.completion",
            created: 0,
            model: "judge",
            system_fingerprint: "fp",
            choices: [
              {
                index: 0,
                finish_reason: "stop",
                message: { role: "assistant", content },
              },
            ],
            usage: { prompt_tokens: 900, completion_tokens: 60, total_tokens: 960, cost: 0.004 },
          }),
        );
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    close = () => server.close();
    const { port } = server.address() as AddressInfo;
    return { requests, serverURL: `http://127.0.0.1:${port}` };
  }

  it("asks for JSON verdicts under the app's data policy, and reads the cost", async () => {
    const reply = {
      verdicts: [
        { criterion: 1, reason: "Says it was stopped.", met: true },
        { criterion: 2, reason: "Gives 2026-08-30.", met: true },
      ],
    };
    const { requests, serverURL } = await fakeOpenRouter(JSON.stringify(reply));
    const judge = openRouterJudge({ apiKey: "test-key", model: "judge/model", serverURL });

    const judgement = await judge({
      question: "Is he still on dexamethasone?",
      answer: "No, stopped on 2026-08-30.",
      toolResults: [],
      criteria,
    });

    expect(judgement).toEqual({
      verdicts: [
        { criterion: criteria[0], met: true, reason: "Says it was stopped." },
        { criterion: criteria[1], met: true, reason: "Gives 2026-08-30." },
      ],
      usage: { modelCalls: 1, inputTokens: 900, outputTokens: 60, costUsd: 0.004 },
    });
    expect(requests[0]).toMatchObject({
      model: "judge/model",
      stream: false,
      provider: { data_collection: "deny", zdr: true },
      response_format: { type: "json_schema", json_schema: { name: "verdicts", strict: true } },
    });
  });
});
