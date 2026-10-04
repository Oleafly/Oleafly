import { describe, expect, it } from "vitest";
import type { MessageRef } from "@oleafly/preflight";
import enPreflight from "@/i18n/locales/en/preflight.json" with { type: "json" };
import {
  type DetailedMessage,
  preflightDetail,
  preflightDetailInEnglish,
  preflightMessage,
  preflightMessageInEnglish,
} from "./message";

const title: MessageRef = { key: "rules.refs-undefined-cite.title", params: { key: "smith21" } };
const detail: DetailedMessage = {
  detail: { key: "rules.refs-undefined-cite.detail" },
  detailParts: [{ key: "gate.cautionAdvice" }],
};

describe("preflight messages", () => {
  it("renders a message reference in the active language", () => {
    expect(preflightMessage(title)).toBe(
      enPreflight.rules["refs-undefined-cite"].title.replace("{{key}}", "smith21"),
    );
  });

  it("joins a detail with its extra parts", () => {
    expect(preflightDetail(detail)).toBe(
      `${enPreflight.rules["refs-undefined-cite"].detail} ${enPreflight.gate.cautionAdvice}`,
    );
    expect(preflightDetail({ detail: detail.detail })).toBe(
      enPreflight.rules["refs-undefined-cite"].detail,
    );
  });

  it("renders the English text used in exported reports", () => {
    expect(preflightMessageInEnglish(title)).toBe(
      enPreflight.rules["refs-undefined-cite"].title.replace("{{key}}", "smith21"),
    );
    expect(preflightDetailInEnglish(detail)).toBe(
      `${enPreflight.rules["refs-undefined-cite"].detail} ${enPreflight.gate.cautionAdvice}`,
    );
  });
});
