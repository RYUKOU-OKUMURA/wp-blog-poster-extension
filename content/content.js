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

  }

  /**
   * 現在のサイトを判定
   */
  function detectPlatform() {
    const host = window.location.hostname;
    if (host.includes('chat.openai.com') || host.includes('chatgpt.com')) return 'chatgpt';
    if (host.includes('claude.ai')) return 'claude';
    if (host.includes('gemini.google.com')) return 'gemini';
    return 'unknown';
  }

  /**
   * プラットフォーム別のアシスタントメッセージセレクタ
   */
  function getAssistantMessageSelector(platform) {
    switch (platform) {
      case 'chatgpt':
        // ChatGPTのアシスタントメッセージ
        return '[data-message-author-role="assistant"] .markdown';
      case 'claude':
        // Claudeのアシスタントメッセージ
        return '[data-is-streaming="false"].font-claude-message .grid-cols-1, .font-claude-message .prose';
      case 'gemini':
        // Geminiのアシスタントメッセージ（会話ターンコンテナ）
        return 'message-content.model-response-text';
      default:
        return null;
    }
  }

  /**
   * プラットフォーム別の親コンテナセレクタ（重複防止用）
   */
  function getParentContainerSelector(platform) {
    switch (platform) {
      case 'chatgpt':
        return '[data-message-author-role="assistant"]';
      case 'claude':
        return '.font-claude-message';
      case 'gemini':
        return 'model-response, .conversation-turn';
      default:
        return null;
    }
  }

  /**
   * マークダウンコードブロックをスキャン
   */
  function scanForMarkdownBlocks() {
    const platform = detectPlatform();
    const parentSelector = getParentContainerSelector(platform);
    let foundInPlatformMessage = false;

    // 1. プラットフォーム固有のアシスタントメッセージを検索
    const assistantSelector = getAssistantMessageSelector(platform);
    if (assistantSelector) {
      const messages = document.querySelectorAll(assistantSelector);
      messages.forEach(msg => {
        if (processedBlocks.has(msg)) return;
        // 既にボタンがある要素はスキップ
        if (msg.querySelector('.wp-post-btn-wrapper')) return;

        // 親コンテナに既にボタンがある場合はスキップ（重複防止）
        if (parentSelector) {
          const parent = msg.closest(parentSelector);
          if (parent && parent.querySelector('.wp-post-btn-wrapper')) return;
        }

        const content = msg.innerText || msg.textContent || '';

        // マークダウンコンテンツかチェック
        if (isMarkdownContent(content)) {
          processedBlocks.add(msg);
          addPostButton(msg, content, platform);
          foundInPlatformMessage = true;
        }
      });
    }

    // 2. プラットフォーム固有で見つからなかった場合のみ、コードブロックを検索
    if (!foundInPlatformMessage) {
      const codeBlocks = document.querySelectorAll('pre code, pre');

      codeBlocks.forEach(block => {
        if (processedBlocks.has(block)) return;
        // 既にボタンがある親要素はスキップ
        if (block.closest('.wp-post-btn-wrapper')) return;
        if (parentSelector) {
          const parent = block.closest(parentSelector);
          if (parent && parent.querySelector('.wp-post-btn-wrapper')) return;
        }

        const content = block.textContent || '';

        // マークダウンコンテンツかチェック
        if (isMarkdownContent(content)) {
          processedBlocks.add(block);
          addPostButton(block, content, platform);
        }
      });
    }
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
  function addPostButton(block, content, platform) {
    // ボタンを配置する要素を決定
    let targetElement = block;

    // コードブロックの場合はpre要素を使用
    if (block.tagName === 'CODE' || block.tagName === 'PRE') {
      targetElement = block.tagName === 'PRE' ? block : block.closest('pre');
      if (!targetElement) return;
    }

    // 既にボタンがあるかチェック
    if (targetElement.querySelector('.wp-post-btn-wrapper')) return;
    // 親要素にも既にボタンがないかチェック（重複防止）
    if (targetElement.closest('.wp-post-btn-wrapper')) return;

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

    // 要素内に配置
    targetElement.style.position = 'relative';
    targetElement.appendChild(wrapper);
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
    const config = await chrome.storage.local.get(['settings', 'wpUrl', 'lastUsedTagsBySite']);
    const defaultStatus = config.settings?.defaultStatus || 'draft';
    const wpUrl = (config.wpUrl || '').trim();
    const lastUsedTagsBySite = config.lastUsedTagsBySite || {};

    const scheduleAt = toDatetimeLocalValue(metadata.date);
    const isScheduledByFrontMatter = isFutureDatetimeLocal(scheduleAt);

    let initialTags = normalizeStringArray(metadata.tags);
    if (initialTags.length === 0 && wpUrl && Array.isArray(lastUsedTagsBySite[wpUrl])) {
      initialTags = lastUsedTagsBySite[wpUrl].map(s => String(s).trim()).filter(Boolean);
    }

    const dialogOptions = {
      title,
      categories: normalizeStringArray(metadata.categories),
      tags: initialTags,
      slug: metadata.slug,
      excerpt: metadata.excerpt,
      body: processedBody,
      charCount: processedBody.length,
      defaultStatus: isScheduledByFrontMatter ? 'future' : defaultStatus,
      scheduleAt,
      wpUrl,
      onConfirm: async ({ status, scheduleAt, body }) => {
        showDialogLoading(dialog, true);

        try {
          // 前回タグを保存（投稿成功/失敗に関わらず次回の入力を楽にする）
          if (dialogOptions.wpUrl) {
            const trimmedTags = (dialogOptions.tags || []).map(s => String(s).trim()).filter(Boolean);
            const current = await chrome.storage.local.get(['lastUsedTagsBySite']);
            const next = { ...(current.lastUsedTagsBySite || {}) };
            next[dialogOptions.wpUrl] = trimmedTags;
            await chrome.storage.local.set({ lastUsedTagsBySite: next });
          }

          // Markdown to HTML
          const htmlContent = convertMarkdownToHtml(body);

          const result = await chrome.runtime.sendMessage({
            type: 'CREATE_POST',
            data: {
              title: dialogOptions.title,
              content: htmlContent,
              status,
              categories: dialogOptions.categories,
              tags: dialogOptions.tags,
              slug: dialogOptions.slug,
              date: status === 'future' ? scheduleAt : metadata.date,
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
              <label>
                <input type="radio" name="wpStatus" value="future" ${options.defaultStatus === 'future' ? 'checked' : ''}>
                予約投稿する
              </label>
            </div>
          </div>
          <div class="wp-form-group" id="wpScheduleGroup" style="display: none;">
            <label>公開日時（予約）</label>
            <input type="datetime-local" class="wp-input" id="wpScheduleAt" value="${escapeHtml(options.scheduleAt || '')}">
            <p class="wp-form-hint">未来の日時のみ指定できます</p>
            <p class="wp-form-error" id="wpScheduleError" style="display: none;"></p>
          </div>
          <div class="wp-form-group">
            <div class="wp-editor-header">
              <label for="wpBody">本文（Markdown）</label>
              <span class="wp-char-count" id="wpCharCount">${options.charCount.toLocaleString()}文字</span>
            </div>
            <div class="wp-editor-toolbar" role="toolbar" aria-label="Markdown編集">
              <button type="button" class="wp-tool-btn" data-action="bold" title="太字">B</button>
              <button type="button" class="wp-tool-btn" data-action="italic" title="斜体">I</button>
              <button type="button" class="wp-tool-btn" data-action="heading" title="見出し">H2</button>
              <button type="button" class="wp-tool-btn" data-action="link" title="リンク">Link</button>
              <button type="button" class="wp-tool-btn" data-action="ul" title="箇条書き">-</button>
              <button type="button" class="wp-tool-btn" data-action="ol" title="番号リスト">1.</button>
              <button type="button" class="wp-tool-btn" data-action="quote" title="引用">&gt;</button>
              <button type="button" class="wp-tool-btn" data-action="code" title="インラインコード">&#96;</button>
              <button type="button" class="wp-tool-btn" data-action="codeblock" title="コードブロック">Code</button>
              <button type="button" class="wp-tool-btn" data-action="hr" title="区切り線">HR</button>
            </div>
            <textarea class="wp-textarea" id="wpBody" rows="9">${escapeHtml(options.body || '')}</textarea>
            <div class="wp-preview-actions">
              <button type="button" class="wp-tool-btn wp-preview-btn" data-preview="toggle">プレビュー</button>
              <button type="button" class="wp-tool-btn wp-expand-btn" data-expand="toggle">拡大</button>
            </div>
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

    const previewOverlay = document.createElement('div');
    previewOverlay.className = 'wp-preview-overlay';
    previewOverlay.style.display = 'none';
    previewOverlay.innerHTML = `
      <div class="wp-preview-modal" role="dialog" aria-modal="true" aria-label="プレビュー">
        <div class="wp-preview-header">
          <h3>プレビュー</h3>
          <button type="button" class="wp-preview-close" title="閉じる">×</button>
        </div>
        <div class="wp-preview-body">
          <div class="wp-preview-content" id="wpPreviewContent"></div>
        </div>
      </div>
    `;
    overlay.appendChild(previewOverlay);

    const scheduleGroup = overlay.querySelector('#wpScheduleGroup');
    const scheduleInput = overlay.querySelector('#wpScheduleAt');
    const scheduleError = overlay.querySelector('#wpScheduleError');
    const bodyEditor = overlay.querySelector('#wpBody');
    const charCount = overlay.querySelector('#wpCharCount');
    const previewBtn = overlay.querySelector('.wp-preview-btn');
    const expandBtn = overlay.querySelector('.wp-expand-btn');
    const previewContent = overlay.querySelector('#wpPreviewContent');
    const previewClose = overlay.querySelector('.wp-preview-close');
    const selectionState = { start: 0, end: 0 };
    let editorExpanded = false;

    function updateScheduleVisibility() {
      const status = overlay.querySelector('input[name="wpStatus"]:checked')?.value;
      const show = status === 'future';
      scheduleGroup.style.display = show ? 'block' : 'none';
      if (!show) {
        scheduleError.style.display = 'none';
        scheduleError.textContent = '';
      }
    }

    overlay.querySelectorAll('input[name="wpStatus"]').forEach((radio) => {
      radio.addEventListener('change', updateScheduleVisibility);
    });
    updateScheduleVisibility();

    function updateCharCount() {
      if (!bodyEditor || !charCount) return;
      charCount.textContent = `${bodyEditor.value.length.toLocaleString()}文字`;
    }

    function setEditorExpanded(expanded) {
      editorExpanded = expanded;
      overlay.classList.toggle('wp-editor-expanded', expanded);
      if (expandBtn) {
        expandBtn.textContent = expanded ? '縮小' : '拡大';
      }
    }

    function openPreview() {
      if (!previewOverlay || !previewContent || !bodyEditor) return;
      previewContent.innerHTML = convertMarkdownToHtml(bodyEditor.value);
      previewOverlay.style.display = 'flex';
    }

    function closePreview() {
      if (!previewOverlay) return;
      previewOverlay.style.display = 'none';
    }

    function captureSelection() {
      if (!bodyEditor) return;
      if (typeof bodyEditor.selectionStart === 'number') {
        selectionState.start = bodyEditor.selectionStart;
        selectionState.end = bodyEditor.selectionEnd || bodyEditor.selectionStart;
      }
    }

    function getSelectionRange() {
      if (!bodyEditor) return { start: 0, end: 0 };
      if (document.activeElement !== bodyEditor) {
        return { start: selectionState.start, end: selectionState.end };
      }
      return {
        start: typeof bodyEditor.selectionStart === 'number' ? bodyEditor.selectionStart : selectionState.start,
        end: typeof bodyEditor.selectionEnd === 'number' ? bodyEditor.selectionEnd : selectionState.end
      };
    }

    function focusEditorWithoutScroll() {
      if (!bodyEditor) return;
      try {
        bodyEditor.focus({ preventScroll: true });
      } catch {
        bodyEditor.focus();
      }
    }

    function updateEditorValue(nextValue, selectionStart, selectionEnd) {
      if (!bodyEditor) return;
      const scrollTop = bodyEditor.scrollTop;
      bodyEditor.value = nextValue;
      focusEditorWithoutScroll();
      bodyEditor.setSelectionRange(selectionStart, selectionEnd);
      bodyEditor.scrollTop = scrollTop;
      selectionState.start = selectionStart;
      selectionState.end = selectionEnd;
      updateCharCount();
    }

    function wrapSelection(before, after) {
      if (!bodyEditor) return;
      const value = bodyEditor.value;
      const { start, end } = getSelectionRange();
      const selected = value.slice(start, end);
      const insert = `${before}${selected}${after}`;
      const nextValue = value.slice(0, start) + insert + value.slice(end);
      const cursorStart = start + before.length;
      const cursorEnd = cursorStart + selected.length;
      updateEditorValue(nextValue, cursorStart, cursorEnd);
    }

    function insertLink() {
      if (!bodyEditor) return;
      const value = bodyEditor.value;
      const { start, end } = getSelectionRange();
      const selected = value.slice(start, end);
      const text = selected || 'text';
      const url = 'https://';
      const insert = `[${text}](${url})`;
      const nextValue = value.slice(0, start) + insert + value.slice(end);
      const urlStart = start + 2 + text.length;
      const urlEnd = urlStart + url.length;
      updateEditorValue(nextValue, urlStart, urlEnd);
    }

    function prefixLines(prefix, ordered = false) {
      if (!bodyEditor) return;
      const value = bodyEditor.value;
      const { start, end } = getSelectionRange();
      const lineStart = value.lastIndexOf('\n', start - 1) + 1;
      const lineEnd = (() => {
        const index = value.indexOf('\n', end);
        return index === -1 ? value.length : index;
      })();
      const block = value.slice(lineStart, lineEnd);
      const lines = block.split('\n');
      const updated = lines.map((line, idx) => {
        if (ordered) return `${idx + 1}. ${line}`;
        return `${prefix}${line}`;
      }).join('\n');
      const nextValue = value.slice(0, lineStart) + updated + value.slice(lineEnd);
      updateEditorValue(nextValue, lineStart, lineStart + updated.length);
    }

    function insertCodeBlock() {
      if (!bodyEditor) return;
      const value = bodyEditor.value;
      const { start, end } = getSelectionRange();
      const selected = value.slice(start, end);
      const before = '```\n';
      const after = '\n```';
      const insert = selected ? `${before}${selected}${after}` : `${before}${after}`;
      const nextValue = value.slice(0, start) + insert + value.slice(end);
      const cursorStart = start + before.length;
      const cursorEnd = selected ? cursorStart + selected.length : cursorStart;
      updateEditorValue(nextValue, cursorStart, cursorEnd);
    }

    function insertHorizontalRule() {
      if (!bodyEditor) return;
      const value = bodyEditor.value;
      const { start, end } = getSelectionRange();
      let insert = '---';
      if (start > 0 && value[start - 1] !== '\n') {
        insert = `\n${insert}`;
      }
      insert = `${insert}\n`;
      const nextValue = value.slice(0, start) + insert + value.slice(end);
      const cursor = start + insert.length;
      updateEditorValue(nextValue, cursor, cursor);
    }

    if (bodyEditor) {
      const selectionEvents = ['keyup', 'click', 'select', 'mouseup', 'focus'];
      selectionEvents.forEach((eventName) => {
        bodyEditor.addEventListener(eventName, captureSelection);
      });
      bodyEditor.addEventListener('input', () => {
        captureSelection();
        updateCharCount();
      });
      captureSelection();
    }

    if (previewBtn) {
      previewBtn.addEventListener('click', () => {
        openPreview();
      });
    }

    if (expandBtn) {
      expandBtn.addEventListener('click', () => {
        setEditorExpanded(!editorExpanded);
      });
    }

    if (previewClose) {
      previewClose.addEventListener('click', () => {
        closePreview();
        focusEditorWithoutScroll();
      });
    }

    if (previewOverlay) {
      previewOverlay.addEventListener('click', (event) => {
        if (event.target === previewOverlay) {
          closePreview();
          focusEditorWithoutScroll();
        }
      });
    }

    overlay.querySelectorAll('.wp-tool-btn').forEach((button) => {
      button.addEventListener('mousedown', (event) => {
        captureSelection();
        event.preventDefault();
      });
    });

    overlay.querySelectorAll('.wp-tool-btn[data-action]').forEach((button) => {
      button.addEventListener('click', () => {
        focusEditorWithoutScroll();
        const action = button.getAttribute('data-action');
        switch (action) {
          case 'bold':
            wrapSelection('**', '**');
            break;
          case 'italic':
            wrapSelection('*', '*');
            break;
          case 'heading':
            prefixLines('## ');
            break;
          case 'code':
            wrapSelection('`', '`');
            break;
          case 'link':
            insertLink();
            break;
          case 'ul':
            prefixLines('- ');
            break;
          case 'ol':
            prefixLines('', true);
            break;
          case 'quote':
            prefixLines('> ');
            break;
          case 'codeblock':
            insertCodeBlock();
            break;
          case 'hr':
            insertHorizontalRule();
            break;
          default:
            break;
        }
      });
    });

    // イベントリスナー
    overlay.querySelector('.wp-dialog-close').addEventListener('click', options.onCancel);
    overlay.querySelector('.wp-cancel-btn').addEventListener('click', options.onCancel);
    overlay.querySelector('.wp-submit-btn').addEventListener('click', () => {
      const title = overlay.querySelector('#wpTitle').value;
      const categories = overlay.querySelector('#wpCategories').value.split(',').map(s => s.trim()).filter(Boolean);
      const tags = overlay.querySelector('#wpTags').value.split(',').map(s => s.trim()).filter(Boolean);
      const status = overlay.querySelector('input[name="wpStatus"]:checked').value;
      const scheduleAt = scheduleInput?.value || '';
      const body = bodyEditor ? bodyEditor.value : (options.body || '');

      // オプションを更新
      options.title = title;
      options.categories = categories;
      options.tags = tags;
      options.body = body;

      if (status === 'future') {
        if (!scheduleAt) {
          scheduleError.textContent = '予約投稿するには公開日時を入力してください';
          scheduleError.style.display = 'block';
          return;
        }
        if (!isFutureDatetimeLocal(scheduleAt)) {
          scheduleError.textContent = '未来の日時を入力してください';
          scheduleError.style.display = 'block';
          return;
        }
      }

      options.onConfirm({ status, scheduleAt, body });
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
      } catch {
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
   * 日時を datetime-local 用の値に変換
   */
  function toDatetimeLocalValue(value) {
    if (!value) return '';

    if (value instanceof Date) {
      return formatDateToDatetimeLocal(value);
    }

    const str = String(value).trim();
    if (!str) return '';

    // すでに datetime-local 形式（秒なし/あり）
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(str)) return str;
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(str)) return str.slice(0, 16);

    // "YYYY-MM-DD HH:MM" など
    if (/^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}$/.test(str)) {
      return str.replace(/\s+/, 'T');
    }

    const parsed = new Date(str);
    if (isNaN(parsed.getTime())) return '';
    return formatDateToDatetimeLocal(parsed);
  }

  function formatDateToDatetimeLocal(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hour = String(date.getHours()).padStart(2, '0');
    const minute = String(date.getMinutes()).padStart(2, '0');
    return `${year}-${month}-${day}T${hour}:${minute}`;
  }

  function isFutureDatetimeLocal(value) {
    if (!value) return false;
    const parsed = new Date(String(value));
    if (isNaN(parsed.getTime())) return false;
    return parsed.getTime() > Date.now();
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
    } catch {
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
