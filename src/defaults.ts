import type { CategoryRule } from "./core";

export interface ReadLaterSettings {
	inboxFolder: string;
	listPath: string;
	archivePath: string;
	defaultCategory: string;
	/** ツール判定されたエントリを入れるカテゴリ。空なら通常ルールで分類 */
	toolCategory: string;
	usedLabel: string;
	categories: CategoryRule[];
	toolDomains: string[];
	toolUrlPatterns: string[];
	toolKeywords: string[];
	fetchPage: boolean;
	autoProcess: boolean;
}

export const DEFAULT_SETTINGS: ReadLaterSettings = {
	inboxFolder: "ReadLater/Inbox",
	listPath: "ReadLater/ReadLater.md",
	archivePath: "ReadLater/Archive.md",
	defaultCategory: "未分類",
	toolCategory: "ツール",
	usedLabel: "使用済み",
	categories: [
		{ name: "開発", domains: ["github.com", "gitlab.com", "stackoverflow.com", "qiita.com", "zenn.dev", "dev.to", "developer.mozilla.org", "docs.python.org"], keywords: ["API", "SDK", "プログラミング", "TypeScript", "Python", "Rust"] },
		{ name: "AI", domains: ["openai.com", "anthropic.com", "huggingface.co", "arxiv.org"], keywords: ["LLM", "GPT", "Claude", "生成AI", "機械学習"] },
		{ name: "動画", domains: ["youtube.com", "youtu.be", "nicovideo.jp", "vimeo.com", "tver.jp"], keywords: [] },
		{ name: "SNS", domains: ["x.com", "twitter.com", "instagram.com", "threads.net", "reddit.com", "bsky.app", "note.com"], keywords: [] },
		{ name: "ニュース", domains: ["nhk.or.jp", "nikkei.com", "asahi.com", "yomiuri.co.jp", "itmedia.co.jp", "gigazine.net", "news.yahoo.co.jp", "bbc.com", "reuters.com", "theverge.com"], keywords: ["ニュース"] },
		{ name: "買い物", domains: ["amazon.co.jp", "amazon.com", "rakuten.co.jp", "item.rakuten.co.jp", "mercari.com", "shopping.yahoo.co.jp", "kakaku.com"], keywords: [] },
		{ name: "レシピ", domains: ["cookpad.com", "kurashiru.com", "delishkitchen.tv"], keywords: ["レシピ"] },
	],
	toolDomains: [
		"apps.apple.com",
		"play.google.com",
		"chromewebstore.google.com",
		"chrome.google.com/webstore",
		"addons.mozilla.org",
		"apps.microsoft.com",
		"marketplace.visualstudio.com",
		"sourceforge.net",
		"vector.co.jp",
		"forest.watch.impress.co.jp",
		"f-droid.org",
		"itch.io",
		"obsidian.md/plugins",
		"formulae.brew.sh",
	],
	toolUrlPatterns: ["/releases(/|$)", "/downloads?(/|$|\\.)", "/install(/|$)"],
	toolKeywords: ["download", "ダウンロード", "インストール", "App Store", "Google Play", "Chrome ウェブストア", "Chrome Web Store", "フリーソフト", "freeware", "窓の杜"],
	fetchPage: true,
	autoProcess: true,
};
