import { beforeEach, describe, expect, it } from "vitest";
import { localeTag, resolveLocale, setActiveLocale, t } from "./i18n";

describe("i18n", () => {
  beforeEach(() => setActiveLocale("ja"));

  it("prefers a persisted supported locale", () => {
    expect(resolveLocale("en", ["ja-JP"])).toBe("en");
  });

  it("uses Japanese for Japanese browser languages and English otherwise", () => {
    expect(resolveLocale(null, ["ja-JP", "en-US"])).toBe("ja");
    expect(resolveLocale(null, ["fr-FR", "en-US"])).toBe("en");
  });

  it("translates messages and interpolates values", () => {
    setActiveLocale("en");
    expect(t("connection.connectAria", { name: "BME280" })).toBe("Connect BME280");
    expect(localeTag()).toBe("en-US");
  });
});
