// Sign-up availability on this instance, baked in at build time from SIGNUPS_ENABLED
// (packages/infra/alchemy.*.ts). The server refuses sign-up on its own; this only drives UI.
export const SIGNUPS_ENABLED = import.meta.env.VITE_SIGNUPS_ENABLED === "true";

export const SELF_HOST_URL =
  "https://github.com/AbdelilahOu/AttijariFlare#self-host-on-your-own-cloudflare-account";
