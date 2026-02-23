import { describe, expect, it } from "vitest";
import {
  buildItemYamlRecord,
  buildPromptText,
  getDefaultPromptTemplate,
  renderPromptTemplate
} from "../src/prompt";
import { PromptItemInput } from "../src/types";

const sample: PromptItemInput = {
  id: "item_1",
  projectName: "Checkout",
  categoryName: "Issues",
  type: "issue",
  title: "Submit button blocked",
  description: "Submit button stays disabled after valid input.",
  status: "open",
  priority: "high",
  tags: ["checkout", "blocking"],
  attachments: [{ path: "images/item_1/screen_1.png" }],
  createdAt: "2026-02-23T00:00:00.000Z",
  updatedAt: "2026-02-23T00:00:00.000Z"
};

describe("prompt builders", () => {
  it("builds structured prompt text", () => {
    const text = buildPromptText(sample);
    expect(text).toContain("[GOAL]");
    expect(text).toContain("Project: Checkout");
    expect(text).toContain("images/item_1/screen_1.png");
  });

  it("builds yaml record", () => {
    const yamlRecord = buildItemYamlRecord(sample);
    expect(yamlRecord.id).toBe("item_1");
    expect(yamlRecord.attachments[0]?.path).toBe("images/item_1/screen_1.png");
    expect(yamlRecord.prompt.goal).toContain("issue");
    expect(yamlRecord.prompt_text).toContain("Submit button blocked");
    expect(yamlRecord.prompt_template_kind).toBe("issue");
  });

  it("renders a custom template with placeholders", () => {
    const template = "ID={{item.id}} | Kind={{item.kind}} | Category={{category.name}}";
    const rendered = renderPromptTemplate(template, sample);
    expect(rendered).toBe("ID=item_1 | Kind=issue | Category=Issues");
  });

  it("falls back to default template when custom template is empty", () => {
    const text = buildPromptText(sample, "   ");
    expect(text).toContain(getDefaultPromptTemplate("issue").split("\n")[0]);
  });
});
