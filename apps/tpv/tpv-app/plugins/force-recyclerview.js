const { withProjectBuildGradle } = require('@expo/config-plugins')

// Stripe Terminal arrastra transitivamente androidx.recyclerview:recyclerview:1.4.0,
// que se publicó exigiendo compileSdk 35. Expo SDK 51 está fijado a AGP 8.2.1 /
// compileSdk 34 (su máximo soportado), así que forzamos recyclerview a la última
// versión compatible con SDK 34 (1.3.2). Quita este plugin cuando subas a un Expo
// SDK con AGP ≥ 8.6 / compileSdk 35.
const FORCE_BLOCK = `
allprojects {
  configurations.all {
    resolutionStrategy {
      force 'androidx.recyclerview:recyclerview:1.3.2'
    }
  }
}
`

module.exports = function withForceRecyclerview(config) {
  return withProjectBuildGradle(config, (cfg) => {
    if (cfg.modResults.language !== 'groovy') return cfg
    if (!cfg.modResults.contents.includes("force 'androidx.recyclerview:recyclerview")) {
      cfg.modResults.contents += FORCE_BLOCK
    }
    return cfg
  })
}
