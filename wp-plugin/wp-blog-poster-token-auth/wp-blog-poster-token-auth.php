<?php
/**
 * Plugin Name: WP Blog Poster Token Auth
 * Description: Token-based auth for the Blog Poster extension without server config changes.
 * Version: 0.1.0
 * Author: wp-blog-poster
 */

if (!defined('ABSPATH')) {
  exit;
}

define('WPBP_OPTION_KEY', 'wp_blog_poster_token_data');
define('WPBP_TRANSIENT_PLAIN', 'wp_blog_poster_token_plain');
if (!defined('WPBP_DEBUG')) {
  define('WPBP_DEBUG', false);
}

// セキュリティ: トークン有効期限（日数）
if (!defined('WPBP_TOKEN_LIFETIME_DAYS')) {
  define('WPBP_TOKEN_LIFETIME_DAYS', 90);
}

// セキュリティ: レート制限
if (!defined('WPBP_RATE_LIMIT_REQUESTS')) {
  define('WPBP_RATE_LIMIT_REQUESTS', 60); // 1分あたりの最大リクエスト数
}
if (!defined('WPBP_RATE_LIMIT_WINDOW')) {
  define('WPBP_RATE_LIMIT_WINDOW', 60); // ウィンドウサイズ（秒）
}
define('WPBP_RATE_LIMIT_TRANSIENT_PREFIX', 'wpbp_rate_');

function wpbp_get_request_token() {
  $token = '';

  if (isset($_SERVER['HTTP_X_WPBP_TOKEN'])) {
    $token = trim((string) $_SERVER['HTTP_X_WPBP_TOKEN']);
  } elseif (isset($_SERVER['HTTP_X_WP_BLOG_POSTER_TOKEN'])) {
    $token = trim((string) $_SERVER['HTTP_X_WP_BLOG_POSTER_TOKEN']);
  }

  if ($token === '' && function_exists('getallheaders')) {
    $headers = getallheaders();
    if (!empty($headers['X-WPBP-Token'])) {
      $token = trim((string) $headers['X-WPBP-Token']);
    } elseif (!empty($headers['X-WP-Blog-Poster-Token'])) {
      $token = trim((string) $headers['X-WP-Blog-Poster-Token']);
    }
  }

  if ($token === '' && !empty($_GET['wpbp_token'])) {
    $token = trim((string) $_GET['wpbp_token']);
  }

  if ($token !== '') {
    $GLOBALS['wpbp_token_present'] = true;
  }

  return $token;
}

/**
 * トークンを検証（有効期限チェック付き）
 */
function wpbp_validate_token($token) {
  $data = get_option(WPBP_OPTION_KEY);
  if (empty($data['hash']) || empty($data['user_id'])) {
    return 0;
  }

  // 有効期限チェック
  if (!empty($data['created_at']) && WPBP_TOKEN_LIFETIME_DAYS > 0) {
    $expires_at = $data['created_at'] + (WPBP_TOKEN_LIFETIME_DAYS * DAY_IN_SECONDS);
    if (time() > $expires_at) {
      $GLOBALS['wpbp_token_expired'] = true;
      return 0;
    }
  }

  if (!wp_check_password($token, $data['hash'])) {
    return 0;
  }

  return (int) $data['user_id'];
}

/**
 * レート制限をチェック
 * @return bool レート制限内ならtrue、超過ならfalse
 */
function wpbp_check_rate_limit() {
  // レート制限が無効化されている場合
  if (WPBP_RATE_LIMIT_REQUESTS <= 0) {
    return true;
  }

  $ip = isset($_SERVER['REMOTE_ADDR']) ? sanitize_text_field($_SERVER['REMOTE_ADDR']) : 'unknown';
  $transient_key = WPBP_RATE_LIMIT_TRANSIENT_PREFIX . md5($ip);
  $now = time();

  $data = get_transient($transient_key);

  if ($data === false) {
    // 初回リクエスト
    set_transient($transient_key, array(
      'count' => 1,
      'window_start' => $now
    ), WPBP_RATE_LIMIT_WINDOW);
    return true;
  }

  // ウィンドウが期限切れの場合はリセット
  if ($now - $data['window_start'] > WPBP_RATE_LIMIT_WINDOW) {
    set_transient($transient_key, array(
      'count' => 1,
      'window_start' => $now
    ), WPBP_RATE_LIMIT_WINDOW);
    return true;
  }

  // カウンターをインクリメント
  $data['count']++;
  set_transient($transient_key, $data, WPBP_RATE_LIMIT_WINDOW);

  return $data['count'] <= WPBP_RATE_LIMIT_REQUESTS;
}

function wpbp_is_rest_request() {
  if (defined('REST_REQUEST') && REST_REQUEST) {
    return true;
  }
  if (function_exists('wp_doing_rest') && wp_doing_rest()) {
    return true;
  }
  if (!empty($_SERVER['REQUEST_URI']) && strpos($_SERVER['REQUEST_URI'], '/wp-json/') !== false) {
    return true;
  }
  return false;
}

function wpbp_determine_current_user($user_id) {
  if ($user_id) {
    return $user_id;
  }

  if (!wpbp_is_rest_request()) {
    return $user_id;
  }

  $token = wpbp_get_request_token();
  if ($token === '') {
    return $user_id;
  }

  $validated_user_id = wpbp_validate_token($token);
  if ($validated_user_id) {
    $GLOBALS['wpbp_token_valid'] = true;
    return $validated_user_id;
  }

  $GLOBALS['wpbp_token_invalid'] = true;
  return $user_id;
}
add_filter('determine_current_user', 'wpbp_determine_current_user', 20);

function wpbp_rest_authentication_errors($result) {
  $token = wpbp_get_request_token();
  if ($token === '') {
    return $result;
  }

  // レート制限チェック（トークン認証の前に実行）
  if (!wpbp_check_rate_limit()) {
    return new WP_Error(
      'wpbp_rate_limit_exceeded',
      'Rate limit exceeded. Please try again later.',
      array('status' => 429)
    );
  }

  $validated_user_id = wpbp_validate_token($token);
  if (!$validated_user_id) {
    // トークン期限切れの場合は専用メッセージ
    if (!empty($GLOBALS['wpbp_token_expired'])) {
      return new WP_Error(
        'wpbp_token_expired',
        'Token has expired. Please regenerate a new token.',
        array('status' => 401)
      );
    }
    return new WP_Error('wpbp_invalid_token', 'Invalid token.', array('status' => 401));
  }

  $GLOBALS['wpbp_token_valid'] = true;
  wp_set_current_user($validated_user_id);
  return true;  // 認証成功を明示的に返す（nullだと後続の認証チェックが実行される）
}
add_filter('rest_authentication_errors', 'wpbp_rest_authentication_errors');

function wpbp_limit_routes($result, $server, $request) {
  $token = wpbp_get_request_token();
  if ($token === '') {
    return $result;
  }

  if (empty($GLOBALS['wpbp_token_valid'])) {
    return $result;
  }

  $method = $request->get_method();
  if ($method === 'OPTIONS') {
    return $result;
  }

  $route = $request->get_route();
  $allowed = array(
    array('#^/wp/v2/users/me$#', array('GET')),
    array('#^/wp/v2/categories#', array('GET', 'POST')),
    array('#^/wp/v2/tags#', array('GET', 'POST')),
    array('#^/wp/v2/media#', array('POST')),
    array('#^/wp/v2/posts#', array('POST')),
  );
  if (WPBP_DEBUG) {
    $allowed[] = array('#^/wpbp/v1/debug$#', array('GET'));
  }

  foreach ($allowed as $rule) {
    if (preg_match($rule[0], $route) && in_array($method, $rule[1], true)) {
      return $result;
    }
  }

  return new WP_Error('wpbp_forbidden_route', 'Route not allowed for token auth.', array('status' => 403));
}
add_filter('rest_pre_dispatch', 'wpbp_limit_routes', 10, 3);

function wpbp_allowed_cors_headers($headers) {
  $headers[] = 'X-WPBP-Token';
  $headers[] = 'X-WP-Blog-Poster-Token';
  return $headers;
}
add_filter('rest_allowed_cors_headers', 'wpbp_allowed_cors_headers');

function wpbp_admin_menu() {
  add_management_page(
    'Blog Poster Token',
    'Blog Poster Token',
    'manage_options',
    'wp-blog-poster-token-auth',
    'wpbp_render_settings_page'
  );
}
add_action('admin_menu', 'wpbp_admin_menu');

function wpbp_render_settings_page() {
  if (!current_user_can('manage_options')) {
    return;
  }

  $data = get_option(WPBP_OPTION_KEY);
  $has_token = !empty($data['hash']) && !empty($data['user_id']);
  $plain = get_transient(WPBP_TRANSIENT_PLAIN);

  // 有効期限を計算
  $expires_at = null;
  $is_expired = false;
  $time_remaining = '';
  if ($has_token && !empty($data['created_at']) && WPBP_TOKEN_LIFETIME_DAYS > 0) {
    $expires_at = $data['created_at'] + (WPBP_TOKEN_LIFETIME_DAYS * DAY_IN_SECONDS);
    $is_expired = time() > $expires_at;
    if (!$is_expired) {
      $time_remaining = human_time_diff(time(), $expires_at);
    }
  }

  ?>
  <div class="wrap">
    <h1>Blog Poster Token</h1>
    <p>Generate a token for the Blog Poster extension. Keep it secret.</p>

    <?php if ($plain) : ?>
      <div style="padding:12px;border:1px solid #ccd0d4;background:#f6ffed;margin:12px 0;">
        <strong>Your token (shown once):</strong>
        <code style="display:block;margin-top:8px;"><?php echo esc_html($plain); ?></code>
      </div>
    <?php endif; ?>

    <?php if ($has_token && $is_expired) : ?>
      <div style="padding:12px;border:1px solid #dc3545;background:#f8d7da;margin:12px 0;color:#721c24;">
        <strong>⚠️ Your token has expired.</strong>
        <p style="margin:8px 0 0;">Please regenerate a new token to continue using the extension.</p>
      </div>
    <?php elseif ($has_token && $expires_at) : ?>
      <div style="padding:12px;border:1px solid #ccd0d4;background:#e7f3ff;margin:12px 0;">
        <strong>Token Status:</strong> Active<br>
        <strong>Expires:</strong> <?php echo esc_html(date_i18n(get_option('date_format') . ' ' . get_option('time_format'), $expires_at)); ?>
        <br><small>(<?php echo esc_html($time_remaining); ?> remaining)</small>
      </div>
    <?php endif; ?>

    <form method="post" action="<?php echo esc_url(admin_url('admin-post.php')); ?>">
      <?php wp_nonce_field('wpbp_generate_token'); ?>
      <input type="hidden" name="action" value="wpbp_generate_token">
      <p>
        <button class="button button-primary" type="submit">
          <?php echo $has_token ? 'Regenerate Token' : 'Generate Token'; ?>
        </button>
      </p>
    </form>

    <?php if ($has_token) : ?>
      <form method="post" action="<?php echo esc_url(admin_url('admin-post.php')); ?>">
        <?php wp_nonce_field('wpbp_revoke_token'); ?>
        <input type="hidden" name="action" value="wpbp_revoke_token">
        <p>
          <button class="button" type="submit">Revoke Token</button>
        </p>
      </form>
    <?php endif; ?>

  <hr>
  <h2>How to use</h2>
  <p>Set this header in the extension requests:</p>
  <code>X-WPBP-Token: YOUR_TOKEN</code>
  <p>If headers are blocked by hosting, you can also use:</p>
  <code>?wpbp_token=YOUR_TOKEN</code>
  <p>Allowed endpoints: posts, media, categories, tags, users/me.</p>

  <hr>
  <h2>Security Information</h2>
  <ul>
    <li><strong>Token Lifetime:</strong> <?php echo esc_html(WPBP_TOKEN_LIFETIME_DAYS); ?> days</li>
    <li><strong>Rate Limit:</strong> <?php echo esc_html(WPBP_RATE_LIMIT_REQUESTS); ?> requests per <?php echo esc_html(WPBP_RATE_LIMIT_WINDOW); ?> seconds</li>
  </ul>
</div>
  <?php
}

function wpbp_generate_token() {
  if (!current_user_can('manage_options')) {
    wp_die('Not allowed');
  }
  check_admin_referer('wpbp_generate_token');

  $token = wp_generate_password(32, false, false);
  $data = array(
    'hash' => wp_hash_password($token),
    'user_id' => get_current_user_id(),
    'created_at' => time(),
  );

  update_option(WPBP_OPTION_KEY, $data, false);
  set_transient(WPBP_TRANSIENT_PLAIN, $token, 5 * MINUTE_IN_SECONDS);

  wp_safe_redirect(admin_url('tools.php?page=wp-blog-poster-token-auth'));
  exit;
}
add_action('admin_post_wpbp_generate_token', 'wpbp_generate_token');

function wpbp_revoke_token() {
  if (!current_user_can('manage_options')) {
    wp_die('Not allowed');
  }
  check_admin_referer('wpbp_revoke_token');

  delete_option(WPBP_OPTION_KEY);
  delete_transient(WPBP_TRANSIENT_PLAIN);

  wp_safe_redirect(admin_url('tools.php?page=wp-blog-poster-token-auth'));
  exit;
}
add_action('admin_post_wpbp_revoke_token', 'wpbp_revoke_token');

// デバッグ用エンドポイント（認証不要）
function wpbp_register_debug_endpoint() {
  if (!WPBP_DEBUG) {
    return;
  }
  register_rest_route('wpbp/v1', '/debug', array(
    'methods' => 'GET',
    'callback' => 'wpbp_debug_callback',
    'permission_callback' => '__return_true',
  ));
}
add_action('rest_api_init', 'wpbp_register_debug_endpoint');

function wpbp_debug_callback($request) {
  $token_from_header = '';
  $token_from_get = '';
  $headers_received = array();

  // $_SERVER からヘッダーを取得
  if (isset($_SERVER['HTTP_X_WPBP_TOKEN'])) {
    $token_from_header = $_SERVER['HTTP_X_WPBP_TOKEN'];
  }

  // getallheaders() からヘッダーを取得
  if (function_exists('getallheaders')) {
    $headers_received = getallheaders();
  }

  // $_GET からトークンを取得
  if (isset($_GET['wpbp_token'])) {
    $token_from_get = $_GET['wpbp_token'];
  }

  // プラグインの関数でトークンを取得
  $token_from_function = wpbp_get_request_token();

  // トークンデータが保存されているか確認
  $token_data = get_option(WPBP_OPTION_KEY);
  $has_stored_token = !empty($token_data['hash']) && !empty($token_data['user_id']);

  return array(
    'plugin_active' => true,
    'token_from_header_server' => $token_from_header ? substr($token_from_header, 0, 8) . '...' : '(empty)',
    'token_from_get' => $token_from_get ? substr($token_from_get, 0, 8) . '...' : '(empty)',
    'token_from_function' => $token_from_function ? substr($token_from_function, 0, 8) . '...' : '(empty)',
    'has_stored_token' => $has_stored_token,
    'stored_user_id' => $has_stored_token ? $token_data['user_id'] : null,
    'headers_x_wpbp' => isset($headers_received['X-WPBP-Token']) ? substr($headers_received['X-WPBP-Token'], 0, 8) . '...' : '(not found)',
    'all_header_keys' => array_keys($headers_received),
  );
}
