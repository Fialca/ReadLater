// Obsidian API に依存しない純粋ロジック（パース・分類・描画）。テスト対象。

export interface CategoryRule {
	name: string;
	domains: string[];
	keywords: string[];
}

export interface ToolRules {
	domains: string[];
	urlPatterns: string[];
	keywords: string[];
}

export interface Entry {
	title: string;
	url: string;
	date: string;
	read: boolean;
	isTool: boolean;
	used: boolean;
	category: string;
	/** リンクと日付以外の、行末に付いていたテキスト（ユーザーのメモなど） */
	extra: string;
	/** エントリ配下のインデント行（使用済みチェックボックス以外） */
	children: string[];
}

export interface ListDocument {
	header: string[];
	entries: Entry[];
	/** ファイル上に現れた見出しの順序（手動で作ったカテゴリも保持する） */
	categoryOrder: string[];
}

export const TOOL_TAG = "#tool";

const DATE_RE = /\d{4}-\d{2}-\d{2}/;
const URL_RE = /https?:\/\/[^\s<>"'）)]+/;

// ---------- Inbox（ショートカットが書き出すファイル）のパース ----------

/**
 * ショートカットが保存したテキストからエントリを取り出す。
 * 受け付ける形式:
 *   1. key: value 形式（url: / title: / date:）。複数件は空行か --- で区切る
 *   2. Markdown チェックリスト行 `- [ ] [タイトル](URL) (日付)`
 *   3. URL だけの行
 */
export function parseInbox(content: string, fallbackDate: string): Array<Pick<Entry, "title" | "url" | "date">> {
	const results: Array<Pick<Entry, "title" | "url" | "date">> = [];
	const blocks = content.replace(/\r\n?/g, "\n").split(/\n\s*(?:---+)?\s*\n/);

	for (const block of blocks) {
		const kv = parseKeyValueBlock(block);
		if (kv) {
			results.push({ title: kv.title, url: kv.url, date: kv.date || fallbackDate });
			continue;
		}
		for (const line of block.split("\n")) {
			const trimmed = line.trim();
			if (!trimmed) continue;
			const link = parseLinkLine(trimmed.replace(/^[-*]\s+(\[[ xX]\]\s+)?/, ""));
			if (link) {
				results.push({ title: link.title, url: link.url, date: link.date || fallbackDate });
				continue;
			}
			const m = trimmed.match(URL_RE);
			if (m) {
				const date = trimmed.match(DATE_RE)?.[0];
				results.push({ title: "", url: m[0], date: date || fallbackDate });
			}
		}
	}
	return results;
}

function parseKeyValueBlock(block: string): { url: string; title: string; date: string } | null {
	const fields: Record<string, string> = {};
	for (const line of block.split("\n")) {
		const m = line.match(/^\s*(url|title|date)\s*[:：]\s*(.*)$/i);
		if (m) fields[m[1].toLowerCase()] = m[2].trim();
	}
	const url = fields.url?.match(URL_RE)?.[0];
	if (!url) return null;
	return {
		url,
		title: fields.title ?? "",
		date: fields.date?.match(DATE_RE)?.[0] ?? "",
	};
}

/** `[title](url) rest` を分解する。title 内の `]` / `(` にも耐えるよう最後の `](http` で区切る。 */
function parseLinkLine(text: string): { title: string; url: string; date: string; rest: string } | null {
	const m = text.match(/^\[(.*)\]\(<?(https?:\/\/[^\s>]+?)>?\)(.*)$/);
	if (!m) return null;
	const rest = m[3];
	return {
		title: unescapeTitle(m[1]),
		url: m[2],
		date: rest.match(DATE_RE)?.[0] ?? "",
		rest,
	};
}

// ---------- リストファイルのパース / 描画 ----------

const ENTRY_RE = /^[-*] \[([ xX])\] (.*)$/;
const CHILD_CHECK_RE = /^\s+[-*] \[([ xX])\] (.*)$/;

export function parseList(content: string, usedLabel: string, defaultCategory: string): ListDocument {
	const doc: ListDocument = { header: [], entries: [], categoryOrder: [] };
	let category: string | null = null;
	let last: Entry | null = null;

	for (const line of content.replace(/\r\n?/g, "\n").split("\n")) {
		const heading = line.match(/^##\s+(.+?)\s*$/);
		if (heading) {
			category = heading[1];
			if (!doc.categoryOrder.includes(category)) doc.categoryOrder.push(category);
			last = null;
			continue;
		}
		if (category === null) {
			doc.header.push(line);
			continue;
		}

		const em = line.match(ENTRY_RE);
		const link = em ? parseLinkLine(em[2]) : null;
		if (em && link) {
			let rest = link.rest;
			const hasToolTag = new RegExp(`(^|\\s)${escapeRegExp(TOOL_TAG)}(?=\\s|$)`).test(rest);
			rest = rest
				.replace(new RegExp(`(^|\\s)${escapeRegExp(TOOL_TAG)}(?=\\s|$)`, "g"), " ")
				.replace(/\(\d{4}-\d{2}-\d{2}\)|\d{4}-\d{2}-\d{2}/, " ");
			last = {
				title: link.title,
				url: link.url,
				date: link.date,
				read: em[1] !== " ",
				isTool: hasToolTag,
				used: false,
				category: category || defaultCategory,
				extra: rest.replace(/\s+/g, " ").trim(),
				children: [],
			};
			doc.entries.push(last);
			continue;
		}

		if (!line.trim()) continue;

		if (last && /^\s/.test(line)) {
			const cm = line.match(CHILD_CHECK_RE);
			if (cm && cm[2].trim() === usedLabel) {
				last.isTool = true;
				last.used = cm[1] !== " ";
			} else {
				last.children.push(line);
			}
			continue;
		}

		// カテゴリ直下の自由記述行は直前のエントリに付けて消さないようにする
		if (last) {
			last.children.push("\t" + line.trim());
		} else {
			// エントリより前のメモ行はヘッダー扱いで保持
			doc.header.push(line);
		}
	}
	return doc;
}

export interface RenderOptions {
	usedLabel: string;
	defaultCategory: string;
	/** 設定上のカテゴリ順（先頭から並ぶ） */
	preferredOrder: string[];
}

export function renderList(doc: ListDocument, opts: RenderOptions): string {
	const groups = new Map<string, Entry[]>();
	for (const e of doc.entries) {
		const list = groups.get(e.category) ?? [];
		list.push(e);
		groups.set(e.category, list);
	}

	const order: string[] = [];
	const pushCat = (c: string) => {
		if (groups.has(c) && !order.includes(c) && c !== opts.defaultCategory) order.push(c);
	};
	opts.preferredOrder.forEach(pushCat);
	doc.categoryOrder.forEach(pushCat);
	[...groups.keys()].sort().forEach(pushCat);
	if (groups.has(opts.defaultCategory)) order.push(opts.defaultCategory);

	const header = trimBlankEdges(doc.header);
	const out: string[] = header.length ? [...header, ""] : ["# Read Later", ""];

	for (const cat of order) {
		const entries = sortEntries(groups.get(cat)!);
		out.push(`## ${cat}`);
		out.push("");
		for (const e of entries) out.push(...renderEntry(e, opts.usedLabel));
		out.push("");
	}
	return out.join("\n").replace(/\n+$/, "\n");
}

export function renderEntry(e: Entry, usedLabel: string): string[] {
	const parts = [`- [${e.read ? "x" : " "}] [${escapeTitle(e.title || e.url)}](${e.url})`];
	if (e.date) parts.push(`(${e.date})`);
	if (e.isTool) parts.push(TOOL_TAG);
	if (e.extra) parts.push(e.extra);
	const lines = [parts.join(" ")];
	if (e.isTool) lines.push(`\t- [${e.used ? "x" : " "}] ${usedLabel}`);
	lines.push(...e.children);
	return lines;
}

/** 未読を上、既読を下。それぞれ日付の新しい順（同日は元の順序を維持）。 */
function sortEntries(entries: Entry[]): Entry[] {
	return entries
		.map((e, i) => ({ e, i }))
		.sort((a, b) => {
			if (a.e.read !== b.e.read) return a.e.read ? 1 : -1;
			if (a.e.date !== b.e.date) return a.e.date < b.e.date ? 1 : -1;
			return a.i - b.i;
		})
		.map((x) => x.e);
}

/** 既読かつ（ツールなら使用済み）のエントリ */
export function isDone(e: Entry): boolean {
	return e.read && (!e.isTool || e.used);
}

// ---------- 分類 ----------

export function classify(title: string, url: string, rules: CategoryRule[]): string | null {
	const host = hostOf(url);
	const lowerTitle = title.toLowerCase();
	const lowerUrl = url.toLowerCase();
	// ドメイン一致をキーワード一致より優先する（手動で学習させたドメインが確実に効くように）
	for (const rule of rules) {
		if (rule.domains.some((d) => matchDomain(host, lowerUrl, d))) return rule.name;
	}
	for (const rule of rules) {
		if (rule.keywords.some((k) => k && (lowerTitle.includes(k.toLowerCase()) || lowerUrl.includes(k.toLowerCase())))) {
			return rule.name;
		}
	}
	return null;
}

/**
 * ドメインを指定カテゴリのルールへ移す（他のルールからは外す）。
 * category が null なら外すだけ。ルールが無ければ末尾に作る。
 */
export function assignDomain(rules: CategoryRule[], host: string, category: string | null): CategoryRule[] {
	const next = rules.map((r) => ({ ...r, domains: r.domains.filter((d) => d.toLowerCase() !== host) }));
	if (!category || !host) return next;
	const target = next.find((r) => r.name === category);
	if (target) target.domains.push(host);
	else next.push({ name: category, domains: [host], keywords: [] });
	return next;
}

/** リスト上の 1 行からエントリの URL を取り出す */
export function urlFromEntryLine(line: string): string | null {
	const m = line.match(ENTRY_RE);
	if (!m) return null;
	return parseLinkLine(m[2])?.url ?? null;
}

export function detectToolByRules(title: string, url: string, rules: ToolRules): boolean {
	const host = hostOf(url);
	const lowerUrl = url.toLowerCase();
	if (rules.domains.some((d) => matchDomain(host, lowerUrl, d))) return true;
	let path = "";
	try {
		path = new URL(url).pathname.toLowerCase();
	} catch {
		/* noop */
	}
	if (rules.urlPatterns.some((p) => p && safeRegExp(p)?.test(path))) return true;
	const lowerTitle = title.toLowerCase();
	return rules.keywords.some((k) => k && lowerTitle.includes(k.toLowerCase()));
}

const BINARY_LINK_RE = /href\s*=\s*["'][^"']+\.(exe|msi|dmg|pkg|appimage|deb|rpm|apk|zip|7z|tar\.gz)(\?[^"']*)?["']/i;
const DOWNLOAD_TEXT_RE = /(download\s+(for|now|latest|free)|ダウンロード(する|はこちら|ページ)|無料ダウンロード|get\s+it\s+on\s+google\s+play|download\s+on\s+the\s+app\s+store)/i;

/** ページ HTML からダウンロードサイトらしさを判定する */
export function detectToolFromHtml(html: string): boolean {
	return BINARY_LINK_RE.test(html) || DOWNLOAD_TEXT_RE.test(stripTags(html));
}

export function extractTitle(html: string): string {
	const og = html.match(/<meta[^>]+property=["']og:title["'][^>]*content=["']([^"']*)["']/i)?.[1];
	const t = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
	return decodeEntities((t || og || "").replace(/\s+/g, " ").trim());
}

// ---------- 設定テキスト <-> ルール ----------

/** 1 行 1 ルール: `カテゴリ名 | ドメイン,ドメイン | キーワード,キーワード` */
export function parseCategoryRules(text: string): CategoryRule[] {
	return text
		.split("\n")
		.map((l) => l.trim())
		.filter((l) => l && !l.startsWith("#"))
		.map((l) => {
			const [name, domains = "", keywords = ""] = l.split("|").map((s) => s.trim());
			return { name, domains: splitList(domains), keywords: splitList(keywords) };
		})
		.filter((r) => r.name);
}

export function formatCategoryRules(rules: CategoryRule[]): string {
	return rules.map((r) => `${r.name} | ${r.domains.join(", ")} | ${r.keywords.join(", ")}`).join("\n");
}

export function splitList(s: string): string[] {
	return s
		.split(/[,\n、]/)
		.map((x) => x.trim())
		.filter(Boolean);
}

// ---------- ユーティリティ ----------

/** 重複判定用の URL 正規化（#fragment・utm_* ・末尾スラッシュ・www. を無視） */
export function normalizeUrl(url: string): string {
	try {
		const u = new URL(url);
		u.hash = "";
		for (const key of [...u.searchParams.keys()]) {
			if (/^(utm_|fbclid$|gclid$|ref_src$)/i.test(key)) u.searchParams.delete(key);
		}
		const host = u.hostname.replace(/^www\./, "").toLowerCase();
		const path = u.pathname.replace(/\/+$/, "");
		return `${host}${path}${u.search}`;
	} catch {
		return url.trim();
	}
}

export function hostOf(url: string): string {
	try {
		return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
	} catch {
		return "";
	}
}

/** `example.com` はサブドメインも含めて一致。`example.com/path` はパス前方一致。 */
function matchDomain(host: string, lowerUrl: string, pattern: string): boolean {
	const p = pattern.toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "");
	if (!p) return false;
	const slash = p.indexOf("/");
	if (slash === -1) return host === p || host.endsWith("." + p);
	const domain = p.slice(0, slash);
	if (!(host === domain || host.endsWith("." + domain))) return false;
	const rest = lowerUrl.replace(/^https?:\/\/(www\.)?/, "");
	return rest.slice(rest.indexOf("/")).startsWith(p.slice(slash));
}

function safeRegExp(p: string): RegExp | null {
	try {
		return new RegExp(p, "i");
	} catch {
		return null;
	}
}

function escapeRegExp(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function escapeTitle(t: string): string {
	return t.replace(/\s+/g, " ").replace(/([[\]])/g, "\\$1");
}

function unescapeTitle(t: string): string {
	return t.replace(/\\([[\]])/g, "$1");
}

function stripTags(html: string): string {
	return html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ");
}

function decodeEntities(s: string): string {
	return s
		.replace(/&amp;/g, "&")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&#39;|&apos;/g, "'")
		.replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));
}

function trimBlankEdges(lines: string[]): string[] {
	let s = 0;
	let e = lines.length;
	while (s < e && !lines[s].trim()) s++;
	while (e > s && !lines[e - 1].trim()) e--;
	return lines.slice(s, e);
}

/** ローカル時刻の YYYY-MM-DD */
export function formatDate(d: Date): string {
	const pad = (n: number) => String(n).padStart(2, "0");
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
