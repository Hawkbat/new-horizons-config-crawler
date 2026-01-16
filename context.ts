
export interface AnalysisContext {
  manifestConfigs: Record<string, any> // Mod UniqueName -> manifest.json data

  titleScreenConfigs: Record<string, any> // Mod UniqueName -> title-screen.json data

  addonConfigs: Record<string, any> // Mod UniqueName -> addon-manifest.json data
  settingConfigs: Record<string, any> // Mod UniqueName -> default-config.json data

  planetConfigs: Record<string, Record<string, any>> // Mod UniqueName -> Config File Path -> planet json data

  systemConfigs: Record<string, Record<string, any>> // Mod UniqueName -> Config File Path -> system json data
}

export function createAnalysisContext(): AnalysisContext {
  return {
    manifestConfigs: {},
    titleScreenConfigs: {},
    addonConfigs: {},
    settingConfigs: {},
    planetConfigs: {},
    systemConfigs: {},
  }
}
