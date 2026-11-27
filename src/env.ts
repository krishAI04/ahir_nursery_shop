export type Env = {
  DB: D1Database;
  PHOTOS: R2Bucket;
  ENVIRONMENT: string;
  STOREFRONT_ORIGINS: string;
  ACCESS_TEAM_DOMAIN: string;
  ACCESS_AUD: string;
  ADMIN_USERNAME: string;
  /** Host the admin is served on (e.g. admin.example.com). Empty: admin and API share every host. */
  ADMIN_HOST: string;
  ADMIN_PASSWORD_HASH: string;
  IMAGE_BASE_URL: string;
  SHOP_WHATSAPP: string;
  PAGES_DEPLOY_HOOK: string;
  CF_API_TOKEN: string;
  CF_ACCOUNT_ID: string;
  PAGES_PROJECT: string;
};
