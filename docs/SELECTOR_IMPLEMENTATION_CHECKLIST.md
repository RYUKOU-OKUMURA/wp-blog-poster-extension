# セレクタ設定システム実装チェックリスト

## フェーズ 1: ポップアップUI開発 ✅ 実装完了

### 1.1 HTML 構造
- [x] セレクタ設定タブのHTML作成
- [x] サービス選択ドロップダウン実装
  - [x] ChatGPT
  - [x] Claude
  - [x] Gemini
- [x] セレクタルール入力フォーム実装
  - [x] ruleName テキスト入力
  - [x] selector テキスト入力（複数行対応）
  - [x] type セレクト（text, html, attribute, count）
  - [x] attributeName テキスト入力（条件付き表示）
  - [x] description テキスト入力
  - [x] fallback テキスト入力
  - [x] enabled チェックボックス
  - [x] priority スライダー（0-100）
- [x] ルール一覧テーブル
  - [x] ルール名
  - [x] セレクタ（省略表示）
  - [x] 有効/無効ステータス
  - [x] 編集・削除ボタン

### 1.2 CSS スタイリング
- [x] レスポンシブレイアウト（ポップアップサイズ: 450x600px）
- [x] フォーム要素のスタイリング
- [x] ボタンデザイン
  - [x] プライマリボタン（保存）
  - [x] セカンダリボタン（テスト実行）
  - [x] 削除ボタン（警告色）
- [x] バリデーションエラーメッセージ表示
- [x] ローディング状態の表示
- [x] トグルペインアニメーション

### 1.3 JavaScript (popup.js/selector-manager.js) - UI ロジック ✅ 完了
- [x] サービス選択時のスキーマロード機能
- [x] フォーム入力値の取得・検証
  - [x] 必須項目チェック
  - [x] CSS セレクタ構文検証
  - [x] ruleName ユニーク性チェック
- [x] 条件付きフィールド表示
  - [x] `type === 'attribute'` で attributeName 表示
- [x] priority スライダーの値表示更新
- [x] ルール追加/編集/削除機能
- [x] クリア・キャンセル機能
- [x] フォーム状態の管理（dirty flag）

---

## フェーズ 2: テスト実行エンジン ✅ 実装完了

### 2.1 テスト実行ボタン機能
- [x] 現在のタブで content.js と通信
- [x] test 結果を受け取る
- [x] マッチ数を表示
- [x] マッチ要素のプレビュー表示（最初の3件）
- [x] エラーハンドリング表示

### 2.2 プレビュー表示
- [x] テキスト抽出プレビュー
- [x] HTML 抽出プレビュー（エスケープ処理）
- [x] 属性値プレビュー
- [x] カウント結果表示
- [x] スクロール可能な表示領域

---

## フェーズ 3: ストレージ管理 ✅ 実装完了

### 3.1 Storage API の実装
- [x] 初期スキーマの作成・保存
- [x] スキーマの読み込み機能
- [x] スキーマの保存機能
- [x] バージョンの自動インクリメント
- [x] lastUpdated タイムスタンプの自動更新
- [x] Storage 容量チェック

### 3.2 データバリデーション
- [x] スキーマの型チェック
- [x] ルールの整合性チェック
- [x] 破壊的変更の検出

### 3.3 バックアップ・復元機能
- [ ] JSON 形式でのエクスポート（将来実装）
- [ ] JSON のインポート機能（将来実装）
- [ ] 復元時の検証（将来実装）

---

## フェーズ 4: Content Script (content.js) 実装 ✅ 実装完了

### 4.1 サービス判定機能
- [x] URL パターンマッチング
- [x] 判定結果の キャッシング（パフォーマンス）

### 4.2 ストレージからスキーマ取得
- [x] `chrome.storage.local.get()` で スキーマ取得
- [x] 対応するサービスのスキーマ選択
- [x] ルールの優先度順ソート

### 4.3 セレクタ実行エンジン
- [x] ルールの反復処理（優先度順）
- [x] `document.querySelectorAll()` 実行
- [x] エラー時のフォールバック処理
- [x] ルールの disabled 状態チェック

### 4.4 コンテンツ抽出
- [x] `type` に応じた抽出処理
  - [x] `type: 'text'` → `textContent`
  - [x] `type: 'html'` → `innerHTML`
  - [x] `type: 'attribute'` → `getAttribute()`
  - [x] `type: 'count'` → `length`
- [x] 空要素のフィルタリング
- [x] テキストのトリム処理

### 4.5 メッセージハンドリング
- [x] ポップアップからの `TEST_SELECTOR` メッセージ受け取り
- [x] バックグラウンドスクリプトからのルール更新通知受け取り

### 4.6 パフォーマンス最適化
- [x] セレクタ実行結果のメモ化
- [x] DOM クエリの頻度制限
- [x] オフスクリーン要素の除外オプション

---

## フェーズ 5: バックグラウンドスクリプト (background.js) ✅ 実装完了

### 5.1 メッセージハンドリング
- [x] ポップアップからのルール保存リクエスト受け取り
- [x] Content Script への更新通知送信
- [x] エラーログの記録

### 5.2 バージョン管理
- [x] バージョン変更の検出
- [x] 移行スクリプトの実行（major version up 時）

---

## フェーズ 6: バリデーション & エラーハンドリング ✅ 実装完了

### 6.1 セレクタバリデーション
- [x] CSS セレクタ構文チェック
- [x] 危険なパターンの検出

### 6.2 フォームバリデーション
- [x] ruleName の空チェック
  - [x] 英数字とアンダースコアのみ許可
  - [x] 先頭は英文字のみ
- [x] selector の空チェック
- [x] type が有効な値か確認
- [x] attributeName（type が 'attribute' の場合）の空チェック
- [x] priority が 0-100 の範囲か

### 6.3 エラーメッセージ
- [x] 日本語の明確なエラーメッセージ
- [x] 修正方法のヒント提示
- [x] エラーのログ記録

---

## フェーズ 7: ドキュメント & ヘルプ

### 7.1 UI内ヘルプ
- [ ] 各フィールドにツールチップ表示
- [ ] セレクタ例のプリセット表示
- [ ] よくある間違いの注記

### 7.2 ドキュメント
- [ ] セレクタ書き方ガイド
- [ ] サービス別のセレクタ例集
- [ ] トラブルシューティング

### 7.3 動画チュートリアル
- [ ] セレクタ設定の基本
- [ ] テスト実行の方法
- [ ] エラー対応

---

## フェーズ 8: テスト & QA

### 8.1 単体テスト
- [ ] Selector バリデーション
  ```javascript
  test('validateSelector', () => {
    assert(validateSelector('span.text'));
    assert(!validateSelector('invalid {{}}'));
  });
  ```
- [ ] ルール優先度ソート
- [ ] コンテンツ抽出ロジック

### 8.2 統合テスト
- [ ] 各サービス（ChatGPT, Claude, Gemini）でのテスト
- [ ] セレクタ更新から反映までの流れ
- [ ] フォールバック動作確認
- [ ] 複数ルール同時実行

### 8.3 UI テスト
- [ ] ポップアップの表示確認
- [ ] フォーム入力の反応性
- [ ] テスト実行ボタンの動作
- [ ] 保存・キャンセルボタンの動作

### 8.4 互換性テスト
- [ ] Chrome の複数バージョン
- [ ] 複数の OS（Windows, Mac, Linux）

---

## フェーズ 9: デプロイ & リリース

### 9.1 本番環境チェック
- [ ] manifest.json の確認
- [ ] permission の最小化
- [ ] 不要なコードの削除

### 9.2 リリースノート作成
- [ ] 新機能説明
- [ ] 使用方法
- [ ] 既知の制限事項

### 9.3 リリース手順
- [ ] Chrome Web Store へ登録
- [ ] バージョン管理（git tag）
- [ ] ユーザーへの通知

---

## 進捗追跡テンプレート

```
【フェーズ 1: ポップアップUI開発】
進捗: 40% (5/12)

[x] HTML 構造
  [x] セレクタ設定タブ
  [x] サービス選択
  [ ] セレクタルール入力フォーム
  [ ] ルール一覧テーブル

[ ] CSS スタイリング
[ ] JavaScript (popup.js) - UI ロジック

【フェーズ 2: テスト実行エンジン】
進捗: 0% (0/2)

[ ] テスト実行ボタン機能
[ ] プレビュー表示

---

**全体進捗**: 16% (5/31)
**最終更新**: 2026-01-16
**担当**: [チーム名]
```

---

## 補足: セレクタ設定例集

### ChatGPT 用セレクタ

```javascript
{
  ruleName: "markdownHeadings",
  selector: "span:contains('##'), span:contains('###'), span:contains('####'), span:contains('#####')",
  type: "text",
  description: "マークダウン見出し",
  fallback: "span[role='none']",
  priority: 100
}
```

### Claude 用セレクタ

```javascript
{
  ruleName: "aiResponse",
  selector: "div[role='article'] p, div[role='article'] span",
  type: "text",
  description: "Claude の回答テキスト",
  fallback: "div.message-text",
  priority: 100
}
```

### Gemini 用セレクタ

```javascript
{
  ruleName: "modelResponse",
  selector": "div[data-message-role='assistant'] p, div[data-message-role='assistant'] span",
  type: "text",
  description: "Gemini の回答テキスト",
  fallback: "div.response-text",
  priority: 100
}
```

---

**作成日**: 2026-01-16
**更新日**: 2026-01-16
