# セレクタ設定システム仕様書

## 1. 概要

このシステムは、ChatGPT / Claude / Gemini などの AI チャット画面で生成されるマークダウンコンテンツの要素セレクタを、ユーザーが Chrome 拡張機能のポップアップから動的に更新・管理できるようにするものです。

AI サービスの UI 変更に対応する際、コード修正なしで設定変更のみで対応できることを目的としています。

## 2. 目的

- **非開発者向け対応**: コード変更なしにセレクタルール更新可能
- **柔軟な対応**: AI サービスの仕様変更時に迅速に対応
- **テスト機能**: セレクタが正しく動作するか事前検証
- **複数サービス対応**: ChatGPT, Claude, Gemini それぞれに異なるセレクタに対応

## 3. スコープ

### 対象範囲
- マークダウンコンテンツの抽出
- コンテンツ要素の見出し・階層構造の検出
- セレクタルールの管理・保存・更新

### 対象外
- マークダウン解析エンジンの仕様変更
- コンテンツの変換・加工ロジック
- WordPress への投稿機能

## 4. 用語定義

| 用語 | 説明 |
|------|------|
| **セレクタ** | CSS セレクタ構文で記述した要素選択ルール（例: `div.content > span.text`) |
| **パス** | ネストされた要素に到達するまでのセレクタの組み合わせ |
| **スキーマ** | 特定のサービス（ChatGPT など）向けのセレクタルール集合 |
| **フォールバック** | セレクタが失敗した場合の代替ルール |
| **バージョン** | スキーマの変更履歴を管理するための識別子 |

## 5. 全体アーキテクチャ

```
┌─────────────────────────────────────────────────────────┐
│  Chrome 拡張機能 - ポップアップUI                        │
│  ┌─────────────────────────────────────────────────┐    │
│  │ セレクタ設定タブ                                  │    │
│  │ ├─ サービス選択                                 │    │
│  │ ├─ セレクタ入力フォーム                        │    │
│  │ ├─ テスト & プレビュー                         │    │
│  │ └─ 保存                                        │    │
│  └─────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────┘
            │
            │ (Storage API)
            ▼
┌─────────────────────────────────────────────────────────┐
│  Chrome Storage (chrome.storage.local)                   │
│  ┌─────────────────────────────────────────────────┐    │
│  │ selectorSchemas: {                              │    │
│  │   "chatgpt": { ... },                           │    │
│  │   "claude": { ... },                            │    │
│  │   "gemini": { ... }                             │    │
│  │ }                                               │    │
│  └─────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────┘
            │
            │ (Content Script)
            ▼
┌─────────────────────────────────────────────────────────┐
│  content.js - セレクタ実行エンジン                       │
│  ┌─────────────────────────────────────────────────┐    │
│  │ スキーマに基づいて動的にセレクタを実行       │    │
│  │ マークダウン要素を抽出                         │    │
│  └─────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────┘
```

## 6. ポップアップ UI 仕様

### 6.1 レイアウト

```html
┌─────────────────────────────────────────────┐
│  ブログ投稿アシスタント - セレクタ設定      │
├─────────────────────────────────────────────┤
│ 【タブ】                                    │
│  [基本設定] [セレクタ設定] [テスト] [ログ] │
├─────────────────────────────────────────────┤
│ 【コンテンツ】                              │
│                                             │
│ サービス選択: [ChatGPT ▼]                  │
│                                             │
│ 現在のバージョン: 1.0 (2026-01-16)         │
│                                             │
│ ┌─────────────────────────────────────────┐│
│ │ セレクタルール設定                       ││
│ │                                         ││
│ │ ルール名: [       ] *必須                ││
│ │ セレクタ: [                ] *必須      ││
│ │ タイプ: [テキスト抽出 ▼]                 ││
│ │ 説明:   [                    ]         ││
│ │ フォールバック: [    ] (別セレクタ)    ││
│ │                                         ││
│ │ [プレビュー] [テスト実行]                ││
│ └─────────────────────────────────────────┘│
│                                             │
│ ┌─────────────────────────────────────────┐│
│ │ ルール一覧                               ││
│ │ ✓ articleHeading    (H1,H2,H3...)      ││
│ │ ✓ markdownContent   (span.text)        ││
│ │ ✓ codeBlock         (pre, code)        ││
│ │ ✓ listItems         (ul > li)          ││
│ └─────────────────────────────────────────┘│
│                                             │
│ [キャンセル]      [保存]                    │
└─────────────────────────────────────────────┘
```

### 6.2 セレクタ設定画面の入力項目

| フィールド | 型 | 必須 | 説明 |
|-----------|-----|------|------|
| `ruleName` | string | ✓ | ルール識別子（英数字とアンダースコア） |
| `selector` | string | ✓ | CSS セレクタ（複数指定可: `selector1, selector2`) |
| `type` | enum | ✓ | 抽出タイプ：`text` \| `html` \| `attribute` \| `count` |
| `attributeName` | string | ○ | `type: "attribute"` の場合は属性名必須 |
| `description` | string | × | ルール説明 |
| `fallback` | string | × | フォールバックセレクタ |
| `enabled` | boolean | × | ルール有効/無効フラグ（デフォルト: true） |
| `priority` | number | × | 複数マッチ時の優先度（0-100、高いほど優先） |

### 6.3 テスト実行機能

```
┌──────────────────────────────────────────┐
│ セレクタテスト実行                        │
├──────────────────────────────────────────┤
│ [テスト実行] ボタン → 以下の処理:       │
│                                          │
│ 1. 現在のページでセレクタを実行          │
│ 2. マッチ数をカウント                    │
│ 3. 最初の3件をプレビュー表示             │
│ 4. 成功/失敗を表示                       │
│                                          │
│ 【結果】                                 │
│ ✓ マッチ数: 5件                          │
│ ✓ セレクタ: span.text                   │
│                                          │
│ 【プレビュー（最初の3件）】               │
│ ─────────────────────────────────────   │
│ 1. "## 方向性（ざっくり設計）"           │
│ 2. "読者：病院で「異常なし」でも腰がつ...│
│ 3. "ゴール：原因の見立てが整理できて..."  │
│                                          │
│ [ルール編集に戻る]                       │
└──────────────────────────────────────────┘
```

## 7. データ構造仕様

### 7.1 ストレージフォーマット

```javascript
// chrome.storage.local に保存
{
  "selectorSchemas": {
    "chatgpt": {
      "version": "1.0",
      "lastUpdated": "2026-01-16T10:30:00Z",
      "service": "chatgpt",
      "rules": [
        {
          "ruleName": "articleHeading",
          "selector": "article h1, article h2, article h3, article h4, article h5, article h6",
          "type": "text",
          "description": "チャットの見出し要素",
          "fallback": "article > div > span:first-child",
          "enabled": true,
          "priority": 100
        },
        {
          "ruleName": "markdownContent",
          "selector": "span:not([data-testid])",
          "type": "text",
          "description": "マークダウンテキスト",
          "fallback": "div[role] > generic",
          "enabled": true,
          "priority": 90
        },
        {
          "ruleName": "codeBlock",
          "selector": "pre code, code.hljs",
          "type": "html",
          "description": "コードブロック",
          "fallback": "pre",
          "enabled": true,
          "priority": 95
        }
      ]
    },
    "claude": {
      "version": "1.0",
      "lastUpdated": "2026-01-16T10:30:00Z",
      "service": "claude",
      "rules": [
        // Claude 用ルール
      ]
    },
    "gemini": {
      "version": "1.0",
      "lastUpdated": "2026-01-16T10:30:00Z",
      "service": "gemini",
      "rules": [
        // Gemini 用ルール
      ]
    }
  }
}
```

### 7.2 各ルールオブジェクトの詳細

```typescript
interface SelectorRule {
  // 基本情報
  ruleName: string;           // ルール識別子（ユニーク）
  selector: string;            // CSS セレクタ（複数指定可）
  type: 'text' | 'html' | 'attribute' | 'count';
  attributeName?: string;      // type が 'attribute' の場合のみ

  // 説明・管理
  description?: string;        // ルールの説明
  enabled: boolean;            // 有効/無効フラグ
  priority: number;            // 優先度（0-100）

  // フォールバック
  fallback?: string;           // セレクタが失敗時の代替ルール
  maxRetries?: number;         // 再試行回数

  // メタデータ
  createdAt?: string;          // ISO 8601 形式
  updatedAt?: string;          // ISO 8601 形式
  author?: string;             // ルール作成者
}

interface SelectorSchema {
  version: string;             // スキーマバージョン（SemVer）
  lastUpdated: string;         // 最終更新日（ISO 8601）
  service: 'chatgpt' | 'claude' | 'gemini';
  rules: SelectorRule[];
}
```

## 8. 実行フロー

### 8.1 セレクタ設定の保存フロー

```
┌─────────────────────────────┐
│ ユーザーが設定を入力        │
└────────┬────────────────────┘
         │
         ▼
┌─────────────────────────────┐
│ バリデーション              │
│ ✓ 必須項目確認              │
│ ✓ セレクタ構文確認          │
│ ✓ ruleName ユニーク確認    │
└────────┬────────────────────┘
         │
     NG ├─→ エラーメッセージ表示
         │   (retry)
         │
     OK │
         ▼
┌─────────────────────────────┐
│ テスト実行（自動）          │
│ ✓ セレクタが有効か確認      │
│ ✓ マッチ数をカウント        │
└────────┬────────────────────┘
         │
     警告 ├─→ ユーザー確認
         │   "マッチなし。続行？"
         │
     OK │
         ▼
┌─────────────────────────────┐
│ Storage に保存              │
│ ✓ スキーマ更新              │
│ ✓ バージョン increment      │
│ ✓ lastUpdated 更新         │
└────────┬────────────────────┘
         │
         ▼
┌─────────────────────────────┐
│ 完了通知表示                │
│ "設定を保存しました"        │
└─────────────────────────────┘
```

### 8.2 content.js でのセレクタ実行フロー

```
┌──────────────────────────────┐
│ コンテンツスクリプト起動    │
└────────┬─────────────────────┘
         │
         ▼
┌──────────────────────────────┐
│ サービス判定                 │
│ ✓ URL から service 判定      │
│   (chatgpt.com → 'chatgpt')  │
└────────┬─────────────────────┘
         │
         ▼
┌──────────────────────────────┐
│ Storage からスキーマ取得    │
│ ✓ 該当サービスのルール読込  │
└────────┬─────────────────────┘
         │
         ▼
┌──────────────────────────────┐
│ ルール実行（優先度順）      │
│ ・rule.enabled === true      │
│ ・priority 高い順に実行      │
└────────┬─────────────────────┘
         │
         ▼
┌──────────────────────────────┐
│ セレクタクエリ実行          │
│ try:                         │
│   document.querySelectorAll()│
│ catch:                       │
│   fallback セレクタ実行     │
└────────┬─────────────────────┘
         │
     失敗 ├─→ 次ルール試行
         │
     成功 │
         ▼
┌──────────────────────────────┐
│ 結果を type に応じて抽出    │
│ ✓ text: textContent         │
│ ✓ html: innerHTML           │
│ ✓ attr: getAttribute()      │
│ ✓ count: length             │
└────────┬─────────────────────┘
         │
         ▼
┌──────────────────────────────┐
│ マークダウンオブジェクト生成│
│ ✓ 構造化した結果を返す      │
└──────────────────────────────┘
```

## 9. エラーハンドリング

### 9.1 セレクタ設定時のエラー

| エラー | 原因 | 対応 |
|-------|------|------|
| `INVALID_SELECTOR_SYNTAX` | CSS 構文エラー | 修正提案を表示 |
| `DUPLICATE_RULE_NAME` | ルール名が重複 | 別の名前を使用 |
| `EMPTY_SELECTOR` | セレクタが空 | 入力必須 |
| `INVALID_ATTRIBUTE_NAME` | 属性名が無効 | 有効な属性名を確認 |
| `PRIORITY_OUT_OF_RANGE` | priority が 0-100 外 | 範囲内の値に修正 |

### 9.2 セレクタ実行時のエラー

```javascript
try {
  const elements = document.querySelectorAll(rule.selector);
  if (elements.length === 0 && rule.fallback) {
    // フォールバック実行
    console.warn(`Fallback triggered for rule: ${rule.ruleName}`);
    const fallbackElements = document.querySelectorAll(rule.fallback);
    return extractContent(fallbackElements, rule.type);
  }
  return extractContent(elements, rule.type);
} catch (error) {
  console.error(`Selector error in rule ${rule.ruleName}:`, error);
  // フォールバック試行
  if (rule.fallback) {
    try {
      return document.querySelectorAll(rule.fallback);
    } catch (fallbackError) {
      // ルールスキップ
      return [];
    }
  }
  return [];
}
```

## 10. 実装例

### 10.1 セレクタ設定例 - ChatGPT

```javascript
{
  "chatgpt": {
    "version": "2.0",
    "lastUpdated": "2026-01-16T15:00:00Z",
    "service": "chatgpt",
    "rules": [
      {
        "ruleName": "responseHeadings",
        "selector": "span:contains('##'), span:contains('###'), span:contains('####'), span:contains('#####')",
        "type": "text",
        "description": "マークダウン見出し（##, ###, ####, #####）",
        "fallback": "span[role='none']",
        "enabled": true,
        "priority": 100,
        "createdAt": "2026-01-16T10:00:00Z"
      },
      {
        "ruleName": "paragraphs",
        "selector": "span:not(:contains('##')):not(:contains('###')):not(:empty)",
        "type": "text",
        "description": "段落テキスト",
        "fallback": "div[role] > generic",
        "enabled": true,
        "priority": 80
      },
      {
        "ruleName": "listItems",
        "selector": "span:contains('- '), span:contains('1. '), span:contains('2. ')",
        "type": "text",
        "description": "リストアイテム",
        "fallback": null,
        "enabled": true,
        "priority": 85
      }
    ]
  }
}
```

### 10.2 ポップアップ操作例

```
1. 拡張機能アイコンをクリック
2. [セレクタ設定] タブを選択
3. サービス選択で [ChatGPT] を選択
4. [+ 新規ルール] をクリック
5. 以下を入力:
   - ルール名: paragraphText
   - セレクタ: span.text-base
   - タイプ: テキスト抽出
   - フォールバック: div > span
6. [テスト実行] をクリック → マッチ数が表示される
7. [保存] をクリック → 即座に反映される
```

## 11. バージョン管理戦略

### 11.1 スキーマバージョンの管理

```
バージョン形式: Major.Minor.Patch (SemVer)

- Major: セレクタ構造が大きく変わった時
  例) 1.0.0 → 2.0.0 (html.textContent → span.textContent)

- Minor: 新しいルールが追加された時
  例) 1.0.0 → 1.1.0 (codeBlock ルール追加)

- Patch: ルールの微調整（フォールバック追加など）
  例) 1.0.0 → 1.0.1 (fallback セレクタ追加)
```

### 11.2 バージョン履歴表示

```
ポップアップに以下を表示:
─────────────────────────────
現在のバージョン: 2.1.0
最終更新: 2026-01-16 15:30:00
前バージョン: 2.0.5 (2026-01-15)

📋 更新履歴:
▼ v2.1.0 (2026-01-16)
  - リストアイテム検出ルール追加
  - codeBlock セレクタ更新

▼ v2.0.5 (2026-01-15)
  - フォールバックセレクタ追加

[履歴の詳細を表示]
─────────────────────────────
```

## 12. セキュリティ考慮事項

### 12.1 セレクタの検証

```javascript
// 危険なセレクタのブロック
const dangerousPatterns = [
  /javascript:/i,
  /onerror/i,
  /onclick/i,
  /script/i
];

function validateSelector(selector) {
  for (const pattern of dangerousPatterns) {
    if (pattern.test(selector)) {
      throw new Error('Invalid selector pattern detected');
    }
  }
  // CSS セレクタ構文チェック
  try {
    document.querySelector(selector);
    return true;
  } catch (e) {
    throw new Error('Invalid CSS selector syntax');
  }
}
```

### 12.2 ストレージの暗号化

- 機密情報（API キーなど）はセレクタに含めない
- ストレージ内容は定期的にバックアップ
- ユーザー確認なしに自動更新しない

## 13. ロギング & デバッグ

### 13.1 ログレベル

| レベル | 用途 |
|-------|------|
| `DEBUG` | セレクタ実行詳細、マッチ要素数 |
| `INFO` | ルール実行開始/終了 |
| `WARN` | フォールバック実行、マッチなし |
| `ERROR` | セレクタ構文エラー、ルール実行失敗 |

### 13.2 ログ出力例

```
[INFO] 2026-01-16 15:30:00 - Service detected: chatgpt
[INFO] 2026-01-16 15:30:00 - Schema loaded: chatgpt v2.1.0
[DEBUG] 2026-01-16 15:30:00 - Rule: responseHeadings (priority: 100)
[DEBUG] 2026-01-16 15:30:00 - Selector: span:contains('##')
[DEBUG] 2026-01-16 15:30:00 - Matched: 15 elements
[INFO] 2026-01-16 15:30:00 - Extraction completed: 15 headings found
```

## 14. テスト仕様

### 14.1 単体テスト項目

- [ ] セレクタの CSS 構文検証
- [ ] ルール名のユニーク性検証
- [ ] priority の範囲チェック
- [ ] フォールバック機能
- [ ] マルチセレクタ対応（`,` で区切られたセレクタ）
- [ ] type に応じた抽出（text, html, attr, count）

### 14.2 統合テスト項目

- [ ] Storage からのスキーマ読み込み
- [ ] content.js でのセレクタ実行
- [ ] サービス判定の正確性
- [ ] エラー発生時のフォールバック動作
- [ ] 複数ルール同時実行時の優先度順序

## 15. 移行手順

### 15.1 既存実装からの移行

```javascript
// Before: content.js で直接セレクタハードコード
const headings = document.querySelectorAll('article h1, article h2, article h3');

// After: ストレージからセレクタを動的に取得
chrome.storage.local.get('selectorSchemas', (data) => {
  const schema = data.selectorSchemas[detectedService];
  const headingRule = schema.rules.find(r => r.ruleName === 'articleHeading');
  const headings = document.querySelectorAll(headingRule.selector);
});
```

### 15.2 バージョン管理

- 古いセレクタルールは互換性のため保持
- major バージョン変更時のみ破壊的変更を許可
- 移行ガイドをドキュメント化

## 16. FAQ & トラブルシューティング

### Q: セレクタが反応しません

**A:** 以下を確認してください:
1. セレクタテスト実行で「マッチなし」が表示されるか
2. CSS セレクタの構文が正しいか（ブラウザの DevTools で確認）
3. ターゲット要素が実際に DOM に存在するか
4. フォールバックセレクタは設定されているか

### Q: 複数ページで異なるセレクタが必要です

**A:** `priority` を使用して同一ルール内で複数セレクタを指定:
```
selector: "span.text-base, div.markdown, article > span"
priority: 100  // 最初にマッチしたセレクタを使用
```

### Q: セレクタの更新が反映されません

**A:** 以下を確認してください:
1. ポップアップで「保存」をクリックしたか
2. ページをリロードしたか
3. ブラウザコンソールにエラーがないか

---

**最終更新日**: 2026-01-16
**バージョン**: 1.0
**作成者**: ブログ投稿アシスタント開発チーム
