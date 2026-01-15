/**
 * ブログ投稿アシスタント - Content Script
 * ChatGPT, Claude, Gemini のページでマークダウンコードブロックを検出
 */

(function() {
  'use strict';

  // 処理済みブロックを追跡
  const processedBlocks = new WeakSet();
  const COPY_BUTTON_SELECTORS = [
    'button[aria-label="コピーする"]',
    'button[aria-label="Copy code"]',
    'button[aria-label="Copy"]'
  ];

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

    let resizeTimer = null;
    window.addEventListener('resize', () => {
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(scanForMarkdownBlocks, 300);
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
   * 重複しないコードブロックを取得
   */
  function getUniqueCodeBlocks(root) {
    const candidates = root.querySelectorAll('code.language-markdown, pre code, pre');
    const unique = [];
    const seen = new WeakSet();

    candidates.forEach(node => {
      const canonical = normalizeCodeBlock(node);
      if (!canonical || seen.has(canonical)) return;
      seen.add(canonical);
      unique.push(canonical);
    });

    return unique;
  }

  function normalizeCodeBlock(node) {
    if (!node || !node.tagName) return null;
    if (node.tagName === 'PRE') {
      const code = node.querySelector('code');
      return code || node;
    }
    return node;
  }

  /**
   * マークダウンコードブロックをスキャン
   */
  function scanForMarkdownBlocks() {
    const platform = detectPlatform();
    const parentSelector = getParentContainerSelector(platform);

    // 1. プラットフォーム固有のアシスタントメッセージを検索
    const assistantSelector = getAssistantMessageSelector(platform);
    if (assistantSelector) {
      const messages = document.querySelectorAll(assistantSelector);
      messages.forEach(msg => {
        // 先にメッセージ内のコードブロックを処理（コピー按钮の位置に追従させるため）
        const blocks = getUniqueCodeBlocks(msg);
        let handledInMessage = false;

        blocks.forEach(block => {
          const content = block.textContent || '';
          if (!isMarkdownContent(content, block)) return;
          const inlineTarget = findInlineTarget(block);
          if (processedBlocks.has(block)) {
            if (inlineTarget) {
              syncActionGroupLayout(block, inlineTarget);
              syncInlineButton(block, inlineTarget);
            }
            return;
          }
          processedBlocks.add(block);
          addPostButton(block, content, platform);
          handledInMessage = true;
        });

        if (handledInMessage) {
          return;
        }

        if (processedBlocks.has(msg)) return;

        // 親コンテナに既にボタンがある場合はスキップ（重複防止）
        if (parentSelector) {
          const parent = msg.closest(parentSelector);
          if (parent && parent.querySelector('.wp-post-btn, .wp-post-btn-wrapper')) return;
        }

        const content = msg.innerText || msg.textContent || '';

        // マークダウンコンテンツかチェック
        if (isMarkdownContent(content, msg)) {
          processedBlocks.add(msg);
          addPostButton(msg, content, platform);
        }
      });
    }

    // 2. ページ全体のコードブロックも検索
    {
      const codeBlocks = getUniqueCodeBlocks(document);

      codeBlocks.forEach(block => {
        const content = block.textContent || '';
        if (!isMarkdownContent(content, block)) return;
        const inlineTarget = findInlineTarget(block);

        if (processedBlocks.has(block)) {
          if (inlineTarget) {
            syncActionGroupLayout(block, inlineTarget);
            syncInlineButton(block, inlineTarget);
          }
          return;
        }

        // 既にボタンがある親要素はスキップ
        if (block.closest('.wp-post-btn-wrapper')) return;
        if (parentSelector) {
          const parent = block.closest(parentSelector);
          if (parent && parent.querySelector('.wp-post-btn-wrapper')) return;
        }

        processedBlocks.add(block);
        addPostButton(block, content, platform);
      });
    }
  }

  /**
   * マークダウンコンテンツかどうか判定
   */
  function isMarkdownContent(content, element) {
    const trimmed = content.trim();
    if (!trimmed) return false;

    // Front Matterがある（ブログ記事の可能性が高い）
    const hasFrontMatter = /^---\s*\n[\s\S]*?\n---/.test(trimmed);
    if (hasFrontMatter) return true;

    // H1またはH2見出しがある + マークダウン構文がある
    const hasH1 = /^#\s+.+$/m.test(trimmed);
    const hasH2 = /^##\s+.+$/m.test(trimmed);
    const hasMarkdownSyntax = /(\*\*|__|\[.+\]\(.+\)|```|^\s*[-*+]\s|\|.+\|)/m.test(trimmed);

    // 最低限の長さチェック（短すぎる場合は除外）
    const isLongEnough = trimmed.length > 200;

    if ((hasH1 || hasH2) && hasMarkdownSyntax && isLongEnough) return true;

    const hasHtmlArticleTags = /<(h1|h2|h3|p|div|img|ol|ul|li|nav|footer|section|article|script)\b/i.test(trimmed);
    if (hasHtmlArticleTags && isLongEnough) return true;

    if (element && element.classList && element.classList.contains('language-markdown') && isLongEnough) {
      return true;
    }

    return false;
  }

  /**
   * 投稿ボタンを追加
   */
  function addPostButton(block, content, platform) {
    // ボタンを配置する要素を決定
    const targetElement = resolveTargetElement(block);
    if (!targetElement) return;

    // 既にボタンがあるかチェック
    if (targetElement.querySelector('.wp-post-btn-wrapper')) return;
    // 親要素にも既にボタンがないかチェック（重複防止）
    if (targetElement.closest('.wp-post-btn-wrapper')) return;

    const inlineTarget = findInlineTarget(block);
    const infoTarget = findInfoSourceTarget(block, platform);
    const baseButton = createPostButton(inlineTarget ? '投稿' : '📤 WPに投稿', content);

    let attachedInline = false;
    let attachedInfo = false;

    if (inlineTarget) {
      const toolbar = resolveActionContainer(inlineTarget.button, block);
      if (toolbar && !toolbar.querySelector('.wp-post-btn-inline')) {
        baseButton.classList.add('wp-post-btn-inline');
        inlineTarget.button.insertAdjacentElement('beforebegin', baseButton);
        syncActionGroupLayout(block, inlineTarget);
        attachedInline = true;
      }
    }

    if (infoTarget) {
      attachedInfo = attachInfoPostButton(infoTarget, content);
    }

    if (attachedInline || attachedInfo) return;

    // ラッパーを作成
    const wrapper = document.createElement('div');
    wrapper.className = 'wp-post-btn-wrapper';

    wrapper.appendChild(baseButton);

    // 要素内に配置
    targetElement.style.position = 'relative';
    targetElement.appendChild(wrapper);
  }

  function createPostButton(label, content) {
    const button = document.createElement('button');
    button.className = 'wp-post-btn';
    button.type = 'button';
    button.textContent = label;
    button.title = 'WordPressに投稿';

    button.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      showConfirmDialog(content);
    });

    return button;
  }

  function attachInfoPostButton(infoTarget, content) {
    if (!infoTarget || !(infoTarget instanceof HTMLElement)) return false;
    const parent = infoTarget.parentElement;
    if (!parent) return false;
    if (parent.querySelector('.wp-post-btn-info')) return false;

    let wrapper = parent.querySelector('.wp-post-info-group');
    if (!wrapper) {
      wrapper = document.createElement('div');
      wrapper.className = 'wp-post-info-group';
      parent.insertBefore(wrapper, infoTarget);
      wrapper.appendChild(infoTarget);
    }

    const infoButton = createPostButton('投稿', content);
    infoButton.classList.add('wp-post-btn-inline', 'wp-post-btn-info');
    wrapper.appendChild(infoButton);
    return true;
  }

  function resolveTargetElement(block) {
    if (!block || !block.tagName) return null;
    if (block.tagName === 'CODE') {
      return block.closest('pre') || block.parentElement || block;
    }
    if (block.tagName === 'PRE') return block;
    return block;
  }

  /**
   * コピーボタンの位置に追従させる対象を探す
   */
  function findInlineTarget(block) {
    const selector = COPY_BUTTON_SELECTORS.join(',');
    const copyButtonLabels = new Set([
      'コピーする',
      'コードをコピーする',
      'Copy code',
      'Copy'
    ]);
    let current = block;
    let depth = 0;
    const maxDepth = 8;

    while (current && depth < maxDepth) {
      const container = current.parentElement;
      if (!container) break;
      let button = container.querySelector(selector);
      if (!button) {
        const buttons = container.querySelectorAll('button');
        for (const candidate of buttons) {
          const label = (candidate.getAttribute('aria-label') || candidate.textContent || '').trim();
          if (copyButtonLabels.has(label)) {
            button = candidate;
            break;
          }
        }
      }
      if (button) {
        markCopyButton(button);
        return { button };
      }
      current = container;
      depth += 1;
    }

    return null;
  }

  function findInfoSourceTarget(block, platform) {
    if (platform !== 'chatgpt') return null;
    const targetRoot = resolveTargetElement(block);
    if (!targetRoot) return null;

    let current = targetRoot;
    let depth = 0;
    const maxDepth = 10;

    while (current && depth < maxDepth) {
      const buttons = current.querySelectorAll('button');
      for (const candidate of buttons) {
        const text = (candidate.textContent || '').trim();
        if (text.includes('情報源')) {
          return candidate;
        }
      }
      current = current.parentElement;
      depth += 1;
    }

    const fallbackButtons = document.querySelectorAll('button');
    for (const candidate of fallbackButtons) {
      const text = (candidate.textContent || '').trim();
      if (text.includes('情報源')) {
        return candidate;
      }
    }

    return null;
  }

  function resolveActionContainer(button, block) {
    if (!button || !button.parentElement) return null;
    markCopyButton(button);
    const scrollContainer = block ? findScrollableContainer(block) : null;
    if (scrollContainer) {
      let group = scrollContainer.querySelector('.wp-post-action-group');
      if (!group) {
        group = document.createElement('div');
        group.className = 'wp-post-action-group wp-post-action-group-sticky';
        scrollContainer.insertBefore(group, scrollContainer.firstChild);
      } else {
        group.classList.add('wp-post-action-group-sticky');
      }

      const previousParent = button.parentElement;
      if (!group.contains(button)) {
        group.appendChild(button);
      }
      if (previousParent && previousParent !== group) {
        const inlineButtons = previousParent.querySelectorAll('.wp-post-btn-inline');
        inlineButtons.forEach((inlineButton) => {
          if (!group.contains(inlineButton)) {
            group.insertBefore(inlineButton, button);
          }
        });
      }
      return group;
    }

    const parent = button.parentElement;
    const existingGroup = parent.querySelector('.wp-post-action-group');
    if (existingGroup) return existingGroup;

    const hasJustifyBetween = parent.classList && parent.classList.contains('justify-between');
    let isFlexSpaceBetween = false;
    if (parent instanceof HTMLElement) {
      const style = window.getComputedStyle(parent);
      isFlexSpaceBetween = style.display.includes('flex') && style.justifyContent === 'space-between';
    }

    if (hasJustifyBetween || isFlexSpaceBetween) {
      const group = document.createElement('div');
      group.className = 'wp-post-action-group';
      parent.appendChild(group);
      group.appendChild(button);
      return group;
    }

    return parent;
  }

  function markCopyButton(button) {
    if (!button || !(button instanceof HTMLElement)) return;
    button.classList.add('wp-post-copy-btn');
  }

  function syncInlineButton(block, inlineTarget) {
    const targetElement = resolveTargetElement(block);
    if (!targetElement) return;
    const toolbar = resolveActionContainer(inlineTarget.button, block);
    if (!toolbar) return;
    const existingInline = toolbar.querySelector('.wp-post-btn-inline');
    if (existingInline) return;

    const wrapper = targetElement.querySelector('.wp-post-btn-wrapper');
    if (!wrapper) return;
    const existingButton = wrapper.querySelector('.wp-post-btn');
    if (!existingButton) return;

    existingButton.classList.add('wp-post-btn-inline');
    existingButton.textContent = '投稿';
    inlineTarget.button.insertAdjacentElement('beforebegin', existingButton);
    syncActionGroupLayout(block, inlineTarget);
    wrapper.remove();
  }

  function updateActionGroupSize(block, inlineTarget) {
    const toolbar = resolveActionContainer(inlineTarget.button, block);
    if (!toolbar) return;
    const isLarge = isExpandedEditor(block);
    toolbar.classList.toggle('wp-post-action-group-large', isLarge);
  }

  function updateActionGroupSticky(block, inlineTarget) {
    const toolbar = resolveActionContainer(inlineTarget.button, block);
    if (!toolbar) return;
    const scrollContainer = findScrollableContainer(block);
    toolbar.classList.toggle('wp-post-action-group-sticky', !!scrollContainer);
  }

  function syncActionGroupLayout(block, inlineTarget) {
    updateActionGroupSize(block, inlineTarget);
    updateActionGroupSticky(block, inlineTarget);
  }

  function isExpandedEditor(block) {
    const container = findEditorContainer(block);
    if (!container) return false;
    return container.getBoundingClientRect().height >= 320;
  }

  function findEditorContainer(block) {
    return findScrollableContainer(block) || resolveTargetElement(block);
  }

  function findScrollableContainer(block) {
    let current = resolveTargetElement(block);
    const blockPre = block && block.closest ? block.closest('pre') : null;
    let depth = 0;
    const maxDepth = 10;

    while (current && depth < maxDepth) {
      if (current instanceof HTMLElement) {
        if (blockPre && !blockPre.contains(current)) {
          current = current.parentElement;
          depth += 1;
          continue;
        }
        const className = current.className || '';
        if (typeof className === 'string' && /overflow-y-(auto|scroll)/.test(className)) {
          return current;
        }
        const style = window.getComputedStyle(current);
        if (style && /(auto|scroll)/.test(style.overflowY)) {
          return current;
        }
      }
      current = current.parentElement;
      depth += 1;
    }

    return null;
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
              <div class="wp-editor-header-actions">
                <span class="wp-char-count" id="wpCharCount">${options.charCount.toLocaleString()}文字</span>
                <button type="button" class="wp-tool-btn wp-preview-btn" data-preview="toggle">プレビュー</button>
                <button type="button" class="wp-tool-btn wp-expand-btn" data-expand="toggle">拡大</button>
              </div>
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

    const editorOverlay = document.createElement('div');
    editorOverlay.className = 'wp-editor-overlay';
    editorOverlay.style.display = 'none';
    editorOverlay.innerHTML = `
      <div class="wp-editor-modal" role="dialog" aria-modal="true" aria-label="本文編集">
        <div class="wp-editor-modal-header">
          <h3>本文編集</h3>
          <div class="wp-editor-modal-actions">
            <span class="wp-char-count" id="wpExpandedCharCount">${options.charCount.toLocaleString()}文字</span>
            <button type="button" class="wp-tool-btn wp-editor-close">閉じる</button>
          </div>
        </div>
        <div class="wp-editor-modal-body"></div>
      </div>
    `;
    overlay.appendChild(editorOverlay);

    const scheduleGroup = overlay.querySelector('#wpScheduleGroup');
    const scheduleInput = overlay.querySelector('#wpScheduleAt');
    const scheduleError = overlay.querySelector('#wpScheduleError');
    const bodyEditor = overlay.querySelector('#wpBody');
    const charCount = overlay.querySelector('#wpCharCount');
    const mainToolbar = overlay.querySelector('.wp-editor-toolbar');
    const previewBtn = overlay.querySelector('.wp-preview-btn');
    const expandBtn = overlay.querySelector('.wp-expand-btn');
    const previewContent = overlay.querySelector('#wpPreviewContent');
    const previewClose = overlay.querySelector('.wp-preview-close');
    const editorOverlayEl = overlay.querySelector('.wp-editor-overlay');
    const editorModalBody = editorOverlayEl ? editorOverlayEl.querySelector('.wp-editor-modal-body') : null;
    const expandedCharCount = overlay.querySelector('#wpExpandedCharCount');
    const editorClose = overlay.querySelector('.wp-editor-close');
    let expandedEditor = null;
    let expandedToolbar = null;
    const mainSelectionState = { start: 0, end: 0 };
    const expandedSelectionState = { start: 0, end: 0 };
    const selectionEvents = ['keyup', 'click', 'select', 'mouseup', 'focus'];

    if (editorModalBody && mainToolbar) {
      expandedToolbar = mainToolbar.cloneNode(true);
      editorModalBody.appendChild(expandedToolbar);
      expandedEditor = document.createElement('textarea');
      expandedEditor.className = 'wp-textarea wp-textarea-expanded';
      expandedEditor.id = 'wpBodyExpanded';
      expandedEditor.rows = 16;
      expandedEditor.value = options.body || '';
      editorModalBody.appendChild(expandedEditor);
    }

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

    function updateCharCount(value) {
      const text = typeof value === 'string' ? value : (bodyEditor ? bodyEditor.value : '');
      const length = text.length;
      if (charCount) charCount.textContent = `${length.toLocaleString()}文字`;
      if (expandedCharCount) expandedCharCount.textContent = `${length.toLocaleString()}文字`;
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

    function openEditorModal() {
      if (!editorOverlayEl || !expandedEditor || !bodyEditor) return;
      expandedEditor.value = bodyEditor.value;
      updateCharCount(bodyEditor.value);
      editorOverlayEl.style.display = 'flex';
      const { start, end } = getSelectionRange(bodyEditor);
      focusEditorWithoutScroll(expandedEditor);
      expandedEditor.setSelectionRange(start, end);
      expandedSelectionState.start = start;
      expandedSelectionState.end = end;
    }

    function closeEditorModal() {
      if (!editorOverlayEl || !expandedEditor || !bodyEditor) return;
      const { start, end } = getSelectionRange(expandedEditor);
      bodyEditor.value = expandedEditor.value;
      updateCharCount(bodyEditor.value);
      editorOverlayEl.style.display = 'none';
      focusEditorWithoutScroll(bodyEditor);
      bodyEditor.setSelectionRange(start, end);
      mainSelectionState.start = start;
      mainSelectionState.end = end;
    }

    function getSelectionState(editor) {
      return editor === expandedEditor ? expandedSelectionState : mainSelectionState;
    }

    function captureSelection(editor) {
      if (!editor) return;
      const state = getSelectionState(editor);
      if (typeof editor.selectionStart === 'number') {
        state.start = editor.selectionStart;
        state.end = editor.selectionEnd || editor.selectionStart;
      }
    }

    function getSelectionRange(editor) {
      if (!editor) return { start: 0, end: 0 };
      const state = getSelectionState(editor);
      if (document.activeElement !== editor) {
        return { start: state.start, end: state.end };
      }
      return {
        start: typeof editor.selectionStart === 'number' ? editor.selectionStart : state.start,
        end: typeof editor.selectionEnd === 'number' ? editor.selectionEnd : state.end
      };
    }

    function focusEditorWithoutScroll(editor) {
      if (!editor) return;
      try {
        editor.focus({ preventScroll: true });
      } catch {
        editor.focus();
      }
    }

    function syncEditorValues(sourceEditor, value) {
      if (sourceEditor === bodyEditor && expandedEditor) {
        expandedEditor.value = value;
      }
      if (sourceEditor === expandedEditor && bodyEditor) {
        bodyEditor.value = value;
      }
    }

    function updateEditorValue(editor, nextValue, selectionStart, selectionEnd) {
      if (!editor) return;
      const scrollTop = editor.scrollTop;
      editor.value = nextValue;
      syncEditorValues(editor, nextValue);
      focusEditorWithoutScroll(editor);
      editor.setSelectionRange(selectionStart, selectionEnd);
      editor.scrollTop = scrollTop;
      const state = getSelectionState(editor);
      state.start = selectionStart;
      state.end = selectionEnd;
      updateCharCount(nextValue);
    }

    function wrapSelection(editor, before, after) {
      if (!editor) return;
      const value = editor.value;
      const { start, end } = getSelectionRange(editor);
      const selected = value.slice(start, end);
      const insert = `${before}${selected}${after}`;
      const nextValue = value.slice(0, start) + insert + value.slice(end);
      const cursorStart = start + before.length;
      const cursorEnd = cursorStart + selected.length;
      updateEditorValue(editor, nextValue, cursorStart, cursorEnd);
    }

    function insertLink(editor) {
      if (!editor) return;
      const value = editor.value;
      const { start, end } = getSelectionRange(editor);
      const selected = value.slice(start, end);
      const text = selected || 'text';
      const url = 'https://';
      const insert = `[${text}](${url})`;
      const nextValue = value.slice(0, start) + insert + value.slice(end);
      const urlStart = start + 2 + text.length;
      const urlEnd = urlStart + url.length;
      updateEditorValue(editor, nextValue, urlStart, urlEnd);
    }

    function prefixLines(editor, prefix, ordered = false) {
      if (!editor) return;
      const value = editor.value;
      const { start, end } = getSelectionRange(editor);
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
      updateEditorValue(editor, nextValue, lineStart, lineStart + updated.length);
    }

    function insertCodeBlock(editor) {
      if (!editor) return;
      const value = editor.value;
      const { start, end } = getSelectionRange(editor);
      const selected = value.slice(start, end);
      const before = '```\n';
      const after = '\n```';
      const insert = selected ? `${before}${selected}${after}` : `${before}${after}`;
      const nextValue = value.slice(0, start) + insert + value.slice(end);
      const cursorStart = start + before.length;
      const cursorEnd = selected ? cursorStart + selected.length : cursorStart;
      updateEditorValue(editor, nextValue, cursorStart, cursorEnd);
    }

    function insertHorizontalRule(editor) {
      if (!editor) return;
      const value = editor.value;
      const { start, end } = getSelectionRange(editor);
      let insert = '---';
      if (start > 0 && value[start - 1] !== '\n') {
        insert = `\n${insert}`;
      }
      insert = `${insert}\n`;
      const nextValue = value.slice(0, start) + insert + value.slice(end);
      const cursor = start + insert.length;
      updateEditorValue(editor, nextValue, cursor, cursor);
    }

    function handleEditorInput(editor) {
      if (!editor) return;
      captureSelection(editor);
      syncEditorValues(editor, editor.value);
      updateCharCount(editor.value);
    }

    function bindSelectionTracking(editor) {
      if (!editor) return;
      selectionEvents.forEach((eventName) => {
        editor.addEventListener(eventName, () => captureSelection(editor));
      });
      editor.addEventListener('input', () => {
        handleEditorInput(editor);
      });
      captureSelection(editor);
    }

    function bindTrigger(button, editor, handler) {
      if (!button) return;
      button.addEventListener('mousedown', (event) => {
        captureSelection(editor);
        event.preventDefault();
      });
      button.addEventListener('click', handler);
    }

    function handleToolbarAction(action, editor) {
      switch (action) {
        case 'bold':
          wrapSelection(editor, '**', '**');
          break;
        case 'italic':
          wrapSelection(editor, '*', '*');
          break;
        case 'heading':
          prefixLines(editor, '## ');
          break;
        case 'code':
          wrapSelection(editor, '`', '`');
          break;
        case 'link':
          insertLink(editor);
          break;
        case 'ul':
          prefixLines(editor, '- ');
          break;
        case 'ol':
          prefixLines(editor, '', true);
          break;
        case 'quote':
          prefixLines(editor, '> ');
          break;
        case 'codeblock':
          insertCodeBlock(editor);
          break;
        case 'hr':
          insertHorizontalRule(editor);
          break;
        default:
          break;
      }
    }

    function bindToolbar(toolbar, editor) {
      if (!toolbar || !editor) return;
      toolbar.querySelectorAll('.wp-tool-btn').forEach((button) => {
        button.addEventListener('mousedown', (event) => {
          captureSelection(editor);
          event.preventDefault();
        });
      });
      toolbar.querySelectorAll('.wp-tool-btn[data-action]').forEach((button) => {
        button.addEventListener('click', () => {
          focusEditorWithoutScroll(editor);
          const action = button.getAttribute('data-action');
          handleToolbarAction(action, editor);
        });
      });
    }

    bindSelectionTracking(bodyEditor);
    bindSelectionTracking(expandedEditor);

    bindToolbar(mainToolbar, bodyEditor);
    bindToolbar(expandedToolbar, expandedEditor);

    bindTrigger(previewBtn, bodyEditor, openPreview);
    bindTrigger(expandBtn, bodyEditor, openEditorModal);

    if (editorClose) {
      editorClose.addEventListener('click', () => {
        closeEditorModal();
      });
    }

    if (editorOverlayEl) {
      editorOverlayEl.addEventListener('click', (event) => {
        if (event.target === editorOverlayEl) {
          closeEditorModal();
        }
      });
    }

    if (previewClose) {
      previewClose.addEventListener('click', () => {
        closePreview();
        focusEditorWithoutScroll(bodyEditor);
      });
    }

    if (previewOverlay) {
      previewOverlay.addEventListener('click', (event) => {
        if (event.target === previewOverlay) {
          closePreview();
          focusEditorWithoutScroll(bodyEditor);
        }
      });
    }

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
   * 安全なHTMLサニタイザー（ホワイトリスト方式）
   * XSS攻撃を防ぐため、許可されたタグと属性のみを通過させる
   */
  function sanitizeHtml(html) {
    // ホワイトリスト: 許可するタグ
    const ALLOWED_TAGS = new Set([
      // 構造
      'p', 'div', 'span', 'br', 'hr',
      // 見出し
      'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
      // テキスト装飾
      'strong', 'b', 'em', 'i', 'u', 's', 'strike', 'del', 'ins',
      'sub', 'sup', 'small', 'mark', 'abbr', 'cite', 'q',
      // リスト
      'ul', 'ol', 'li', 'dl', 'dt', 'dd',
      // リンク・メディア
      'a', 'img',
      // テーブル
      'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption', 'colgroup', 'col',
      // 引用・コード
      'blockquote', 'pre', 'code', 'kbd', 'samp', 'var',
      // セマンティック
      'figure', 'figcaption', 'article', 'section', 'aside',
      'header', 'footer', 'main', 'nav', 'address', 'time',
      // ルビ（日本語用）
      'ruby', 'rt', 'rp',
      // その他
      'details', 'summary', 'wbr'
    ]);

    // ホワイトリスト: タグごとの許可属性
    const ALLOWED_ATTRIBUTES = {
      '*': ['class', 'id', 'title', 'lang', 'dir'],
      'a': ['href', 'target', 'rel', 'hreflang'],
      'img': ['src', 'alt', 'width', 'height', 'loading'],
      'td': ['colspan', 'rowspan', 'headers'],
      'th': ['colspan', 'rowspan', 'scope', 'headers'],
      'col': ['span'],
      'colgroup': ['span'],
      'ol': ['start', 'type', 'reversed'],
      'li': ['value'],
      'time': ['datetime'],
      'abbr': ['title'],
      'blockquote': ['cite'],
      'q': ['cite'],
      'del': ['cite', 'datetime'],
      'ins': ['cite', 'datetime'],
      'table': ['border']
    };

    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, 'text/html');

      // パースエラーチェック
      const parseError = doc.querySelector('parsererror');
      if (parseError) {
        console.warn('HTML parse error, returning escaped HTML');
        return escapeHtml(html);
      }

      const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_ELEMENT, null);
      const toRemove = [];

      while (walker.nextNode()) {
        const el = walker.currentNode;
        const tag = el.tagName.toLowerCase();

        // ホワイトリストにないタグは削除対象
        if (!ALLOWED_TAGS.has(tag)) {
          toRemove.push(el);
          continue;
        }

        // 許可された属性のみを残す
        const allowedForTag = [
          ...(ALLOWED_ATTRIBUTES['*'] || []),
          ...(ALLOWED_ATTRIBUTES[tag] || [])
        ];

        for (const attr of [...el.attributes]) {
          const name = attr.name.toLowerCase();
          const value = attr.value;

          // イベントハンドラは常に削除
          if (name.startsWith('on')) {
            el.removeAttribute(attr.name);
            continue;
          }

          // 許可リストにない属性は削除
          if (!allowedForTag.includes(name)) {
            el.removeAttribute(attr.name);
            continue;
          }

          // URL属性の検証
          if (name === 'href' || name === 'src') {
            if (isDangerousUrl(value)) {
              el.removeAttribute(attr.name);
            }
          }

          // aタグのtarget="_blank"にはrel="noopener noreferrer"を追加
          if (tag === 'a' && name === 'target' && value === '_blank') {
            const currentRel = el.getAttribute('rel') || '';
            if (!currentRel.includes('noopener')) {
              el.setAttribute('rel', (currentRel + ' noopener noreferrer').trim());
            }
          }
        }
      }

      // 削除対象の要素を処理（テキストは保持）
      toRemove.forEach(el => {
        const dangerousTags = ['script', 'style', 'noscript', 'iframe', 'object', 'embed'];
        if (!dangerousTags.includes(el.tagName.toLowerCase()) && el.textContent) {
          const textNode = document.createTextNode(el.textContent);
          el.parentNode?.replaceChild(textNode, el);
        } else {
          el.remove();
        }
      });

      return doc.body.innerHTML;
    } catch (error) {
      // エラー時は安全のためエスケープしたHTMLを返す（生HTMLは返さない）
      console.warn('Sanitization error, returning escaped HTML:', error);
      return escapeHtml(html);
    }
  }

  /**
   * 危険なURLを検出
   */
  function isDangerousUrl(value) {
    if (!value) return false;
    const trimmed = value.trim().toLowerCase();

    // javascript/vbscriptプロトコルをブロック
    if (trimmed.startsWith('javascript:') || trimmed.startsWith('vbscript:')) {
      return true;
    }

    // data: URLの検証
    if (trimmed.startsWith('data:')) {
      // SVGはスクリプトを含む可能性があるためブロック
      if (trimmed.startsWith('data:image/svg')) {
        return true;
      }
      // 安全な画像形式のみ許可
      if (/^data:image\/(png|jpe?g|gif|webp);base64,/i.test(trimmed)) {
        return false;
      }
      return true;
    }

    // その他の危険なプロトコルをブロック
    const dangerousProtocols = ['file:', 'ftp:', 'telnet:', 'ssh:'];
    for (const protocol of dangerousProtocols) {
      if (trimmed.startsWith(protocol)) {
        return true;
      }
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
