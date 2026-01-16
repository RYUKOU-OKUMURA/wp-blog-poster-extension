# デバッグセッション 2026-01-16

## 問題概要
セレクタ設定タブのフォームが表示されない（白い画面のまま）

## 実装した修正内容
1. **selector-manager.js** - エラーハンドリングとログを強化
   - `constructor()` に初期化ログを追加
   - `renderRulesList()`, `clearForm()`, `displayLogs()` に try-catch と null チェックを追加

2. **popup.js** - DOM 要素初期化タイミングの修正
   - `elements` オブジェクトをグローバルスコープから DOMContentLoaded 後の `initializeElements()` 関数に移動
   - 初期化ログを追加

## デバッグ結果

### ✅ 確認できたこと
1. **HTML 要素は存在する**
   ```javascript
   document.getElementById('selectorScreen')
   // 結果: <div id="selectorScreen" class="selector-screen tab-content" data-tab="selector" style="display: none;">
   ```

2. **タブボタンは4つ存在し、正しく認識される**
   ```javascript
   Tab buttons found: 4
   Button 0: 基本設定 data-tab: main
   Button 1: セレクタ設定 data-tab: selector
   Button 2: (テスト) data-tab: test
   Button 3: ログ data-tab: logs
   ```

3. **セレクタ設定タブボタンはすでに active クラスを持っている**
   ```javascript
   <button class="tab-btn active" data-tab="selector">セレクタ設定</button>
   ```

4. **手動で display を変更すると反応する**
   ```javascript
   selectorScreen.style.display = 'block';
   selectorScreen.classList.add('active');
   // コンソール: Manually activated (成功)
   ```

### ❌ 重大な問題: JavaScript が初期化されていない
- コンソールに `[Popup]` で始まるログが**一切表示されていない**
- コンソールに `[SelectorManager]` で始まるログが**一切表示されていない**
- これは DOMContentLoaded イベントが発火していない、またはスクリプトが読み込まれていないことを示唆

### 未確認事項（次のセッションで調査すること）
1. **SelectorManager が初期化されているか**
   ```javascript
   console.log('selectorManager:', typeof selectorManager, selectorManager);
   ```

2. **スクリプトが正しく読み込まれているか**
   ```javascript
   document.querySelectorAll('script').forEach(s => {
     console.log('Script:', s.src || '(inline)');
   });
   ```

3. **手動で display を 'block' にした後、フォーム内容は表示されるか**
   - これは CSS の display プロパティが正しく動作しているか確認できる

4. **popup.html の script タグの順序は正しいか**
   ```html
   <script src="selector-manager.js"></script>
   <script src="popup.js"></script>
   ```

## 原因の仮説

### 仮説 1: スクリプト読み込み順序の問題
- `selector-manager.js` が読み込まれる前に `popup.js` が実行されている可能性
- または、スクリプトが読み込まれていない

### 仮説 2: DOMContentLoaded イベントの発火タイミング
- popup.html 読み込み時にすでに DOMContentLoaded が発火した後にスクリプトが読み込まれている
- この場合、`document.addEventListener('DOMContentLoaded', ...)` のハンドラは実行されない

### 仮説 3: popup.html のスクリプト読み込み方法
- `popup.html` で正しく `<script>` タグが記述されていない可能性

## 次のセッションでの確認手順

1. **スクリプト読み込み確認**
   ```javascript
   const scripts = document.querySelectorAll('script');
   console.log('Scripts loaded:', scripts.length);
   scripts.forEach(s => {
     console.log('- ', s.src || s.textContent.substring(0, 100));
   });
   ```

2. **SelectorManager 確認**
   ```javascript
   console.log('typeof selectorManager:', typeof selectorManager);
   if (typeof selectorManager !== 'undefined') {
     console.log('selectorManager.currentSchema:', selectorManager.currentSchema);
     console.log('selectorManager.currentService:', selectorManager.currentService);
   }
   ```

3. **popup.html を確認**
   - `popup.html` の `</body>` タグの直前に以下があるか確認:
   ```html
   <script src="selector-manager.js"></script>
   <script src="popup.js"></script>
   ```

4. **DOMContentLoaded イベントの手動発火**
   ```javascript
   const event = new Event('DOMContentLoaded');
   document.dispatchEvent(event);
   ```
   その後、コンソールに `[Popup]` ログが表示されるか確認

5. **CSS による非表示の確認**
   ```javascript
   const selectorScreen = document.getElementById('selectorScreen');
   const styles = window.getComputedStyle(selectorScreen);
   console.log('Computed display:', styles.display);
   console.log('Computed visibility:', styles.visibility);
   console.log('Computed opacity:', styles.opacity);
   selectorScreen.style.display = 'block';
   // フォーム内容が表示されるか確認
   ```

## 結論
- **HTML と DOM 構造は正常**
- **JavaScript の初期化に問題がある**
- **手動操作で表示できるため、CSS は正常と思われる**

次のセッションでスクリプト読み込みと初期化を詳しく調査する必要がある。
