import { expect, test } from "vitest";
import { parseContentLanguage, contentLanguageQuery } from "../src/core/content-language.js";
import { runWithCliRequestContext, setCurrentContentLanguage } from "../src/core/request-context.js";

test("language is scoped to supported content reads", () => {
  runWithCliRequestContext(undefined, () => {
    setCurrentContentLanguage("en");
    expect(contentLanguageQuery("/api/v1/search", undefined, { keyword: "APEX" })).toEqual({ keyword: "APEX", lang: "en" });
    expect(contentLanguageQuery("/api/v1/me", undefined)).toBeUndefined();
    expect(contentLanguageQuery("/api/v1/ask", "POST")).toBeUndefined();
    expect(contentLanguageQuery("/api/v1/topics/42", "DELETE")).toBeUndefined();
    expect(contentLanguageQuery("/api/v1/topics/42", undefined, { lang: "zh-cn" })).toEqual({ lang: "zh-cn" });
  });
  expect(contentLanguageQuery("/api/v1/search", undefined)).toBeUndefined();
  expect(() => parseContentLanguage("fr")).toThrow();
});

test("parallel command contexts cannot exchange languages", async () => {
  const languages = await Promise.all((["en", "zh-cn"] as const).map(language =>
    runWithCliRequestContext(undefined, async () => {
      setCurrentContentLanguage(language);
      await new Promise(resolve => setTimeout(resolve, language === "en" ? 5 : 1));
      return contentLanguageQuery("/api/v1/topics/42", undefined)?.lang;
    })
  ));
  expect(languages).toEqual(["en", "zh-cn"]);
});
