const fs = require('fs');
const path = require('path');
const { withAndroidManifest, withDangerousMod, withMainApplication } = require('@expo/config-plugins');

module.exports = function withTouchGrassAndroid(config) {
  // Copy Kotlin service templates and Android resources into Expo's generated project.
  // The templates live beside this plugin so a clean prebuild can recreate them.
  config = withDangerousMod(config, ['android', async mod => {
    const root = mod.modRequest.projectRoot;
    const kotlinDir = path.join(root, 'android/app/src/main/java/com/touchgrass/touchgrassrn');
    const xmlDir = path.join(root, 'android/app/src/main/res/xml');
    const valuesDir = path.join(root, 'android/app/src/main/res/values');
    const templateDir = path.join(__dirname, 'android');
    fs.mkdirSync(kotlinDir, { recursive: true }); fs.mkdirSync(xmlDir, { recursive: true }); fs.mkdirSync(valuesDir, { recursive: true });
    // Keep templates with this plugin so `expo prebuild --clean` can recreate the
    // native sources. On the first migration, seed them from the existing RN tree.
    for (const file of ['DnsVpnService.kt', 'AppBlockingAccessibilityService.kt']) {
      const sourcePath = path.join(kotlinDir, file);
      const templatePath = path.join(templateDir, file);
      const inputPath = fs.existsSync(templatePath) ? templatePath : sourcePath;
      if (!fs.existsSync(inputPath)) {
        throw new Error(
          `Missing ${file} template at ${templatePath}. Restore the native service source before running Expo prebuild.`
        );
      }
      const contents = fs.readFileSync(inputPath, 'utf8')
        .replace(/^package com\.touchgrass\.touchgrass\s*$/m, 'package com.touchgrass.touchgrassrn');
      if (!fs.existsSync(templatePath)) {
        fs.mkdirSync(templateDir, { recursive: true });
        fs.writeFileSync(templatePath, contents);
      }
      fs.writeFileSync(sourcePath, contents);
    }
    // Rewrite the source package name for the separate React Native application ID.
    for (const file of ['TouchGrassAndroidModule.kt', 'TouchGrassPackage.kt']) {
      const contents = fs.readFileSync(path.join(__dirname, file), 'utf8').replace(/^package com\.touchgrass\.touchgrass\s*$/m, 'package com.touchgrass.touchgrassrn');
      fs.writeFileSync(path.join(kotlinDir, file), contents);
    }
    const accessibilityConfig = path.join(xmlDir, 'app_blocking_accessibility_service.xml');
    const accessibilityTemplate = path.join(templateDir, 'app_blocking_accessibility_service.xml');
    const accessibilityInput = fs.existsSync(accessibilityTemplate) ? accessibilityTemplate : accessibilityConfig;
    if (!fs.existsSync(accessibilityInput)) {
      throw new Error(
        `Missing accessibility-service config template at ${accessibilityTemplate}. Restore the native XML resource before running Expo prebuild.`
      );
    }
    const accessibilityContents = fs.readFileSync(accessibilityInput, 'utf8');
    if (!fs.existsSync(accessibilityTemplate)) {
      fs.mkdirSync(templateDir, { recursive: true });
      fs.writeFileSync(accessibilityTemplate, accessibilityContents);
    }
    fs.writeFileSync(accessibilityConfig, accessibilityContents);
    fs.writeFileSync(path.join(valuesDir, 'touchgrass_strings.xml'), '<resources><string name="app_blocking_accessibility_label">TouchGrass app blocking</string><string name="app_blocking_accessibility_description">Detects when selected distracting apps are open so TouchGrass can pause them. It does not read screen content.</string></resources>');
    return mod;
  }]);
  // Register required permissions and declare both native Android services.
  config = withAndroidManifest(config, mod => {
    const manifest = mod.modResults.manifest;
    const app = manifest.application[0];
    const perms = manifest['uses-permission'] ?? (manifest['uses-permission'] = []);
    for (const name of ['android.permission.INTERNET', 'android.permission.FOREGROUND_SERVICE', 'android.permission.FOREGROUND_SERVICE_SYSTEM_EXEMPTED']) {
      if (!perms.some(p => p.$['android:name'] === name)) perms.push({ $: { 'android:name': name } });
    }
    const services = app.service ?? (app.service = []);
    if (!services.some(s => s.$['android:name'] === '.DnsVpnService')) services.push({ $: { 'android:name': '.DnsVpnService', 'android:exported': 'true', 'android:permission': 'android.permission.BIND_VPN_SERVICE', 'android:foregroundServiceType': 'systemExempted' }, 'intent-filter': [{ action: [{ $: { 'android:name': 'android.net.VpnService' } }] }] });
    if (!services.some(s => s.$['android:name'] === '.AppBlockingAccessibilityService')) services.push({ $: { 'android:name': '.AppBlockingAccessibilityService', 'android:exported': 'true', 'android:label': '@string/app_blocking_accessibility_label', 'android:permission': 'android.permission.BIND_ACCESSIBILITY_SERVICE' }, 'intent-filter': [{ action: [{ $: { 'android:name': 'android.accessibilityservice.AccessibilityService' } }] }], 'meta-data': [{ $: { 'android:name': 'android.accessibilityservice', 'android:resource': '@xml/app_blocking_accessibility_service' } }] });
    return mod;
  });
  // Add the manually written ReactPackage to Expo's generated MainApplication class.
  config = withMainApplication(config, mod => {
    let source = mod.modResults.contents;
    source = source.replace(/^import com\.touchgrass\.touchgrass\.TouchGrassPackage\s*\n/gm, '');
    if (!source.includes('import com.touchgrass.touchgrassrn.TouchGrassPackage')) source = source.replace(/(package [^\n]+\n)/, '$1\nimport com.touchgrass.touchgrassrn.TouchGrassPackage\n');
    if (!source.includes('add(TouchGrassPackage())')) source = source.replace(/(PackageList\(this\)\.packages\.apply\s*\{)/, '$1\n              add(TouchGrassPackage())');
    mod.modResults.contents = source;
    return mod;
  });
  return config;
};
