import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  chromium,
  type Browser,
  type BrowserContext,
  type Locator,
  type Page,
} from "playwright";
import type {
  AgentDecision,
  Checkpoint,
  Control,
  Observation,
  Step,
  Target,
} from "../core/schema.js";
import type { StepExecution, SurfaceAdapter } from "./types.js";

interface RawControl extends Omit<Control, "ref"> {
  id: string;
  fieldName: string;
  text: string;
}

export interface PlaywrightSurfaceOptions {
  headless?: boolean;
  slowMo?: number;
  browser?: Browser;
  context?: BrowserContext;
  page?: Page;
}

function selectorValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

export class PlaywrightSurface implements SurfaceAdapter {
  readonly kind = "playwright-web-v1";
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private ownsBrowser = true;
  private targetByRef = new Map<string, Target>();

  constructor(private readonly options: PlaywrightSurfaceOptions = {}) {
    if (options.browser) this.browser = options.browser;
    if (options.context) this.context = options.context;
    if (options.page) {
      this.page = options.page;
      this.ownsBrowser = false;
    }
  }

  get activePage(): Page {
    if (!this.page) throw new Error("Surface has not started");
    return this.page;
  }

  async start(entryUrl: string): Promise<void> {
    if (!this.page) {
      this.browser ??= await chromium.launch({
        headless: this.options.headless ?? true,
        slowMo: this.options.slowMo ?? 0,
      });
      this.context ??= await this.browser.newContext({
        viewport: { width: 1280, height: 800 },
      });
      this.page = await this.context.newPage();
    }
    await this.activePage.goto(entryUrl, { waitUntil: "domcontentloaded" });
  }

  async observe(evidenceDir: string, sequence: number): Promise<Observation> {
    await mkdir(evidenceDir, { recursive: true });
    const screenshotPath = join(evidenceDir, `step-${String(sequence).padStart(2, "0")}.png`);
    await this.activePage.screenshot({ path: screenshotPath, fullPage: true });

    const raw = await this.activePage
      .locator(
        "a,button,input,select,textarea,[role='button'],[role='link'],[role='status'],.amount",
      )
      .evaluateAll(elements =>
        elements
          .filter(element => {
            const rect = element.getBoundingClientRect();
            const style = window.getComputedStyle(element);
            return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden";
          })
          .map(element => {
            const html = element as HTMLElement;
            const input = element as HTMLInputElement;
            const id = html.id ?? "";
            const explicitLabel = id
              ? document.querySelector(`label[for="${CSS.escape(id)}"]`)?.textContent ?? ""
              : "";
            const wrappingLabel = html.closest("label")?.textContent ?? "";
            const label = (explicitLabel || wrappingLabel).trim();
            const text = (html.innerText || input.value || "").trim();
            const role =
              html.getAttribute("role") ||
              (html.tagName === "A"
                ? "link"
                : html.tagName === "BUTTON" || input.type === "submit"
                  ? "button"
                  : ["INPUT", "TEXTAREA", "SELECT"].includes(html.tagName)
                    ? input.type === "checkbox"
                      ? "checkbox"
                      : "textbox"
                    : html.tagName.toLowerCase());
            const name = (html.getAttribute("aria-label") || label || text).trim();
            return {
              role,
              name,
              label,
              placeholder: input.placeholder ?? "",
              tag: html.tagName.toLowerCase(),
              type: input.type ?? "",
              href: html instanceof HTMLAnchorElement ? html.href : "",
              disabled: Boolean(input.disabled),
              id,
              fieldName: input.name ?? "",
              text,
            };
          }),
      );

    this.targetByRef.clear();
    const controls = raw.map((control: RawControl, index: number): Control => {
      const ref = `c${index + 1}`;
      this.targetByRef.set(ref, this.toTarget(control));
      return {
        ref,
        role: control.role,
        name: control.name,
        label: control.label,
        placeholder: control.placeholder,
        tag: control.tag,
        type: control.type,
        href: control.href,
        disabled: control.disabled,
      };
    });

    return {
      url: this.activePage.url(),
      title: await this.activePage.title(),
      visibleText: (await this.activePage.locator("body").innerText()).slice(0, 10_000),
      controls,
      screenshotPath,
    };
  }

  decisionToStep(decision: AgentDecision, observation: Observation, sequence: number): Step {
    if (decision.action === "done" || decision.action === "escalate") {
      throw new Error(`Decision ${decision.action} does not map to an executable step`);
    }
    let target = decision.targetRef ? this.targetByRef.get(decision.targetRef) ?? null : null;
    if (["fill", "click", "extract"].includes(decision.action) && !target) {
      throw new Error(`Unknown or missing control reference: ${decision.targetRef ?? "null"}`);
    }
    if (decision.action === "navigate" && !decision.value) {
      throw new Error("Navigate requires a URL value");
    }
    if (decision.action === "extract" && target) {
      const nonDataStrategies = target.strategies.filter(strategy =>
        ["css", "label", "placeholder"].includes(strategy.kind),
      );
      if (nonDataStrategies.length === 0) {
        throw new Error("Extracted data has no locator that is safe to persist");
      }
      target = {
        description: `declared output ${decision.outputName ?? "value"}`,
        strategies: nonDataStrategies,
      };
    }
    const targetText = target?.description ?? "";
    const deterministicRisk =
      decision.action === "click" &&
      /delete|close account|wire|transfer funds|submit payment|confirm purchase|open account/i.test(
        targetText,
      );
    return {
      id: `step-${String(sequence).padStart(2, "0")}`,
      action: decision.action,
      description: decision.reason,
      target,
      value: decision.action === "fill" || decision.action === "navigate" ? decision.value : null,
      outputName: decision.action === "extract" ? decision.outputName : null,
      risk: decision.risk === "risky" || deterministicRisk ? "risky" : "safe",
      timeoutMs: 10_000,
      checkpoint: null,
    };
  }

  async execute(step: Step, resolvedValue: string | null): Promise<StepExecution> {
    const timeout = step.timeoutMs;
    if (step.action === "navigate") {
      if (!resolvedValue) throw new Error("Navigate step is missing a URL");
      await this.activePage.goto(resolvedValue, { waitUntil: "domcontentloaded", timeout });
      return { value: null, observed: this.activePage.url() };
    }
    if (step.action === "wait") {
      await this.activePage.waitForTimeout(Math.min(timeout, 5_000));
      return { value: null, observed: "wait completed" };
    }
    if (!step.target) throw new Error(`${step.action} step is missing a target`);
    const locator = await this.locate(step.target, timeout);
    if (step.action === "fill") {
      if (resolvedValue === null) throw new Error("Fill step is missing a value");
      await locator.fill(resolvedValue, { timeout });
      return { value: null, observed: `filled ${step.target.description}` };
    }
    if (step.action === "click") {
      await locator.click({ timeout });
      await this.activePage.waitForLoadState("domcontentloaded").catch(() => undefined);
      return { value: null, observed: `clicked ${step.target.description}` };
    }
    if (step.action === "extract") {
      const value = (await locator.textContent({ timeout }))?.trim() ?? "";
      return { value, observed: value };
    }
    if (step.action === "assert") {
      const observed = (await locator.textContent({ timeout }))?.trim() ?? "";
      if (resolvedValue !== null && !observed.includes(resolvedValue)) {
        throw new Error(`Assertion failed. Expected ${resolvedValue}; observed ${observed}`);
      }
      return { value: null, observed };
    }
    throw new Error(`Unsupported step action: ${step.action}`);
  }

  async check(checkpoint: Checkpoint): Promise<{ passed: boolean; observed: string }> {
    if (checkpoint.kind === "url") {
      const observed = this.activePage.url();
      return { passed: observed.includes(checkpoint.expected), observed };
    }
    if (checkpoint.kind === "visible_text") {
      const observed = await this.visibleText();
      return { passed: observed.includes(checkpoint.expected), observed: observed.slice(0, 500) };
    }
    if (!checkpoint.target) throw new Error(`${checkpoint.kind} checkpoint requires a target`);
    try {
      const locator = await this.locate(checkpoint.target, 5_000);
      if (checkpoint.kind === "element_visible") {
        const passed = await locator.isVisible();
        return { passed, observed: passed ? "visible" : "not visible" };
      }
      const observed =
        (await locator.inputValue().catch(() => locator.textContent()))?.trim() ?? "";
      return { passed: observed.includes(checkpoint.expected), observed };
    } catch (error) {
      return { passed: false, observed: error instanceof Error ? error.message : String(error) };
    }
  }

  async visibleText(): Promise<string> {
    return (await this.activePage.locator("body").innerText()).slice(0, 10_000);
  }

  currentUrl(): string {
    return this.activePage.url();
  }

  async screenshot(path: string): Promise<void> {
    await mkdir(dirname(path), { recursive: true });
    await this.activePage.screenshot({ path, fullPage: true });
  }

  async close(): Promise<void> {
    if (this.ownsBrowser) await this.browser?.close();
    this.page = null;
    this.context = null;
    this.browser = null;
  }

  private toTarget(control: RawControl): Target {
    const strategies: Target["strategies"] = [];
    if (control.label) {
      strategies.push({ kind: "label", value: control.label, role: null, exact: true });
    }
    if (
      ["button", "link", "textbox", "checkbox", "combobox", "status", "heading"].includes(
        control.role,
      ) && control.name
    ) {
      strategies.push({
        kind: "role",
        role: control.role,
        value: control.name,
        exact: true,
      });
    }
    if (control.placeholder) {
      strategies.push({ kind: "placeholder", value: control.placeholder, role: null, exact: true });
    }
    if (control.fieldName) {
      strategies.push({
        kind: "css",
        value: `[name="${selectorValue(control.fieldName)}"]`,
        role: null,
        exact: true,
      });
    }
    if (control.id) {
      strategies.push({
        kind: "css",
        value: `[id="${selectorValue(control.id)}"]`,
        role: null,
        exact: true,
      });
    }
    if (control.text) {
      strategies.push({ kind: "text", value: control.text, role: null, exact: true });
    }
    if (strategies.length === 0) {
      throw new Error(`Control has no stable targeting strategy: ${control.tag}`);
    }
    return {
      description: control.label || control.name || control.text || control.tag,
      strategies,
    };
  }

  private async locate(target: Target, timeout: number): Promise<Locator> {
    const failures: string[] = [];
    for (const strategy of target.strategies) {
      let locator: Locator;
      if (strategy.kind === "label") {
        locator = this.activePage.getByLabel(strategy.value, { exact: strategy.exact });
      } else if (strategy.kind === "role") {
        locator = this.activePage.getByRole(strategy.role as never, {
          name: strategy.value,
          exact: strategy.exact,
        });
      } else if (strategy.kind === "placeholder") {
        locator = this.activePage.getByPlaceholder(strategy.value, { exact: strategy.exact });
      } else if (strategy.kind === "text") {
        locator = this.activePage.getByText(strategy.value, { exact: strategy.exact });
      } else {
        locator = this.activePage.locator(strategy.value);
      }
      try {
        await locator.first().waitFor({ state: "visible", timeout: Math.min(timeout, 2_500) });
        return locator.first();
      } catch (error) {
        failures.push(`${strategy.kind}:${strategy.value}`);
      }
    }
    throw new Error(`No locator matched ${target.description}. Tried ${failures.join(", ")}`);
  }
}
