import {
	App,
	Editor,
	MarkdownFileInfo,
	MarkdownView,
	Notice,
	Plugin,
	SuggestModal,
	TAbstractFile,
	TFile,
	TFolder,
	debounce,
	normalizePath,
	requestUrl,
} from "obsidian";
import {
	Entry,
	ListDocument,
	assignDomain,
	classify,
	detectToolByRules,
	detectToolFromHtml,
	extractTitle,
	formatDate,
	hostOf,
	isDone,
	normalizeUrl,
	parseInbox,
	parseList,
	renderEntry,
	renderList,
	urlFromEntryLine,
} from "./core";
import { DEFAULT_SETTINGS, ReadLaterSettings } from "./defaults";
import { ReadLaterSettingTab } from "./settings";

const FETCH_TIMEOUT_MS = 8000;
const FETCH_MAX_CHARS = 500_000;

export default class ReadLaterPlugin extends Plugin {
	settings!: ReadLaterSettings;
	private running = false;
	private rerun = false;
	private unparsable = new Set<string>();

	private scheduleProcess = debounce(() => void this.processInbox(), 2000, true);

	async onload() {
		await this.loadSettings();
		this.addSettingTab(new ReadLaterSettingTab(this.app, this));

		this.addCommand({
			id: "process-inbox",
			name: "Inbox を取り込む",
			callback: () => void this.processInbox(true),
		});
		this.addCommand({
			id: "reorganize",
			name: "リストを再整理（並び替えのみ）",
			callback: () => void this.rewriteList(false),
		});
		this.addCommand({
			id: "reclassify-all",
			name: "全件を再分類",
			callback: () => void this.rewriteList(true),
		});
		this.addCommand({
			id: "archive-done",
			name: "完了済みをアーカイブ",
			callback: () => void this.archiveDone(),
		});

		this.addCommand({
			id: "change-category",
			name: "カテゴリを変更",
			editorCheckCallback: (checking, editor, ctx) => {
				if (ctx.file?.path !== normalizePath(this.settings.listPath)) return false;
				const url = urlAtCursor(editor);
				if (!url) return false;
				if (!checking) void this.pickCategory(url, ctx);
				return true;
			},
		});
		this.registerEvent(
			this.app.workspace.on("editor-menu", (menu, editor, ctx) => {
				if (ctx.file?.path !== normalizePath(this.settings.listPath)) return;
				const url = urlAtCursor(editor);
				if (!url) return;
				menu.addItem((item) =>
					item
						.setTitle("カテゴリを変更")
						.setIcon("folder-input")
						.onClick(() => void this.pickCategory(url, ctx)),
				);
			}),
		);

		this.app.workspace.onLayoutReady(() => {
			void this.ensureInboxFolder();
			// 起動時のファイル走査で create イベントが大量に来るため、登録はレイアウト完成後に行う
			const onChange = (f: TAbstractFile) => {
				if (this.settings.autoProcess && this.isInboxFile(f)) this.scheduleProcess();
			};
			this.registerEvent(this.app.vault.on("create", onChange));
			this.registerEvent(this.app.vault.on("modify", onChange));
			this.registerEvent(this.app.vault.on("rename", onChange));
			if (this.settings.autoProcess) void this.processInbox();
		});

		// iCloud の同期がイベントを取りこぼした場合の保険
		this.registerInterval(
			window.setInterval(() => {
				if (this.settings.autoProcess) void this.processInbox();
			}, 5 * 60 * 1000),
		);
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	private isInboxFile(f: TAbstractFile): f is TFile {
		const folder = normalizePath(this.settings.inboxFolder);
		return f instanceof TFile && f.path.startsWith(folder + "/") && ["md", "txt"].includes(f.extension);
	}

	private inboxFiles(): TFile[] {
		const folder = this.app.vault.getAbstractFileByPath(normalizePath(this.settings.inboxFolder));
		if (!(folder instanceof TFolder)) return [];
		const files: TFile[] = [];
		const walk = (dir: TFolder) => {
			for (const c of dir.children) {
				if (c instanceof TFolder) walk(c);
				else if (this.isInboxFile(c)) files.push(c);
			}
		};
		walk(folder);
		return files.sort((a, b) => a.stat.ctime - b.stat.ctime);
	}

	/** Inbox のファイルを読み、分類してリストに追記し、取り込んだファイルを削除する */
	async processInbox(manual = false): Promise<void> {
		if (this.running) {
			this.rerun = true;
			return;
		}
		this.running = true;
		try {
			const files = this.inboxFiles();
			if (!files.length) {
				if (manual) new Notice("ReadLater: Inbox は空です");
				return;
			}

			// ページ取得に時間がかかるため、先に新規エントリを組み立ててからリストを原子的に更新する
			const known = new Set((await this.readList()).entries.map((e) => normalizeUrl(e.url)));
			const built: Entry[] = [];
			const consumed: TFile[] = [];
			for (const file of files) {
				const content = await this.app.vault.read(file);
				// iCloud からの同期途中で空のことがある。次回に回す
				if (!content.trim()) continue;
				const fallbackDate = formatDate(new Date(file.stat.ctime));
				const items = parseInbox(content, fallbackDate);
				// URL を読み取れないファイルは消さずに残して知らせる
				if (!items.length) {
					if (!this.unparsable.has(file.path)) {
						this.unparsable.add(file.path);
						new Notice(`ReadLater: URL を読み取れませんでした: ${file.path}`);
					}
					continue;
				}
				for (const item of items) {
					const key = normalizeUrl(item.url);
					if (known.has(key)) continue;
					known.add(key);
					built.push(await this.buildEntry(item.title, item.url, item.date));
				}
				consumed.push(file);
			}

			let added = 0;
			if (built.length) {
				await this.updateList((doc) => {
					const current = new Set(doc.entries.map((e) => normalizeUrl(e.url)));
					for (const e of built) {
						if (current.has(normalizeUrl(e.url))) continue;
						doc.entries.push(e);
						added++;
					}
				});
			}
			for (const f of consumed) await this.app.vault.delete(f);
			if (added || manual) new Notice(`ReadLater: ${added} 件追加しました`);
		} catch (e) {
			console.error("ReadLater: processInbox failed", e);
			new Notice(`ReadLater: 取り込みに失敗しました: ${(e as Error).message}`);
		} finally {
			this.running = false;
			if (this.rerun) {
				this.rerun = false;
				void this.processInbox();
			}
		}
	}

	private async buildEntry(title: string, url: string, date: string): Promise<Entry> {
		const s = this.settings;
		let isTool = detectToolByRules(title, url, { domains: s.toolDomains, urlPatterns: s.toolUrlPatterns, keywords: s.toolKeywords });

		if (s.fetchPage && (!title || !isTool)) {
			const html = await fetchHtml(url);
			if (html) {
				if (!title) title = extractTitle(html);
				if (!isTool) isTool = detectToolFromHtml(html);
			}
		}

		return {
			title: title || url,
			url,
			date,
			read: false,
			isTool,
			used: false,
			category: this.categorize(title, url, isTool),
			extra: "",
			children: [],
		};
	}

	private categorize(title: string, url: string, isTool: boolean): string {
		const s = this.settings;
		if (isTool && s.toolCategory) return s.toolCategory;
		return classify(title, url, s.categories) ?? s.defaultCategory;
	}

	/** リストを読み直して書き戻す。reclassify=true なら全件のカテゴリとツール判定をやり直す */
	async rewriteList(reclassify: boolean): Promise<void> {
		const s = this.settings;
		await this.updateList((doc) => {
			if (!reclassify) return;
			for (const e of doc.entries) {
				e.isTool = e.isTool || detectToolByRules(e.title, e.url, { domains: s.toolDomains, urlPatterns: s.toolUrlPatterns, keywords: s.toolKeywords });
				e.category = this.categorize(e.title, e.url, e.isTool);
			}
		});
		new Notice(reclassify ? "ReadLater: 再分類しました" : "ReadLater: 再整理しました");
	}

	/** カテゴリ一覧を出して、選ばれたカテゴリへエントリを移す */
	private async pickCategory(url: string, ctx: MarkdownView | MarkdownFileInfo): Promise<void> {
		// エディタ上の未保存の変更を先に書き出しておく
		if (ctx instanceof MarkdownView) await ctx.save();
		const s = this.settings;
		const doc = await this.readList();
		const current = doc.entries.find((e) => normalizeUrl(e.url) === normalizeUrl(url))?.category;
		const names = [...s.categories.map((c) => c.name), s.toolCategory, ...doc.categoryOrder, s.defaultCategory];
		const choices = [...new Set(names.filter((n) => n && n !== current))];
		new CategoryModal(this.app, choices, current, (c) => void this.changeCategory(url, c)).open();
	}

	private async changeCategory(url: string, category: string): Promise<void> {
		const s = this.settings;
		const key = normalizeUrl(url);
		await this.updateList((doc) => {
			const e = doc.entries.find((x) => normalizeUrl(x.url) === key);
			if (!e) return;
			e.category = category;
			if (category === s.toolCategory) e.isTool = true;
		});

		const host = hostOf(url);
		const learnable = s.learnDomain && host && category !== s.toolCategory;
		if (learnable) {
			s.categories = assignDomain(s.categories, host, category === s.defaultCategory ? null : category);
			await this.saveSettings();
		}
		new Notice(
			learnable && category !== s.defaultCategory
				? `ReadLater: 「${category}」に移動し、${host} を学習しました`
				: `ReadLater: 「${category}」に移動しました`,
		);
	}

	/** 既読（ツールは使用済みも）のエントリをアーカイブファイルへ移す */
	async archiveDone(): Promise<void> {
		let done: Entry[] = [];
		await this.updateList((doc) => {
			done = doc.entries.filter(isDone);
			doc.entries = doc.entries.filter((e) => !isDone(e));
		});
		if (!done.length) {
			new Notice("ReadLater: アーカイブ対象はありません");
			return;
		}

		const lines = [`## ${formatDate(new Date())} アーカイブ`, ""];
		for (const e of done) {
			const [first, ...rest] = renderEntry(e, this.settings.usedLabel);
			lines.push(`${first} #${e.category.replace(/\s+/g, "_")}`, ...rest);
		}
		const path = normalizePath(this.settings.archivePath);
		const existing = this.app.vault.getAbstractFileByPath(path);
		if (existing instanceof TFile) {
			await this.app.vault.process(existing, (c) => c.replace(/\n*$/, "\n\n") + lines.join("\n") + "\n");
		} else {
			await this.ensureParent(path);
			await this.app.vault.create(path, `# Archive\n\n${lines.join("\n")}\n`);
		}
		new Notice(`ReadLater: ${done.length} 件アーカイブしました`);
	}

	private async readList(): Promise<ListDocument> {
		const file = this.app.vault.getAbstractFileByPath(normalizePath(this.settings.listPath));
		const content = file instanceof TFile ? await this.app.vault.read(file) : "";
		return parseList(content, this.settings.usedLabel, this.settings.defaultCategory);
	}

	/** リストを読み→変更→書き戻しを 1 回の vault.process で行う（途中のユーザー編集を失わないため） */
	private async updateList(mutate: (doc: ListDocument) => void): Promise<void> {
		const s = this.settings;
		const apply = (content: string) => {
			const doc = parseList(content, s.usedLabel, s.defaultCategory);
			mutate(doc);
			return renderList(doc, {
				usedLabel: s.usedLabel,
				defaultCategory: s.defaultCategory,
				preferredOrder: [s.toolCategory, ...s.categories.map((c) => c.name)].filter(Boolean),
			});
		};
		const path = normalizePath(s.listPath);
		const file = this.app.vault.getAbstractFileByPath(path);
		if (file instanceof TFile) {
			await this.app.vault.process(file, apply);
		} else {
			await this.ensureParent(path);
			await this.app.vault.create(path, apply(""));
		}
	}

	/** ショートカットの保存先に指定できるよう Inbox フォルダを用意しておく */
	private async ensureInboxFolder(): Promise<void> {
		const folder = normalizePath(this.settings.inboxFolder);
		if (this.app.vault.getAbstractFileByPath(folder)) return;
		try {
			await this.ensureParent(folder);
			await this.app.vault.createFolder(folder);
		} catch (e) {
			console.error("ReadLater: failed to create inbox folder", e);
		}
	}

	private async ensureParent(path: string): Promise<void> {
		const dir = path.split("/").slice(0, -1).join("/");
		if (dir && !this.app.vault.getAbstractFileByPath(dir)) await this.app.vault.createFolder(dir);
	}
}

/** カーソル行（子行ならその親）のエントリ URL */
function urlAtCursor(editor: Editor): string | null {
	for (let i = editor.getCursor().line; i >= 0; i--) {
		const line = editor.getLine(i);
		const url = urlFromEntryLine(line);
		if (url) return url;
		// 子行（インデント）と空行以外に当たったらエントリ外
		if (line.trim() && !/^\s/.test(line)) return null;
	}
	return null;
}

class CategoryModal extends SuggestModal<string> {
	constructor(
		app: App,
		private categories: string[],
		current: string | undefined,
		private onChoose: (category: string) => void,
	) {
		super(app);
		this.setPlaceholder(current ? `現在: ${current}（選択、または新しいカテゴリ名を入力）` : "カテゴリを選択、または新しい名前を入力");
	}

	getSuggestions(query: string): string[] {
		const q = query.trim();
		const hits = this.categories.filter((c) => c.toLowerCase().includes(q.toLowerCase()));
		if (q && !this.categories.includes(q)) hits.push(q);
		return hits;
	}

	renderSuggestion(category: string, el: HTMLElement): void {
		el.setText(this.categories.includes(category) ? category : `＋ 新しいカテゴリ「${category}」`);
	}

	onChooseSuggestion(category: string): void {
		this.onChoose(category);
	}
}

async function fetchHtml(url: string): Promise<string | null> {
	try {
		const res = await Promise.race([
			requestUrl({ url, method: "GET", throw: false }),
			new Promise<null>((r) => window.setTimeout(() => r(null), FETCH_TIMEOUT_MS)),
		]);
		if (!res || res.status >= 400) return null;
		const type = res.headers["content-type"] ?? res.headers["Content-Type"] ?? "";
		if (type && !type.includes("html")) return null;
		return res.text.slice(0, FETCH_MAX_CHARS);
	} catch {
		return null;
	}
}
