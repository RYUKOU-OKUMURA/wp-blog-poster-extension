# セレクタ書き方ガイド

このガイドは、Chrome 拡張機能のポップアップで有効なセレクタルールを作成するための実践的な手引きです。

## 目次

1. [CSS セレクタの基本](#css-セレクタの基本)
2. [各サービス別のセレクタ例](#各サービス別のセレクタ例)
3. [よくあるパターン](#よくあるパターン)
4. [トラブルシューティング](#トラブルシューティング)
5. [実践例](#実践例)

---

## CSS セレクタの基本

### セレクタの種類

| セレクタ | 説明 | 例 |
|---------|------|-----|
| **要素型** | 特定の HTML 要素を選択 | `p`, `div`, `span` |
| **クラス** | 特定のクラスを持つ要素を選択 | `.content`, `.text-base` |
| **ID** | 特定の ID を持つ要素を選択 | `#main`, `#article` |
| **属性** | 特定の属性を持つ要素を選択 | `[role="article"]`, `[data-test]` |
| **組み合わせ** | 複数の条件を組み合わせ | `div.content > span.text` |
| **疑似要素** | 特定の状態の要素を選択 | `:first-child`, `:not(.hidden)` |
| **OR 演算子** | いずれかにマッチする要素を選択 | `span, div, p` |

### よく使うセレクタ

```
// 直下の子要素
div > span

// すべての子孫要素
div span

// 隣接兄弟要素
h2 + p

// 一般兄弟要素
h2 ~ p

// 複数クラス
div.container.active

// 属性が特定の値を含む
[class*="text"]

// 属性の値が完全に一致
[role="article"]

// :not() で除外
span:not([data-test])

// :contains() で テキスト内容にマッチ（注：非標準だが使用例あり）
span:contains('##')
```

---

## 各サービス別のセレクタ例

### ChatGPT (chatgpt.com)

#### マークダウン見出しの抽出

**現在の推奨セレクタ（2026-01-16時点）:**

```
セレクタ: span
説明: マークダウン形式のすべてのテキスト

または

セレクタ: article span
説明: チャット記事内のテキスト
```

**見出し（##, ###, ####...）のみを抽出する場合:**

```javascript
// JavaScript で動的にフィルタリング
// type: "text" で textContent を取得した後、
// アプリケーション側で ## で始まるテキストをフィルタ

// または複数セレクタで複数ルール定義
セレクタ: span
type: text
fallback: div[role]
```

#### リストアイテムの抽出

```
セレクタ: span
説明: 段落、リストなど全テキスト

フォールバック: div.whitespace-pre-wrap
説明: 空白を保持する要素
```

**デバッグ方法:**
1. Chrome DevTools を開く（F12）
2. Elements タブで対象要素を選択
3. DevTools コンソールで以下を実行:
```javascript
document.querySelectorAll('span') // マッチ数を確認
document.querySelectorAll('span')[0].textContent // 最初の要素のテキストを確認
```

---

### Claude (claude.ai)

#### AI 回答テキストの抽出

```
セレクタ: div[role="article"] span
説明: 記事ロール内のテキスト

または

セレクタ: p
説明: 段落要素
```

#### マークダウン要素

Claude は `<code>` タグを使用することが多い:

```
コードブロック:
セレクタ: pre, code.hljs
type: html
説明: シンタックスハイライト付きコード

フォールバック: pre code
```

---

### Gemini (gemini.google.com)

#### テキスト抽出

```
セレクタ: div[data-message-role="assistant"] span
説明: アシスタント回答

または

セレクタ: div.response-content p
説明: 回答コンテンツ内の段落
```

#### コードブロック

```
セレクタ: pre[class*="language"], code.hljs
type: html
説明: コードブロック
```

---

## よくあるパターン

### パターン 1: 特定クラスを持つ要素のみ

```
✓ 正しい: div.markdown
✗ 間違い: div markdown (スペースは子孫セレクタを意味する)
```

**テスト方法:**
```javascript
// ポップアップコンソール または DevTools
document.querySelectorAll('.markdown') // マッチ数を確認
```

### パターン 2: 属性で要素を選択

```
// data-role="content" という属性を持つ要素
セレクタ: [data-role="content"]

// 属性の値に特定文字列を含む
セレクタ: [class*="text"]  // class に "text" を含む

// 属性の値が完全に一致
セレクタ: [role="article"]  // role が "article" の場合のみ
```

### パターン 3: 複数のセレクタを組み合わせ（OR 演算子）

```
セレクタ: h1, h2, h3, h4, h5, h6
説明: 任意の見出しレベルを選択

または

セレクタ: span.heading, div.headline, p.title
説明: 複数の方法で見出しを表現している場合
```

### パターン 4: 子要素の直接的な選択

```
// 直下の子要素のみ（孫要素は含まない）
セレクタ: article > span

// vs

// すべての子孫要素（孫もひ孫も含む）
セレクタ: article span
```

### パターン 5: 特定の状態の要素を除外

```
// hidden クラスを持たない要素
セレクタ: span:not(.hidden)

// 空でない要素
セレクタ: span:not(:empty)

// disabled 属性のない input
セレクタ: input:not([disabled])
```

### パターン 6: テキスト内容で フィルタリング

**注意: 下記は CSS 標準ではなく、jQuery や一部のブラウザ拡張機能でのみ対応**

```
// 非標準だが動く場合がある
セレクタ: span:contains("##")

// 代わりに、JavaScript 側でフィルタリングすることを推奨
// type: "text" で取得後、アプリ側で文字列チェック
```

---

## トラブルシューティング

### 「マッチする要素がありません」エラー

**原因と対策:**

1. **セレクタの構文エラー**
   ```
   ✗ 誤: div.class span  // スペースの位置が違う
   ✓ 正: div.class > span
   ```
   → DevTools コンソールでテスト: `document.querySelectorAll('セレクタ')`

2. **クラス名や属性が変わった**
   ```
   // 2026-01-15 時点
   div.content-text  // このクラスがあった

   // 2026-01-16 に UI 更新
   div.content-box   // クラス名が変わった
   ```
   → DevTools Elements タブで対象要素を右クリック → Copy selector

3. **要素が動的に生成される**
   ```
   // JavaScript で後から DOM に追加される場合、
   // ページロード直後はセレクタが動作しない
   ```
   → フォールバックセレクタを設定、または delay 設定を検討

4. **iFrame 内の要素**
   ```
   // iFrame 内の要素には直接アクセスできない
   セレクタ: iframe#content
   ```
   → iFrame 外のセレクタのみ指定可能

### セレクタが多くの不要な要素も取得する

**原因と対策:**

```
✗ 誤: span  // すべての span を取得

✓ 正: article span  // article 内の span のみ
✓ 正: span.text-base  // クラス指定で限定
✓ 正: span[role="article"]  // 属性指定で限定
```

### 特定のページでのみ失敗する

**対策:**

```
セレクタ: span.main-content, div.article span, .content > span
説明: 複数のセレクタを用意して、いずれかがマッチするようにする
```

---

## 実践例

### 例1: ChatGPT のマークダウン記事を完全抽出

**目標:** ChatGPT の回答からマークダウン形式の記事全体を取得

**セレクタ設定:**

```javascript
// ルール 1: 見出し（## から ##### まで）
{
  ruleName: "markdownHeadings",
  selector: "span",  // すべてのspan を取得
  type: "text",
  description: "マークダウン見出し（##, ###, ####, #####）",
  priority: 100,
  fallback: "div[role] > span"
}

// ルール 2: 段落テキスト
{
  ruleName: "paragraphs",
  selector: "span",
  type: "text",
  description: "段落テキスト",
  priority: 90,
  fallback: "div.whitespace-pre-wrap"
}

// ルール 3: コードブロック
{
  ruleName: "codeBlocks",
  selector": "pre code, code.hljs",
  type: "html",
  description: "シンタックスハイライト付きコード",
  priority: 95,
  fallback: "pre"
}

// ルール 4: リスト
{
  ruleName: "listItems",
  selector: "span",  // リスト記号を含むspan
  type: "text",
  description: "リストアイテム（- , 1. など）",
  priority: 85,
  fallback: null
}
```

**テスト実行:**
1. ポップアップで [テスト実行] をクリック
2. マッチ数: 50件 程度で OK（ページの内容量による）
3. プレビューに見出し、段落、コードが表示される

---

### 例2: Claude の回答を構造化して取得

**目標:** Claude の段落と見出しを別々に抽出

**セレクタ設定:**

```javascript
// ルール 1: 見出し
{
  ruleName: "aiHeadings",
  selector: "div[role='article'] > div > div:first-child",
  type: "text",
  description: "見出し要素",
  priority: 100,
  fallback: "h2, h3"
}

// ルール 2: 本文
{
  ruleName: "aiParagraphs",
  selector: "div[role='article'] p",
  type: "text",
  description: "段落",
  priority: 90,
  fallback: "div.message-content span"
}
```

---

### 例3: サービス間の差異に対応

**目標:** ChatGPT, Claude, Gemini で同じルール名を使いながら異なるセレクタを指定

**各スキーマで定義:**

```javascript
// ChatGPT スキーマ
{
  ruleName: "responseText",
  selector: "span",  // ChatGPT はspan
  priority: 100
}

// Claude スキーマ
{
  ruleName: "responseText",
  selector: "div[role='article'] span",  // Claude は div > span
  priority: 100
}

// Gemini スキーマ
{
  ruleName: "responseText",
  selector: "div[data-message-role='assistant'] span",  // Gemini は data属性
  priority: 100
}
```

**メリット:** アプリケーション側は常に `responseText` ルールを使用、自動的に適切なセレクタが実行される

---

## ベストプラクティス

### ✓ すべき事

1. **具体的で限定的なセレクタを使う**
   ```
   ✓ article > .content > span
   ✗ span
   ```

2. **フォールバックを常に用意**
   ```
   セレクタ: div.new-class
   フォールバック: div.old-class
   ```

3. **複数セレクタでカバー**
   ```
   セレクタ: .heading1, .heading2, .title, h2
   ```

4. **テスト実行で検証**
   - ルール保存前に必ずテスト実行
   - マッチ数が想定範囲か確認

5. **メモ・説明を記入**
   ```
   説明: "2026-01-16 UI 更新に対応。
           前セレクタ: span.text-base (廃止)
           新セレクタ: span (汎用)"
   ```

### ✗ するべきではない事

1. **スペースの混在**
   ```
   ✗ div. class  // スペースあり
   ✓ div.class
   ```

2. **存在しない要素を指定**
   ```
   ✗ articleHeading  // HTML要素ではない
   ✓ article-heading  // ハイフン記号は OK
   ```

3. **動的な属性値に依存**
   ```
   ✗ [id="message-123"]  // ID が動的に変わる
   ✓ [role="article"]  // 固定の属性を使用
   ```

4. **複雑すぎるセレクタ**
   ```
   ✗ div > span:nth-child(2) > p > span:first-of-type
   // 要素構造が少し変わると失敗

   ✓ div.content > span
   // シンプルで堅牢
   ```

---

## デバッグコマンド集

### Chrome DevTools コンソールで実行

```javascript
// 1. セレクタのマッチ数を確認
document.querySelectorAll('span').length

// 2. マッチした要素の内容を確認（最初の3件）
Array.from(document.querySelectorAll('span')).slice(0, 3)
  .forEach(el => console.log(el.textContent))

// 3. 特定クラスを持つ要素のみ
document.querySelectorAll('.text-base').length

// 4. 属性で選択
document.querySelectorAll('[role="article"]').length

// 5. フォールバックセレクタの検証
document.querySelectorAll('div.old-class').length

// 6. 複合セレクタのテスト
document.querySelectorAll('article > span').length

// 7. マッチ要素の HTML を確認
document.querySelector('span').outerHTML

// 8. 複数セレクタ（OR）をテスト
document.querySelectorAll('span, div, p').length
```

---

## チェックリスト：セレクタ作成時

セレクタを新規作成する際は以下をチェック:

- [ ] CSS 構文が正しい（DevTools コンソールでテスト）
- [ ] マッチ数が期待範囲（0件でなく、多すぎない）
- [ ] 最初の3件のプレビューが正しい内容
- [ ] フォールバックセレクタが設定されている（重要）
- [ ] ルール名が英数字とアンダースコアのみ
- [ ] priority が 0-100 の範囲
- [ ] 説明に変更内容を記入（いつ、なぜ変更したか）
- [ ] 同一ルール名が重複していない

---

## 参考リンク

- [MDN - CSS セレクタ](https://developer.mozilla.org/ja/docs/Web/CSS/CSS_Selectors)
- [W3C - CSS セレクタ仕様](https://www.w3.org/TR/selectors-4/)
- [Chrome DevTools - Elements パネル](https://developer.chrome.com/docs/devtools/dom/)

---

**最終更新日**: 2026-01-16
**バージョン**: 1.0
