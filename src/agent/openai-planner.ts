import { readFile } from "node:fs/promises";
import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { AgentDecisionSchema, type AgentDecision } from "../core/schema.js";
import type { DiscoveryPlanner, PlannerContext } from "./planner.js";

const systemPrompt = `You are the discovery planner for a computer-use automation system.
You operate a live business application one action at a time. Your output is schema validated.

Rules:
1. Use only control references present in the latest observation.
2. Prefer semantic controls by label and accessible name.
3. Do not invent data. Use values supplied in the goal.
4. Set completed=true and action=done only after the requested output was extracted and the visible page proves the goal succeeded.
5. Use extract for data the caller requested and give it a concise outputName.
5a. For extract, outputName must exactly match one key in declaredOutputs. Never invent an alias.
6. Use escalate only when you cannot proceed safely, a risky action needs approval, or the UI is in an unknown state.
7. Never navigate outside the supplied target origin.
8. Do not repeat an action that already succeeded.
9. Explain the immediate reason without exposing hidden reasoning or secrets.
10. Mark risk as risky for irreversible account, payment, transfer, approval, or deletion actions. Read-only lookup actions are safe.`;

export class OpenAIPlanner implements DiscoveryPlanner {
  readonly provider = "openai";
  readonly model: string;
  private readonly client: OpenAI;

  constructor(options: { model?: string; apiKey?: string } = {}) {
    this.model = options.model ?? process.env.OPENAI_MODEL ?? "gpt-5.4-mini";
    this.client = new OpenAI({ apiKey: options.apiKey ?? process.env.OPENAI_API_KEY });
  }

  async decide(context: PlannerContext): Promise<AgentDecision> {
    const screenshot = await readFile(context.observation.screenshotPath);
    const history = context.history.map(item => ({
      id: item.step.id,
      action: item.step.action,
      description: item.step.description,
      outputName: item.step.outputName,
      observedUrl: item.observedUrl,
    }));
    const state = {
      goal: context.goal,
      page: {
        url: context.observation.url,
        title: context.observation.title,
        visibleText: context.observation.visibleText,
        controls: context.observation.controls,
      },
      completedActions: history,
      declaredOutputs: context.outputSpecs,
      extractedOutputNames: Object.keys(context.outputs),
    };

    const response = await this.client.responses.parse({
      model: this.model,
      store: false,
      input: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: [
            { type: "input_text", text: JSON.stringify(state) },
            {
              type: "input_image",
              image_url: `data:image/png;base64,${screenshot.toString("base64")}`,
              detail: "low",
            },
          ],
        },
      ],
      text: { format: zodTextFormat(AgentDecisionSchema, "computer_use_decision") },
    });
    if (!response.output_parsed) {
      throw new Error("OpenAI returned no parsed discovery decision");
    }
    return response.output_parsed;
  }
}
