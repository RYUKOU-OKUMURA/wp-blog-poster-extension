# セレクタ設定システム実装チェックリスト

## フェーズ 1: ポップアップUI開発

### 1.1 HTML 構造
- [ ] セレクタ設定タブのHTML作成
- [ ] サービス選択ドロップダウン実装
  - [ ] ChatGPT
  - [ ] Claude
  - [ ] Gemini
- [ ] セレクタルール入力フォーム実装
  - [ ] ruleName テキスト入力
  - [ ] selector テキスト入力（複数行対応）
  - [ ] type セレクト（text, html, attribute, count）
  - [ ] attributeName テキスト入力（条件付き表示）
  - [ ] description テキスト入力
  - [ ] fallback テキスト入力
  - [ ] enabled チェックボックス
  - [ ] priority スライダー（0-100）
- [ ] ルール一覧テーブル
  - [ ] ルール名
  - [ ] セレクタ（省略表示）
  - [ ] 有効/無効ステータス
  - [ ] 編集・削除ボタン

### 1.2 CSS スタイリング
- [ ] レスポンシブレイアウト（ポップアップサイズ: 450x600px）
- [ ] フォーム要素のスタイリング
- [ ] ボタンデザイン
  - [ ] プライマリボタン（保存）
  - [ ] セカンダリボタン（テスト実行）
  - [ ] 削除ボタン（警告色）
- [ ] バリデーションエラーメッセージ表示
- [ ] ローディング状態の表示
- [ ] トグルペインアニメーション

### 1.3 JavaScript (popup.js) - UI ロジック
- [ ] サービス選択時のスキーマロード機能
- [ ] フォーム入力値の取得・検証
  - [ ] 必須項目チェック
  - [ ] CSS セレクタ構文検証
  - [ ] ruleName ユニーク性チェック
- [ ] 条件付きフィールド表示
  - [ ] `type === 'attribute'` で attributeName 表示
- [ ] priority スライダーの値表示更新
- [ ] ルール追加/編集/削除機能
- [ ] クリア・キャンセル機能
- [ ] フォーム状態の管理（dirty flag）

---

## フェーズ 2: テスト実行エンジン

### 2.1 テスト実行ボタン機能
- [ ] 現在のタブで content.js と通信
  ```javascript
  chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
    chrome.tabs.sendMessage(tabs[0].id, {
      type: 'TEST_SELECTOR',
      selector: formData.selector
    });
  });
  ```
- [ ] test 結果を受け取る
- [ ] マッチ数を表示
- [ ] マッチ要素のプレビュー表示（最初の3件）
- [ ] エラーハンドリング表示
  - [ ] "セレクタが無効です"
  - [ ] "マッチする要素がありません"
  - [ ] "このページで実行できません"

### 2.2 プレビュー表示
- [ ] テキスト抽出プレビュー
- [ ] HTML 抽出プレビュー（エスケープ処理）
- [ ] 属性値プレビュー
- [ ] カウント結果表示
- [ ] スクロール可能な表示領域

---

## フェーズ 3: ストレージ管理

### 3.1 Storage API の実装
- [ ] 初期スキーマの作成・保存
  ```javascript
  const defaultSchemas = {
    chatgpt: { version: '1.0', service: 'chatgpt', rules: [] },
    claude: { version: '1.0', service: 'claude', rules: [] },
    gemini: { version: '1.0', service: 'gemini', rules: [] }
  };
  ```
- [ ] スキーマの読み込み機能
- [ ] スキーマの保存機能
- [ ] バージョンの自動インクリメント
- [ ] lastUpdated タイムスタンプの自動更新
- [ ] Storage 容量チェック（Chrome Storage には容量制限あり）

### 3.2 データバリデーション
- [ ] スキーマの型チェック
- [ ] ルールの整合性チェック
- [ ] 破壊的変更の検出

### 3.3 バックアップ・復元機能
- [ ] JSON 形式でのエクスポート
  ```javascript
  const backup = JSON.stringify(data.selectorSchemas, null, 2);
  // ダウンロード処理
  ```
- [ ] JSON のインポート機能
- [ ] 復元時の検証

---

## フェーズ 4: Content Script (content.js) 実装

### 4.1 サービス判定機能
- [ ] URL パターンマッチング
  ```javascript
  const services = {
    'chatgpt.com': 'chatgpt',
    'chat.openai.com': 'chatgpt',
    'claude.ai': 'claude',
    'gemini.google.com': 'gemini'
  };
  ```
- [ ] 判定結果の キャッシング（パフォーマンス）

### 4.2 ストレージからスキーマ取得
- [ ] `chrome.storage.local.get()` で スキーマ取得
- [ ] 対応するサービスのスキーマ選択
- [ ] ルールの優先度順ソート

### 4.3 セレクタ実行エンジン
- [ ] ルールの反復処理（優先度順）
- [ ] `document.querySelectorAll()` 実行
- [ ] エラー時のフォールバック処理
  ```javascript
  try {
    elements = document.querySelectorAll(rule.selector);
  } catch (error) {
    if (rule.fallback) {
      elements = document.querySelectorAll(rule.fallback);
    }
  }
  ```
- [ ] ルールの disabled 状態チェック

### 4.4 コンテンツ抽出
- [ ] `type` に応じた抽出処理
  - [ ] `type: 'text'` → `textContent`
  - [ ] `type: 'html'` → `innerHTML`
  - [ ] `type: 'attribute'` → `getAttribute()`
  - [ ] `type: 'count'` → `length`
- [ ] 空要素のフィルタリング
- [ ] テキストのトリム処理

### 4.5 メッセージハンドリング
- [ ] ポップアップからの `TEST_SELECTOR` メッセージ受け取り
  ```javascript
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.type === 'TEST_SELECTOR') {
      const result = testSelector(request.selector);
      sendResponse({ success: true, data: result });
    }
  });
  ```
- [ ] バックグラウンドスクリプトからのルール更新通知受け取り

### 4.6 パフォーマンス最適化
- [ ] セレクタ実行結果のメモ化
- [ ] DOM クエリの頻度制限
- [ ] オフスクリーン要素の除外オプション

---

## フェーズ 5: バックグラウンドスクリプト (background.js)

### 5.1 メッセージハンドリング
- [ ] ポップアップからのルール保存リクエスト受け取り
- [ ] Content Script への更新通知送信
- [ ] エラーログの記録

### 5.2 バージョン管理
- [ ] バージョン変更の検出
- [ ] 移行スクリプトの実行（major version up 時）

---

## フェーズ 6: バリデーション & エラーハンドリング

### 6.1 セレクタバリデーション
- [ ] CSS セレクタ構文チェック
  ```javascript
  function validateSelector(selector) {
    try {
      document.querySelector(selector);
      return true;
    } catch (e) {
      return false;
    }
  }
  ```
- [ ] 危険なパターンの検出
  - [ ] `javascript:` を含む
  - [ ] `onerror`, `onclick` を含む
  - [ ] `<script>` を含む

### 6.2 フォームバリデーション
- [ ] ruleName の空チェック
  - [ ] 英数字とアンダースコアのみ許可
  - [ ] 先頭は英文字のみ
- [ ] selector の空チェック
- [ ] type が有効な値か確認
- [ ] attributeName（type が 'attribute' の場合）の空チェック
- [ ] priority が 0-100 の範囲か

### 6.3 エラーメッセージ
- [ ] 日本語の明確なエラーメッセージ
- [ ] 修正方法のヒント提示
- [ ] エラーのログ記録

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
