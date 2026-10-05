import { expect, test } from "vitest";
import { commandContentLanguage, inferContentLanguage, parseContentLanguage, contentLanguageQuery } from "../src/core/content-language.js";
import { runWithCliRequestContext, setCurrentContentLanguage } from "../src/core/request-context.js";

test.each([
  ["How do I use REST APIs in APEX?", "en"],
  ["APEX 如何调用 REST API？", "zh-cn"],
  ["繁體中文問題", "zh-cn"],
  ["¿Cómo usar ORDS?", "en"],
  ["Comment utiliser ORDS ?", "en"],
  ["Как использовать APEX?", "en"],
  ["APEX", "en"],
  ["APEX の使用方法は？", "en"],
  ["APEX 質問을 어떻게 처리합니까?", "en"],
  ["𠀀 APEX", "zh-cn"]
])("input language selects the stored edition: %s", (input, language) => {
  expect(inferContentLanguage(input)).toBe(language);
});

test("command language comes from the question, not retrieval keywords or context", () => {
  expect(commandContentLanguage("rag.retrieve", ["How does ORDS work?"], { query: ["中文检索词"] })).toBe("en");
  expect(commandContentLanguage("rag.retrieve", ["如何使用 ORDS？"], { query: ["ORDS"] })).toBe("zh-cn");
  expect(commandContentLanguage("search", ["English"], { lang: "zh-cn" })).toBe("zh-cn");
  expect(commandContentLanguage("search", ["中文"], { lang: "en" })).toBe("en");
  expect(commandContentLanguage("collection.build", [], { query: ["ORDS", "中文"] })).toBe("zh-cn");
  expect(commandContentLanguage("collection.build", [], {})).toBeUndefined();
  expect(commandContentLanguage("topic.view", ["42"], {})).toBeUndefined();
});

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
