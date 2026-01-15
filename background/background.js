/**
 * ブログ投稿アシスタント - Background Service Worker
 * WordPress REST API との通信を担当
 */

function encodeBasicAuth(user, password) {
  const text = `${user}:${password}`;
  if (typeof TextEncoder === 'undefined') {
    return btoa(unescape(encodeURIComponent(text)));
  }
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function normalizeApplicationPassword(password) {
  return String(password ?? '').replace(/\s+/g, '');
}

// =============================================================================
// セキュリティ: 画像URL検証（SSRF対策）
// =============================================================================

const MAX_IMAGE_SIZE_BYTES = 10 * 1024 * 1024; // 10MB

// プライベート/ローカルIPパターン
const BLOCKED_IP_PATTERNS = [
  /^127\./,                          // Localhost
  /^10\./,                           // Private Class A
  /^172\.(1[6-9]|2\d|3[01])\./,     // Private Class B
  /^192\.168\./,                     // Private Class C
  /^169\.254\./,                     // Link-local
  /^0\./,                            // Current network
  /^224\./,                          // Multicast
  /^255\./,                          // Broadcast
];

/**
 * ホスト名がプライベート/ローカルIPかどうかを判定
 */
function isPrivateOrLocalHost(hostname) {
  // localhostのチェック
  if (hostname === 'localhost' || hostname.endsWith('.localhost')) {
    return true;
  }

  // IPv4アドレスのチェック
  const ipv4Match = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4Match) {
    for (const pattern of BLOCKED_IP_PATTERNS) {
      if (pattern.test(hostname)) {
        return true;
      }
    }
  }

  // IPv6 localhost
  if (hostname === '[::1]' || hostname === '::1') {
    return true;
  }

  return false;
}

/**
 * 画像URLを検証
 * @returns {{ valid: boolean, reason?: string }}
 */
function validateImageUrl(url) {
  try {
    const parsed = new URL(url);

    // http/httpsのみ許可
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return { valid: false, reason: 'Invalid protocol' };
    }

    // プライベート/ローカルIPをブロック
    if (isPrivateOrLocalHost(parsed.hostname)) {
      return { valid: false, reason: 'Private or local address not allowed' };
    }

    return { valid: true };
  } catch {
    return { valid: false, reason: 'Invalid URL' };
  }
}

/**
 * ファイル名をサニタイズ（パストラバーサル対策）
 */
function sanitizeFilename(filename) {
  // パストラバーサル攻撃を防ぐ
  let sanitized = filename.replace(/\.\./g, '');

  // ディレクトリ区切り文字を削除
  sanitized = sanitized.replace(/[/\\]/g, '');

  // null バイトを削除
  sanitized = sanitized.replace(/\0/g, '');

  // 安全な文字のみを残す（英数字、ハイフン、アンダースコア、ドット）
  sanitized = sanitized.replace(/[^a-zA-Z0-9._-]/g, '_');

  // 拡張子がない場合はデフォルトを追加
  if (!/\.[a-zA-Z0-9]+$/.test(sanitized)) {
    sanitized += '.jpg';
  }

  // 長さを制限
  if (sanitized.length > 200) {
    const ext = sanitized.match(/\.[a-zA-Z0-9]+$/)?.[0] || '.jpg';
    sanitized = sanitized.slice(0, 200 - ext.length) + ext;
  }

  // 空の場合はデフォルト名を使用
  if (!sanitized || sanitized === '.jpg') {
    sanitized = 'image_' + Date.now() + '.jpg';
  }

  return sanitized;
}

const TOKEN_TRANSPORT_HEADER = 'header';
const TOKEN_TRANSPORT_QUERY = 'query';

/**
 * WordPress API クラス
 */
class WordPressAPI {
  constructor(config) {
    this.baseUrl = config.wpUrl.replace(/\/$/, '');
    this.token = config.wpToken ? String(config.wpToken).trim() : '';
    const password = config.wpPassword ? normalizeApplicationPassword(config.wpPassword) : '';
    this.user = config.wpUser ? String(config.wpUser).trim() : '';
    this.tokenTransport = config.tokenTransport || TOKEN_TRANSPORT_HEADER;
    this.tokenTransportChanged = false;
    // セキュリティ: クエリパラメータフォールバックへの同意フラグ
    this.queryFallbackConsented = config.queryFallbackConsented || false;
    this.auth = this.user && password
      ? encodeBasicAuth(this.user, password)
      : '';
  }

  buildUrl(endpoint, useQueryToken = false) {
    const url = new URL(`${this.baseUrl}/wp-json/wp/v2${endpoint}`);
    if (this.token && useQueryToken) {
      url.searchParams.set('wpbp_token', this.token);
    }
    return url.toString();
  }

  buildHeaders(options = {}, useQueryToken = false) {
    const headers = {
      ...options.headers
    };

    const hasBody = typeof options.body !== 'undefined' && options.body !== null;
    const isFormData = typeof FormData !== 'undefined' && options.body instanceof FormData;
    if (hasBody && !isFormData && !headers['Content-Type']) {
      headers['Content-Type'] = 'application/json';
    }

    if (this.token) {
      if (!useQueryToken) {
        headers['X-WPBP-Token'] = this.token;
      }
    } else if (this.auth) {
      headers['Authorization'] = `Basic ${this.auth}`;
    }

    return headers;
  }

  normalizeError(error) {
    if (error && typeof error.status !== 'undefined') {
      return error;
    }
    return {
      status: 0,
      code: 'NETWORK_ERROR',
      message: 'ネットワーク接続を確認してください'
    };
  }

  /**
   * エラーがクエリパラメータフォールバックの対象かどうかを判定
   */
  isQueryFallbackCandidate(error, useQueryToken) {
    if (!this.token || useQueryToken) return false;
    if (this.tokenTransport !== TOKEN_TRANSPORT_HEADER) return false;
    if (error.code === 'NETWORK_ERROR') return true;
    if (error.status === 403 && error.code === 'HTTP_ERROR') return true;
    return error.status === 401 && error.code === 'rest_not_logged_in';
  }

  /**
   * クエリパラメータフォールバックを実行できるか判定
   * （同意が必要な場合は同意済みかどうかをチェック）
   */
  shouldFallbackToQuery(error, useQueryToken) {
    if (!this.isQueryFallbackCandidate(error, useQueryToken)) return false;
    // セキュリティ: 同意がない場合はフォールバックしない
    return this.queryFallbackConsented;
  }

  markTokenTransportQuery() {
    if (this.tokenTransport !== TOKEN_TRANSPORT_QUERY) {
      this.tokenTransport = TOKEN_TRANSPORT_QUERY;
      this.tokenTransportChanged = true;
    }
  }

  /**
   * APIリクエスト
   */
  async request(endpoint, options = {}) {
    const useQueryToken = this.token && this.tokenTransport === TOKEN_TRANSPORT_QUERY;
    try {
      return await this.performRequest(endpoint, options, useQueryToken);
    } catch (error) {
      const normalized = this.normalizeError(error);

      // フォールバック候補だが同意がない場合は、同意を求めるエラーを投げる
      if (this.isQueryFallbackCandidate(normalized, useQueryToken) && !this.queryFallbackConsented) {
        throw {
          ...normalized,
          needsQueryFallbackConsent: true,
          consentMessage: 'ヘッダー認証が失敗しました。URLにトークンを含める方式に切り替えますか？'
        };
      }

      if (this.shouldFallbackToQuery(normalized, useQueryToken)) {
        try {
          const result = await this.performRequest(endpoint, options, true);
          this.markTokenTransportQuery();
          return result;
        } catch (fallbackError) {
          const normalizedFallback = this.normalizeError(fallbackError);
          if (normalizedFallback.status) {
            this.markTokenTransportQuery();
          }
          throw normalizedFallback;
        }
      }
      throw normalized;
    }
  }

  async performRequest(endpoint, options = {}, useQueryToken = false) {
    const url = this.buildUrl(endpoint, useQueryToken);
    const headers = this.buildHeaders(options, useQueryToken);
    const response = await fetch(url, {
      ...options,
      headers
    });

    if (!response.ok) {
      const errorText = await response.text();
      let error = {};
      try {
        error = JSON.parse(errorText);
      } catch {
        error = { message: errorText };
      }
      throw {
        status: response.status,
        code: error.code || 'HTTP_ERROR',
        message: error.message || `HTTP Error ${response.status}`
      };
    }

    try {
      return await response.json();
    } catch {
      return null;
    }
  }

  /**
   * 接続テスト
   */
  async testConnection() {
    return this.request('/users/me');
  }

  /**
   * タームを検索
   */
  async searchTerm(type, name) {
    const endpoint = type === 'category' ? 'categories' : 'tags';
    const terms = await this.request(`/${endpoint}?search=${encodeURIComponent(name)}&per_page=100`);
    return terms.find(term => term.name.toLowerCase() === name.toLowerCase());
  }

  /**
   * タームを作成
   */
  async createTerm(type, name) {
    const endpoint = type === 'category' ? 'categories' : 'tags';
    return this.request(`/${endpoint}`, {
      method: 'POST',
      body: JSON.stringify({ name })
    });
  }

  /**
   * ターム名からIDを解決
   */
  async resolveTermIds(type, names, createIfNotExists = false) {
    const ids = [];
    for (const name of names) {
      if (!name) continue;
      try {
        let term = await this.searchTerm(type, name);
        if (!term && createIfNotExists) {
          term = await this.createTerm(type, name);
        }
        if (term) {
          ids.push(term.id);
        }
      } catch {}
    }
    return ids;
  }

  /**
   * カテゴリ名からIDを解決
   */
  async resolveCategoryIds(names, createIfNotExists = false) {
    return this.resolveTermIds('category', names, createIfNotExists);
  }

  /**
   * タグ名からIDを解決
   */
  async resolveTagIds(names, createIfNotExists = false) {
    return this.resolveTermIds('tag', names, createIfNotExists);
  }

  /**
   * 画像をアップロード（セキュリティ強化版）
   */
  async uploadImage(imageUrl, filename) {
    try {
      // 1. URL検証（SSRF対策）
      const validation = validateImageUrl(imageUrl);
      if (!validation.valid) {
        console.warn(`Image URL rejected: ${validation.reason} - ${imageUrl}`);
        return null;
      }

      // 2. ファイル名サニタイズ（パストラバーサル対策）
      const safeFilename = sanitizeFilename(filename);

      // 3. HEADリクエストでサイズを事前チェック（可能な場合）
      try {
        const headResponse = await fetch(imageUrl, { method: 'HEAD' });
        if (headResponse.ok) {
          const contentLength = headResponse.headers.get('content-length');
          if (contentLength && parseInt(contentLength, 10) > MAX_IMAGE_SIZE_BYTES) {
            console.warn(`Image too large (HEAD): ${contentLength} bytes - ${imageUrl}`);
            return null;
          }
        }
      } catch {
        // HEADリクエストが失敗しても続行（GETで再チェック）
      }

      // 4. 画像をfetch
      const imageResponse = await fetch(imageUrl);
      if (!imageResponse.ok) {
        throw new Error('画像の取得に失敗しました');
      }

      const blob = await imageResponse.blob();

      // 5. 実際のサイズをチェック
      if (blob.size > MAX_IMAGE_SIZE_BYTES) {
        console.warn(`Image too large: ${blob.size} bytes - ${imageUrl}`);
        return null;
      }

      // 6. MIMEタイプを検証（画像であることを確認）
      if (!blob.type.startsWith('image/')) {
        console.warn(`Not an image: ${blob.type} - ${imageUrl}`);
        return null;
      }

      // WordPress Media APIにアップロード
      const formData = new FormData();
      formData.append('file', blob, safeFilename);

      const media = await this.request('/media', {
        method: 'POST',
        body: formData
      });
      if (!media || !media.id || !media.source_url) {
        return null;
      }
      return {
        id: media.id,
        url: media.source_url
      };
    } catch (error) {
      return null;
    }
  }

  /**
   * コンテンツ内の画像をアップロードして置換
   */
  async processImages(content) {
    // Markdown画像を検出: ![alt](url)
    const mdImageRegex = /!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
    // HTML画像を検出: <img src="url">
    const htmlImageRegex = /<img\s+[^>]*src=["']([^"']+)["'][^>]*>/gi;

    const imageUrls = new Map();
    let match;

    // Markdown画像URLを収集
    while ((match = mdImageRegex.exec(content)) !== null) {
      const url = match[2];
      if (url.startsWith('http://') || url.startsWith('https://')) {
        if (!imageUrls.has(url)) {
          imageUrls.set(url, { original: match[0], alt: match[1] });
        }
      }
    }

    // HTML画像URLを収集
    while ((match = htmlImageRegex.exec(content)) !== null) {
      const url = match[1];
      if (url.startsWith('http://') || url.startsWith('https://')) {
        if (!imageUrls.has(url)) {
          imageUrls.set(url, { original: match[0], alt: '' });
        }
      }
    }

    let processedContent = content;
    let featuredMediaId = null;
    let isFirst = true;

    // 各画像をアップロード
    for (const [url, info] of imageUrls) {
      try {
        // ファイル名を抽出
        const urlObj = new URL(url);
        let filename = urlObj.pathname.split('/').pop() || 'image.jpg';

        // アップロード
        const uploaded = await this.uploadImage(url, filename);

        if (uploaded) {
          // 画像タグのsrcだけを置換
          processedContent = replaceMarkdownImageUrl(processedContent, url, uploaded.url);
          processedContent = replaceHtmlImageSrc(processedContent, url, uploaded.url);

          // 最初の画像をアイキャッチ候補に
          if (isFirst) {
            featuredMediaId = uploaded.id;
            isFirst = false;
          }
        }
      } catch (e) {
      }
    }

    return { content: processedContent, featuredMediaId };
  }

  /**
   * 投稿を作成
   */
  async createPost(data) {
    return this.request('/posts', {
      method: 'POST',
      body: JSON.stringify(data)
    });
  }
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function replaceMarkdownImageUrl(content, url, newUrl) {
  const escaped = escapeRegExp(url);
  const regex = new RegExp(`(!\\[[^\\]]*\\]\\()${escaped}(\\s+"[^"]*")?(\\))`, 'g');
  return content.replace(regex, (match, prefix, title, suffix) => {
    return `${prefix}${newUrl}${title || ''}${suffix}`;
  });
}

function replaceHtmlImageSrc(content, url, newUrl) {
  const escaped = escapeRegExp(url);
  const regex = new RegExp(`(<img\\b[^>]*\\ssrc=["'])${escaped}(["'][^>]*>)`, 'gi');
  return content.replace(regex, `$1${newUrl}$2`);
}

/**
 * エラーメッセージをユーザーフレンドリーに変換
 */
function getErrorMessage(error) {
  if (error?.status === 401 && error?.code === 'rest_not_logged_in') {
    return {
      code: 'AUTH_401',
      message: '現在ログインしていません。認証情報を確認してください'
    };
  }

  const messages = {
    401: {
      code: 'AUTH_401',
      message: '認証情報が間違っています（パスワード/トークン）'
    },
    403: {
      code: 'AUTH_403',
      message: 'このユーザーには投稿権限がありません'
    },
    404: {
      code: 'NOT_FOUND_404',
      message: 'WordPressが見つかりません。URLを確認してください'
    },
    500: {
      code: 'SERVER_500',
      message: 'サーバーエラーが発生しました。しばらく待ってから再試行してください'
    }
  };

  if (error.status && messages[error.status]) {
    return messages[error.status];
  }

  if (error.code === 'NETWORK_ERROR') {
    return {
      code: 'NETWORK_ERROR',
      message: 'ネットワーク接続を確認してください'
    };
  }

  return {
    code: error.code || 'UNKNOWN',
    message: error.message || 'エラーが発生しました'
  };
}

function normalizeOrigin(url) {
  try {
    return new URL(String(url)).origin;
  } catch {
    return null;
  }
}

async function resolveTokenTransport(config, stored) {
  if (!config?.wpToken) return TOKEN_TRANSPORT_HEADER;
  const origin = normalizeOrigin(config.wpUrl);
  if (!origin) return TOKEN_TRANSPORT_HEADER;
  const source = stored || await chrome.storage.local.get(['tokenTransport', 'tokenTransportUrl']);
  if (source.tokenTransportUrl === origin) {
    if (source.tokenTransport === TOKEN_TRANSPORT_QUERY) return TOKEN_TRANSPORT_QUERY;
    if (source.tokenTransport === TOKEN_TRANSPORT_HEADER) return TOKEN_TRANSPORT_HEADER;
  }
  return TOKEN_TRANSPORT_HEADER;
}

async function persistTokenTransportIfNeeded(url, api) {
  if (!api?.token || !api?.tokenTransportChanged) return;
  const origin = normalizeOrigin(url);
  if (!origin) return;
  await chrome.storage.local.set({
    tokenTransport: api.tokenTransport,
    tokenTransportUrl: origin
  });
}

/**
 * メッセージハンドラー
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message).then(sendResponse);
  return true; // 非同期レスポンスを有効化
});

/**
 * メッセージを処理
 */
async function handleMessage(message) {
  try {
    switch (message.type) {
      case 'TEST_CONNECTION':
        return await handleTestConnection(message.data);

      case 'CREATE_POST':
        return await handleCreatePost(message.data);

      default:
        return {
          success: false,
          error: { code: 'UNKNOWN_ACTION', message: '不明なアクション' }
        };
    }
  } catch (error) {
    return {
      success: false,
      error: getErrorMessage(error)
    };
  }
}

/**
 * 接続テストを処理
 */
async function handleTestConnection(data) {
  const tokenTransport = await resolveTokenTransport(data);
  // 同意状態を取得（dataから渡されるか、ストレージから取得）
  let queryFallbackConsented = data.queryFallbackConsented || false;
  if (!queryFallbackConsented) {
    const stored = await chrome.storage.local.get(['queryFallbackConsent']);
    queryFallbackConsented = stored.queryFallbackConsent || false;
  }

  let api;
  try {
    api = new WordPressAPI({ ...data, tokenTransport, queryFallbackConsented });
    const user = await api.testConnection();
    return {
      success: true,
      data: {
        user: user.name || user.slug || data.wpUser
      }
    };
  } catch (error) {
    // 同意が必要な場合は特別なレスポンスを返す
    if (error.needsQueryFallbackConsent) {
      return {
        success: false,
        needsQueryFallbackConsent: true,
        error: {
          code: 'NEEDS_QUERY_FALLBACK_CONSENT',
          message: error.consentMessage
        }
      };
    }
    const formatted = getErrorMessage(error);
    return {
      success: false,
      error: formatted
    };
  } finally {
    await persistTokenTransportIfNeeded(data.wpUrl, api);
  }
}

/**
 * 投稿作成を処理
 */
async function handleCreatePost(data) {
  const config = await chrome.storage.local.get([
    'wpUrl',
    'wpUser',
    'wpPassword',
    'wpToken',
    'settings',
    'tokenTransport',
    'tokenTransportUrl',
    'queryFallbackConsent'
  ]);
  let api;
  try {
    // 設定を取得
    if (!config.wpUrl || !config.wpUser || (!config.wpPassword && !config.wpToken)) {
      return {
        success: false,
        error: { code: 'NOT_CONFIGURED', message: '設定が完了していません' }
      };
    }
    const tokenTransport = await resolveTokenTransport(config, config);
    const queryFallbackConsented = config.queryFallbackConsent || false;
    api = new WordPressAPI({ ...config, tokenTransport, queryFallbackConsented });
    const autoCreate = config.settings?.autoCreateTerms || false;

    // 画像を処理
    let processedContent = data.content;
    let featuredMediaId = null;

    if (data.content) {
      try {
        const imageResult = await api.processImages(data.content);
        processedContent = imageResult.content;
        featuredMediaId = imageResult.featuredMediaId;
      } catch {}
    }

    // カテゴリとタグを解決
    const categoryIds = data.categories?.length
      ? await api.resolveCategoryIds(data.categories, autoCreate)
      : [];

    const tagIds = data.tags?.length
      ? await api.resolveTagIds(data.tags, autoCreate)
      : [];

    // 投稿データを準備
    const postData = {
      title: data.title || '無題の記事',
      content: processedContent,
      status: data.status || 'draft'
    };

    if (categoryIds.length > 0) {
      postData.categories = categoryIds;
    }

    if (tagIds.length > 0) {
      postData.tags = tagIds;
    }

    if (data.slug) {
      postData.slug = data.slug;
    }

    const normalizedDate = data.date ? normalizeDate(data.date) : null;
    if (postData.status === 'future') {
      if (!normalizedDate) {
        return {
          success: false,
          error: { code: 'SCHEDULE_DATE_REQUIRED', message: '予約投稿には未来の日時指定が必要です' }
        };
      }
      postData.date = normalizedDate;
    } else if (normalizedDate) {
      postData.date = normalizedDate;
    }

    if (data.excerpt) {
      postData.excerpt = data.excerpt;
    }

    if (featuredMediaId) {
      postData.featured_media = featuredMediaId;
    }

    // 投稿を作成
    const post = await api.createPost(postData);

    return {
      success: true,
      data: {
        id: post.id,
        status: post.status,
        link: post.link,
        editUrl: `${config.wpUrl}/wp-admin/post.php?post=${post.id}&action=edit`
      }
    };
  } catch (error) {
    const formatted = getErrorMessage(error);
    return {
      success: false,
      error: formatted
    };
  } finally {
    await persistTokenTransportIfNeeded(config.wpUrl, api);
  }
}

/**
 * 日付を正規化
 */
function normalizeDate(value) {
  if (!value) return null;

  if (value instanceof Date) {
    return formatLocalDateTime(value);
  }

  const dateStr = String(value).trim();
  if (!dateStr) return null;

  // ローカル日時としてそのままWPに渡す（WP側のタイムゾーンで解釈される）
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(dateStr)) return `${dateStr}:00`;
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(dateStr)) return dateStr;
  if (/^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}$/.test(dateStr)) return `${dateStr.replace(/\s+/, 'T')}:00`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return `${dateStr}T00:00:00`;

  // それ以外（タイムゾーン付き等）は Date で解釈 → ローカルに整形
  const parsed = new Date(dateStr);
  if (isNaN(parsed.getTime())) return null;
  return formatLocalDateTime(parsed);
}

function formatLocalDateTime(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hour = String(date.getHours()).padStart(2, '0');
  const minute = String(date.getMinutes()).padStart(2, '0');
  const second = String(date.getSeconds()).padStart(2, '0');
  return `${year}-${month}-${day}T${hour}:${minute}:${second}`;
}
