# --- FILE: frontend/security_headers.inc ---
# Заголовки безопасности для всех ответов nginx (подключается в server и в каждом location).
#
# CSP — главная защита токена в localStorage от XSS: даже если злоумышленник внедрит разметку,
# браузер не выполнит чужой или встроенный скрипт и не отправит данные на чужой домен.
#   script-src 'self'         — только скрипты из сборки, без inline и eval;
#   style-src 'unsafe-inline' — React и библиотеки выставляют стили атрибутом style;
#   img-src                   — аватары api.dicebear.com, data:/blob: для иконок и превью;
#   connect-src 'self'        — fetch и WebSocket только на свой домен (CSP3 включает ws/wss).
add_header Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://api.dicebear.com; font-src 'self' data:; media-src 'self' data: blob:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'" always;
add_header X-Content-Type-Options "nosniff" always;
add_header X-Frame-Options "DENY" always;
add_header Referrer-Policy "no-referrer" always;
add_header Permissions-Policy "camera=(), microphone=(), geolocation=()" always;
# add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
