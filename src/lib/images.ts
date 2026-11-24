import type { Env } from "../env";

export const imageUrl = (env: Pick<Env, "IMAGE_BASE_URL">, key: string): string =>
  env.IMAGE_BASE_URL ? env.IMAGE_BASE_URL.replace(/\/+$/, "") + "/" + key : "/img/" + key;
