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

/**
 * WordPress API クラス
 */
class WordPressAPI {
  constructor(config) {
    this.baseUrl = config.wpUrl.replace(/\/$/, '');
    this.token = config.wpToken ? String(config.wpToken).trim() : '';
    this.auth = config.wpUser && config.wpPassword
      ? encodeBasicAuth(config.wpUser, config.wpPassword)
      : '';
  }

  buildUrl(endpoint) {
    const url = new URL(`${this.baseUrl}/wp-json/wp/v2${endpoint}`);
    if (this.token) {
      url.searchParams.set('wpbp_token', this.token);
    }
    return url.toString();
  }

  /**
   * APIリクエスト
   */
  async request(endpoint, options = {}) {
    const url = this.buildUrl(endpoint);
    const headers = {
      ...options.headers
    };

    // POSTリクエストのみContent-Typeを設定（GETでは不要でCORS問題を起こす）
    if (options.method === 'POST' || options.body) {
      headers['Content-Type'] = 'application/json';
    }

    // トークン認証はURLパラメータ（buildUrl）で行う（カスタムヘッダーはサーバーでフィルタリングされる）
    // Basic認証のみヘッダーを使用
    if (!this.token && this.auth) {
      headers['Authorization'] = `Basic ${this.auth}`;
    }

    try {
      const response = await fetch(url, {
        ...options,
        headers
      });

      if (!response.ok) {
        const errorText = await response.text();
        let error = {};
        try {
          error = JSON.parse(errorText);
        } catch (e) {
          error = { message: errorText };
        }
        throw {
          status: response.status,
          code: error.code || 'UNKNOWN',
          message: error.message || `HTTP Error ${response.status}`
        };
      }

      return response.json();
    } catch (error) {
      if (error.status) throw error;
      throw {
        status: 0,
        code: 'NETWORK_ERROR',
        message: 'ネットワーク接続を確認してください'
      };
    }
  }

  /**
   * 接続テスト
   */
  async testConnection() {
    return this.request('/users/me');
  }

  /**
   * カテゴリを検索
   */
  async searchCategories(name) {
    const categories = await this.request(`/categories?search=${encodeURIComponent(name)}&per_page=100`);
    return categories.find(cat => cat.name.toLowerCase() === name.toLowerCase());
  }

  /**
   * タグを検索
   */
  async searchTags(name) {
    const tags = await this.request(`/tags?search=${encodeURIComponent(name)}&per_page=100`);
    return tags.find(tag => tag.name.toLowerCase() === name.toLowerCase());
  }

  /**
   * カテゴリを作成
   */
  async createCategory(name) {
    return this.request('/categories', {
      method: 'POST',
      body: JSON.stringify({ name })
    });
  }

  /**
   * タグを作成
   */
  async createTag(name) {
    return this.request('/tags', {
      method: 'POST',
      body: JSON.stringify({ name })
    });
  }

  /**
   * カテゴリ名からIDを解決
   */
  async resolveCategoryIds(names, createIfNotExists = false) {
    const ids = [];
    for (const name of names) {
      if (!name) continue;
      try {
        let category = await this.searchCategories(name);
        if (!category && createIfNotExists) {
          category = await this.createCategory(name);
        }
        if (category) {
          ids.push(category.id);
        }
      } catch (e) {
        console.warn(`カテゴリ「${name}」の解決に失敗:`, e);
      }
    }
    return ids;
  }

  /**
   * タグ名からIDを解決
   */
  async resolveTagIds(names, createIfNotExists = false) {
    const ids = [];
    for (const name of names) {
      if (!name) continue;
      try {
        let tag = await this.searchTags(name);
        if (!tag && createIfNotExists) {
          tag = await this.createTag(name);
        }
        if (tag) {
          ids.push(tag.id);
        }
      } catch (e) {
        console.warn(`タグ「${name}」の解決に失敗:`, e);
      }
    }
    return ids;
  }

  /**
   * 画像をアップロード
   */
  async uploadImage(imageUrl, filename) {
    try {
      // 画像をfetch
      const imageResponse = await fetch(imageUrl);
      if (!imageResponse.ok) {
        throw new Error('画像の取得に失敗しました');
      }

      const blob = await imageResponse.blob();
      const mimeType = blob.type || 'image/jpeg';

      // WordPress Media APIにアップロード
      const url = this.buildUrl('/media');
      const formData = new FormData();
      formData.append('file', blob, filename);

      // トークン認証はURLパラメータ（buildUrl）で行う
      const headers = {};
      if (!this.token && this.auth) {
        headers['Authorization'] = `Basic ${this.auth}`;
      }

      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: formData
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.message || '画像のアップロードに失敗しました');
      }

      const media = await response.json();
      return {
        id: media.id,
        url: media.source_url
      };
    } catch (error) {
      console.warn('画像アップロードエラー:', error);
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
        console.warn(`画像のアップロードをスキップ: ${url}`, e);
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
    console.error('メッセージ処理エラー:', error);
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
  try {
    const api = new WordPressAPI(data);
    const user = await api.testConnection();

    return {
      success: true,
      data: {
        user: user.name || user.slug || data.wpUser
      }
    };
  } catch (error) {
    return {
      success: false,
      error: getErrorMessage(error)
    };
  }
}

/**
 * 投稿作成を処理
 */
async function handleCreatePost(data) {
  try {
    // 設定を取得
    const config = await chrome.storage.local.get(['wpUrl', 'wpUser', 'wpPassword', 'wpToken', 'settings']);

    if (!config.wpUrl || !config.wpUser || (!config.wpPassword && !config.wpToken)) {
      return {
        success: false,
        error: { code: 'NOT_CONFIGURED', message: '設定が完了していません' }
      };
    }

    const api = new WordPressAPI(config);
    const autoCreate = config.settings?.autoCreateTerms || false;

    // 画像を処理
    let processedContent = data.content;
    let featuredMediaId = null;

    if (data.content) {
      try {
        const imageResult = await api.processImages(data.content);
        processedContent = imageResult.content;
        featuredMediaId = imageResult.featuredMediaId;
      } catch (e) {
        console.warn('画像処理エラー（続行）:', e);
      }
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

    if (data.date) {
      postData.date = normalizeDate(data.date);
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
    console.error('投稿作成エラー:', error);
    return {
      success: false,
      error: getErrorMessage(error)
    };
  }
}

/**
 * 日付を正規化
 */
function normalizeDate(value) {
  if (!value) return null;

  if (value instanceof Date) {
    return value.toISOString().split('.')[0];
  }

  const dateStr = String(value).trim();
  if (!dateStr) return null;

  // ISO 8601形式かチェック
  const parsed = new Date(dateStr);
  if (!isNaN(parsed.getTime())) {
    return dateStr;
  }

  return null;
}

console.log('[ブログ投稿アシスタント] Background Service Worker 起動');
