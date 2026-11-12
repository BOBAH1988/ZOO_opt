// Версия приложения.
// Первые два компонента (major.minor) поднимаются вручную.
// Третий (patch) автоматически инкрементируется при каждом коммите
// через git-hook `.git/hooks/pre-commit`.
export const APP_VERSION = '0.0.79';
export const APP_VERSION_STR = `v${APP_VERSION}`;