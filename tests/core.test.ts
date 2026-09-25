import { describe, expect, it } from "vitest";
import {
	assignDomain,
	classify,
	urlFromEntryLine,
	detectToolByRules,
	detectToolFromHtml,
	extractTitle,
	isDone,
	normalizeUrl,
	parseCategoryRules,
	parseInbox,
	parseList,
	renderList,
} from "../src/core";
import { DEFAULT_SETTINGS } from "../src/defaults";

const opts = { usedLabel: "使用済み", defaultCategory: "未分類", preferredOrder: ["ツール", "開発"] };
const toolRules = {
	domains: DEFAULT_SETTINGS.toolDomains,
	urlPatterns: DEFAULT_SETTINGS.toolUrlPatterns,
	keywords: DEFAULT_SETTINGS.toolKeywords,
};

describe("parseInbox", () => {
	it("key-value 形式", () => {
		const r = parseInbox("url: https://example.com/a\ntitle: Foo [bar] (baz)\ndate: 2026-09-25\n", "2000-01-01");
		expect(r).toEqual([{ url: "https://example.com/a", title: "Foo [bar] (baz)", date: "2026-09-25" }]);
	});

	it("date が無ければ fallback", () => {
		expect(parseInbox("URL：https://example.com\nTitle: x", "2026-01-02")[0].date).toBe("2026-01-02");
	});

	it("複数ブロック・Markdown 行・URL のみ", () => {
		const r = parseInbox(
			"url: https://a.com\ntitle: A\n---\n- [ ] [B](https://b.com) (2026-09-01)\nhttps://c.com/x?y=1\n",
			"2026-09-25",
		);
		expect(r.map((x) => [x.url, x.title, x.date])).toEqual([
			["https://a.com", "A", "2026-09-25"],
			["https://b.com", "B", "2026-09-01"],
			["https://c.com/x?y=1", "", "2026-09-25"],
		]);
	});
});

describe("parseList / renderList", () => {
	const src = [
		"# Read Later",
		"メモ",
		"",
		"## 開発",
		"",
		"- [x] [Old](https://old.dev) (2026-09-01)",
		"- [ ] [New \\[beta\\]](https://new.dev) (2026-09-20) 後で試す",
		"\t- 子メモ",
		"",
		"## ツール",
		"",
		"- [x] [App](https://apps.apple.com/app/1) (2026-09-10) #tool",
		"\t- [x] 使用済み",
		"",
		"## 自作カテゴリ",
		"- [ ] [Z](https://z.com) (2026-09-11)",
		"",
	].join("\n");

	it("状態・カテゴリ・メモを保持してラウンドトリップする", () => {
		const doc = parseList(src, "使用済み", "未分類");
		expect(doc.entries).toHaveLength(4);
		const newer = doc.entries[1];
		expect(newer).toMatchObject({ title: "New [beta]", read: false, category: "開発", extra: "後で試す", children: ["\t- 子メモ"] });
		expect(doc.entries[2]).toMatchObject({ isTool: true, used: true, read: true, category: "ツール" });

		const out = renderList(doc, opts);
		expect(out).toBe(
			[
				"# Read Later",
				"メモ",
				"",
				"## ツール",
				"",
				"- [x] [App](https://apps.apple.com/app/1) (2026-09-10) #tool",
				"\t- [x] 使用済み",
				"",
				"## 開発",
				"",
				"- [ ] [New \\[beta\\]](https://new.dev) (2026-09-20) 後で試す",
				"\t- 子メモ",
				"- [x] [Old](https://old.dev) (2026-09-01)",
				"",
				"## 自作カテゴリ",
				"",
				"- [ ] [Z](https://z.com) (2026-09-11)",
				"",
			].join("\n"),
		);
		// 2 回目も同じ出力（冪等）
		expect(renderList(parseList(out, "使用済み", "未分類"), opts)).toBe(out);
	});

	it("#tool タグだけ付けたエントリは使用済みチェックが生える", () => {
		const doc = parseList("## 未分類\n- [ ] [T](https://t.com) #tool\n", "使用済み", "未分類");
		expect(renderList(doc, opts)).toContain("- [ ] [T](https://t.com) #tool\n\t- [ ] 使用済み");
	});

	it("空ファイルからでも描画できる", () => {
		expect(renderList(parseList("", "使用済み", "未分類"), opts)).toBe("# Read Later\n");
	});
});

describe("isDone", () => {
	const base = { title: "", url: "", date: "", category: "", extra: "", children: [] };
	it("ツールは使用済みまで必要", () => {
		expect(isDone({ ...base, read: true, isTool: false, used: false })).toBe(true);
		expect(isDone({ ...base, read: true, isTool: true, used: false })).toBe(false);
		expect(isDone({ ...base, read: true, isTool: true, used: true })).toBe(true);
	});
});

describe("classify", () => {
	const rules = DEFAULT_SETTINGS.categories;
	it("ドメイン（サブドメイン含む）", () => {
		expect(classify("x", "https://www.youtube.com/watch?v=1", rules)).toBe("動画");
		expect(classify("x", "https://m.youtube.com/watch?v=1", rules)).toBe("動画");
		expect(classify("x", "https://notyoutube.com/", rules)).toBeNull();
	});
	it("キーワード", () => {
		expect(classify("簡単レシピ 10 選", "https://blog.example.com", rules)).toBe("レシピ");
	});
	it("ルール文字列のパース", () => {
		expect(parseCategoryRules("# comment\n趣味 | a.com, b.com | 釣り、キャンプ\n")).toEqual([
			{ name: "趣味", domains: ["a.com", "b.com"], keywords: ["釣り", "キャンプ"] },
		]);
	});
});

describe("tool detection", () => {
	it("ドメイン・パス・キーワード", () => {
		expect(detectToolByRules("Foo", "https://apps.apple.com/jp/app/foo/id1", toolRules)).toBe(true);
		expect(detectToolByRules("Foo", "https://chrome.google.com/webstore/detail/x", toolRules)).toBe(true);
		expect(detectToolByRules("Foo", "https://chrome.google.com/search", toolRules)).toBe(false);
		expect(detectToolByRules("Foo", "https://github.com/a/b/releases/tag/v1", toolRules)).toBe(true);
		expect(detectToolByRules("Foo", "https://example.com/download", toolRules)).toBe(true);
		expect(detectToolByRules("Foo をダウンロード", "https://example.com/", toolRules)).toBe(true);
		expect(detectToolByRules("ニュース記事", "https://example.com/news/1", toolRules)).toBe(false);
	});
	it("HTML", () => {
		expect(detectToolFromHtml('<a href="/files/setup-1.2.exe">x</a>')).toBe(true);
		expect(detectToolFromHtml("<button>Download for Mac</button>")).toBe(true);
		expect(detectToolFromHtml("<p>普通の記事</p>")).toBe(false);
		expect(extractTitle("<title>\n A &amp; B </title>")).toBe("A & B");
	});
});

describe("normalizeUrl", () => {
	it("トラッキングパラメータ・www・末尾スラッシュ・hash を無視", () => {
		expect(normalizeUrl("https://www.example.com/a/?utm_source=x&id=1#top")).toBe(normalizeUrl("https://example.com/a?id=1"));
	});
});

describe("カテゴリの手動変更", () => {
	const rules = [
		{ name: "開発", domains: ["github.com"], keywords: ["漫画"] },
		{ name: "動画", domains: ["youtube.com"], keywords: [] },
	];

	it("ドメインを移し、既存ルールから外す", () => {
		const next = assignDomain(rules, "github.com", "動画");
		expect(next[0].domains).toEqual([]);
		expect(next[1].domains).toEqual(["youtube.com", "github.com"]);
		expect(rules[0].domains).toEqual(["github.com"]);
	});

	it("存在しないカテゴリは末尾に作る", () => {
		const next = assignDomain(rules, "comic-action.com", "マンガ");
		expect(next.at(-1)).toEqual({ name: "マンガ", domains: ["comic-action.com"], keywords: [] });
	});

	it("null なら外すだけ", () => {
		expect(assignDomain(rules, "github.com", null).flatMap((r) => r.domains)).toEqual(["youtube.com"]);
	});

	it("学習したドメインは前のルールのキーワードより優先される", () => {
		const next = assignDomain(rules, "comic-action.com", "マンガ");
		expect(classify("第2話 漫画", "https://comic-action.com/episode/1", next)).toBe("マンガ");
	});

	it("エントリ行から URL を取り出す", () => {
		expect(urlFromEntryLine("- [ ] [A \\[b\\]](https://a.com/x) (2026-09-25) #tool")).toBe("https://a.com/x");
		expect(urlFromEntryLine("\t- [ ] 使用済み")).toBeNull();
		expect(urlFromEntryLine("## 開発")).toBeNull();
	});
});
