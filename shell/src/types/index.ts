export type AppTheme = "light" | "dark";
export type AppLanguage = "pt-BR" | "en-US";

export type UserInfo = {
  username: string;
  role: string;
  is_platform_admin: boolean;
  allowed_modules: string[];
};

export type ModuleManifest = {
  id: string;
  name: string;
  version: string;
  status: "enabled" | "disabled";
  nav_label: string;
  nav_order: number;
  icon: string;
  remote_url: string;
  api_url: string;
  required_roles: string[];
  health: "healthy" | "degraded" | "unreachable";
};

export type ModuleProps = {
  token: string;
  user: UserInfo;
  apiBase: string;
  theme: AppTheme;
  language: AppLanguage;
};
