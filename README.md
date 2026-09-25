# ReadLater Inbox

iPhone の Safari で開いているページを、共有シートのショートカットから iCloud 上の Obsidian vault に保存し、PC の Obsidian でカテゴリ別チェックリストとして読む仕組み。

```
iPhone Safari ─共有→ ショートカット ─iCloud Drive→ vault/ReadLater/Inbox/*.md
                                                        │
                           Obsidian（PC・iPhone どちらでも）のプラグインが検出
                                                        ▼
                                          vault/ReadLater/ReadLater.md
```

生成されるリストの例:

```markdown
# Read Later

## ツール

- [ ] [Foo - Mac App Store](https://apps.apple.com/jp/app/foo/id123) (2026-09-25) #tool
	- [ ] 使用済み

## 開発

- [ ] [anthropics/claude-code](https://github.com/anthropics/claude-code) (2026-09-24)
- [x] [TypeScript 7 の変更点](https://zenn.dev/xxx) (2026-09-20)

## 未分類

- [ ] [どのルールにも当たらなかったページ](https://example.com) (2026-09-23)
```

- 各行のチェック = 既読
- ツール（ダウンロードサイト）と判定されたものには `#tool` と「使用済み」のサブチェックが付く
- カテゴリ内は「未読 → 既読」、それぞれ日付の新しい順に自動で並ぶ

## 構成

| 役割 | 実体 |
|---|---|
| 保存 | iOS ショートカット（共有シートから起動） |
| 同期 | iCloud Drive（Obsidian vault を iCloud に置く） |
| 整理 | Obsidian プラグイン `ReadLater Inbox`（このリポジトリ） |

ショートカットは 1 件ごとに `ReadLater/Inbox/` へ別ファイルを保存する。1 つのファイルに追記する方式にしないのは、iPhone の追記と PC 側の書き換えが iCloud 上で衝突して内容が消えるのを避けるため。

## 1. プラグインのインストール

### iPhone だけで入れる（BRAT）

1. Obsidian（iPhone）→ 設定 → コミュニティプラグイン → 制限モードをオフ
2. 「閲覧」で `BRAT` を検索してインストール・有効化
3. BRAT の設定 → 「Add beta plugin」→ `Fialca/ReadLater` を入力して追加
4. コミュニティプラグイン一覧で `ReadLater Inbox` を有効化

BRAT は GitHub の Release から `main.js` / `manifest.json` を取得し、以後の更新も自動で取り込む。

### 手動で入れる（PC）

1. ビルド済みファイルを入手する
   - GitHub の Actions → `Build` の最新実行 → Artifacts の `readlater-inbox`、またはmain に入ると作られる Releases（タグ名 = manifest.json の version）から `main.js` と `manifest.json`
   - 自分でビルドする場合: `npm ci && npm run build`
2. vault 内に `.obsidian/plugins/readlater-inbox/` を作り、`main.js` と `manifest.json` を置く
3. Obsidian → 設定 → コミュニティプラグイン → 制限モードをオフ → `ReadLater Inbox` を有効化

vault の `.obsidian` も iCloud で同期されるので、PC で入れれば iPhone の Obsidian にも入る（有効化は端末ごとに必要な場合がある）。

## 2. iOS ショートカットの作成

ショートカット App で新規作成し、以下の順にアクションを並べる。

1. **ショートカットの詳細（ⓘ）**
   - 「共有シートに表示」をオン
   - 受け入れる入力: 「Safari Web ページ」と「URL」だけにする
2. **URL を取得**（入力: ショートカットの入力）
3. **名前を取得**（入力: ショートカットの入力）
   - Safari から実行するとページタイトルが取れる。取れない場合は空でよい（プラグインがページを取得して補完する）
4. **日付を書式設定**
   - 日付: 現在の日付 / 日付フォーマット: カスタム `yyyy-MM-dd`
5. **テキスト** に次を入力（`{}` は変数を挿入）
   ```
   url: {URL}
   title: {名前}
   date: {書式設定された日付}
   ```
6. **名前を設定**
   - 入力: 上のテキスト / 名前: `{現在の日付（カスタム yyyyMMdd-HHmmss）}.md`
7. **ファイルを保存**
   - 「保存先を尋ねる」をオフ
   - 保存先フォルダ: `iCloud Drive/Obsidian/<vault 名>/ReadLater/Inbox`
   - 「上書き」はオフ
8. （任意）**通知を表示**「保存しました」

使い方: Safari で共有ボタン → 作ったショートカットを選ぶ。

補足
- `ReadLater/Inbox` フォルダはプラグインが起動時に自動で作る。ショートカットの保存先はプラグインを有効化してから選ぶ。
- 「ファイルを保存」の保存先で vault フォルダを選べない場合は、iOS の「ファイル」App で iCloud Drive/Obsidian が表示されているか（iCloud Drive 同期がオンか）を確認する。
- key-value 形式以外に、`- [ ] [タイトル](URL)` 形式の行や URL だけの行も受け付ける。

## 3. 動作

- Inbox にファイルが増えると 2 秒後に取り込み、元ファイルは削除する。Obsidian 起動時と 5 分ごとにも確認する（iCloud の同期がファイルイベントを取りこぼす場合の保険）。
- すでにリストにある URL は追加しない（`utm_*`・`#hash`・`www.`・末尾 `/` の違いは同一扱い）。
- タイトルが無い場合、または URL/タイトルだけでツール判定できなかった場合は、ページを 1 回取得してタイトル補完とダウンロードリンク検出を行う（設定でオフにできる）。

### コマンド（コマンドパレット）

| コマンド | 内容 |
|---|---|
| Inbox を取り込む | 手動で取り込みを実行 |
| リストを再整理（並び替えのみ） | 既読を下に移すなどの並び替え。カテゴリは変えない |
| 全件を再分類 | 現在のルールで全件のカテゴリとツール判定をやり直す（手動で移したカテゴリも上書きされる） |
| カテゴリを変更 | カーソル行の項目のカテゴリを一覧から選んで変更（リストファイルを編集中のときのみ） |
| 完了済みをアーカイブ | 既読（ツールは使用済みも）の項目を `ReadLater/Archive.md` へ移す |

### カテゴリの変更（選択式）

リストの項目にカーソルを置き、コマンド「**カテゴリを変更**」を実行すると、カテゴリ一覧が出る。選ぶとその見出しの下へ移動する。一覧に無い名前を入力すれば新しいカテゴリを作れる。

- PC: 項目行を右クリック →「カテゴリを変更」でも可
- iPhone: 設定 → Toolbar（モバイルツールバー）に「ReadLater Inbox: カテゴリを変更」を追加しておくと、ボタン 1 つで開ける
- 設定「手動分類を学習」がオン（既定）の場合、そのドメインがカテゴリルールに追加され、次回から同じサイトは自動でそのカテゴリに入る。「未分類」へ移した場合はルールから外すだけ

### 手動での調整

- 項目を別の `## 見出し` の下へ移すと、そのカテゴリとして保持される（再分類コマンドを実行するまで）。
- 新しい `## 見出し` を自分で作ってもよい。
- 行末に `#tool` を付けると次回の整理で「使用済み」チェックが生える。
- 項目の行末に書いたメモや、項目の下にインデントして書いた行は保持される。

## 4. 分類ルール

設定 → ReadLater Inbox で編集する。

- カテゴリルール: 1 行 1 カテゴリで `カテゴリ名 | ドメイン, … | キーワード, …`。上から順に判定し、最初に一致したものを採用。ドメインはサブドメインも一致、`example.com/path` と書けばパス前方一致。キーワードはタイトルと URL の部分一致（大文字小文字無視）。
- ツール判定: 以下のどれかに該当すればツール扱い。ツールは「ツールカテゴリ」（既定 `ツール`、空欄なら通常ルールで分類）に入る。
  - ドメイン: App Store / Google Play / Chrome ウェブストア / VS Code Marketplace / SourceForge / Vector / 窓の杜 など
  - URL パス: `/releases`、`/download(s)`、`/install`
  - タイトル: 「ダウンロード」「download」「インストール」など
  - ページ内容: `.exe` `.dmg` `.msi` `.pkg` `.apk` `.zip` などへのリンク、または「Download for …」等の文言

GitHub のリポジトリトップはツール扱いにしていない（ライブラリや記事的なリポジトリも多いため）。ツールとして扱いたい場合は `#tool` を手で付けるか、ツール判定ドメインに `github.com` を追加する。

## 制約・注意

- Windows で iCloud 上の vault を使う場合は「iCloud for Windows」が必要。同期の遅延や `.icloud` プレースホルダ（未ダウンロード）の状態では取り込まれず、同期完了後に処理される。
- PC と iPhone の Obsidian を同時に開いていると、両方のプラグインが同じ Inbox を処理しようとする。URL の重複排除で二重登録はしないが、iCloud の競合コピー（`ReadLater 2.md` のようなファイル）ができる可能性はある。気になる場合は iPhone 側で設定の「自動取り込み」をオフにする。
- ページ取得はサイトによって失敗する（ログイン必須・ボット対策など）。失敗してもエントリは URL/タイトルだけで登録される。

## 開発

```sh
npm ci
npm test         # ロジックのユニットテスト
npm run build    # 型チェック + main.js 生成
npm run dev      # ウォッチビルド
```

- `src/core.ts` — パース・分類・描画（Obsidian 非依存）
- `src/main.ts` — プラグイン本体（Inbox 監視、ページ取得、ファイル更新）
- `src/defaults.ts` / `src/settings.ts` — 既定値と設定画面
