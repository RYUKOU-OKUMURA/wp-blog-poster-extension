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

function wpbp_validate_token($token) {
  $data = get_option(WPBP_OPTION_KEY);
  if (empty($data['hash']) || empty($data['user_id'])) {
    return 0;
  }

  if (!wp_check_password($token, $data['hash'])) {
    return 0;
  }

  return (int) $data['user_id'];
}

function wpbp_determine_current_user($user_id) {
  if ($user_id) {
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

  $validated_user_id = wpbp_validate_token($token);
  if (!$validated_user_id) {
    return new WP_Error('wpbp_invalid_token', 'Invalid token.', array('status' => 401));
  }

  $GLOBALS['wpbp_token_valid'] = true;
  wp_set_current_user($validated_user_id);
  return $result;
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
