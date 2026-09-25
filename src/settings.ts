import { App, PluginSettingTab, Setting } from "obsidian";
import { formatCategoryRules, parseCategoryRules } from "./core";
import type { ReadLaterSettings } from "./defaults";
import type ReadLaterPlugin from "./main";

export class ReadLaterSettingTab extends PluginSettingTab {
	constructor(app: App, private plugin: ReadLaterPlugin) {
		super(app, plugin);
	}

	display(): void {
		const { containerEl } = this;
		const s = this.plugin.settings;
		containerEl.empty();

		const text = (name: string, desc: string, key: "inboxFolder" | "listPath" | "archivePath" | "defaultCategory" | "toolCategory" | "usedLabel") =>
			new Setting(containerEl)
				.setName(name)
				.setDesc(desc)
				.addText((t) =>
					t.setValue(s[key]).onChange(async (v) => {
						s[key] = v.trim();
						await this.plugin.saveSettings();
					}),
				);

		text("Inbox フォルダ", "ショートカットがファイルを保存するフォルダ", "inboxFolder");
		text("リストファイル", "カテゴリ別チェックリストの保存先", "listPath");
		text("アーカイブファイル", "「完了済みをアーカイブ」で移動する先", "archivePath");
		text("既定カテゴリ", "どのルールにも一致しない場合", "defaultCategory");
		text("ツールカテゴリ", "ツール判定されたものを入れるカテゴリ。空欄なら通常ルールで分類", "toolCategory");
		text("使用済みラベル", "ツールに付くサブチェックボックスの文言", "usedLabel");

		new Setting(containerEl)
			.setName("自動取り込み")
			.setDesc("Inbox にファイルが追加されたら自動でリストへ取り込む")
			.addToggle((t) =>
				t.setValue(s.autoProcess).onChange(async (v) => {
					s.autoProcess = v;
					await this.plugin.saveSettings();
				}),
			);

		new Setting(containerEl)
			.setName("手動分類を学習")
			.setDesc("「カテゴリを変更」で移動したとき、そのドメインをカテゴリルールに追加し、次回から自動で同じカテゴリに入れる")
			.addToggle((t) =>
				t.setValue(s.learnDomain).onChange(async (v) => {
					s.learnDomain = v;
					await this.plugin.saveSettings();
				}),
			);

		new Setting(containerEl)
			.setName("ページを取得して判定")
			.setDesc("取り込み時にページを取得し、タイトル補完とダウンロードリンク検出を行う（通信が発生する）")
			.addToggle((t) =>
				t.setValue(s.fetchPage).onChange(async (v) => {
					s.fetchPage = v;
					await this.plugin.saveSettings();
				}),
			);

		containerEl.createEl("h3", { text: "カテゴリルール" });
		new Setting(containerEl)
			.setName("ルール")
			.setDesc("1 行 1 カテゴリ: カテゴリ名 | ドメイン, … | キーワード, …（上から順に判定。キーワードはタイトルと URL に部分一致）")
			.addTextArea((t) => {
				t.inputEl.rows = 12;
				t.inputEl.style.width = "100%";
				t.setValue(formatCategoryRules(s.categories)).onChange(async (v) => {
					s.categories = parseCategoryRules(v);
					await this.plugin.saveSettings();
				});
			});

		containerEl.createEl("h3", { text: "ツール判定" });
		const list = (name: string, desc: string, key: "toolDomains" | "toolUrlPatterns" | "toolKeywords") =>
			new Setting(containerEl)
				.setName(name)
				.setDesc(desc)
				.addTextArea((t) => {
					t.inputEl.rows = 6;
					t.setValue(s[key].join("\n")).onChange(async (v) => {
						s[key] = v.split("\n").map((x) => x.trim()).filter(Boolean);
						await this.plugin.saveSettings();
					});
				});
		list("ドメイン", "1 行 1 件。example.com/path のようにパス前方一致も可", "toolDomains");
		list("URL パス正規表現", "1 行 1 件。URL のパス部分に対して判定", "toolUrlPatterns");
		list("タイトルキーワード", "1 行 1 件", "toolKeywords");
	}
}
