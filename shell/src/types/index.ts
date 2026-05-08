export type AppTheme = "light" | "dark";
export type AppLanguage = "pt-BR" | "en-US";

export type UserInfo = {
  username: string;
  role: string;
  is_platform_admin: boolean;
  allowed_modules: string[];
  theme?: string;
};

/** Formato retornado pelo Module Registry */
export type ModuleManifest = {
  id: string;
  name: string;
  version: string;
  section: string;
  permission: string;
  health_path: string;
  health: "healthy" | "warning" | "danger";
  container: string;
  status: string;
  source: "config" | "label";
  frontend_url?: string;
};

export type ModuleSetting = {
  key: string;
  value: string;
  is_secret: boolean;
};

export type ModuleProps = {
  token: string;
  user: UserInfo;
  theme: AppTheme;
  language: AppLanguage;
};
