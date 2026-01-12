/**
 * ブログ投稿アシスタント - Content Script
 * ChatGPT, Claude, Gemini のページでマークダウンコードブロックを検出
 */

(function() {
  'use strict';

  // 処理済みブロックを追跡
  const processedBlocks = new WeakSet();

  // 確認ダイアログの状態
  let activeDialog = null;

  /**
   * 初期化
   */
  function init() {
    // 初回スキャン
    setTimeout(scanForMarkdownBlocks, 1000);

    // MutationObserverで新しいコンテンツを監視
    const observer = new MutationObserver((mutations) => {
      let shouldScan = false;
      for (const mutation of mutations) {
        if (mutation.addedNodes.length > 0) {
          shouldScan = true;
          break;
        }
      }
      if (shouldScan) {
        setTimeout(scanForMarkdownBlocks, 500);
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });

    console.log('[ブログ投稿アシスタント] 初期化完了');
  }

  /**
   * マークダウンコードブロックをスキャン
   */
  function scanForMarkdownBlocks() {
    // コードブロックを検索
    const codeBlocks = document.querySelectorAll('pre code, pre');

    codeBlocks.forEach(block => {
      if (processedBlocks.has(block)) return;

      const content = block.textContent || '';

      // マークダウンコンテンツかチェック
      if (isMarkdownContent(content)) {
        processedBlocks.add(block);
        addPostButton(block, content);
      }
    });
  }

  /**
   * マークダウンコンテンツかどうか判定
   */
  function isMarkdownContent(content) {
    const trimmed = content.trim();

    // Front Matterがある（ブログ記事の可能性が高い）
    const hasFrontMatter = /^---\s*\n[\s\S]*?\n---/.test(trimmed);
    if (hasFrontMatter) return true;

    // H1またはH2見出しがある + マークダウン構文がある
    const hasH1 = /^#\s+.+$/m.test(trimmed);
    const hasH2 = /^##\s+.+$/m.test(trimmed);
    const hasMarkdownSyntax = /(\*\*|__|\[.+\]\(.+\)|```|^\s*[-*+]\s|\|.+\|)/m.test(trimmed);

    // 最低限の長さチェック（短すぎる場合は除外）
    const isLongEnough = trimmed.length > 200;

    return (hasH1 || hasH2) && hasMarkdownSyntax && isLongEnough;
  }

  /**
   * 投稿ボタンを追加
   */
  function addPostButton(block, content) {
    // 親要素（pre）を取得
    const preElement = block.tagName === 'PRE' ? block : block.closest('pre');
    if (!preElement) return;

    // 既にボタンがあるかチェック
    if (preElement.querySelector('.wp-post-btn-wrapper')) return;

    // ラッパーを作成
    const wrapper = document.createElement('div');
    wrapper.className = 'wp-post-btn-wrapper';

    // ボタンを作成
    const button = document.createElement('button');
    button.className = 'wp-post-btn';
    button.innerHTML = '📤 WPに投稿';
    button.title = 'WordPressに投稿';

    button.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      showConfirmDialog(content);
    });

    wrapper.appendChild(button);

    // preの中に配置
    preElement.style.position = 'relative';
    preElement.appendChild(wrapper);
  }

  /**
   * 確認ダイアログを表示
   */
  async function showConfirmDialog(rawContent) {
    // 既存のダイアログを閉じる
    if (activeDialog) {
      activeDialog.remove();
    }

    // コンテンツを解析
    const { metadata, body } = parseFrontMatter(rawContent);

    // タイトルを抽出
    let title = metadata.title;
    let processedBody = body;

    if (!title) {
      const extracted = extractTitle(body);
      title = extracted.title;
      processedBody = extracted.body;
    } else {
      processedBody = removeHeadingMatchingTitle(body, title);
    }

    // 設定を取得
    const config = await chrome.storage.local.get(['settings']);
    const defaultStatus = config.settings?.defaultStatus || 'draft';

    const dialogOptions = {
      title,
      categories: normalizeStringArray(metadata.categories),
      tags: normalizeStringArray(metadata.tags),
      slug: metadata.slug,
      excerpt: metadata.excerpt,
      bodyPreview: processedBody.substring(0, 300),
      charCount: processedBody.length,
      defaultStatus,
      onConfirm: async (status) => {
        showDialogLoading(dialog, true);

        try {
          // Markdown to HTML
          const htmlContent = convertMarkdownToHtml(processedBody);

          const result = await chrome.runtime.sendMessage({
            type: 'CREATE_POST',
            data: {
              title: dialogOptions.title,
              content: htmlContent,
              status,
              categories: dialogOptions.categories,
              tags: dialogOptions.tags,
              slug: dialogOptions.slug,
              date: metadata.date,
              excerpt: dialogOptions.excerpt
            }
          });

          if (result.success) {
            showDialogResult(dialog, true, result.data);
          } else {
            showDialogResult(dialog, false, result.error);
          }
        } catch (error) {
          showDialogResult(dialog, false, { message: 'エラーが発生しました' });
        }
      },
      onCancel: () => {
        dialog.remove();
        activeDialog = null;
      }
    };

    // ダイアログを作成
    const dialog = createDialog(dialogOptions);

    document.body.appendChild(dialog);
    activeDialog = dialog;
  }

  /**
   * ダイアログを作成
   */
  function createDialog(options) {
    const overlay = document.createElement('div');
    overlay.className = 'wp-dialog-overlay';

    const dialog = document.createElement('div');
    dialog.className = 'wp-dialog';

    dialog.innerHTML = `
      <div class="wp-dialog-header">
        <h2>📝 投稿内容の確認</h2>
        <button class="wp-dialog-close" title="閉じる">×</button>
      </div>
      <div class="wp-dialog-body">
        <div class="wp-dialog-form">
          <div class="wp-form-group">
            <label>タイトル</label>
            <input type="text" class="wp-input" id="wpTitle" value="${escapeHtml(options.title || '')}">
          </div>
          <div class="wp-form-group">
            <label>カテゴリ</label>
            <input type="text" class="wp-input" id="wpCategories" value="${escapeHtml((options.categories || []).join(', '))}" placeholder="カテゴリ1, カテゴリ2">
          </div>
          <div class="wp-form-group">
            <label>タグ</label>
            <input type="text" class="wp-input" id="wpTags" value="${escapeHtml((options.tags || []).join(', '))}" placeholder="タグ1, タグ2">
          </div>
          <div class="wp-form-group">
            <label>投稿状態</label>
            <div class="wp-radio-group">
              <label>
                <input type="radio" name="wpStatus" value="draft" ${options.defaultStatus === 'draft' ? 'checked' : ''}>
                下書きとして保存
              </label>
              <label>
                <input type="radio" name="wpStatus" value="publish" ${options.defaultStatus === 'publish' ? 'checked' : ''}>
                公開する
              </label>
            </div>
          </div>
          <div class="wp-form-group">
            <label>本文プレビュー (${options.charCount.toLocaleString()}文字)</label>
            <div class="wp-preview">${escapeHtml(options.bodyPreview)}...</div>
          </div>
        </div>
      </div>
      <div class="wp-dialog-footer">
        <button class="wp-btn wp-btn-secondary wp-cancel-btn">キャンセル</button>
        <button class="wp-btn wp-btn-primary wp-submit-btn">📤 投稿する</button>
      </div>
      <div class="wp-dialog-loading" style="display: none;">
        <div class="wp-spinner"></div>
        <p>投稿中...</p>
      </div>
      <div class="wp-dialog-result" style="display: none;"></div>
    `;

    overlay.appendChild(dialog);

    // イベントリスナー
    overlay.querySelector('.wp-dialog-close').addEventListener('click', options.onCancel);
    overlay.querySelector('.wp-cancel-btn').addEventListener('click', options.onCancel);
    overlay.querySelector('.wp-submit-btn').addEventListener('click', () => {
      const title = overlay.querySelector('#wpTitle').value;
      const categories = overlay.querySelector('#wpCategories').value.split(',').map(s => s.trim()).filter(Boolean);
      const tags = overlay.querySelector('#wpTags').value.split(',').map(s => s.trim()).filter(Boolean);
      const status = overlay.querySelector('input[name="wpStatus"]:checked').value;

      // オプションを更新
      options.title = title;
      options.categories = categories;
      options.tags = tags;

      options.onConfirm(status);
    });

    // オーバーレイクリックで閉じる
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) options.onCancel();
    });

    return overlay;
  }

  /**
   * ダイアログのローディング表示
   */
  function showDialogLoading(dialog, show) {
    const body = dialog.querySelector('.wp-dialog-body');
    const footer = dialog.querySelector('.wp-dialog-footer');
    const loading = dialog.querySelector('.wp-dialog-loading');

    if (show) {
      body.style.display = 'none';
      footer.style.display = 'none';
      loading.style.display = 'flex';
    } else {
      body.style.display = 'block';
      footer.style.display = 'flex';
      loading.style.display = 'none';
    }
  }

  /**
   * ダイアログの結果表示
   */
  function showDialogResult(dialog, success, data) {
    const loading = dialog.querySelector('.wp-dialog-loading');
    const result = dialog.querySelector('.wp-dialog-result');

    loading.style.display = 'none';
    result.style.display = 'flex';

    if (success) {
      result.innerHTML = `
        <div class="wp-result-success">
          <span class="wp-result-icon">✅</span>
          <h3>投稿が完了しました！</h3>
          <p>記事を${data.status === 'publish' ? '公開' : '下書き保存'}しました</p>
          <div class="wp-result-actions">
            <a href="${escapeHtml(data.editUrl)}" target="_blank" class="wp-btn wp-btn-secondary">編集画面を開く</a>
            <button class="wp-btn wp-btn-primary wp-close-result">閉じる</button>
          </div>
        </div>
      `;
    } else {
      result.innerHTML = `
        <div class="wp-result-error">
          <span class="wp-result-icon">❌</span>
          <h3>投稿に失敗しました</h3>
          <p>${escapeHtml(data.message)}</p>
          <div class="wp-result-actions">
            <button class="wp-btn wp-btn-secondary wp-retry-btn">戻る</button>
            <button class="wp-btn wp-btn-primary wp-close-result">閉じる</button>
          </div>
        </div>
      `;

      result.querySelector('.wp-retry-btn').addEventListener('click', () => {
        result.style.display = 'none';
        dialog.querySelector('.wp-dialog-body').style.display = 'block';
        dialog.querySelector('.wp-dialog-footer').style.display = 'flex';
      });
    }

    result.querySelector('.wp-close-result').addEventListener('click', () => {
      dialog.remove();
      activeDialog = null;
    });
  }

  /**
   * Front Matterを解析
   */
  function parseFrontMatter(content) {
    const metadata = {};
    let body = content;

    // BOMを除去
    if (content.charCodeAt(0) === 0xFEFF) {
      content = content.slice(1);
      body = content;
    }

    const trimmed = content.trimStart();
    const frontMatterRegex = /^---\s*\n([\s\S]*?)\n---\s*\n/;
    const match = trimmed.match(frontMatterRegex);

    if (match) {
      try {
        const yamlContent = match[1];
        // js-yamlが読み込まれていれば使用
        if (typeof jsyaml !== 'undefined') {
          const parsed = jsyaml.load(yamlContent) || {};
          Object.assign(metadata, parsed);
        } else {
          // 簡易パース
          parseSimpleYaml(yamlContent, metadata);
        }
        body = trimmed.slice(match[0].length);
      } catch (e) {
        console.warn('[ブログ投稿アシスタント] Front Matter解析エラー:', e);
      }
    }

    return { metadata, body };
  }

  /**
   * 値を配列に正規化
   */
  function normalizeStringArray(value) {
    if (!value) return [];
    if (Array.isArray(value)) {
      return value.map(item => String(item).trim()).filter(Boolean);
    }
    if (typeof value === 'string') {
      return value
        .split(',')
        .map(item => item.trim())
        .filter(Boolean);
    }
    return [String(value).trim()].filter(Boolean);
  }

  /**
   * 簡易YAMLパース（js-yamlがない場合のフォールバック）
   */
  function parseSimpleYaml(yaml, result) {
    const lines = yaml.split('\n');
    let currentKey = null;
    let currentArray = null;

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      // 配列項目
      if (trimmed.startsWith('- ') && currentKey) {
        if (!Array.isArray(result[currentKey])) {
          result[currentKey] = [];
        }
        result[currentKey].push(trimmed.slice(2).trim());
        continue;
      }

      // キー: 値
      const colonIndex = trimmed.indexOf(':');
      if (colonIndex > 0) {
        currentKey = trimmed.slice(0, colonIndex).trim();
        const value = trimmed.slice(colonIndex + 1).trim();
        if (value) {
          result[currentKey] = value;
        }
      }
    }
  }

  /**
   * タイトルを抽出
   */
  function extractTitle(content) {
    const lines = content.split('\n');
    let title = null;
    let titleLineIndex = null;

    // H1を探す
    for (let i = 0; i < lines.length; i++) {
      const match = lines[i].trim().match(/^#\s+(.+)$/);
      if (match) {
        title = match[1].trim();
        titleLineIndex = i;
        break;
      }
    }

    // H1がなければH2を探す
    if (!title) {
      for (let i = 0; i < lines.length; i++) {
        const match = lines[i].trim().match(/^##\s+(.+)$/);
        if (match) {
          title = match[1].trim();
          titleLineIndex = i;
          break;
        }
      }
    }

    // タイトル行を本文から除去
    let body = content;
    if (titleLineIndex !== null) {
      const newLines = [...lines.slice(0, titleLineIndex), ...lines.slice(titleLineIndex + 1)];
      // 先頭の空行を除去
      while (newLines.length > 0 && newLines[0].trim() === '') {
        newLines.shift();
      }
      body = newLines.join('\n');
    }

    return { title: title || '無題の記事', body };
  }

  /**
   * タイトルと一致する見出しを除去
   */
  function removeHeadingMatchingTitle(content, title) {
    if (!title) return content;

    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const match = lines[i].trim().match(/^#{1,2}\s+(.+)$/);
      if (match && match[1].trim() === title) {
        const newLines = [...lines.slice(0, i), ...lines.slice(i + 1)];
        while (newLines.length > 0 && newLines[0].trim() === '') {
          newLines.shift();
        }
        return newLines.join('\n');
      }
    }

    return content;
  }

  /**
   * Markdown to HTML変換
   */
  function convertMarkdownToHtml(markdown) {
    if (typeof marked !== 'undefined') {
      marked.setOptions({
        gfm: true,
        breaks: false,
        headerIds: true,
        mangle: false
      });
      return sanitizeHtml(marked.parse(markdown));
    }

    // フォールバック: 簡易変換
    const html = markdown
      .replace(/^### (.+)$/gm, '<h3>$1</h3>')
      .replace(/^## (.+)$/gm, '<h2>$1</h2>')
      .replace(/^# (.+)$/gm, '<h1>$1</h1>')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      .replace(/\n\n/g, '</p><p>')
      .replace(/^/, '<p>')
      .replace(/$/, '</p>');
    return sanitizeHtml(html);
  }

  /**
   * 危険なタグ/属性を軽く除去
   */
  function sanitizeHtml(html) {
    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, 'text/html');
      const blockedTags = new Set(['script', 'iframe', 'object', 'embed', 'link', 'style']);
      const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_ELEMENT, null);
      const toRemove = [];

      while (walker.nextNode()) {
        const el = walker.currentNode;
        const tag = el.tagName.toLowerCase();
        if (blockedTags.has(tag)) {
          toRemove.push(el);
          continue;
        }

        for (const attr of [...el.attributes]) {
          const name = attr.name.toLowerCase();
          const value = attr.value;
          if (name.startsWith('on')) {
            el.removeAttribute(attr.name);
            continue;
          }
          if (name === 'href' || name === 'src' || name === 'xlink:href') {
            if (isDangerousUrl(value)) {
              el.removeAttribute(attr.name);
            }
          }
        }
      }

      toRemove.forEach(el => el.remove());
      return doc.body.innerHTML;
    } catch (e) {
      console.warn('[ブログ投稿アシスタント] HTMLサニタイズ失敗:', e);
      return html;
    }
  }

  function isDangerousUrl(value) {
    if (!value) return false;
    const trimmed = value.trim().toLowerCase();
    if (trimmed.startsWith('javascript:') || trimmed.startsWith('vbscript:')) {
      return true;
    }
    if (trimmed.startsWith('data:')) {
      return !/^data:image\/(png|jpe?g|gif|webp);/i.test(trimmed);
    }
    return false;
  }

  /**
   * HTMLエスケープ
   */
  function escapeHtml(str) {
    if (!str) return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // 初期化
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
