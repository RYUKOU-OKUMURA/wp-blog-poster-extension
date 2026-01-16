/**
 * セレクタ設定マネージャー
 * ChatGPT, Claude, Gemini のセレクタルール管理
 */

class SelectorManager {
  constructor() {
    this.currentService = 'chatgpt';
    this.currentSchema = null;
    this.editingRuleIndex = null;
    this.logs = [];
    this.init();
  }

  // 初期化
  init() {
    this.setupEventListeners();
    this.loadDefaultSchemas();
  }

  // イベントリスナー設定
  setupEventListeners() {
    // サービス選択
    document.getElementById('serviceSelect').addEventListener('change', (e) => {
      this.currentService = e.target.value;
      this.loadSchema(e.target.value);
    });

    // ルールType変更時に属性名フィールド表示/非表示
    document.getElementById('ruleType').addEventListener('change', (e) => {
      const attributeGroup = document.getElementById('attributeNameGroup');
      attributeGroup.style.display = e.target.value === 'attribute' ? 'block' : 'none';
    });

    // Priority スライダーと数値入力を連動
    const prioritySlider = document.getElementById('prioritySlider');
    const priorityInput = document.getElementById('priority');
    prioritySlider.addEventListener('input', (e) => {
      priorityInput.value = e.target.value;
    });
    priorityInput.addEventListener('input', (e) => {
      prioritySlider.value = e.target.value;
    });

    // ボタン
    document.getElementById('testSelectorBtn').addEventListener('click', () => this.testSelector());
    document.getElementById('saveRuleBtn').addEventListener('click', () => this.saveRule());
    document.getElementById('clearRuleBtn').addEventListener('click', () => this.clearForm());
    document.getElementById('runAllTestsBtn').addEventListener('click', () => this.runAllTests());
    document.getElementById('clearLogsBtn').addEventListener('click', () => this.clearLogs());

    // ログレベルフィルター
    document.getElementById('logLevelFilter').addEventListener('change', () => this.displayLogs());
  }

  // デフォルトスキーマ読み込み/作成
  loadDefaultSchemas() {
    chrome.storage.local.get(['selectorSchemas'], (data) => {
      if (!data.selectorSchemas) {
        const defaultSchemas = {
          chatgpt: {
            version: '1.0',
            lastUpdated: new Date().toISOString(),
            service: 'chatgpt',
            rules: this.getDefaultChatGPTRules()
          },
          claude: {
            version: '1.0',
            lastUpdated: new Date().toISOString(),
            service: 'claude',
            rules: this.getDefaultClaudeRules()
          },
          gemini: {
            version: '1.0',
            lastUpdated: new Date().toISOString(),
            service: 'gemini',
            rules: this.getDefaultGeminiRules()
          }
        };
        chrome.storage.local.set({ selectorSchemas: defaultSchemas }, () => {
          this.loadSchema('chatgpt');
          this.addLog('INFO', 'デフォルトスキーマを作成しました');
        });
      } else {
        this.loadSchema('chatgpt');
      }
    });
  }

  // ChatGPT デフォルトルール
  getDefaultChatGPTRules() {
    return [
      {
        ruleName: 'markdownHeadings',
        selector: 'span',
        type: 'text',
        description: 'マークダウン見出しと段落テキスト',
        fallback: 'div[role]',
        enabled: true,
        priority: 100,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }
    ];
  }

  // Claude デフォルトルール
  getDefaultClaudeRules() {
    return [
      {
        ruleName: 'responseText',
        selector: 'div[role="article"] span, p',
        type: 'text',
        description: 'Claude の回答テキスト',
        fallback: 'div.message-content',
        enabled: true,
        priority: 100,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }
    ];
  }

  // Gemini デフォルトルール
  getDefaultGeminiRules() {
    return [
      {
        ruleName: 'assistantResponse',
        selector: 'div[data-message-role="assistant"] span, p',
        type: 'text',
        description: 'Gemini のアシスタント回答',
        fallback: 'div.response-text',
        enabled: true,
        priority: 100,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }
    ];
  }

  // スキーマ読み込み
  loadSchema(service) {
    chrome.storage.local.get(['selectorSchemas'], (data) => {
      if (data.selectorSchemas && data.selectorSchemas[service]) {
        this.currentSchema = data.selectorSchemas[service];
        this.updateSchemaInfo();
        this.renderRulesList();
        this.clearForm();
        this.addLog('INFO', `${service} スキーマを読み込みました`);
      }
    });
  }

  // スキーマ情報更新
  updateSchemaInfo() {
    document.getElementById('schemaVersion').textContent = this.currentSchema.version;
    const lastUpdated = new Date(this.currentSchema.lastUpdated);
    document.getElementById('lastUpdated').textContent = lastUpdated.toLocaleString('ja-JP');
  }

  // フォームバリデーション
  validateForm() {
    const errors = {};

    const ruleName = document.getElementById('ruleName').value.trim();
    if (!ruleName) {
      errors.ruleName = 'ルール名は必須です';
    } else if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(ruleName)) {
      errors.ruleName = '英数字とアンダースコア（先頭は英文字）のみ使用可能です';
    } else if (this.currentSchema.rules.some((r, i) => r.ruleName === ruleName && i !== this.editingRuleIndex)) {
      errors.ruleName = 'このルール名は既に使用されています';
    }

    const selector = document.getElementById('selector').value.trim();
    if (!selector) {
      errors.selector = 'セレクタは必須です';
    } else {
      // セレクタ構文検証
      try {
        const selectors = selector.split(',').map(s => s.trim());
        selectors.forEach(sel => {
          document.querySelector(sel); // 構文チェック
        });
      } catch (e) {
        errors.selector = 'セレクタの構文が無効です: ' + e.message;
      }
    }

    const ruleType = document.getElementById('ruleType').value;
    if (ruleType === 'attribute') {
      const attributeName = document.getElementById('attributeName').value.trim();
      if (!attributeName) {
        errors.attributeName = '属性名は必須です';
      }
    }

    // エラー表示
    this.clearErrors();
    Object.keys(errors).forEach(field => {
      const errorEl = document.getElementById(`${field}Error`);
      if (errorEl) {
        errorEl.textContent = errors[field];
      }
    });

    return Object.keys(errors).length === 0;
  }

  // エラークリア
  clearErrors() {
    document.querySelectorAll('.error').forEach(el => el.textContent = '');
  }

  // セレクタテスト
  testSelector() {
    if (!this.validateForm()) {
      this.addLog('ERROR', 'フォームのバリデーションに失敗しました');
      return;
    }

    const selector = document.getElementById('selector').value.trim();
    const fallback = document.getElementById('fallbackSelector').value.trim();

    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      chrome.tabs.sendMessage(tabs[0].id, {
        type: 'TEST_SELECTOR',
        selector: selector,
        fallback: fallback,
        ruleType: document.getElementById('ruleType').value
      }, (response) => {
        if (response && response.success) {
          this.showTestResult(response.data);
          this.addLog('INFO', `セレクタテスト完了: ${response.data.matchCount}件マッチ`);
        } else {
          this.showTestResult({
            matchCount: 0,
            error: response ? response.error : 'タブとの通信に失敗しました'
          });
          this.addLog('ERROR', `セレクタテスト失敗: ${response ? response.error : '通信エラー'}`);
        }
      });
    });
  }

  // テスト結果表示
  showTestResult(data) {
    const panel = document.getElementById('testResultPanel');
    const content = document.getElementById('testResultContent');

    let html = `<div class="match-count">マッチ数: ${data.matchCount}件</div>`;

    if (data.error) {
      html += `<div style="color: var(--error-text);">エラー: ${data.error}</div>`;
      panel.classList.remove('success');
      panel.classList.add('error');
    } else if (data.matchCount === 0) {
      html += '<div style="color: var(--muted);">マッチする要素がありません</div>';
      panel.classList.remove('success');
      panel.classList.add('error');
    } else {
      panel.classList.add('success');
      panel.classList.remove('error');
      if (data.previews && data.previews.length > 0) {
        html += '<div style="margin-top: 8px;"><strong>プレビュー（最初の3件）:</strong></div>';
        data.previews.forEach((preview, idx) => {
          const truncated = preview.length > 100 ? preview.substring(0, 100) + '...' : preview;
          html += `<div class="preview">${idx + 1}. ${this.escapeHtml(truncated)}</div>`;
        });
      }
    }

    content.innerHTML = html;
    panel.style.display = 'block';
  }

  // ルール保存
  saveRule() {
    if (!this.validateForm()) {
      this.addLog('ERROR', 'バリデーションエラー');
      return;
    }

    const rule = {
      ruleName: document.getElementById('ruleName').value.trim(),
      selector: document.getElementById('selector').value.trim(),
      type: document.getElementById('ruleType').value,
      attributeName: document.getElementById('attributeName').value.trim() || undefined,
      fallback: document.getElementById('fallbackSelector').value.trim() || undefined,
      description: document.getElementById('ruleDescription').value.trim() || undefined,
      enabled: document.getElementById('ruleEnabled').checked,
      priority: parseInt(document.getElementById('priority').value),
      createdAt: this.editingRuleIndex !== null
        ? this.currentSchema.rules[this.editingRuleIndex].createdAt
        : new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    if (this.editingRuleIndex !== null) {
      // 編集モード
      this.currentSchema.rules[this.editingRuleIndex] = rule;
      this.addLog('INFO', `ルール編集: ${rule.ruleName}`);
    } else {
      // 追加モード
      this.currentSchema.rules.push(rule);
      this.addLog('INFO', `ルール追加: ${rule.ruleName}`);
    }

    // バージョン更新
    const [major, minor, patch] = this.currentSchema.version.split('.').map(Number);
    this.currentSchema.version = `${major}.${minor}.${patch + 1}`;
    this.currentSchema.lastUpdated = new Date().toISOString();

    // Storage に保存
    chrome.storage.local.get(['selectorSchemas'], (data) => {
      const schemas = data.selectorSchemas;
      schemas[this.currentService] = this.currentSchema;
      chrome.storage.local.set({ selectorSchemas: schemas }, () => {
        this.addLog('INFO', 'Storage に保存完了');
        this.updateSchemaInfo();
        this.renderRulesList();
        this.clearForm();
      });
    });
  }

  // ルール一覧レンダリング
  renderRulesList() {
    const rulesList = document.getElementById('rulesList');

    if (!this.currentSchema.rules || this.currentSchema.rules.length === 0) {
      rulesList.innerHTML = '<p class="empty-message">ルールが設定されていません</p>';
      return;
    }

    // 優先度でソート
    const sortedRules = [...this.currentSchema.rules].sort((a, b) => b.priority - a.priority);

    rulesList.innerHTML = sortedRules.map((rule, idx) => `
      <div class="rule-item ${!rule.enabled ? 'disabled' : ''}">
        <div class="rule-item-info">
          <div class="rule-name">
            ${rule.enabled ? '✓' : '✗'} ${this.escapeHtml(rule.ruleName)}
            <span style="color: var(--muted); font-size: 11px;">(Priority: ${rule.priority})</span>
          </div>
          <div class="rule-selector">セレクタ: ${this.escapeHtml(rule.selector)}</div>
          ${rule.description ? `<div style="color: var(--muted); font-size: 11px; margin-top: 2px;">${this.escapeHtml(rule.description)}</div>` : ''}
        </div>
        <div class="rule-item-actions">
          <button type="button" title="編集" onclick="selectorManager.editRule(${idx})">✎</button>
          <button type="button" title="削除" onclick="selectorManager.deleteRule(${idx})">🗑</button>
        </div>
      </div>
    `).join('');
  }

  // ルール編集
  editRule(index) {
    const rule = this.currentSchema.rules[index];
    this.editingRuleIndex = index;

    document.getElementById('ruleName').value = rule.ruleName;
    document.getElementById('selector').value = rule.selector;
    document.getElementById('ruleType').value = rule.type;
    document.getElementById('attributeName').value = rule.attributeName || '';
    document.getElementById('fallbackSelector').value = rule.fallback || '';
    document.getElementById('ruleDescription').value = rule.description || '';
    document.getElementById('priority').value = rule.priority;
    document.getElementById('prioritySlider').value = rule.priority;
    document.getElementById('ruleEnabled').checked = rule.enabled;

    // 属性名フィールド表示/非表示
    const attributeGroup = document.getElementById('attributeNameGroup');
    attributeGroup.style.display = rule.type === 'attribute' ? 'block' : 'none';

    document.getElementById('saveRuleBtn').textContent = 'ルールを更新';

    // フォームへスクロール
    document.querySelector('.form-section').scrollIntoView({ behavior: 'smooth' });
  }

  // ルール削除
  deleteRule(index) {
    if (confirm('このルールを削除してもよろしいですか？')) {
      const deletedRule = this.currentSchema.rules[index];
      this.currentSchema.rules.splice(index, 1);

      // バージョン更新
      const [major, minor, patch] = this.currentSchema.version.split('.').map(Number);
      this.currentSchema.version = `${major}.${minor}.${patch + 1}`;
      this.currentSchema.lastUpdated = new Date().toISOString();

      chrome.storage.local.get(['selectorSchemas'], (data) => {
        const schemas = data.selectorSchemas;
        schemas[this.currentService] = this.currentSchema;
        chrome.storage.local.set({ selectorSchemas: schemas }, () => {
          this.addLog('INFO', `ルール削除: ${deletedRule.ruleName}`);
          this.renderRulesList();
        });
      });
    }
  }

  // フォームクリア
  clearForm() {
    document.getElementById('ruleName').value = '';
    document.getElementById('selector').value = '';
    document.getElementById('ruleType').value = 'text';
    document.getElementById('attributeName').value = '';
    document.getElementById('fallbackSelector').value = '';
    document.getElementById('ruleDescription').value = '';
    document.getElementById('priority').value = 50;
    document.getElementById('prioritySlider').value = 50;
    document.getElementById('ruleEnabled').checked = true;
    document.getElementById('attributeNameGroup').style.display = 'none';
    document.getElementById('saveRuleBtn').textContent = 'ルールを保存';
    document.getElementById('testResultPanel').style.display = 'none';
    this.editingRuleIndex = null;
    this.clearErrors();
  }

  // 全ルールテスト
  runAllTests() {
    const testRunResult = document.getElementById('testRunResult');
    testRunResult.style.display = 'block';
    const content = document.getElementById('testRunContent');

    content.innerHTML = '<p>全ルールをテスト中...</p>';

    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const results = [];
      let completed = 0;

      this.currentSchema.rules.forEach((rule, idx) => {
        if (!rule.enabled) {
          results[idx] = { ...rule, status: 'skipped', reason: '無効' };
          completed++;
          if (completed === this.currentSchema.rules.length) {
            this.displayTestResults(results);
          }
          return;
        }

        chrome.tabs.sendMessage(tabs[0].id, {
          type: 'TEST_SELECTOR',
          selector: rule.selector,
          fallback: rule.fallback,
          ruleType: rule.type
        }, (response) => {
          if (response && response.success) {
            results[idx] = { ...rule, ...response.data, status: 'success' };
          } else {
            results[idx] = { ...rule, status: 'error', error: response ? response.error : '通信エラー' };
          }
          completed++;

          if (completed === this.currentSchema.rules.length) {
            this.displayTestResults(results);
          }
        });
      });
    });
  }

  // テスト結果表示
  displayTestResults(results) {
    const content = document.getElementById('testRunContent');
    let html = '';

    results.forEach((result, idx) => {
      const statusIcon = result.status === 'success' ? '✓' : result.status === 'skipped' ? '⊗' : '✗';
      const statusColor = result.status === 'success' ? '#22c55e' : result.status === 'skipped' ? '#888' : '#ef4444';

      html += `
        <div style="margin-bottom: 12px; padding: 8px; background: var(--surface-2); border-radius: 6px; border-left: 3px solid ${statusColor};">
          <div style="font-weight: 600; color: var(--text); margin-bottom: 4px;">
            <span style="color: ${statusColor};">${statusIcon}</span> ${this.escapeHtml(result.ruleName)}
          </div>
          <div style="font-size: 11px; color: var(--muted);">
            ${result.status === 'success' ? `マッチ: ${result.matchCount}件` :
              result.status === 'skipped' ? `スキップ: ${result.reason}` :
              `エラー: ${result.error}`}
          </div>
        </div>
      `;
    });

    content.innerHTML = html;
  }

  // ログ追加
  addLog(level, message) {
    const timestamp = new Date().toLocaleString('ja-JP');
    this.logs.push({ level, message, timestamp });

    // ログは最新1000件まで保持
    if (this.logs.length > 1000) {
      this.logs.shift();
    }

    this.displayLogs();
  }

  // ログ表示
  displayLogs() {
    const filter = document.getElementById('logLevelFilter').value;
    const logsList = document.getElementById('logsList');

    const filteredLogs = filter === 'all'
      ? this.logs
      : this.logs.filter(log => log.level === filter);

    if (filteredLogs.length === 0) {
      logsList.innerHTML = '<p class="empty-message">ログがありません</p>';
      return;
    }

    logsList.innerHTML = filteredLogs.map(log => `
      <div class="log-item ${log.level.toLowerCase()}">
        [${log.timestamp}] ${log.level}: ${this.escapeHtml(log.message)}
      </div>
    `).join('');

    // 最新のログにスクロール
    logsList.scrollTop = logsList.scrollHeight;
  }

  // ログクリア
  clearLogs() {
    if (confirm('すべてのログを削除してもよろしいですか？')) {
      this.logs = [];
      this.displayLogs();
    }
  }

  // HTML エスケープ
  escapeHtml(text) {
    const map = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;'
    };
    return text.replace(/[&<>"']/g, char => map[char]);
  }
}

// グローバル インスタンス化
let selectorManager;
document.addEventListener('DOMContentLoaded', () => {
  selectorManager = new SelectorManager();
});
