const {
  withInfoPlist,
  withAndroidManifest,
  createRunOncePlugin,
} = require('@expo/config-plugins')

function ensureUrlType(infoPlist, scheme) {
  const urlTypes = Array.isArray(infoPlist.CFBundleURLTypes) ? infoPlist.CFBundleURLTypes : []
  const alreadyPresent = urlTypes.some((entry) =>
    Array.isArray(entry?.CFBundleURLSchemes) && entry.CFBundleURLSchemes.includes(scheme)
  )

  if (!alreadyPresent) {
    urlTypes.push({
      CFBundleTypeRole: 'Editor',
      CFBundleURLName: scheme,
      CFBundleURLSchemes: [scheme],
    })
  }

  infoPlist.CFBundleURLTypes = urlTypes
  return infoPlist
}

const withVariantExpoScheme = (config, props = {}) => {
  const variant = props.variant || 'production'
  const appScheme = props.appScheme

  if (!appScheme || variant === 'production') {
    // Production already gets Expo's standard scheme wiring from app.config.ts.
    // This plugin only adds the variant-specific exp+<scheme> alias needed by
    // development-style dev-client launch flows.
    return config
  }

  config = withInfoPlist(config, (modConfig) => {
    modConfig.modResults = ensureUrlType(modConfig.modResults, `exp+${appScheme}`)
    return modConfig
  })

  return withAndroidManifest(config, (modConfig) => {
    const manifest = modConfig.modResults.manifest
    const application = manifest.application?.[0]
    const activity = application?.activity?.find(
      (candidate) => candidate?.$?.['android:name'] === '.MainActivity'
    )

    if (!activity) {
      return modConfig
    }

    const intentFilters = Array.isArray(activity['intent-filter'])
      ? activity['intent-filter']
      : []
    const viewIntent = intentFilters.find((intentFilter) => {
      const actions = intentFilter.action ?? []
      return actions.some(
        (action) => action?.$?.['android:name'] === 'android.intent.action.VIEW'
      )
    })

    if (!viewIntent) {
      return modConfig
    }

    const dataEntries = Array.isArray(viewIntent.data) ? viewIntent.data : []
    const aliasScheme = `exp+${appScheme}`
    const alreadyPresent = dataEntries.some(
      (entry) => entry?.$?.['android:scheme'] === aliasScheme
    )

    if (!alreadyPresent) {
      dataEntries.push({ $: { 'android:scheme': aliasScheme } })
      viewIntent.data = dataEntries
    }

    return modConfig
  })
}

module.exports = createRunOncePlugin(withVariantExpoScheme, 'with-variant-expo-scheme', '1.0.0')
