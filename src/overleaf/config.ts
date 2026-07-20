export interface ConfigurationInspection<T> {
  defaultValue?: T;
  globalValue?: T;
  workspaceValue?: T;
  workspaceFolderValue?: T;
  globalLanguageValue?: T;
  workspaceLanguageValue?: T;
  workspaceFolderLanguageValue?: T;
}

export interface InspectableConfiguration {
  get<T>(section: string, defaultValue: T): T;
  inspect<T>(section: string): ConfigurationInspection<T> | undefined;
}

const EXPLICIT_CONFIGURATION_SCOPES = [
  'globalValue',
  'workspaceValue',
  'workspaceFolderValue',
  'globalLanguageValue',
  'workspaceLanguageValue',
  'workspaceFolderLanguageValue'
] as const;

export function hasExplicitConfigurationValue<T>(inspection: ConfigurationInspection<T> | undefined): boolean {
  if (!inspection) return false;
  return EXPLICIT_CONFIGURATION_SCOPES.some(scope => Object.prototype.hasOwnProperty.call(inspection, scope));
}

export function getWithLegacyFallback<T>(
  primary: InspectableConfiguration,
  primarySection: string,
  legacy: InspectableConfiguration,
  legacySection: string,
  defaultValue: T
): T {
  if (hasExplicitConfigurationValue(primary.inspect<T>(primarySection))) {
    return primary.get<T>(primarySection, defaultValue);
  }
  return legacy.get<T>(legacySection, defaultValue);
}
